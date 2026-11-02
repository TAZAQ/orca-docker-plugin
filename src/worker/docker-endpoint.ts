import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Where the Docker Engine API listens. Windows named pipes are passed to node:http as a socketPath too. */
export type DockerEndpoint =
  | { kind: 'socket'; socketPath: string }
  | { kind: 'tcp'; host: string; port: number }

export const DEFAULT_UNIX_SOCKET = '/var/run/docker.sock'
export const DEFAULT_WINDOWS_PIPE = '\\\\.\\pipe\\docker_engine'

export function parseDockerHost(value: string): DockerEndpoint | null {
  if (value.startsWith('unix://')) {
    const socketPath = value.slice('unix://'.length)
    return socketPath === '' ? null : { kind: 'socket', socketPath }
  }
  if (value.startsWith('npipe://')) {
    // npipe:////./pipe/docker_engine -> \\.\pipe\docker_engine
    const pipe = value.slice('npipe://'.length).replaceAll('/', '\\')
    return pipe === '' ? null : { kind: 'socket', socketPath: pipe }
  }
  if (value.startsWith('tcp://')) {
    try {
      const url = new URL(`http://${value.slice('tcp://'.length)}`)
      return { kind: 'tcp', host: url.hostname, port: url.port === '' ? 2375 : Number(url.port) }
    } catch {
      return null
    }
  }
  return null
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Orca gives plugin workers a scrubbed environment without DOCKER_HOST or DOCKER_CONTEXT,
 * so the endpoint comes from the docker CLI's current context in ~/.docker, as `docker` itself resolves it.
 */
export async function resolveDockerEndpoint(
  home: string,
  platform: NodeJS.Platform = process.platform
): Promise<DockerEndpoint> {
  const fallback: DockerEndpoint = {
    kind: 'socket',
    socketPath: platform === 'win32' ? DEFAULT_WINDOWS_PIPE : DEFAULT_UNIX_SOCKET
  }
  const dockerDir = join(home, '.docker')
  const config = (await readJson(join(dockerDir, 'config.json'))) as { currentContext?: unknown } | null
  const contextName = config?.currentContext
  if (typeof contextName !== 'string' || contextName === '' || contextName === 'default') {
    return fallback
  }
  const contextId = createHash('sha256').update(contextName).digest('hex')
  const meta = (await readJson(join(dockerDir, 'contexts', 'meta', contextId, 'meta.json'))) as {
    Endpoints?: { docker?: { Host?: unknown } }
  } | null
  const host = meta?.Endpoints?.docker?.Host
  return (typeof host === 'string' && parseDockerHost(host)) || fallback
}

export function describeEndpoint(endpoint: DockerEndpoint): string {
  return endpoint.kind === 'socket' ? endpoint.socketPath : `${endpoint.host}:${endpoint.port}`
}
