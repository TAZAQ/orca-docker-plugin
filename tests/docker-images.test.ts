import { describe, expect, it, vi } from 'vitest'
import type { DockerContainer, DockerImage } from '../src/worker/docker-api'
import { previewPrune, pruneCandidates, removeImageWithContainers } from '../src/worker/docker-images'

const image = (Id: string, RepoTags: string[] | null, Size = 1): DockerImage => ({ Id, RepoTags, Size })
const container = (Id: string, ImageID: string): DockerContainer => ({
  Id,
  ImageID,
  Names: [`/${Id}`],
  State: 'exited',
  Status: 'Exited (0)',
  Image: 'x',
  Ports: [],
  Labels: {}
})

const images = [
  image('sha256:tagged-used', ['app:1']),
  image('sha256:tagged-free', ['app:old']),
  image('sha256:none-free', ['<none>:<none>']),
  image('sha256:null-free', null),
  image('sha256:none-used', null)
]
const containers = [container('c1', 'sha256:tagged-used'), container('c2', 'sha256:none-used')]

describe('pruneCandidates', () => {
  it('takes only untagged images in dangling mode', () => {
    expect(pruneCandidates(images, containers, 'dangling').map((item) => item.Id)).toEqual([
      'sha256:none-free',
      'sha256:null-free'
    ])
  })

  it('takes every image without a container in unused mode', () => {
    expect(pruneCandidates(images, containers, 'unused').map((item) => item.Id)).toEqual([
      'sha256:tagged-free',
      'sha256:none-free',
      'sha256:null-free'
    ])
  })

  it('never takes an image a stopped container uses', () => {
    const taken = pruneCandidates(images, containers, 'unused').map((item) => item.Id)
    expect(taken).not.toContain('sha256:tagged-used')
    expect(taken).not.toContain('sha256:none-used')
  })
})

describe('previewPrune', () => {
  it('names images, by a short id when they have no tag', async () => {
    const preview = await previewPrune(
      { listImages: async () => [image('sha256:0123456789abcdef', null, 7)], listContainers: async () => [] },
      'dangling'
    )
    expect(preview).toEqual({ images: [{ name: '0123456789ab', size: 7 }] })
  })
})

describe('removeImageWithContainers', () => {
  function docker(list: DockerContainer[]) {
    const calls: string[] = []
    return {
      calls,
      api: {
        listContainers: async () => list,
        listImages: async () => [],
        forceRemoveContainer: vi.fn(async (id: string) => void calls.push(`container ${id}`)),
        removeImage: vi.fn(async (id: string) => void calls.push(`image ${id}`))
      }
    }
  }

  it('removes the containers first, then the image, and no other container', async () => {
    const { api, calls } = docker([container('a', 'sha256:x'), container('b', 'sha256:x'), container('c', 'sha256:y')])
    await removeImageWithContainers(api, 'sha256:x', ['a', 'b'])
    expect(calls).toEqual(['container a', 'container b', 'image sha256:x'])
  })

  it('removes an image no container uses', async () => {
    const { api, calls } = docker([])
    await removeImageWithContainers(api, 'sha256:x', [])
    expect(calls).toEqual(['image sha256:x'])
  })

  it('touches nothing when a new container appeared after the person agreed', async () => {
    const { api, calls } = docker([container('a', 'sha256:x'), container('new', 'sha256:x')])
    await expect(removeImageWithContainers(api, 'sha256:x', ['a'])).rejects.toMatchObject({ code: 'conflict' })
    expect(calls).toEqual([])
  })

  it('touches nothing when an agreed container is gone', async () => {
    const { api, calls } = docker([])
    await expect(removeImageWithContainers(api, 'sha256:x', ['a'])).rejects.toMatchObject({ code: 'conflict' })
    expect(calls).toEqual([])
  })

  it('keeps the image when a container could not be removed', async () => {
    const { api } = docker([container('a', 'sha256:x')])
    api.forceRemoveContainer.mockRejectedValue(new Error('cannot kill'))
    await expect(removeImageWithContainers(api, 'sha256:x', ['a'])).rejects.toThrow('cannot kill')
    expect(api.removeImage).not.toHaveBeenCalled()
  })
})
