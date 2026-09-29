import { cookies } from 'next/headers'
import { eventBusInstance } from '@/lib/services/eventBus'
import { validateSession } from '@/lib/services/authService'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('session')?.value

  if (!sessionToken) {
    return new Response('Unauthorized', { status: 401 })
  }

  const session = await validateSession(sessionToken)
  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  const userId = session.user.id

  const encoder = new TextEncoder()
  let isClosed = false
  let keepAlive: ReturnType<typeof setInterval> | undefined
  let unsubscribe: (() => void) | undefined

  // Both the keep-alive timer and the event-bus subscription are per-connection
  // resources that must be released together. A ReadableStream only calls
  // cancel(); the value returned from start() is discarded, so teardown has to
  // live out here or it simply never runs.
  const teardown = (): void => {
    if (isClosed) return
    isClosed = true
    if (keepAlive !== undefined) {
      clearInterval(keepAlive)
      keepAlive = undefined
    }
    if (unsubscribe !== undefined) {
      unsubscribe()
      unsubscribe = undefined
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        if (isClosed) return
        try {
          controller.enqueue(encoder.encode(data))
        } catch (error) {
          // The client vanished mid-write. Tearing down here stops the interval
          // and the bus subscription, so nothing tries this socket again.
          logger.debug({ error }, 'SSE write failed; releasing stream')
          teardown()
        }
      }

      const sendEvent = (event: string, data: unknown) => {
        send(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      }

      sendEvent('connected', { timestamp: new Date().toISOString() })

      unsubscribe = eventBusInstance.on((event) => {
        if (event.userId && event.userId !== userId) {
          return
        }
        sendEvent(event.type, event.payload)
      })

      keepAlive = setInterval(() => {
        send(': keep-alive\n\n')
      }, 30_000)
    },
    cancel() {
      teardown()
    },
  })

  // React to the disconnect as soon as it happens, rather than waiting for the
  // next write to fail.
  //
  // Wrapping enqueue() in try/catch is not enough on its own. The browser
  // aborting the request does not raise a catchable error at the point of
  // enqueue: it arrives later, asynchronously, from Node's HTTP layer as
  //   uncaughtException: [Error: aborted] { code: 'ECONNRESET' }
  // and there is no handler between that and the process, so the whole server
  // dies. Any user closing the tab was enough to take the dashboard down, and
  // that is what the E2E run kept tripping over.
  //
  // The abort signal fires first, so releasing the stream here means the
  // socket is never written to again and the asynchronous error never fires.
  if (request.signal) {
    if (request.signal.aborted) {
      teardown()
    } else {
      request.signal.addEventListener('abort', () => {
        logger.debug('SSE client aborted; releasing stream')
        teardown()
      })
    }
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}