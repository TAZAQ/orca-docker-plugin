import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type TlsMaterial = { ca?: Buffer; cert?: Buffer; key?: Buffer; verify: boolean }

/** Where the Docker Engine API listens. Windows named pipes are passed to node:http as a socketPath too. */
export type DockerEndpoint =
  | { kind: 'socket'; socketPath: string }
  | { kind: 'tcp'; host: string; port: number; tls?: TlsMaterial }

export type DockerContexts = {
  /** Every context the docker CLI knows, `default` first. */
  names: string[]
  /** The one the docker CLI uses now. */
  cli: string
}

export const DEFAULT_CONTEXT = 'default'

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

const contextId = (name: string): string => createHash('sha256').update(name).digest('hex')

async function readOptional(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path)
  } catch {
    return undefined
  }
}

type ContextMeta = { Name?: unknown; Endpoints?: { docker?: { Host?: unknown; SkipTLSVerify?: unknown } } }

async function cliContext(dockerDir: string): Promise<string> {
  const config = (await readJson(join(dockerDir, 'config.json'))) as { currentContext?: unknown } | null
  const name = config?.currentContext
  return typeof name === 'string' && name !== '' ? name : DEFAULT_CONTEXT
}

export async function listContexts(home: string): Promise<DockerContexts> {
  const dockerDir = join(home, '.docker')
  const metaDir = join(dockerDir, 'contexts', 'meta')
  let ids: string[] = []
  try {
    ids = await readdir(metaDir)
  } catch {
    // No contexts besides the default one.
  }
  const names = (
    await Promise.all(
      ids.map(async (id) => ((await readJson(join(metaDir, id, 'meta.json'))) as ContextMeta | null)?.Name)
    )
  ).filter((name): name is string => typeof name === 'string' && name !== DEFAULT_CONTEXT)
  return { names: [DEFAULT_CONTEXT, ...names.sort()], cli: await cliContext(dockerDir) }
}

/** TLS material sits next to the metadata, as `docker context create --docker tls…` stores it. */
async function contextTls(dockerDir: string, id: string, skipVerify: boolean): Promise<TlsMaterial | undefined> {
  const dir = join(dockerDir, 'contexts', 'tls', id, 'docker')
  const [ca, cert, key] = await Promise.all(
    ['ca.pem', 'cert.pem', 'key.pem'].map((file) => readOptional(join(dir, file)))
  )
  if (!ca && !cert && !key && !skipVerify) {
    return undefined
  }
  return { ca, cert, key, verify: !skipVerify }
}

/**
 * Orca gives plugin workers a scrubbed environment without DOCKER_HOST or DOCKER_CONTEXT,
 * so the endpoint comes from a docker CLI context in ~/.docker, as `docker` itself resolves it:
 * the one named, or else the CLI's current one.
 */
export async function resolveDockerEndpoint(
  home: string,
  platform: NodeJS.Platform = process.platform,
  contextName: string | null = null
): Promise<DockerEndpoint> {
  const fallback: DockerEndpoint = {
    kind: 'socket',
    socketPath: platform === 'win32' ? DEFAULT_WINDOWS_PIPE : DEFAULT_UNIX_SOCKET
  }
  const dockerDir = join(home, '.docker')
  const name = contextName ?? (await cliContext(dockerDir))
  if (name === DEFAULT_CONTEXT) {
    return fallback
  }
  const id = contextId(name)
  const meta = (await readJson(join(dockerDir, 'contexts', 'meta', id, 'meta.json'))) as ContextMeta | null
  const host = meta?.Endpoints?.docker?.Host
  if (typeof host !== 'string') {
    return fallback
  }
  if (host.startsWith('ssh://')) {
    // Falling back would quietly show another daemon's containers as if they were this one's.
    throw new Error(`Docker context ${name} connects over SSH, which this plugin does not support yet`)
  }
  const endpoint = parseDockerHost(host)
  if (!endpoint) {
    return fallback
  }
  if (endpoint.kind === 'tcp') {
    const tls = await contextTls(dockerDir, id, meta?.Endpoints?.docker?.SkipTLSVerify === true)
    return tls ? { ...endpoint, tls } : endpoint
  }
  return endpoint
}

export function describeEndpoint(endpoint: DockerEndpoint): string {
  if (endpoint.kind === 'socket') {
    return endpoint.socketPath
  }
  return `${endpoint.tls ? 'https' : 'http'}://${endpoint.host}:${endpoint.port}`
}
