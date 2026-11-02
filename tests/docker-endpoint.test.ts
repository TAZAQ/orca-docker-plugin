import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDockerHost, resolveDockerEndpoint } from '../src/worker/docker-endpoint'

async function homeWithContext(name: string | null, host?: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'docker-home-'))
  await mkdir(join(home, '.docker'))
  if (name !== null) {
    await writeFile(join(home, '.docker', 'config.json'), JSON.stringify({ currentContext: name }))
  }
  if (name !== null && host !== undefined) {
    const dir = join(home, '.docker', 'contexts', 'meta', createHash('sha256').update(name).digest('hex'))
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ Name: name, Endpoints: { docker: { Host: host } } }))
  }
  return home
}

describe('parseDockerHost', () => {
  it('understands unix, npipe and tcp hosts', () => {
    expect(parseDockerHost('unix:///run/user/1000/docker.sock')).toEqual({
      kind: 'socket',
      socketPath: '/run/user/1000/docker.sock'
    })
    expect(parseDockerHost('npipe:////./pipe/dockerDesktopLinuxEngine')).toEqual({
      kind: 'socket',
      socketPath: '\\\\.\\pipe\\dockerDesktopLinuxEngine'
    })
    expect(parseDockerHost('tcp://10.0.0.5:2375')).toEqual({ kind: 'tcp', host: '10.0.0.5', port: 2375 })
    expect(parseDockerHost('ssh://user@box')).toBeNull()
  })
})

describe('resolveDockerEndpoint', () => {
  it('falls back to the default socket without a docker config', async () => {
    const home = await homeWithContext(null)
    expect(await resolveDockerEndpoint(home, 'linux')).toEqual({ kind: 'socket', socketPath: '/var/run/docker.sock' })
  })

  it('uses the current context endpoint, like the docker CLI', async () => {
    const home = await homeWithContext('desktop-linux', 'unix:///home/u/.docker/desktop/docker.sock')
    expect(await resolveDockerEndpoint(home, 'linux')).toEqual({
      kind: 'socket',
      socketPath: '/home/u/.docker/desktop/docker.sock'
    })
  })

  it('falls back when the context metadata is missing or unsupported', async () => {
    expect(await resolveDockerEndpoint(await homeWithContext('gone'), 'linux')).toEqual({
      kind: 'socket',
      socketPath: '/var/run/docker.sock'
    })
    expect(await resolveDockerEndpoint(await homeWithContext('remote', 'ssh://box'), 'linux')).toEqual({
      kind: 'socket',
      socketPath: '/var/run/docker.sock'
    })
  })
})
