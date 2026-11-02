import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOGS_FLUSH_MS, LOGS_LEASE_MS, LOGS_POST_MAX_CHARS, LogStreams } from '../src/worker/log-streams'
import type { LogsPayload } from '../src/shared/protocol'

function setup() {
  const posted: LogsPayload[] = []
  const follows: {
    id: string
    onText: (text: string) => void
    signal: AbortSignal
    finish: (error?: Error) => void
  }[] = []
  const streams = new LogStreams({
    follow: (id, onText, signal) =>
      new Promise<void>((resolve, reject) => {
        follows.push({ id, onText, signal, finish: (error) => (error ? reject(error) : resolve()) })
      }),
    post: (payload) => posted.push(payload)
  })
  return { streams, posted, follows }
}

describe('LogStreams', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  it('batches text into one post', async () => {
    const { streams, posted, follows } = setup()
    const id = streams.start('c1')
    follows[0]!.onText('a')
    follows[0]!.onText('b')
    expect(posted).toEqual([])
    await vi.advanceTimersByTimeAsync(LOGS_FLUSH_MS)
    expect(posted).toEqual([{ streamId: id, kind: 'text', text: 'ab' }])
  })

  it('keeps the newest text of a flood', async () => {
    const { streams, posted, follows } = setup()
    streams.start('c1')
    follows[0]!.onText('x'.repeat(LOGS_POST_MAX_CHARS))
    follows[0]!.onText('tail')
    await vi.advanceTimersByTimeAsync(LOGS_FLUSH_MS)
    const [payload] = posted
    expect(payload?.kind === 'text' && payload.text.length).toBe(LOGS_POST_MAX_CHARS)
    expect(payload?.kind === 'text' && payload.text.endsWith('tail')).toBe(true)
  })

  it('tells the panel when the container stops, after the last text', async () => {
    const { streams, posted, follows } = setup()
    const id = streams.start('c1')
    follows[0]!.onText('bye\n')
    follows[0]!.finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(posted).toEqual([
      { streamId: id, kind: 'text', text: 'bye\n' },
      { streamId: id, kind: 'ended' }
    ])
  })

  it('tells the panel why a stream failed', async () => {
    const { streams, posted, follows } = setup()
    const id = streams.start('c1')
    follows[0]!.finish(new Error('no such container'))
    await vi.advanceTimersByTimeAsync(0)
    expect(posted).toEqual([{ streamId: id, kind: 'ended', error: 'no such container' }])
  })

  it('runs one stream at a time', () => {
    const { streams, follows } = setup()
    const first = streams.start('c1')
    streams.start('c2')
    expect(follows[0]!.signal.aborted).toBe(true)
    expect(streams.renew(first)).toBe(false)
  })

  it('stops a stream nobody renews, because the panel may be gone', async () => {
    const { streams, follows } = setup()
    const id = streams.start('c1')
    await vi.advanceTimersByTimeAsync(LOGS_LEASE_MS - 1)
    expect(streams.renew(id)).toBe(true)
    await vi.advanceTimersByTimeAsync(LOGS_LEASE_MS - 1)
    expect(follows[0]!.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(follows[0]!.signal.aborted).toBe(true)
  })

  it('posts nothing after being stopped', async () => {
    const { streams, posted, follows } = setup()
    streams.start('c1')
    follows[0]!.onText('late')
    streams.stop()
    follows[0]!.finish(new Error('aborted'))
    await vi.advanceTimersByTimeAsync(LOGS_FLUSH_MS)
    expect(posted).toEqual([])
  })
})
