import { describe, expect, it, vi } from 'vitest'
import type { DockerContainer } from '../src/worker/docker-api'
import { buildTree, TreePublisher } from '../src/worker/docker-tree'

function container(overrides: Partial<DockerContainer> & { name: string }): DockerContainer {
  const { name, ...rest } = overrides
  return {
    Id: `id-${name}`,
    Names: [`/${name}`],
    State: 'running',
    Status: 'Up 1 minute',
    Image: 'nginx',
    Ports: [],
    Labels: {},
    ...rest
  }
}

const compose = (project: string, service: string) => ({
  'com.docker.compose.project': project,
  'com.docker.compose.service': service,
  'com.docker.compose.project.config_files': `/srv/${project}/compose.yaml,/srv/${project}/dev.yaml`
})

describe('buildTree', () => {
  it('groups containers by project and service, sorted, with standalone ones apart', () => {
    const tree = buildTree([
      container({ name: 'z-web-2', Labels: compose('z', 'web') }),
      container({ name: 'solo' }),
      container({ name: 'z-db-1', Labels: compose('z', 'db') }),
      container({ name: 'a-web-1', Labels: compose('a', 'web') }),
      container({ name: 'z-web-1', Labels: compose('z', 'web') })
    ])
    expect(tree.projects.map((project) => project.name)).toEqual(['a', 'z'])
    expect(tree.projects[1]!.configFiles).toEqual(['/srv/z/compose.yaml', '/srv/z/dev.yaml'])
    expect(tree.projects[1]!.services.map((service) => service.name)).toEqual(['db', 'web'])
    expect(tree.projects[1]!.services[1]!.containers.map((item) => item.name)).toEqual([
      'z-web-1',
      'z-web-2'
    ])
    expect(tree.containers.map((item) => item.name)).toEqual(['solo'])
  })

  it('reads health from the status text', () => {
    const tree = buildTree([
      container({ name: 'a', Status: 'Up 1 minute (unhealthy)' }),
      container({ name: 'b', Status: 'Up 1 minute (healthy)' }),
      container({ name: 'c', Status: 'Up 1 second (health: starting)' }),
      container({ name: 'd' })
    ])
    expect(tree.containers.map((item) => item.health)).toEqual(['unhealthy', 'healthy', 'starting', null])
  })

  it('lists a port published on both address families once and skips unpublished ones', () => {
    const tree = buildTree([
      container({
        name: 'a',
        Ports: [
          { PrivatePort: 80, PublicPort: 8080, Type: 'tcp', IP: '0.0.0.0' },
          { PrivatePort: 80, PublicPort: 8080, Type: 'tcp', IP: '::' },
          { PrivatePort: 443, Type: 'tcp' }
        ]
      })
    ])
    expect(tree.containers[0]!.ports).toEqual(['8080→80'])
  })
})

describe('TreePublisher', () => {
  const tree = { projects: [], containers: [] }

  it('turns a burst of events into one read and one post', async () => {
    vi.useFakeTimers()
    const load = vi.fn(async () => tree)
    const post = vi.fn()
    const publisher = new TreePublisher({ load, post, debounceMs: 100 })
    publisher.schedule()
    publisher.schedule()
    await vi.advanceTimersByTimeAsync(100)
    vi.useRealTimers()
    expect(load).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when nothing changed', async () => {
    vi.useFakeTimers()
    const post = vi.fn()
    const publisher = new TreePublisher({ load: async () => tree, post, debounceMs: 100 })
    await publisher.current()
    publisher.schedule()
    await vi.advanceTimersByTimeAsync(100)
    vi.useRealTimers()
    expect(post).not.toHaveBeenCalled()
  })

  it('reports an unreachable daemon instead of failing', async () => {
    const publisher = new TreePublisher({
      load: async () => {
        throw new Error('connect ENOENT')
      },
      post: () => undefined
    })
    await expect(publisher.current()).resolves.toEqual({
      projects: [],
      containers: [],
      error: 'connect ENOENT'
    })
  })
})
