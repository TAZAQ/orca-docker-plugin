import { request, type IncomingMessage, type RequestOptions } from 'node:http'
import type { DockerEndpoint } from './docker-endpoint'

/** Minimal Docker Engine API client: the plugin only reads containers and follows /events. */

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
  Ports: { PrivatePort: number; PublicPort?: number; Type: string; IP?: string }[]
  Labels: Record<string, string>
}

export class DockerApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(message)
  }
}

const REQUEST_TIMEOUT_MS = 10_000

export class DockerApi {
  constructor(private readonly endpoint: DockerEndpoint) {}

  private open(path: string, signal?: AbortSignal): Promise<IncomingMessage> {
    const target: RequestOptions =
      this.endpoint.kind === 'socket'
        ? { socketPath: this.endpoint.socketPath }
        : { host: this.endpoint.host, port: this.endpoint.port }
    return new Promise((resolve, reject) => {
      const req = request({ ...target, path, method: 'GET', signal, headers: { Host: 'docker' } })
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
      req.end()
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
