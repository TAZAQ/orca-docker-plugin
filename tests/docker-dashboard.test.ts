import { describe, expect, it } from 'vitest'
import type { DockerContainer } from '../src/worker/docker-api'
import { buildDashboard } from '../src/worker/docker-dashboard'

const user = (Id: string, extra: Partial<DockerContainer>): DockerContainer => ({
  Id,
  Names: [`/${Id}`],
  State: 'running',
  Status: 'Up 1 hour',
  Image: 'x',
  ImageID: 'sha256:x',
  Ports: [],
  Labels: {},
  ...extra
})

function docker(inspect: Record<string, unknown>, containers: DockerContainer[] = []) {
  return {
    inspect: async (kind: string) => inspect[kind],
    imageHistory: async () => [
      { Created: 1, CreatedBy: '/bin/sh -c #(nop)  CMD ["nginx"]', Size: 0 },
      { Created: 1, CreatedBy: '/bin/sh -c apk add curl', Size: 2_500_000 }
    ],
    listContainers: async () => containers
  }
}

const table = (dashboard: { tables: { title: string; rows: string[][] }[] }, title: string) =>
  dashboard.tables.find((item) => item.title === title)?.rows

describe('buildDashboard', () => {
  it('shows a container’s environment, ports, volumes and networks', async () => {
    const dashboard = await buildDashboard(
      docker({
        container: {
          Id: 'abcdef0123456789',
          Name: '/shop-web-1',
          Created: '2026-11-01',
          State: { Status: 'exited', StartedAt: '', ExitCode: 137 },
          Config: { Image: 'nginx:1', Env: ['TZ=UTC', 'URL=a=b'], Labels: { tier: 'web' }, Cmd: ['nginx'], Entrypoint: null },
          HostConfig: { RestartPolicy: { Name: 'unless-stopped' } },
          NetworkSettings: {
            Ports: { '80/tcp': [{ HostIp: '', HostPort: '8080' }], '443/tcp': null },
            Networks: { shop_default: { IPAddress: '172.18.0.2' } }
          },
          Mounts: [{ Type: 'volume', Name: 'pgdata', Source: '/var/lib', Destination: '/data', RW: false }]
        }
      }),
      'container',
      'abcdef0123456789'
    )
    expect(dashboard.title).toBe('shop-web-1')
    expect(dashboard.fields).toContainEqual({ label: 'Status', value: 'exited (137)' })
    expect(dashboard.fields).toContainEqual({ label: 'Restart policy', value: 'unless-stopped' })
    expect(table(dashboard, 'Environment variables')).toEqual([
      ['TZ', 'UTC'],
      ['URL', 'a=b']
    ])
    expect(table(dashboard, 'Port bindings')).toEqual([
      ['80/tcp', '0.0.0.0:8080'],
      ['443/tcp', 'not published']
    ])
    expect(table(dashboard, 'Volume bindings')).toEqual([['pgdata', '/data', 'ro']])
    expect(table(dashboard, 'Networks')).toEqual([['shop_default', '172.18.0.2']])
    expect(table(dashboard, 'Labels')).toEqual([['tier', 'web']])
  })

  it('shows an image’s tags, the containers using it and its layers', async () => {
    const dashboard = await buildDashboard(
      docker(
        {
          image: {
            Id: 'sha256:aaaabbbbccccdddd',
            RepoTags: ['nginx:1', 'nginx:latest'],
            Created: '2026-10-01',
            Size: 52_000_000,
            Architecture: 'amd64',
            Os: 'linux',
            Config: { Labels: null }
          }
        },
        [user('web', { ImageID: 'sha256:aaaabbbbccccdddd' }), user('other', {})]
      ),
      'image',
      'sha256:aaaabbbbccccdddd'
    )
    expect(dashboard.title).toBe('nginx:1')
    expect(dashboard.fields).toContainEqual({ label: 'Size', value: '52.0 MB' })
    expect(table(dashboard, 'Containers')).toEqual([['web', 'Up 1 hour']])
    expect(table(dashboard, 'Layers')).toEqual([
      ['0.0 MB', 'CMD ["nginx"]'],
      ['2.5 MB', 'apk add curl']
    ])
    expect(table(dashboard, 'Labels')).toBeUndefined()
  })

  it('shows a network’s containers and subnet', async () => {
    const dashboard = await buildDashboard(
      docker({
        network: {
          Id: 'n1n1n1n1n1n1n1',
          Name: 'shop_default',
          Driver: 'bridge',
          Scope: 'local',
          Internal: false,
          Attachable: true,
          Created: '2026-11-01',
          IPAM: { Config: [{ Subnet: '172.18.0.0/16', Gateway: '172.18.0.1' }] },
          Containers: { abc: { Name: 'shop-web-1', IPv4Address: '172.18.0.2/16' } },
          Labels: { 'com.docker.compose.network': 'default' }
        }
      }),
      'network',
      'n1n1n1n1n1n1n1'
    )
    expect(dashboard.fields).toContainEqual({ label: 'Subnet', value: '172.18.0.0/16 via 172.18.0.1' })
    expect(table(dashboard, 'Containers')).toEqual([['shop-web-1', '172.18.0.2/16']])
  })

  it('shows which containers use a volume, stopped ones included', async () => {
    const dashboard = await buildDashboard(
      docker(
        { volume: { Name: 'pgdata', Driver: 'local', Mountpoint: '/var/lib/docker/volumes/pgdata', Scope: 'local', Labels: null } },
        [
          user('db', { State: 'exited', Status: 'Exited (0)', Mounts: [{ Type: 'volume', Name: 'pgdata' }] }),
          user('web', { Mounts: [{ Type: 'bind' }] })
        ]
      ),
      'volume',
      'pgdata'
    )
    expect(table(dashboard, 'Containers')).toEqual([['db', 'Exited (0)']])
  })
})
