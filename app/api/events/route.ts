import { cookies } from 'next/headers'
import { eventBusInstance } from '@/lib/services/eventBus'
import { validateSession } from '@/lib/services/authService'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
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
          // A client that closes the tab mid-write surfaces here as ECONNRESET.
          // Letting the throw escape — from a timer, or from an event-bus emit —
          // would become an uncaughtException and take the whole server down.
          // The event bus swallows handler errors, but the keep-alive interval
          // does not, which is why this guard is the only thing between a closed
          // tab and a crashed process.
          logger.debug({ error }, 'SSE client disconnected; releasing stream')
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

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}