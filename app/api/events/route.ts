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

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        if (!isClosed) {
          controller.enqueue(encoder.encode(data))
        }
      }

      const sendEvent = (event: string, data: unknown) => {
        send(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      }

      sendEvent('connected', { timestamp: new Date().toISOString() })

      const unsubscribe = eventBusInstance.on((event) => {
        if (event.userId && event.userId !== userId) {
          return
        }
        sendEvent(event.type, event.payload)
      })

      const keepAlive = setInterval(() => {
        if (!isClosed) {
          send(': keep-alive\n\n')
        }
      }, 30_000)

      return () => {
        isClosed = true
        clearInterval(keepAlive)
        unsubscribe()
      }
    },
    cancel() {
      isClosed = true
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