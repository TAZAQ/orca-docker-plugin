import { describe, expect, it, vi } from 'vitest'
import { registerPanelRequests } from '../src/worker/panel-requests'
import {
  CONTAINER_ACTION_REQUEST,
  SEND_TEXT_REQUEST,
  TREE_REQUEST,
  type DockerTree
} from '../src/shared/protocol'

function fakeOrca(accepted = true) {
  const handlers = new Map<string, (input: unknown) => unknown>()
  const call = vi.fn(async () => ({ accepted }))
  const tree: DockerTree = { projects: [], containers: [] }
  const containerAction = vi.fn(async () => undefined)
  registerPanelRequests(
    {
      panels: { handle: (name, handler) => void handlers.set(name, handler) },
      host: { call }
    },
    { tree: { current: async () => tree }, containerAction }
  )
  return {
    call,
    tree,
    send: (input: unknown) => handlers.get(SEND_TEXT_REQUEST)!(input),
    loadTree: () => handlers.get(TREE_REQUEST)!(null),
    containerAction,
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
