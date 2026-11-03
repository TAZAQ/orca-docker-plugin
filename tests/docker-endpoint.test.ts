import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeEndpoint, listContexts, parseDockerHost, resolveDockerEndpoint } from '../src/worker/docker-endpoint'

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

  it('falls back when the context metadata is missing', async () => {
    expect(await resolveDockerEndpoint(await homeWithContext('gone'), 'linux')).toEqual({
      kind: 'socket',
      socketPath: '/var/run/docker.sock'
    })
  })

  it('refuses an SSH context instead of quietly showing the local daemon', async () => {
    await expect(resolveDockerEndpoint(await homeWithContext('remote', 'ssh://box'), 'linux')).rejects.toThrow(
      'Docker context remote connects over SSH'
    )
  })

  it('uses the context chosen in the panel over the CLI’s current one', async () => {
    const home = await homeWithContext('desktop-linux', 'unix:///home/u/.docker/desktop/docker.sock')
    expect(await resolveDockerEndpoint(home, 'linux', 'default')).toEqual({
      kind: 'socket',
      socketPath: '/var/run/docker.sock'
    })
  })

  it('reads the TLS material of a tcp context, verifying unless told to skip', async () => {
    const home = await homeWithContext('secure', 'tcp://docker.example:2376')
    const id = createHash('sha256').update('secure').digest('hex')
    const tlsDir = join(home, '.docker', 'contexts', 'tls', id, 'docker')
    await mkdir(tlsDir, { recursive: true })
    await writeFile(join(tlsDir, 'ca.pem'), 'CA')
    await writeFile(join(tlsDir, 'cert.pem'), 'CERT')
    await writeFile(join(tlsDir, 'key.pem'), 'KEY')
    const endpoint = await resolveDockerEndpoint(home, 'linux')
    expect(endpoint).toEqual({
      kind: 'tcp',
      host: 'docker.example',
      port: 2376,
      tls: { ca: Buffer.from('CA'), cert: Buffer.from('CERT'), key: Buffer.from('KEY'), verify: true }
    })
    expect(describeEndpoint(endpoint)).toBe('https://docker.example:2376')
  })

  it('keeps a plain tcp context without TLS', async () => {
    const endpoint = await resolveDockerEndpoint(await homeWithContext('plain', 'tcp://10.0.0.5:2375'), 'linux')
    expect(endpoint).toEqual({ kind: 'tcp', host: '10.0.0.5', port: 2375 })
    expect(describeEndpoint(endpoint)).toBe('http://10.0.0.5:2375')
  })
})

describe('listContexts', () => {
  it('lists default first, then the others by name, with the CLI’s current one', async () => {
    const home = await homeWithContext('zeta', 'tcp://z:2375')
    const id = createHash('sha256').update('alpha').digest('hex')
    await mkdir(join(home, '.docker', 'contexts', 'meta', id), { recursive: true })
    await writeFile(
      join(home, '.docker', 'contexts', 'meta', id, 'meta.json'),
      JSON.stringify({ Name: 'alpha', Endpoints: { docker: { Host: 'unix:///a.sock' } } })
    )
    expect(await listContexts(home)).toEqual({ names: ['default', 'alpha', 'zeta'], cli: 'zeta' })
  })

  it('knows only default without any docker config', async () => {
    expect(await listContexts(await homeWithContext(null))).toEqual({ names: ['default'], cli: 'default' })
  })
})
