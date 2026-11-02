import { describe, expect, it } from 'vitest'
import { filterTree, isTreeEmpty } from '../src/panel/tree-filter'
import { emptyTree, type DockerTree, type TreeContainer } from '../src/shared/protocol'

function container(name: string, overrides: Partial<TreeContainer> = {}): TreeContainer {
  return {
    id: name,
    name,
    image: 'nginx:1',
    state: 'running',
    status: 'Up',
    health: null,
    ports: [],
    ...overrides
  }
}

const web1 = container('shop-web-1')
const web2 = container('shop-web-2')
const db = container('shop-db-1', { image: 'postgres:14', ports: ['5432→5432'] })
const tree: DockerTree = {
  ...emptyTree(),
  projects: [
    {
      name: 'shop',
      configFiles: [],
      services: [
        { name: 'web', containers: [web1, web2] },
        { name: 'db', containers: [db] }
      ]
    }
  ],
  containers: [db, web1, web2],
  images: [{ id: 'i1', name: 'nginx:1', tags: ['nginx:1', 'nginx:latest'], size: 1 }],
  networks: [{ id: 'n1', name: 'shop_default', driver: 'bridge' }],
  volumes: [{ name: 'pgdata', driver: 'local' }]
}

describe('filterTree', () => {
  it('returns the tree as is for a blank search', () => {
    expect(filterTree(tree, '   ')).toBe(tree)
  })

  it('keeps everything under a matching project', () => {
    expect(filterTree(tree, 'SHOP').projects[0]!.services).toHaveLength(2)
  })

  it('keeps a matching service whole and drops its siblings', () => {
    const services = filterTree(tree, 'web').projects[0]!.services
    expect(services.map((service) => service.name)).toEqual(['web'])
    expect(services[0]!.containers).toHaveLength(2)
  })

  it('keeps only the matching container of a service', () => {
    const services = filterTree(tree, 'web-2').projects[0]!.services
    expect(services[0]!.containers.map((item) => item.name)).toEqual(['shop-web-2'])
  })

  it('finds containers by image and port', () => {
    expect(filterTree(tree, 'postgres').containers).toEqual([db])
    expect(filterTree(tree, '5432').containers).toEqual([db])
  })

  it('finds an image by any of its tags, and networks and volumes by name', () => {
    expect(filterTree(tree, 'latest').images).toHaveLength(1)
    expect(filterTree(tree, 'shop_default').networks).toHaveLength(1)
    expect(filterTree(tree, 'pgdata').volumes).toHaveLength(1)
  })

  it('leaves nothing when nothing matches', () => {
    expect(isTreeEmpty(filterTree(tree, 'zzz'))).toBe(true)
    expect(isTreeEmpty(filterTree(tree, 'nginx'))).toBe(false)
  })
})
