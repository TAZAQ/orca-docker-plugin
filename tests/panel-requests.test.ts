import { describe, expect, it, vi } from 'vitest'
import { registerPanelRequests } from '../src/worker/panel-requests'
import {
  CLEANUP_PREVIEW_REQUEST,
  CLEANUP_REQUEST,
  CONTAINER_ACTION_REQUEST,
  emptyTree,
  FILES_REQUEST,
  IMAGE_SEARCH_REQUEST,
  IMAGE_PRUNE_PREVIEW_REQUEST,
  IMAGE_PRUNE_REQUEST,
  IMAGE_REMOVE_REQUEST,
  INSPECT_REQUEST,
  LOGS_RENEW_REQUEST,
  LOGS_START_REQUEST,
  LOGS_STOP_REQUEST,
  NETWORK_CREATE_REQUEST,
  OPEN_TERMINAL_REQUEST,
  PROCESSES_REQUEST,
  SYSTEM_CLEANUP_REQUEST,
  VOLUME_CREATE_REQUEST,
  TREE_REQUEST,
  type DockerTree
} from '../src/shared/protocol'

function fakeOrca() {
  const handlers = new Map<string, (input: unknown) => unknown>()
  const openTerminal = vi.fn(async () => undefined)
  const tree: DockerTree = emptyTree()
  const containerAction = vi.fn(async () => undefined)
  const files = vi.fn(async () => 'total 0')
  const removeImage = vi.fn(async () => undefined)
  const pruneImages = vi.fn(async () => ({ removed: 0, reclaimed: 0 }))
  const cleanupFn = vi.fn(async () => ({ removed: 1, skipped: 0, failed: [] }))
  const createNetwork = vi.fn(async () => undefined)
  const createVolume = vi.fn(async () => undefined)
  const systemCleanup = vi.fn(async () => ({ removed: 0, skipped: 0, failed: [], buildCacheFreed: 0 }))
  const logs = { start: vi.fn(() => 'stream-1'), renew: vi.fn(() => true), stop: vi.fn() }
  registerPanelRequests(
    { panels: { handle: (name, handler) => void handlers.set(name, handler) } },
    {
      terminals: { open: openTerminal },
      tree: { current: async () => tree },
      containerAction,
      logs,
      inspect: async (_kind, id) => ({ Id: id }),
      processes: async () => ({ Titles: ['PID'], Processes: null }),
      files,
      removeImage,
      previewPrune: async () => ({ images: [] }),
      pruneImages,
      previewCleanup: async () => ({ items: [] }),
      cleanup: cleanupFn,
      createNetwork,
      createVolume,
      searchImages: async (term: string) => [`${term}-official`],
      previewSystemCleanup: async () => ({
        containers: [],
        networks: [],
        volumes: [],
        images: [],
        buildCacheBytes: 0
      }),
      systemCleanup
    }
  )
  return {
    openTerminal,
    tree,
    open: (input: unknown) => handlers.get(OPEN_TERMINAL_REQUEST)!(input),
    loadTree: () => handlers.get(TREE_REQUEST)!(null),
    containerAction,
    logs,
    files,
    removeImage,
    pruneImages,
    cleanup: cleanupFn,
    createNetwork,
    createVolume,
    systemCleanup,
    request: (name: string, input: unknown) => handlers.get(name)!(input),
    act: (input: unknown) => handlers.get(CONTAINER_ACTION_REQUEST)!(input)
  }
}

