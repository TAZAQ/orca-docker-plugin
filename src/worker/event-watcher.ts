import type { DockerApi, DockerEvent } from './docker-api'

/** Keeps a /events stream open, reconnecting with backoff while the daemon is down or restarting. */

export const RECONNECT_MIN_MS = 2_000
export const RECONNECT_MAX_MS = 30_000

export type EventWatcherOptions = {
  api: () => Promise<DockerApi>
  filters: Record<string, string[]>
  onEvent: (event: DockerEvent) => void
  log: (message: string) => void
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

export class EventWatcher {
  private controller: AbortController | null = null
  private loop: Promise<void> | null = null

  constructor(private readonly options: EventWatcherOptions) {}

  get running(): boolean {
    return this.controller !== null
  }

  start(): void {
    if (this.controller) {
      return
    }
    const controller = new AbortController()
    this.controller = controller
    this.loop = this.run(controller.signal)
  }

  async stop(): Promise<void> {
    this.controller?.abort()
    this.controller = null
    await this.loop
    this.loop = null
  }

  private async run(signal: AbortSignal): Promise<void> {
    const sleep = this.options.sleep ?? abortableSleep
    let delay = RECONNECT_MIN_MS
    let lastError = ''
    while (!signal.aborted) {
      const startedAt = Date.now()
      try {
        const api = await this.options.api()
        await api.streamEvents(this.options.filters, this.options.onEvent, signal)
        lastError = ''
      } catch (error) {
        if (signal.aborted) {
          break
        }
        const message = error instanceof Error ? error.message : String(error)
        // Log once per distinct failure so a stopped daemon does not flood the plugin log.
        if (message !== lastError) {
          this.options.log(`docker events unavailable: ${message}`)
          lastError = message
        }
      }
      // A stream that stayed up for a while was healthy; only quick failures back off.
      if (Date.now() - startedAt >= RECONNECT_MAX_MS) {
        delay = RECONNECT_MIN_MS
      }
      await sleep(delay, signal)
      delay = Math.min(delay * 2, RECONNECT_MAX_MS)
    }
  }
}
