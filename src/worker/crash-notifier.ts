import { PROJECT_LABEL, SERVICE_LABEL } from './compose-status'
import type { DockerEvent } from './docker-api'

/** Turns container events into "something crashed" notifications, ignoring stops the user asked for. */

export type CrashNotification = { title: string; body: string }

/** `docker stop`, `compose down` and friends send a kill before the container dies. */
export const INTENTIONAL_KILL_WINDOW_MS = 30_000
/** Docker restarts a crash-looping container about once a minute; notify about it at most this often. */
export const REPEAT_SUPPRESS_MS = 10 * 60_000

export const WATCHED_EVENTS = ['kill', 'die', 'oom', 'health_status']

const TITLE_MAX = 120

export class CrashNotifier {
  private readonly lastKill = new Map<string, number>()
  private readonly lastNotified = new Map<string, { at: number; suppressed: number }>()

  handle(event: DockerEvent, now: number): CrashNotification | null {
    if (event.Type !== 'container') {
      return null
    }
    const id = event.Actor.ID
    const attributes = event.Actor.Attributes
    this.prune(now)

    let problem: string
    if (event.Action === 'kill') {
      this.lastKill.set(id, now)
      return null
    } else if (event.Action === 'die') {
      const exitCode = attributes.exitCode ?? '?'
      const killedRecently = now - (this.lastKill.get(id) ?? -Infinity) < INTENTIONAL_KILL_WINDOW_MS
      if (exitCode === '0' || killedRecently) {
        return null
      }
      problem = `exited with code ${exitCode}`
    } else if (event.Action === 'oom') {
      problem = 'ran out of memory'
    } else if (event.Action === 'health_status: unhealthy') {
      problem = 'is unhealthy'
    } else {
      return null
    }

    const previous = this.lastNotified.get(id)
    if (previous && now - previous.at < REPEAT_SUPPRESS_MS) {
      previous.suppressed += 1
      return null
    }
    this.lastNotified.set(id, { at: now, suppressed: 0 })

    const service = attributes[SERVICE_LABEL] ?? attributes.name ?? id.slice(0, 12)
    const title = `${service} ${problem}`
    const details = [attributes[PROJECT_LABEL], attributes.image].filter(Boolean).join(' · ')
    const repeats = previous?.suppressed ? `${previous.suppressed} more times since the last notice` : ''
    return {
      title: title.length <= TITLE_MAX ? title : `${title.slice(0, TITLE_MAX - 1)}…`,
      body: [repeats, details].filter(Boolean).join('\n')
    }
  }

  private prune(now: number): void {
    for (const [id, at] of this.lastKill) {
      if (now - at >= INTENTIONAL_KILL_WINDOW_MS) {
        this.lastKill.delete(id)
      }
    }
    // Kept for two windows so the next notice can still say how many crashes it skipped.
    for (const [id, entry] of this.lastNotified) {
      if (now - entry.at >= 2 * REPEAT_SUPPRESS_MS) {
        this.lastNotified.delete(id)
      }
    }
  }
}
