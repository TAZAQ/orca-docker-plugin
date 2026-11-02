import type { LogsPayload } from '../shared/protocol'

/** Runs the one log stream the panel shows, batching its text to stay within Orca's post limits. */

/** Orca allows 200 posts per 10 s for the whole plugin, and the tree needs some of them. */
export const LOGS_FLUSH_MS = 250
/** A container flooding its output loses the oldest text rather than the panel its latest. */
export const LOGS_POST_MAX_CHARS = 64 * 1024
/** A panel can close without saying so; a stream nobody renews stops by itself. */
export const LOGS_LEASE_MS = 60_000

export type LogStreamsOptions = {
  follow: (id: string, onText: (text: string) => void, signal: AbortSignal) => Promise<void>
  post: (payload: LogsPayload) => void
}

type Stream = {
  id: string
  controller: AbortController
  buffered: string
  flushTimer?: ReturnType<typeof setTimeout>
  leaseTimer?: ReturnType<typeof setTimeout>
}

export class LogStreams {
  private stream: Stream | null = null
  private nextId = 0

  constructor(private readonly options: LogStreamsOptions) {}

  start(containerId: string): string {
    this.stop()
    const stream: Stream = {
      id: `logs-${++this.nextId}`,
      controller: new AbortController(),
      buffered: ''
    }
    this.stream = stream
    this.renew(stream.id)
    void this.run(stream, containerId)
    return stream.id
  }

  renew(streamId: string): boolean {
    const stream = this.stream
    if (stream?.id !== streamId) {
      return false
    }
    clearTimeout(stream.leaseTimer)
    stream.leaseTimer = setTimeout(() => this.stop(streamId), LOGS_LEASE_MS)
    return true
  }

  /** Stops the given stream, or whichever is running. */
  stop(streamId?: string): void {
    const stream = this.stream
    if (!stream || (streamId !== undefined && stream.id !== streamId)) {
      return
    }
    this.stream = null
    this.release(stream)
    stream.controller.abort()
  }

  private release(stream: Stream): void {
    clearTimeout(stream.flushTimer)
    clearTimeout(stream.leaseTimer)
  }

  private async run(stream: Stream, containerId: string): Promise<void> {
    let error: string | undefined
    try {
      await this.options.follow(containerId, (text) => this.append(stream, text), stream.controller.signal)
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    if (stream.controller.signal.aborted) {
      return
    }
    this.flush(stream)
    this.stop(stream.id)
    this.options.post({
      streamId: stream.id,
      kind: 'ended',
      ...(error === undefined ? {} : { error })
    })
  }

  private append(stream: Stream, text: string): void {
    stream.buffered = (stream.buffered + text).slice(-LOGS_POST_MAX_CHARS)
    stream.flushTimer ??= setTimeout(() => this.flush(stream), LOGS_FLUSH_MS)
  }

  private flush(stream: Stream): void {
    clearTimeout(stream.flushTimer)
    stream.flushTimer = undefined
    if (stream.buffered !== '') {
      this.options.post({ streamId: stream.id, kind: 'text', text: stream.buffered })
      stream.buffered = ''
    }
  }
}
