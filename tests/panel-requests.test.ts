import { describe, expect, it, vi } from 'vitest'
import { registerPanelRequests } from '../src/worker/panel-requests'
import {
  CONTAINER_ACTION_REQUEST,
  emptyTree,
  FILES_REQUEST,
  INSPECT_REQUEST,
  LOGS_RENEW_REQUEST,
  LOGS_START_REQUEST,
  LOGS_STOP_REQUEST,
  PROCESSES_REQUEST,
  SEND_TEXT_REQUEST,
  TREE_REQUEST,
  type DockerTree
} from '../src/shared/protocol'

function fakeOrca(accepted = true) {
  const handlers = new Map<string, (input: unknown) => unknown>()
  const call = vi.fn(async () => ({ accepted }))
  const tree: DockerTree = emptyTree()
  const containerAction = vi.fn(async () => undefined)
  const files = vi.fn(async () => 'total 0')
  const logs = { start: vi.fn(() => 'stream-1'), renew: vi.fn(() => true), stop: vi.fn() }
  registerPanelRequests(
    {
      panels: { handle: (name, handler) => void handlers.set(name, handler) },
      host: { call }
    },
    {
      tree: { current: async () => tree },
      containerAction,
      logs,
      inspect: async (_kind, id) => ({ Id: id }),
      processes: async () => ({ Titles: ['PID'], Processes: null }),
      files
    }
  )
  return {
    call,
    tree,
    send: (input: unknown) => handlers.get(SEND_TEXT_REQUEST)!(input),
    loadTree: () => handlers.get(TREE_REQUEST)!(null),
    containerAction,
    logs,
    files,
    request: (name: string, input: unknown) => handlers.get(name)!(input),
    act: (input: unknown) => handlers.get(CONTAINER_ACTION_REQUEST)!(input)
  }
}

describe('registerPanelRequests', () => {
  it('types into the terminal on behalf of the panel, which cannot do it itself', async () => {
    const { call, send } = fakeOrca()
    await expect(send({ terminalId: 't-1', text: 'docker compose ps', enter: false })).resolves.toEqual({
      accepted: true
    })
    expect(call).toHaveBeenCalledWith('terminal.sendText', {
      terminalId: 't-1',
      text: 'docker compose ps',
      enter: false
    })
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

  it('reports a terminal that refused the text', async () => {
    const { send } = fakeOrca(false)
    await expect(send({ terminalId: 't-1', text: 'x', enter: true })).resolves.toEqual({ accepted: false })
  })

  it.each([
    [null],
    [{ terminalId: 't-1', text: 'x' }],
    [{ terminalId: '', text: 'x', enter: true }],
    [{ terminalId: 't-1', text: 1, enter: true }]
  ])('refuses malformed input %j', async (input) => {
    const { call, send } = fakeOrca()
    await expect(send(input)).rejects.toMatchObject({ code: 'invalid_params' })
    expect(call).not.toHaveBeenCalled()
  })
})
