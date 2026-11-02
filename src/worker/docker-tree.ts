import {
  emptyTree,
  type ContainerHealth,
  type DockerTree,
  type TreeContainer,
  type TreeImage,
  type TreeProject,
  type TreeService
} from '../shared/protocol'
import { PROJECT_LABEL, SERVICE_LABEL } from './compose-status'
import { WATCHED_EVENTS } from './crash-notifier'
import type { DockerContainer, DockerImage, DockerNetwork, DockerVolume } from './docker-api'

/** Lays Docker out the way the Services view of JetBrains IDEs does. */

const CONFIG_FILES_LABEL = 'com.docker.compose.project.config_files'
/** Set by the Dev Containers CLI and by editors on the containers they start. */
const DEV_CONTAINER_LABEL = 'devcontainer.local_folder'

export type DockerResources = {
  images: DockerImage[]
  networks: DockerNetwork[]
  volumes: DockerVolume[]
}

const NO_RESOURCES: DockerResources = { images: [], networks: [], volumes: [] }

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
  'rename',
  'pull',
  'delete',
  'tag',
  'untag'
]

/** Images, networks and volumes change the tree too; only containers matter to the crash notifier. */
export const TREE_EVENT_TYPES = ['container', 'image', 'network', 'volume']

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
    imageId: container.ImageID,
    state: container.State,
    status: container.Status,
    health: readHealth(container.Status),
    ports: readPorts(container)
  }
}

const byName = <T extends { name: string }>(a: T, b: T): number => a.name.localeCompare(b.name)

export function toTreeImage(image: DockerImage): TreeImage {
  const tags = (image.RepoTags ?? []).filter((tag) => tag !== '<none>:<none>')
  return {
    id: image.Id,
    name: tags[0] ?? image.Id.replace(/^sha256:/, '').slice(0, 12),
    tags,
    size: image.Size
  }
}

export function buildTree(
  containers: DockerContainer[],
  resources: DockerResources = NO_RESOURCES
): DockerTree {
  const projects = new Map<string, TreeProject>()
  for (const container of containers) {
    const name = container.Labels[PROJECT_LABEL]
    if (name === undefined) {
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
  return {
    projects: sorted,
    devContainers: containers
      .filter((container) => container.Labels[DEV_CONTAINER_LABEL] !== undefined)
      .map(toTreeContainer)
      .sort(byName),
    containers: containers.map(toTreeContainer).sort(byName),
    images: resources.images.map(toTreeImage).sort(byName),
    networks: resources.networks
      .map((network) => ({ id: network.Id, name: network.Name, driver: network.Driver }))
      .sort(byName),
    volumes: resources.volumes
      .map((volume) => ({ name: volume.Name, driver: volume.Driver }))
      .sort(byName)
  }
}

/** Below Orca's 256 KiB limit for a post. A request may answer with up to 1 MiB. */
export const TREE_POST_MAX_BYTES = 200 * 1024

export type TreePublisherOptions = {
  load: () => Promise<DockerTree>
  /** `null` says the tree changed but is too big to post, so the panel has to ask for it. */
  post: (tree: DockerTree | null) => void
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
      return emptyTree(message)
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
      this.options.post(Buffer.byteLength(text) <= TREE_POST_MAX_BYTES ? tree : null)
    }
  }
}
