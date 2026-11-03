import type { Dashboard, ObjectKind } from '../shared/protocol'
import type { DockerContainer } from './docker-api'

/** The Dashboard tab of each kind of Docker object, built from its inspect data. */

type DashboardApi = {
  inspect(kind: ObjectKind, id: string): Promise<unknown>
  imageHistory(id: string): Promise<{ Created: number; CreatedBy: string; Size: number }[]>
  listContainers(): Promise<DockerContainer[]>
}

type Labels = Record<string, string> | null | undefined

const shortId = (id: string): string => id.replace(/^sha256:/, '').slice(0, 12)
const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`
const nameOf = (container: DockerContainer): string => container.Names[0]?.replace(/^\//, '') ?? shortId(container.Id)

function labelsTable(labels: Labels): Dashboard['tables'] {
  const rows = Object.entries(labels ?? {}).sort(([a], [b]) => a.localeCompare(b))
  return rows.length > 0 ? [{ title: 'Labels', columns: ['Name', 'Value'], rows }] : []
}

function containersTable(containers: DockerContainer[]): Dashboard['tables'] {
  return [
    {
      title: 'Containers',
      columns: ['Name', 'Status'],
      rows: containers.map((container) => [nameOf(container), container.Status])
    }
  ]
}

type ContainerInspect = {
  Id: string
  Name: string
  Created: string
  State: { Status: string; StartedAt: string; ExitCode: number }
  Config: { Image: string; Env: string[] | null; Labels: Labels; Cmd: string[] | null; Entrypoint: string[] | null }
  HostConfig: { RestartPolicy?: { Name: string } }
  NetworkSettings: {
    Ports: Record<string, { HostIp: string; HostPort: string }[] | null> | null
    Networks: Record<string, { IPAddress: string }> | null
  }
  Mounts: { Type: string; Name?: string; Source: string; Destination: string; RW: boolean }[]
}

async function containerDashboard(docker: DashboardApi, id: string): Promise<Dashboard> {
  const info = (await docker.inspect('container', id)) as ContainerInspect
  const env = (info.Config.Env ?? []).map((pair) => {
    const at = pair.indexOf('=')
    return at === -1 ? [pair, ''] : [pair.slice(0, at), pair.slice(at + 1)]
  })
  const ports = Object.entries(info.NetworkSettings.Ports ?? {}).flatMap(([port, bindings]) =>
    bindings && bindings.length > 0
      ? bindings.map((binding) => [port, `${binding.HostIp || '0.0.0.0'}:${binding.HostPort}`])
      : [[port, 'not published']]
  )
  const command = [...(info.Config.Entrypoint ?? []), ...(info.Config.Cmd ?? [])].join(' ')
  return {
    title: info.Name.replace(/^\//, ''),
    fields: [
      { label: 'ID', value: shortId(info.Id) },
      { label: 'Image', value: info.Config.Image },
      { label: 'Status', value: `${info.State.Status}${info.State.Status === 'exited' ? ` (${info.State.ExitCode})` : ''}` },
      { label: 'Created', value: info.Created },
      { label: 'Command', value: command },
      { label: 'Restart policy', value: info.HostConfig.RestartPolicy?.Name || 'no' }
    ],
    tables: [
      { title: 'Environment variables', columns: ['Name', 'Value'], rows: env },
      { title: 'Port bindings', columns: ['Container', 'Host'], rows: ports },
      {
        title: 'Volume bindings',
        columns: ['Source', 'Destination', 'Mode'],
        rows: info.Mounts.map((mount) => [mount.Name ?? mount.Source, mount.Destination, mount.RW ? 'rw' : 'ro'])
      },
      {
        title: 'Networks',
        columns: ['Name', 'IP'],
        rows: Object.entries(info.NetworkSettings.Networks ?? {}).map(([name, network]) => [name, network.IPAddress])
      },
      ...labelsTable(info.Config.Labels)
    ]
  }
}

type ImageInspect = {
  Id: string
  RepoTags: string[] | null
  Created: string
  Size: number
  Architecture: string
  Os: string
  Config: { Labels: Labels } | null
}

async function imageDashboard(docker: DashboardApi, id: string): Promise<Dashboard> {
  const [info, history, containers] = await Promise.all([
    docker.inspect('image', id) as Promise<ImageInspect>,
    docker.imageHistory(id),
    docker.listContainers()
  ])
  const tags = info.RepoTags ?? []
  return {
    title: tags[0] ?? shortId(info.Id),
    fields: [
      { label: 'ID', value: shortId(info.Id) },
      { label: 'Size', value: megabytes(info.Size) },
      { label: 'Created', value: info.Created },
      { label: 'Platform', value: `${info.Os}/${info.Architecture}` }
    ],
    tables: [
      { title: 'Tags', columns: ['Tag'], rows: tags.map((tag) => [tag]) },
      ...containersTable(containers.filter((container) => container.ImageID === info.Id)),
      {
        title: 'Layers',
        columns: ['Size', 'Created by'],
        rows: history.map((layer) => [megabytes(layer.Size), layer.CreatedBy.replace(/^\/bin\/sh -c (#\(nop\)\s+)?/, '')])
      },
      ...labelsTable(info.Config?.Labels)
    ]
  }
}

type NetworkInspect = {
  Id: string
  Name: string
  Driver: string
  Scope: string
  Internal: boolean
  Attachable: boolean
  Created: string
  IPAM: { Config: { Subnet?: string; Gateway?: string }[] | null }
  Containers: Record<string, { Name: string; IPv4Address: string }> | null
  Labels: Labels
}

async function networkDashboard(docker: DashboardApi, id: string): Promise<Dashboard> {
  const info = (await docker.inspect('network', id)) as NetworkInspect
  const subnets = (info.IPAM.Config ?? []).map((item) => [item.Subnet, item.Gateway].filter(Boolean).join(' via '))
  return {
    title: info.Name,
    fields: [
      { label: 'ID', value: shortId(info.Id) },
      { label: 'Driver', value: info.Driver },
      { label: 'Scope', value: info.Scope },
      { label: 'Subnet', value: subnets.join(', ') },
      { label: 'Internal', value: info.Internal ? 'yes' : 'no' },
      { label: 'Attachable', value: info.Attachable ? 'yes' : 'no' },
      { label: 'Created', value: info.Created }
    ],
    tables: [
      {
        title: 'Containers',
        columns: ['Name', 'Address'],
        rows: Object.values(info.Containers ?? {}).map((container) => [container.Name, container.IPv4Address])
      },
      ...labelsTable(info.Labels)
    ]
  }
}

type VolumeInspect = { Name: string; Driver: string; Mountpoint: string; CreatedAt?: string; Scope: string; Labels: Labels }

async function volumeDashboard(docker: DashboardApi, name: string): Promise<Dashboard> {
  const [info, containers] = await Promise.all([
    docker.inspect('volume', name) as Promise<VolumeInspect>,
    docker.listContainers()
  ])
  const users = containers.filter((container) =>
    (container.Mounts ?? []).some((mount) => mount.Type === 'volume' && mount.Name === info.Name)
  )
  return {
    title: info.Name,
    fields: [
      { label: 'Driver', value: info.Driver },
      { label: 'Scope', value: info.Scope },
      { label: 'Mountpoint', value: info.Mountpoint },
      { label: 'Created', value: info.CreatedAt ?? '' }
    ],
    tables: [...containersTable(users), ...labelsTable(info.Labels)]
  }
}

export function buildDashboard(docker: DashboardApi, kind: ObjectKind, id: string): Promise<Dashboard> {
  switch (kind) {
    case 'container':
      return containerDashboard(docker, id)
    case 'image':
      return imageDashboard(docker, id)
    case 'network':
      return networkDashboard(docker, id)
    case 'volume':
      return volumeDashboard(docker, id)
  }
}
