import { describe, expect, it, vi } from 'vitest'
import { registerPanelRequests } from '../src/worker/panel-requests'
import { SEND_TEXT_REQUEST } from '../src/shared/protocol'

function fakeOrca(accepted = true) {
  const handlers = new Map<string, (input: unknown) => unknown>()
  const call = vi.fn(async () => ({ accepted }))
  registerPanelRequests({
    panels: { handle: (name, handler) => void handlers.set(name, handler) },
    host: { call }
  })
  return { call, send: (input: unknown) => handlers.get(SEND_TEXT_REQUEST)!(input) }
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
