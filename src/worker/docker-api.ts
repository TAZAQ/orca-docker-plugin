import { request, type IncomingMessage, type RequestOptions } from 'node:http'
import type {
  ContainerAction,
  NetworkCreateInput,
  ObjectKind,
  PruneMode,
  PruneResult
} from '../shared/protocol'
import type { DockerEndpoint } from './docker-endpoint'
import { LogDecoder } from './log-decoder'

/** Minimal Docker Engine API client: containers, their lifecycle, and the /events stream. */

export type DockerEvent = {
  Type: string
  Action: string
  Actor: { ID: string; Attributes: Record<string, string> }
  time: number
}

export type DockerContainer = {
  Id: string
  Names: string[]
  State: string
  Status: string
  Image: string
  ImageID: string
  Ports: { PrivatePort: number; PublicPort?: number; Type: string; IP?: string }[]
  Labels: Record<string, string>
  Mounts?: { Type: string; Name?: string }[]
  NetworkSettings?: { Networks?: Record<string, { NetworkID?: string }> }
}

export type DockerImage = { Id: string; RepoTags: string[] | null; Size: number }
export type DockerNetwork = { Id: string; Name: string; Driver: string; Scope?: string }
export type DockerVolume = { Name: string; Driver: string }

export class DockerApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(message)
  }
}

const REQUEST_TIMEOUT_MS = 10_000
export const LOG_TAIL_LINES = 500
/** A stop waits out the container's grace period before Docker kills it. */
export const ACTION_TIMEOUT_MS = 60_000
/** Pruning walks every image and its layers. */
export const PRUNE_TIMEOUT_MS = 10 * 60_000
const NOT_MODIFIED = 304
/** A request's answer may not exceed 1 MiB, and a file listing has no natural limit. */
export const EXEC_OUTPUT_MAX_CHARS = 512 * 1024

export class DockerApi {
  constructor(private readonly endpoint: DockerEndpoint) {}

