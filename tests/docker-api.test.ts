import { mkdtemp } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DockerApi, DockerApiError, type DockerEvent } from '../src/worker/docker-api'
import { EventWatcher } from '../src/worker/event-watcher'

let server: Server | null = null

afterEach(async () => {
  server?.closeAllConnections()
  await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined))
  server = null
})

async function fakeDaemon(handler: (url: string, res: ServerResponse) => void): Promise<DockerApi> {
  const socketPath = join(await mkdtemp(join(tmpdir(), 'fake-docker-')), 'docker.sock')
  server = createServer((req, res) => handler(req.url ?? '', res))
  await new Promise<void>((resolve) => server!.listen(socketPath, resolve))
  return new DockerApi({ kind: 'socket', socketPath })
}

const dieEvent = { Type: 'container', Action: 'die', Actor: { ID: 'c1', Attributes: { exitCode: '1' } }, time: 1 }

describe('DockerApi', () => {
  it('lists containers over the unix socket', async () => {
    let seen = ''
    const api = await fakeDaemon((url, res) => {
      seen = url
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify([{ Id: 'c1', Names: ['/redis'], State: 'running', Status: 'Up', Labels: {} }]))
    })
    expect(await api.listContainers()).toHaveLength(1)
    expect(seen).toBe('/containers/json?all=1')
  })

  it('surfaces the daemon error message', async () => {
    const api = await fakeDaemon((_url, res) => {
      res.statusCode = 500
      res.end(JSON.stringify({ message: 'boom' }))
    })
    await expect(api.listContainers()).rejects.toEqual(new DockerApiError('boom', 500))
  })

  it('parses events split across chunks and sends the filters', async () => {
    let seen = ''
    const api = await fakeDaemon((url, res) => {
      seen = decodeURIComponent(url)
      const line = JSON.stringify(dieEvent)
      res.write(line.slice(0, 10))
      setTimeout(() => res.write(`${line.slice(10)}\n${line}`), 5)
      setTimeout(() => res.end('\n'), 10)
    })
    const events: DockerEvent[] = []
    await api.streamEvents({ type: ['container'] }, (event) => events.push(event), new AbortController().signal)
    expect(events).toEqual([dieEvent, dieEvent])
    expect(seen).toBe('/events?filters={"type":["container"]}')
  })
})

describe('EventWatcher', () => {
  it('reconnects after the daemon drops the stream and stops on demand', async () => {
    let connections = 0
    const api = await fakeDaemon((_url, res) => {
      connections += 1
      res.end(`${JSON.stringify(dieEvent)}\n`)
    })
    const events: DockerEvent[] = []
    const logs: string[] = []
    const watcher = new EventWatcher({
      api: async () => api,
      filters: {},
      onEvent: (event) => events.push(event),
      log: (message) => logs.push(message),
      sleep: () => new Promise((resolve) => setTimeout(resolve, 1))
    })
    watcher.start()
    await expect.poll(() => connections).toBeGreaterThanOrEqual(3)
    await watcher.stop()
    expect(watcher.running).toBe(false)
    expect(events.length).toBeGreaterThanOrEqual(3)
    expect(logs).toEqual([])
  })

  it('logs a missing daemon once, not on every retry', async () => {
    const logs: string[] = []
    let attempts = 0
    const watcher = new EventWatcher({
      api: async () => {
        attempts += 1
        return new DockerApi({ kind: 'socket', socketPath: '/nonexistent/docker.sock' })
      },
      filters: {},
      onEvent: () => undefined,
      log: (message) => logs.push(message),
      sleep: () => new Promise((resolve) => setTimeout(resolve, 1))
    })
    watcher.start()
    await expect.poll(() => attempts).toBeGreaterThanOrEqual(3)
    await watcher.stop()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('docker events unavailable')
  })
})
