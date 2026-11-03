import { describe, expect, it, vi } from 'vitest'
import type { DockerContainer, DockerNetwork, DockerVolume } from '../src/worker/docker-api'
import { cleanup, previewCleanup, previewSystemCleanup, systemCleanup } from '../src/worker/docker-cleanup'

function container(
  Id: string,
  State: string,
  extra: Partial<DockerContainer> = {}
): DockerContainer {
  return {
    Id,
    Names: [`/${Id}`],
    State,
    Status: State === 'running' ? 'Up 1 hour' : 'Exited (0)',
    Image: 'x',
    ImageID: 'sha256:x',
    Ports: [],
    Labels: {},
    ...extra
  }
}

function docker(containers: DockerContainer[], networks: DockerNetwork[] = [], volumes: DockerVolume[] = []) {
  const removed: string[] = []
  const api = {
    listContainers: async () => containers,
    listNetworks: async () => networks,
    listVolumes: async () => volumes,
    removeStoppedContainer: vi.fn(async (id: string) => void removed.push(`container ${id}`)),
    removeNetwork: vi.fn(async (id: string) => void removed.push(`network ${id}`)),
    removeVolume: vi.fn(async (name: string) => void removed.push(`volume ${name}`))
  }
  return { api, removed }
}

const onNetwork = (id: string) => ({ NetworkSettings: { Networks: { any: { NetworkID: id } } } })
const withVolume = (name: string) => ({ Mounts: [{ Type: 'volume', Name: name }] })

describe('previewCleanup', () => {
  it('lists stopped, created and dead containers, but not running, paused or restarting ones', async () => {
    const { api } = docker(
      ['running', 'paused', 'restarting', 'exited', 'created', 'dead'].map((state) => container(state, state))
    )
    const { items } = await previewCleanup(api, 'containers')
    expect(items.map((item) => item.id)).toEqual(['created', 'dead', 'exited'])
  })

  it('lists networks no container refers to, stopped ones included, and never Docker’s own', async () => {
    const { api } = docker(
      [container('a', 'exited', onNetwork('n-used'))],
      [
        { Id: 'n-used', Name: 'used', Driver: 'bridge' },
        { Id: 'n-free', Name: 'free', Driver: 'bridge' },
        { Id: 'n-bridge', Name: 'bridge', Driver: 'bridge' },
        { Id: 'n-host', Name: 'host', Driver: 'host' },
        { Id: 'n-none', Name: 'none', Driver: 'null' },
        { Id: 'n-ingress', Name: 'ingress', Driver: 'overlay', Scope: 'swarm' }
      ]
    )
    const { items } = await previewCleanup(api, 'networks')
    expect(items).toEqual([{ id: 'n-free', name: 'free', detail: 'bridge' }])
  })

  it('lists volumes no container mounts, a stopped container counting as a user', async () => {
    const { api } = docker(
      [container('a', 'exited', withVolume('pgdata')), container('b', 'running', { Mounts: [{ Type: 'bind' }] })],
      [],
      [
        { Name: 'pgdata', Driver: 'local' },
        { Name: 'old-cache', Driver: 'local' }
      ]
    )
    const { items } = await previewCleanup(api, 'volumes')
    expect(items.map((item) => item.name)).toEqual(['old-cache'])
  })
})

describe('cleanup', () => {
  it('removes exactly the agreed items', async () => {
    const { api, removed } = docker([], [], [
      { Name: 'a', Driver: 'local' },
      { Name: 'b', Driver: 'local' },
      { Name: 'c', Driver: 'local' }
    ])
    await expect(cleanup(api, 'volumes', ['a', 'c'])).resolves.toEqual({ removed: 2, skipped: 0, failed: [] })
    expect(removed).toEqual(['volume a', 'volume c'])
  })

  it('leaves alone an agreed item that is in use again by now', async () => {
    const { api, removed } = docker(
      [container('back', 'running')],
      [],
      []
    )
    await expect(cleanup(api, 'containers', ['back'])).resolves.toEqual({ removed: 0, skipped: 1, failed: [] })
    expect(removed).toEqual([])
  })

  it('goes on after a failure and reports it by name', async () => {
    const { api, removed } = docker([container('a', 'exited'), container('b', 'exited')])
    api.removeStoppedContainer.mockImplementationOnce(async () => {
      throw new Error('removal in progress')
    })
    await expect(cleanup(api, 'containers', ['a', 'b'])).resolves.toEqual({
      removed: 1,
      skipped: 0,
      failed: [{ name: 'a', error: 'removal in progress' }]
    })
    expect(removed).toEqual(['container b'])
  })
})

describe('system cleanup', () => {
  function system() {
    const calls: string[] = []
    const containers = [container('old', 'exited'), container('live', 'running', withVolume('kept'))]
    const api = {
      listContainers: async () => containers,
      listNetworks: async () => [{ Id: 'n-free', Name: 'free', Driver: 'bridge' }],
      listVolumes: async () => [
        { Name: 'kept', Driver: 'local' },
        { Name: 'cache', Driver: 'local' }
      ],
      listImages: async () => [
        { Id: 'sha256:none', RepoTags: null, Size: 5_000_000 },
        { Id: 'sha256:tagged', RepoTags: ['app:1'], Size: 1 }
      ],
      buildCacheSize: async () => 2_000_000_000,
      pruneBuildCache: vi.fn(async () => 1_500_000_000),
      removeStoppedContainer: async (id: string) => {
        calls.push(`container ${id}`)
        containers.splice(containers.findIndex((item) => item.Id === id), 1)
      },
      removeNetwork: async (id: string) => void calls.push(`network ${id}`),
      removeVolume: async (name: string) => void calls.push(`volume ${name}`),
      removeUnusedImage: async (id: string) => void calls.push(`image ${id}`)
    }
    return { api, calls }
  }

  it('previews everything unused, dangling images only, and the build cache', async () => {
    const { api } = system()
    const preview = await previewSystemCleanup(api)
    expect(preview.containers.map((item) => item.id)).toEqual(['old'])
    expect(preview.networks.map((item) => item.id)).toEqual(['n-free'])
    expect(preview.volumes.map((item) => item.id)).toEqual(['cache'])
    expect(preview.images.map((item) => item.id)).toEqual(['sha256:none'])
    expect(preview.buildCacheBytes).toBe(2_000_000_000)
  })

  it('removes containers first, then what was agreed, and the build cache when asked', async () => {
    const { api, calls } = system()
    const result = await systemCleanup(api, {
      containers: ['old'],
      networks: ['n-free'],
      volumes: ['cache'],
      images: ['sha256:none', 'sha256:tagged'],
      buildCache: true
    })
    expect(calls).toEqual(['container old', 'network n-free', 'volume cache', 'image sha256:none'])
    expect(result).toEqual({ removed: 4, skipped: 1, failed: [], buildCacheFreed: 1_500_000_000 })
  })

  it('keeps the build cache unless it was agreed to', async () => {
    const { api } = system()
    await systemCleanup(api, { containers: [], networks: [], volumes: [], images: [], buildCache: false })
    expect(api.pruneBuildCache).not.toHaveBeenCalled()
  })
})
