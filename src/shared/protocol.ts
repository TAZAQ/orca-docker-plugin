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

export type DockerTree = {
  projects: TreeProject[]
  /** Containers started without Compose. */
  containers: TreeContainer[]
  /** Set when the daemon could not be read. */
  error?: string
}

export const CONTAINER_ACTION_REQUEST = 'docker.container'
export const CONTAINER_ACTIONS = ['start', 'stop', 'restart', 'remove'] as const

export type ContainerAction = (typeof CONTAINER_ACTIONS)[number]
export type ContainerActionInput = { id: string; action: ContainerAction }
