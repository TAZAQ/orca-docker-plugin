import { SEND_TEXT_REQUEST, type SendTextInput, type SendTextOutput } from '../shared/protocol'

/** Requests the panel sends through `orca.plugin.request`. */

type PanelRequestsApi = {
  panels: { handle(name: string, handler: (input: unknown) => unknown): void }
  host: { call(method: string, params?: unknown): Promise<unknown> }
}

function isSendTextInput(input: unknown): input is SendTextInput {
  const value = input as Partial<SendTextInput> | null
  return (
    typeof value?.terminalId === 'string' &&
    value.terminalId !== '' &&
    typeof value.text === 'string' &&
    typeof value.enter === 'boolean'
  )
}

export function registerPanelRequests(orca: PanelRequestsApi): void {
  orca.panels.handle(SEND_TEXT_REQUEST, async (input) => {
    if (!isSendTextInput(input)) {
      throw Object.assign(new Error(`${SEND_TEXT_REQUEST}: malformed input`), { code: 'invalid_params' })
    }
    return (await orca.host.call('terminal.sendText', input)) as SendTextOutput
  })
}
