import { GET } from '@/app/api/events/route'
import { eventBusInstance } from '@/lib/services/eventBus'

/**
 * The SSE endpoint holds two per-connection resources: an event-bus
 * subscription and a 30s keep-alive interval. Both have to be released when
 * the client goes away, and both used to leak:
 *
 *  - `start()` returned a teardown function, but a ReadableStream discards
 *    the value returned from start(). Only cancel() runs.
 *  - cancel() set a flag and stopped sending, but never unsubscribed or
 *    cleared the timer, so every closed tab left a live listener behind.
 *
 * That leak mattered twice over. The listener set grows for the life of the
 * process, and once the client is gone, the surviving keep-alive interval
 * calls controller.enqueue() on a dead stream. That throws ECONNRESET from
 * inside a timer, where nothing catches it, and the process dies. The event
 * bus does guard its own handler calls, so the crash came from the interval.
 */

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}))

jest.mock('@/lib/services/authService', () => ({
  validateSession: jest.fn(),
}))

jest.mock('@/lib/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { cookies } from 'next/headers'
import { validateSession } from '@/lib/services/authService'

const mockedCookies = cookies as unknown as jest.Mock
const mockedValidateSession = validateSession as unknown as jest.Mock

const USER_ID = 'user-1'

function makeSession() {
  return {
    user: { id: USER_ID, email: 'admin@example.com', role: 'admin' },
    session: { id: 'sess-1', userId: USER_ID },
  }
}

function authorise(): void {
  mockedCookies.mockResolvedValue({ get: (name: string) => (name === 'session' ? { value: 'tok' } : undefined) })
  mockedValidateSession.mockResolvedValue(makeSession())
}

/** Reads the whole stream to completion, then cancels the reader. */
async function drain(response: Response): Promise<string> {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let out = ''
  // The stream never closes on its own, so read whatever is buffered and stop.
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    out += decoder.decode(value)
    if (out.includes('\n\n')) break
  }
  await reader.cancel()
  return out
}

describe('GET /api/events', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    eventBusInstance.clear()
    authorise()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    eventBusInstance.clear()
  })

  it('rejects a request with no session cookie', async () => {
    mockedCookies.mockResolvedValue({ get: () => undefined })
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('rejects a request with an invalid session', async () => {
    mockedValidateSession.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('opens a stream and greets the client', async () => {
    const res = await GET()
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    const body = await drain(res)
    expect(body).toContain('event: connected')
  })

  it('does not throw when the client disconnects mid-write', async () => {
    const res = await GET()
    const stream = res.body as ReadableStream<Uint8Array>
    const reader = stream.getReader()
    await reader.read()
    // Simulate the socket dying: a cancelled reader makes the next enqueue
    // fail, exactly as it does when a browser tab closes on a keep-alive tick.
    await reader.cancel()

    expect(() => {
      jest.advanceTimersByTime(30_000)
      eventBusInstance.emit({
        type: 'bandwidth.tick',
        timestamp: new Date().toISOString(),
        userId: USER_ID,
        payload: {
          deviceId: 'd1',
          uploadSpeed: 1,
          downloadSpeed: 1,
          timestamp: new Date().toISOString(),
        },
      })
    }).not.toThrow()
  })

  it('releases the event-bus subscription when the client disconnects', async () => {
    // This is the assertion that matters. The handler used to stay in the bus
    // forever, so a dashboard opened and closed a thousand times left a
    // thousand subscribers still receiving every scan event.
    expect(eventBusInstance.listenerCount()).toBe(0)

    const res = await GET()
    expect(eventBusInstance.listenerCount()).toBe(1)

    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()
    await reader.cancel()

    expect(eventBusInstance.listenerCount()).toBe(0)
  })

  it('clears the keep-alive interval on disconnect', async () => {
    const res = await GET()
    expect(jest.getTimerCount()).toBe(1)

    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()
    await reader.cancel()

    // A surviving interval would keep waking every 30s for a client that is
    // already gone, and its enqueue is what crashed the server.
    expect(jest.getTimerCount()).toBe(0)
  })
})
