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

async function fakeDaemon(
  handler: (url: string, res: ServerResponse, method: string) => void
): Promise<DockerApi> {
  const socketPath = join(await mkdtemp(join(tmpdir(), 'fake-docker-')), 'docker.sock')
  server = createServer((req, res) => handler(req.url ?? '', res, req.method ?? ''))
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

  it.each([
    ['start', 'POST /containers/c1/start'],
    ['stop', 'POST /containers/c1/stop'],
    ['restart', 'POST /containers/c1/restart'],
    ['pause', 'POST /containers/c1/pause'],
    ['unpause', 'POST /containers/c1/unpause'],
    ['remove', 'DELETE /containers/c1']
  ] as const)('%s calls the right endpoint', async (action, expected) => {
    let seen = ''
    const api = await fakeDaemon((url, res, method) => {
      seen = `${method} ${url}`
      res.statusCode = 204
      res.end()
    })
    await api.containerAction('c1', action)
    expect(seen).toBe(expected)
  })

  it('treats a container already in that state as done', async () => {
    const api = await fakeDaemon((_url, res) => {
      res.statusCode = 304
      res.end()
    })
    await expect(api.containerAction('c1', 'stop')).resolves.toBeUndefined()
  })

  it('surfaces a failed action', async () => {
    const api = await fakeDaemon((_url, res) => {
      res.statusCode = 409
      res.end(JSON.stringify({ message: 'container is running' }))
    })
    await expect(api.containerAction('c1', 'remove')).rejects.toEqual(
      new DockerApiError('container is running', 409)
    )
  })

  it('reads images, networks and volumes, and a daemon with no volumes', async () => {
    const api = await fakeDaemon((url, res) => {
      res.end(
        JSON.stringify(
          url === '/volumes' ? { Volumes: null } : [{ Id: 'x', Name: 'x', Driver: 'bridge', Size: 1 }]
        )
      )
    })
    await expect(api.listImages()).resolves.toHaveLength(1)
    await expect(api.listNetworks()).resolves.toHaveLength(1)
    await expect(api.listVolumes()).resolves.toEqual([])
  })

  it('follows multiplexed logs of a container without a TTY', async () => {
    const seen: string[] = []
    const api = await fakeDaemon((url, res) => {
      seen.push(url)
      if (url.endsWith('/json')) {
        res.end(JSON.stringify({ Config: { Tty: false } }))
        return
      }
      const payload = Buffer.from('hello\n')
      const header = Buffer.alloc(8)
      header[0] = 1
      header.writeUInt32BE(payload.length, 4)
      res.end(Buffer.concat([header, payload]))
    })
    const texts: string[] = []
    await api.followLogs('c1', (text) => texts.push(text), new AbortController().signal)
    expect(texts.join('')).toBe('hello\n')
    expect(seen[1]).toBe('/containers/c1/logs?follow=1&stdout=1&stderr=1&tail=500')
  })

  it('removes an image by id with force, and a container with force', async () => {
    const seen: string[] = []
    const api = await fakeDaemon((url, res, method) => {
      seen.push(`${method} ${url}`)
      res.end('[]')
    })
    await api.removeImage('sha256:abc')
    await api.forceRemoveContainer('c1')
    expect(seen).toEqual(['DELETE /images/sha256%3Aabc?force=1', 'DELETE /containers/c1?force=1'])
  })

  it.each([
    ['dangling', '{"dangling":["true"]}'],
    ['unused', '{"dangling":["false"]}']
  ] as const)('prunes %s images with the matching filter', async (mode, filter) => {
    let seen = ''
    const api = await fakeDaemon((url, res, method) => {
      seen = `${method} ${decodeURIComponent(url)}`
      res.end(
        JSON.stringify({
          ImagesDeleted: [{ Untagged: 'old:1' }, { Deleted: 'sha256:a' }, { Deleted: 'sha256:b' }],
          SpaceReclaimed: 500
        })
      )
    })
    await expect(api.pruneImages(mode)).resolves.toEqual({ removed: 2, reclaimed: 500 })
    expect(seen).toBe(`POST /images/prune?filters=${filter}`)
  })

  it('reports a prune that removed nothing', async () => {
    const api = await fakeDaemon((_url, res) => {
      res.end(JSON.stringify({ ImagesDeleted: null, SpaceReclaimed: 0 }))
    })
    await expect(api.pruneImages('dangling')).resolves.toEqual({ removed: 0, reclaimed: 0 })
  })

  it('creates and removes networks and volumes, and removes a stopped container without force', async () => {
    const seen: string[] = []
    const api = await fakeDaemon((url, res, method) => {
      seen.push(`${method} ${url}`)
      res.statusCode = url.includes('create') ? 201 : 204
      res.end(url.includes('create') ? JSON.stringify({ Id: 'x' }) : '')
    })
    await api.createNetwork({ name: 'net', driver: 'bridge', attachable: true, internal: true })
    await api.createVolume('vol')
    await api.removeNetwork('n1')
    await api.removeVolume('my vol')
    await api.removeStoppedContainer('c1')
    expect(seen).toEqual([
      'POST /networks/create',
      'POST /volumes/create',
      'DELETE /networks/n1',
      'DELETE /volumes/my%20vol',
      'DELETE /containers/c1'
    ])
  })

  it('sends the network options to the daemon', async () => {
    let body = ''
    const api = await fakeDaemon((_url, res) => {
      res.statusCode = 201
      res.end('{}')
    })
    server!.prependListener('request', (req) => req.on('data', (chunk: Buffer) => (body += chunk)))
    await api.createNetwork({ name: 'net', driver: 'overlay', attachable: true, internal: false })
    expect(JSON.parse(body)).toEqual({
      Name: 'net',
      Driver: 'overlay',
      Attachable: true,
      Internal: false,
      CheckDuplicate: true
    })
  })

  it('reads what a command printed in a container', async () => {
    const seen: string[] = []
    const api = await fakeDaemon((url, res, method) => {
      seen.push(`${method} ${url}`)
      if (url.endsWith('/exec')) {
        res.end(JSON.stringify({ Id: 'e1' }))
        return
      }
      const payload = Buffer.from('total 0\n')
      const header = Buffer.alloc(8)
      header[0] = 1
      header.writeUInt32BE(payload.length, 4)
      res.end(Buffer.concat([header, payload]))
    })
    await expect(api.execOutput('c1', ['ls', '-la', '/'])).resolves.toBe('total 0\n')
    expect(seen).toEqual(['POST /containers/c1/exec', 'POST /exec/e1/start'])
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
