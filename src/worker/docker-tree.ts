import type {
  ContainerHealth,
  DockerTree,
  TreeContainer,
  TreeProject,
  TreeService
} from '../shared/protocol'
import { PROJECT_LABEL, SERVICE_LABEL } from './compose-status'
import { WATCHED_EVENTS } from './crash-notifier'
import type { DockerContainer } from './docker-api'

/** Groups containers the way the Services view of JetBrains IDEs does: project, service, container. */

const CONFIG_FILES_LABEL = 'com.docker.compose.project.config_files'

/** Everything that changes what the tree shows, on top of what the crash notifier needs. */
export const TREE_EVENTS = [
  ...WATCHED_EVENTS,
  'create',
  'start',
  'stop',
  'restart',
  'pause',
  'unpause',
  'destroy',
  'rename'
]

/** Compose changes many containers at once, so a burst of events becomes one read. */
export const TREE_DEBOUNCE_MS = 300

function readHealth(status: string): ContainerHealth | null {
  if (status.includes('(unhealthy)')) {
    return 'unhealthy'
  }
  if (status.includes('(healthy)')) {
    return 'healthy'
  }
  return status.includes('(health: starting)') ? 'starting' : null
}

function readPorts(container: DockerContainer): string[] {
  const ports = (container.Ports ?? []).flatMap((port) =>
    port.PublicPort === undefined ? [] : [`${port.PublicPort}→${port.PrivatePort}`]
  )
  // Docker lists a published port once per address family.
  return [...new Set(ports)]
}

function toTreeContainer(container: DockerContainer): TreeContainer {
  return {
    id: container.Id,
    name: container.Names[0]?.replace(/^\//, '') ?? container.Id.slice(0, 12),
    image: container.Image,
    state: container.State,
    status: container.Status,
    health: readHealth(container.Status),
    ports: readPorts(container)
  }
}

const byName = <T extends { name: string }>(a: T, b: T): number => a.name.localeCompare(b.name)

export function buildTree(containers: DockerContainer[]): DockerTree {
  const projects = new Map<string, TreeProject>()
  const standalone: TreeContainer[] = []
  for (const container of containers) {
    const name = container.Labels[PROJECT_LABEL]
    if (name === undefined) {
      standalone.push(toTreeContainer(container))
      continue
    }
    const project = projects.get(name) ?? { name, configFiles: [], services: [] }
    projects.set(name, project)
    if (project.configFiles.length === 0) {
      project.configFiles = (container.Labels[CONFIG_FILES_LABEL] ?? '').split(',').filter(Boolean)
    }
    const serviceName = container.Labels[SERVICE_LABEL] ?? '(unnamed)'
    let service: TreeService | undefined = project.services.find((item) => item.name === serviceName)
    if (!service) {
      service = { name: serviceName, containers: [] }
      project.services.push(service)
    }
    service.containers.push(toTreeContainer(container))
  }
  const sorted = [...projects.values()].sort(byName)
  for (const project of sorted) {
    project.services.sort(byName)
    for (const service of project.services) {
      service.containers.sort(byName)
    }
  }
  return { projects: sorted, containers: standalone.sort(byName) }
}

export type TreePublisherOptions = {
  load: () => Promise<DockerTree>
  post: (tree: DockerTree) => void
  debounceMs?: number
}

/** Reads the tree when Docker reports a change and pushes it to panels only if it really differs. */
export class TreePublisher {
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastPosted = ''

  constructor(private readonly options: TreePublisherOptions) {}

  async current(): Promise<DockerTree> {
    try {
      const tree = await this.options.load()
      this.lastPosted = JSON.stringify(tree)
      return tree
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { projects: [], containers: [], error: message }
    }
  }

  schedule(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.publish(), this.options.debounceMs ?? TREE_DEBOUNCE_MS)
  }

  stop(): void {
    clearTimeout(this.timer)
  }

  private async publish(): Promise<void> {
    const previous = this.lastPosted
    const tree = await this.current()
    const text = JSON.stringify(tree)
    if (text !== previous) {
      this.lastPosted = text
      this.options.post(tree)
    }
  }
}
