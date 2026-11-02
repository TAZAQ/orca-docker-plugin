/** The contract between the panel and the worker, shared by both sides. */

export const SEND_TEXT_REQUEST = 'terminal.send'

export type SendTextInput = { terminalId: string; text: string; enter: boolean }
export type SendTextOutput = { accepted: boolean }

export const TREE_REQUEST = 'docker.tree'
export const TREE_CHANGED_EVENT = 'docker.tree.changed'

export type ContainerHealth = 'healthy' | 'unhealthy' | 'starting'

export type TreeContainer = {
  id: string
  name: string
  image: string
  /** Docker's state: running, exited, restarting, paused, created, dead. */
  state: string
  /** Docker's human text, such as "Up 5 days". */
  status: string
  health: ContainerHealth | null
  ports: string[]
}

export type TreeService = { name: string; containers: TreeContainer[] }

export type TreeProject = {
  name: string
  /** Compose files as absolute paths, so commands work from any terminal. */
  configFiles: string[]
  services: TreeService[]
}

export type TreeImage = { id: string; name: string; tags: string[]; size: number }
export type TreeNetwork = { id: string; name: string; driver: string }
export type TreeVolume = { name: string; driver: string }

/** The same groups, in the same order, as the Docker node of the JetBrains Services view. */
export type DockerTree = {
  projects: TreeProject[]
  devContainers: TreeContainer[]
  /** Every container, including the ones listed under a project. */
  containers: TreeContainer[]
  images: TreeImage[]
  networks: TreeNetwork[]
  volumes: TreeVolume[]
  /** Set when the daemon could not be read. */
  error?: string
}

export function emptyTree(error?: string): DockerTree {
  return {
    projects: [],
    devContainers: [],
    containers: [],
    images: [],
    networks: [],
    volumes: [],
    ...(error === undefined ? {} : { error })
  }
}

export const CONTAINER_ACTION_REQUEST = 'docker.container'
export const CONTAINER_ACTIONS = ['start', 'stop', 'restart', 'remove'] as const

export type ContainerAction = (typeof CONTAINER_ACTIONS)[number]
export type ContainerActionInput = { id: string; action: ContainerAction }

export const LOGS_START_REQUEST = 'docker.logs.start'
export const LOGS_RENEW_REQUEST = 'docker.logs.renew'
export const LOGS_STOP_REQUEST = 'docker.logs.stop'
export const LOGS_EVENT = 'docker.logs'

/** How often the panel renews a log stream, well within the worker's lease. */
export const LOGS_RENEW_MS = 20_000

export type LogsStartInput = { id: string }
export type LogsStartOutput = { streamId: string }
export type LogsStreamInput = { streamId: string }
export type LogsRenewOutput = { alive: boolean }

export type LogsPayload =
  | { streamId: string; kind: 'text'; text: string }
  | { streamId: string; kind: 'ended'; error?: string }