describe('registerPanelRequests', () => {
  it('opens a terminal on behalf of the panel, which cannot do it itself', async () => {
    const { open, openTerminal } = fakeOrca()
    const input = { title: 'web sh', command: 'docker exec -it web sh', reuseKey: 'sh:web' }
    await open(input)
    expect(openTerminal).toHaveBeenCalledWith(input)
  })

  it('answers with the current tree', async () => {
    const { loadTree, tree } = fakeOrca()
    await expect(loadTree()).resolves.toBe(tree)
  })

  it('runs a container action', async () => {
    const { act, containerAction } = fakeOrca()
    await act({ id: 'abcdef012345', action: 'restart' })
    expect(containerAction).toHaveBeenCalledWith('abcdef012345', 'restart')
  })

  it.each([
    [null],
    [{ id: '../images/x', action: 'remove' }],
    [{ id: 'abcdef012345/../..', action: 'stop' }],
    [{ id: 'abcdef012345', action: 'exec' }]
  ])('refuses a container request that could leave the container API: %j', async (input) => {
    const { act, containerAction } = fakeOrca()
    await expect(act(input)).rejects.toMatchObject({ code: 'invalid_params' })
    expect(containerAction).not.toHaveBeenCalled()
  })

  it('starts, renews and stops a log stream', () => {
    const { logs, request } = fakeOrca()
    expect(request(LOGS_START_REQUEST, { id: 'abcdef012345' })).toEqual({ streamId: 'stream-1' })
    expect(request(LOGS_RENEW_REQUEST, { streamId: 'stream-1' })).toEqual({ alive: true })
    request(LOGS_STOP_REQUEST, { streamId: 'stream-1' })
    expect(logs.start).toHaveBeenCalledWith('abcdef012345')
    expect(logs.stop).toHaveBeenCalledWith('stream-1')
  })

  it('refuses logs of something that is not a container id', () => {
    const { logs, request } = fakeOrca()
    expect(() => request(LOGS_START_REQUEST, { id: '../../version' })).toThrow('malformed input')
    expect(logs.start).not.toHaveBeenCalled()
  })

  it('inspects a container or an image', async () => {
    const { request } = fakeOrca()
    await expect(request(INSPECT_REQUEST, { kind: 'container', id: 'abcdef012345' })).resolves.toEqual({
      Id: 'abcdef012345'
    })
    const image = `sha256:${'a'.repeat(64)}`
    await expect(request(INSPECT_REQUEST, { kind: 'image', id: image })).resolves.toEqual({ Id: image })
  })

  it.each([
    [{ kind: 'image', id: 'abcdef012345' }],
    [{ kind: 'container', id: '../version' }],
    [{ kind: 'network', id: 'abcdef012345' }]
  ])('refuses to inspect %j', (input) => {
    const { request } = fakeOrca()
    expect(() => request(INSPECT_REQUEST, input)).toThrow('malformed input')
  })

  it('answers with an empty process list for an idle container', async () => {
    const { request } = fakeOrca()
    await expect(request(PROCESSES_REQUEST, { id: 'abcdef012345' })).resolves.toEqual({
      titles: ['PID'],
      processes: []
    })
  })

  it('lists files only by an absolute path', async () => {
    const { request, files } = fakeOrca()
    await expect(request(FILES_REQUEST, { id: 'abcdef012345', path: '/etc' })).resolves.toEqual({
      text: 'total 0'
    })
    await expect(request(FILES_REQUEST, { id: 'abcdef012345', path: '-la' })).rejects.toMatchObject({
      code: 'invalid_params'
    })
    expect(files).toHaveBeenCalledTimes(1)
  })

  it('removes an image with the containers the person agreed to', async () => {
    const { request, removeImage } = fakeOrca()
    const id = `sha256:${'a'.repeat(64)}`
    await request(IMAGE_REMOVE_REQUEST, { id, containerIds: ['abcdef012345'] })
    expect(removeImage).toHaveBeenCalledWith(id, ['abcdef012345'])
  })

  it.each([
    [{ id: 'nginx:1', containerIds: [] }],
    [{ id: `sha256:${'a'.repeat(64)}` }],
    [{ id: `sha256:${'a'.repeat(64)}`, containerIds: ['../x'] }]
  ])('refuses image removal for %j', async (input) => {
    const { request, removeImage } = fakeOrca()
    await expect(request(IMAGE_REMOVE_REQUEST, input)).rejects.toMatchObject({ code: 'invalid_params' })
    expect(removeImage).not.toHaveBeenCalled()
  })

  it('prunes only by a known mode', () => {
    const { request, pruneImages } = fakeOrca()
    expect(() => request(IMAGE_PRUNE_REQUEST, { mode: 'everything' })).toThrow('malformed input')
    expect(() => request(IMAGE_PRUNE_PREVIEW_REQUEST, {})).toThrow('malformed input')
    expect(pruneImages).not.toHaveBeenCalled()
  })

  it.each([
    [null],
    [{ title: 't' }],
    [{ title: 't', command: '' }],
    [{ title: 't', command: 'c', reuseKey: 1 }]
  ])('refuses malformed input %j', async (input) => {
    const { open, openTerminal } = fakeOrca()
    await expect(open(input)).rejects.toMatchObject({ code: 'invalid_params' })
    expect(openTerminal).not.toHaveBeenCalled()
  })
})
