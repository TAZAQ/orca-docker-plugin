import { request, type IncomingMessage, type RequestOptions } from 'node:http'
import type { ContainerAction } from '../shared/protocol'
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
  Ports: { PrivatePort: number; PublicPort?: number; Type: string; IP?: string }[]
  Labels: Record<string, string>
}

export type DockerImage = { Id: string; RepoTags: string[] | null; Size: number }
export type DockerNetwork = { Id: string; Name: string; Driver: string }
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
const NOT_MODIFIED = 304

export class DockerApi {
  constructor(private readonly endpoint: DockerEndpoint) {}

  private open(path: string, signal?: AbortSignal, method = 'GET'): Promise<IncomingMessage> {
    const target: RequestOptions =
      this.endpoint.kind === 'socket'
        ? { socketPath: this.endpoint.socketPath }
        : { host: this.endpoint.host, port: this.endpoint.port }
    return new Promise((resolve, reject) => {
      const req = request({ ...target, path, method, signal, headers: { Host: 'docker' } })
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
