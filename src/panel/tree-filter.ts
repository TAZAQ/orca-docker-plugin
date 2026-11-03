import type { ViewOptions } from './menus'
import { isUp } from './container-state'
import type {
  DockerTree,
  TreeContainer,
  TreeProject,
  TreeService
} from '../shared/protocol'

/** Narrows the tree to what matches a search; a matching parent keeps everything under it. */

function matches(query: string, ...values: string[]): boolean {
  return values.some((value) => value.toLowerCase().includes(query))
}

function matchesContainer(query: string, container: TreeContainer): boolean {
  return matches(query, container.name, container.image, ...container.ports)
}

function filterService(query: string, service: TreeService): TreeService | null {
  if (matches(query, service.name)) {
    return service
  }
  const containers = service.containers.filter((container) => matchesContainer(query, container))
  return containers.length > 0 ? { ...service, containers } : null
}

function filterProject(query: string, project: TreeProject): TreeProject | null {
  if (matches(query, project.name)) {
    return project
  }
  const services = project.services.flatMap((service) => filterService(query, service) ?? [])
  return services.length > 0 ? { ...project, services } : null
}

export function filterTree(tree: DockerTree, search: string): DockerTree {
  const query = search.trim().toLowerCase()
  if (query === '') {
    return tree
  }
  return {
    ...tree,
    projects: tree.projects.flatMap((project) => filterProject(query, project) ?? []),
    devContainers: tree.devContainers.filter((container) => matchesContainer(query, container)),
    containers: tree.containers.filter((container) => matchesContainer(query, container)),
    images: tree.images.filter((image) => matches(query, image.name, ...image.tags)),
    networks: tree.networks.filter((network) => matches(query, network.name, network.driver)),
    volumes: tree.volumes.filter((volume) => matches(query, volume.name))
  }
}

export function isTreeEmpty(tree: DockerTree): boolean {
  return (
    tree.projects.length === 0 &&
    tree.devContainers.length === 0 &&
    tree.containers.length === 0 &&
    tree.images.length === 0 &&
    tree.networks.length === 0 &&
    tree.volumes.length === 0
  )
}

/** The View Options of the Docker root: hiding stopped containers and untagged images. */
export function applyView(tree: DockerTree, view: ViewOptions): DockerTree {
  return {
    ...tree,
    devContainers: view.showStopped ? tree.devContainers : tree.devContainers.filter(isUp),
    containers: view.showStopped ? tree.containers : tree.containers.filter(isUp),
    images: view.showUntagged ? tree.images : tree.images.filter((image) => image.tags.length > 0)
  }
}
