import type { CleanupItem, CleanupKind, CleanupPreview, CleanupResult } from '../shared/protocol'
import type { DockerContainer, DockerNetwork, DockerVolume } from './docker-api'

/** Clean Up for containers, networks and volumes: what would go, and removing exactly that. */

type CleanupApi = {
  listContainers(): Promise<DockerContainer[]>
  listNetworks(): Promise<DockerNetwork[]>
  listVolumes(): Promise<DockerVolume[]>
  removeStoppedContainer(id: string): Promise<void>
  removeNetwork(id: string): Promise<void>
  removeVolume(name: string): Promise<void>
}

/** Docker's own networks, which it never prunes and cannot remove. */
const BUILTIN_NETWORKS = new Set(['bridge', 'host', 'none'])
const STOPPED_STATES = new Set(['exited', 'created', 'dead'])

function containerName(container: DockerContainer): string {
  return container.Names[0]?.replace(/^\//, '') ?? container.Id.slice(0, 12)
}

/** A stopped container still holds its networks and volumes, as Docker's prune sees it. */
function stoppedContainers(containers: DockerContainer[]): CleanupItem[] {
  return containers
    .filter((container) => STOPPED_STATES.has(container.State))
    .map((container) => ({ id: container.Id, name: containerName(container), detail: container.Status }))
}

function unusedNetworks(networks: DockerNetwork[], containers: DockerContainer[]): CleanupItem[] {
  const used = new Set(
    containers.flatMap((container) =>
      Object.values(container.NetworkSettings?.Networks ?? {}).map((network) => network.NetworkID)
    )
  )
  return networks
    .filter(
      (network) =>
        !BUILTIN_NETWORKS.has(network.Name) && network.Scope !== 'swarm' && !used.has(network.Id)
    )
    .map((network) => ({ id: network.Id, name: network.Name, detail: network.Driver }))
}

function unusedVolumes(volumes: DockerVolume[], containers: DockerContainer[]): CleanupItem[] {
  const used = new Set(
    containers.flatMap((container) =>
      (container.Mounts ?? []).flatMap((mount) => (mount.Type === 'volume' && mount.Name ? [mount.Name] : []))
    )
  )
  return volumes
    .filter((volume) => !used.has(volume.Name))
    .map((volume) => ({ id: volume.Name, name: volume.Name, detail: volume.Driver }))
}

async function candidates(docker: CleanupApi, kind: CleanupKind): Promise<CleanupItem[]> {
  const containers = await docker.listContainers()
  switch (kind) {
    case 'containers':
      return stoppedContainers(containers)
    case 'networks':
      return unusedNetworks(await docker.listNetworks(), containers)
    case 'volumes':
      return unusedVolumes(await docker.listVolumes(), containers)
  }
}

const byName = (a: CleanupItem, b: CleanupItem): number => a.name.localeCompare(b.name)

export async function previewCleanup(docker: CleanupApi, kind: CleanupKind): Promise<CleanupPreview> {
  return { items: (await candidates(docker, kind)).sort(byName) }
}

/** Removes the agreed items that are still unused now; anything else stays. */
export async function cleanup(docker: CleanupApi, kind: CleanupKind, ids: string[]): Promise<CleanupResult> {
  const current = new Map((await candidates(docker, kind)).map((item) => [item.id, item]))
  const remove = {
    containers: (id: string) => docker.removeStoppedContainer(id),
    networks: (id: string) => docker.removeNetwork(id),
    volumes: (id: string) => docker.removeVolume(id)
  }[kind]
  const result: CleanupResult = { removed: 0, skipped: 0, failed: [] }
  for (const id of new Set(ids)) {
    const item = current.get(id)
    if (!item) {
      result.skipped += 1
      continue
    }
    try {
      await remove(id)
      result.removed += 1
    } catch (error) {
      result.failed.push({ name: item.name, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return result
}