  private open(
    path: string,
    signal?: AbortSignal,
    method = 'GET',
    body?: unknown
  ): Promise<IncomingMessage> {
    const target: RequestOptions =
      this.endpoint.kind === 'socket'
        ? { socketPath: this.endpoint.socketPath }
        : { host: this.endpoint.host, port: this.endpoint.port }
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body)
      const headers = {
        Host: 'docker',
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json' })
      }
      const req = request({ ...target, path, method, signal, headers })
      req.on('response', (res) => {
        if (res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res)
          return
        }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => (body += chunk))
        res.on('end', () => {
          const message = (() => {
            try {
              return (JSON.parse(body) as { message?: string }).message
            } catch {
              return undefined
            }
          })()
          reject(new DockerApiError(message ?? `HTTP ${res.statusCode}`, res.statusCode))
        })
      })
      req.on('error', reject)
      req.end(payload)
    })
  }

  async getJson<T>(path: string): Promise<T> {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const res = await this.open(path, signal)
    let body = ''
    res.setEncoding('utf8')
    for await (const chunk of res) {
      body += chunk as string
    }
    return JSON.parse(body) as T
  }

  listContainers(): Promise<DockerContainer[]> {
    return this.getJson<DockerContainer[]>('/containers/json?all=1')
  }

  listImages(): Promise<DockerImage[]> {
    return this.getJson<DockerImage[]>('/images/json')
  }

  listNetworks(): Promise<DockerNetwork[]> {
    return this.getJson<DockerNetwork[]>('/networks')
  }

  async listVolumes(): Promise<DockerVolume[]> {
    const { Volumes } = await this.getJson<{ Volumes: DockerVolume[] | null }>('/volumes')
    return Volumes ?? []
  }

  /** Networks and volumes answer at their bare path; containers and images under /json. */
  inspect(kind: ObjectKind, id: string): Promise<unknown> {
    const path = `/${kind}s/${encodeURIComponent(id)}`
    return this.getJson(kind === 'network' || kind === 'volume' ? path : `${path}/json`)
  }

  imageHistory(id: string): Promise<{ Created: number; CreatedBy: string; Size: number }[]> {
    return this.getJson(`/images/${encodeURIComponent(id)}/history`)
  }

  containerProcesses(id: string): Promise<{ Titles: string[]; Processes: string[][] | null }> {
    return this.getJson(`/containers/${id}/top`)
  }

  /** Sends a request that changes something and reads its JSON answer, if any. */
  private async change(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.open(path, AbortSignal.timeout(ACTION_TIMEOUT_MS), method, body)
    let text = ''
    res.setEncoding('utf8')
    for await (const chunk of res) {
      text += chunk as string
    }
    return text === '' ? null : (JSON.parse(text) as unknown)
  }

  async createNetwork({ name, driver, attachable, internal }: NetworkCreateInput): Promise<void> {
    await this.change('POST', '/networks/create', {
      Name: name,
      Driver: driver,
      Attachable: attachable,
      Internal: internal,
      CheckDuplicate: true
    })
  }

  async createVolume(name: string): Promise<void> {
    await this.change('POST', '/volumes/create', { Name: name })
  }

  async removeNetwork(id: string): Promise<void> {
    await this.change('DELETE', `/networks/${encodeURIComponent(id)}`)
  }

  async removeVolume(name: string): Promise<void> {
    await this.change('DELETE', `/volumes/${encodeURIComponent(name)}`)
  }

  /** Without force, so the daemon refuses a container that started again. */
  async removeStoppedContainer(id: string): Promise<void> {
    await this.change('DELETE', `/containers/${id}`)
  }

  /** Without force: the daemon keeps an image that something still uses. */
  async removeUnusedImage(id: string): Promise<void> {
    await this.change('DELETE', `/images/${encodeURIComponent(id)}`)
  }

  /**
   * Bytes a build cache prune frees: not in use by a build, and not shared with an image,
   * which keeps those layers anyway. `docker system df` counts it the same way.
   */
  async buildCacheSize(): Promise<number> {
    const { BuildCache } = await this.getJson<{
      BuildCache: { Size: number; InUse: boolean; Shared: boolean }[] | null
    }>('/system/df?type=build-cache')
    return (BuildCache ?? [])
      .filter((item) => !item.InUse && !item.Shared)
      .reduce((sum, item) => sum + item.Size, 0)
  }

  async pruneBuildCache(): Promise<number> {
    const answer = (await this.change('POST', '/build/prune?all=true')) as { SpaceReclaimed?: number } | null
    return answer?.SpaceReclaimed ?? 0
  }

  async searchImages(term: string): Promise<string[]> {
    const found = await this.getJson<{ name: string; is_official: boolean; star_count: number }[]>(
      `/images/search?term=${encodeURIComponent(term)}&limit=10`
    )
    return found
      .sort((a, b) => Number(b.is_official) - Number(a.is_official) || b.star_count - a.star_count)
      .map((item) => item.name)
  }

  async forceRemoveContainer(id: string): Promise<void> {
    const res = await this.open(`/containers/${id}?force=1`, AbortSignal.timeout(ACTION_TIMEOUT_MS), 'DELETE')
    res.resume()
  }

  /** Force, because an image with several tags cannot be removed by its id otherwise. */
  async removeImage(id: string): Promise<void> {
    const path = `/images/${encodeURIComponent(id)}?force=1`
    const res = await this.open(path, AbortSignal.timeout(ACTION_TIMEOUT_MS), 'DELETE')
    res.resume()
  }

  async pruneImages(mode: PruneMode): Promise<PruneResult> {
    const filters = encodeURIComponent(JSON.stringify({ dangling: [String(mode === 'dangling')] }))
    const res = await this.open(`/images/prune?filters=${filters}`, AbortSignal.timeout(PRUNE_TIMEOUT_MS), 'POST')
    let body = ''
    res.setEncoding('utf8')
    for await (const chunk of res) {
      body += chunk as string
    }
    const { ImagesDeleted, SpaceReclaimed } = JSON.parse(body) as {
      ImagesDeleted: { Deleted?: string }[] | null
      SpaceReclaimed: number
    }
    return {
      removed: (ImagesDeleted ?? []).filter((item) => item.Deleted !== undefined).length,
      reclaimed: SpaceReclaimed
    }
  }

  /** Runs a command in a running container and returns what it printed. */
  async execOutput(id: string, cmd: string[]): Promise<string> {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const created = await this.open(`/containers/${id}/exec`, signal, 'POST', {
      AttachStdout: true,
      AttachStderr: true,
      Cmd: cmd
    })
    let answer = ''
    created.setEncoding('utf8')
    for await (const chunk of created) {
      answer += chunk as string
    }
    const { Id } = JSON.parse(answer) as { Id: string }
    const res = await this.open(`/exec/${Id}/start`, signal, 'POST', { Detach: false, Tty: false })
    const decoder = new LogDecoder(false)
    let output = ''
    for await (const chunk of res) {
      output += decoder.push(chunk as Buffer)
    }
    return output.slice(0, EXEC_OUTPUT_MAX_CHARS)
  }

  async containerAction(id: string, action: ContainerAction): Promise<void> {
    const [method, path] =
      action === 'remove' ? ['DELETE', `/containers/${id}`] : ['POST', `/containers/${id}/${action}`]
    try {
      const res = await this.open(path, AbortSignal.timeout(ACTION_TIMEOUT_MS), method)
      res.resume()
    } catch (error) {
      // 304: the container already is in that state, which is what was asked for.
      if (!(error instanceof DockerApiError) || error.statusCode !== NOT_MODIFIED) {
        throw error
      }
    }
  }

  /** Follows a container's output until it stops, the daemon goes away, or `signal` aborts. */
  async followLogs(id: string, onText: (text: string) => void, signal: AbortSignal): Promise<void> {
    const { Config } = await this.getJson<{ Config: { Tty: boolean } }>(`/containers/${id}/json`)
    const res = await this.open(
      `/containers/${id}/logs?follow=1&stdout=1&stderr=1&tail=${LOG_TAIL_LINES}`,
      signal
    )
    const decoder = new LogDecoder(Config.Tty)
    for await (const chunk of res) {
      const text = decoder.push(chunk as Buffer)
      if (text !== '') {
        onText(text)
      }
    }
  }

  /** Follows /events until the stream ends, the daemon goes away, or `signal` aborts. */
  async streamEvents(
    filters: Record<string, string[]>,
    onEvent: (event: DockerEvent) => void,
    signal: AbortSignal
  ): Promise<void> {
    const query = encodeURIComponent(JSON.stringify(filters))
    const res = await this.open(`/events?filters=${query}`, signal)
    res.setEncoding('utf8')
    let buffered = ''
    for await (const chunk of res) {
      buffered += chunk as string
      let newline = buffered.indexOf('\n')
      while (newline !== -1) {
        const line = buffered.slice(0, newline).trim()
        buffered = buffered.slice(newline + 1)
        if (line !== '') {
          onEvent(JSON.parse(line) as DockerEvent)
        }
        newline = buffered.indexOf('\n')
      }
    }
  }
}
