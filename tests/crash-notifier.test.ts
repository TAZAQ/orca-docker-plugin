import { describe, expect, it } from 'vitest'
import { CrashNotifier, INTENTIONAL_KILL_WINDOW_MS, REPEAT_SUPPRESS_MS } from '../src/worker/crash-notifier'
import type { DockerEvent } from '../src/worker/docker-api'

function event(Action: string, attributes: Record<string, string> = {}, ID = 'c1'): DockerEvent {
  return {
    Type: 'container',
    Action,
    time: 0,
    Actor: {
      ID,
      Attributes: {
        name: 'brave-medods-of-the-future-postgres-1',
        image: 'postgres:16',
        'com.docker.compose.project': 'brave-medods-of-the-future',
        'com.docker.compose.service': 'postgres',
        ...attributes
      }
    }
  }
}

describe('CrashNotifier', () => {
  it('reports a container that dies on its own', () => {
    expect(new CrashNotifier().handle(event('die', { exitCode: '137' }), 1000)).toEqual({
      title: 'postgres exited with code 137',
      body: 'brave-medods-of-the-future · postgres:16'
    })
  })

  it('stays quiet when the user stopped it', () => {
    const notifier = new CrashNotifier()
    expect(notifier.handle(event('kill', { signal: '15' }), 1000)).toBeNull()
    expect(notifier.handle(event('die', { exitCode: '143' }), 3000)).toBeNull()
  })

  it('reports a die long after an unrelated kill', () => {
    const notifier = new CrashNotifier()
    notifier.handle(event('kill'), 0)
    expect(notifier.handle(event('die', { exitCode: '1' }), INTENTIONAL_KILL_WINDOW_MS + 1)).not.toBeNull()
  })

  it('ignores clean exits of one-shot containers', () => {
    expect(new CrashNotifier().handle(event('die', { exitCode: '0' }), 0)).toBeNull()
  })

  it('reports OOM and unhealthy, but not healthy', () => {
    const notifier = new CrashNotifier()
    expect(notifier.handle(event('oom', {}, 'a'), 0)?.title).toBe('postgres ran out of memory')
    expect(notifier.handle(event('health_status: unhealthy', {}, 'b'), 0)?.title).toBe('postgres is unhealthy')
    expect(notifier.handle(event('health_status: healthy', {}, 'c'), 0)).toBeNull()
  })

  it('notifies about a once-a-minute crash loop only every few minutes', () => {
    const notifier = new CrashNotifier()
    const minute = 60_000
    const notices = Array.from({ length: 12 }, (_, i) =>
      notifier.handle(event('die', { exitCode: '1' }), i * minute + 1)
    ).filter((notice) => notice !== null)
    expect(notices).toHaveLength(2)
    expect(notices[1]!.body).toBe('9 more times since the last notice\nbrave-medods-of-the-future · postgres:16')
  })

  it('does not repeat itself for a crash loop', () => {
    const notifier = new CrashNotifier()
    expect(notifier.handle(event('oom'), 0)).not.toBeNull()
    expect(notifier.handle(event('die', { exitCode: '137' }), 10)).toBeNull()
    expect(notifier.handle(event('die', { exitCode: '1' }), REPEAT_SUPPRESS_MS - 1)).toBeNull()
    expect(notifier.handle(event('die', { exitCode: '1' }), REPEAT_SUPPRESS_MS + 10)).not.toBeNull()
  })

  it('names standalone containers by container name', () => {
    const notification = new CrashNotifier().handle(
      {
        Type: 'container',
        Action: 'die',
        time: 0,
        Actor: { ID: 'abc', Attributes: { name: 'kafka_broker', exitCode: '2' } }
      },
      0
    )
    expect(notification).toEqual({ title: 'kafka_broker exited with code 2', body: '' })
  })
})
