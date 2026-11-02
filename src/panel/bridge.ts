import { SEND_TEXT_REQUEST, type SendTextInput, type SendTextOutput } from '../shared/protocol'

/** The panel's view of Orca: the frame API `window.orca`. Anything a panel may not do itself
 * (typing into a terminal, talking to Docker) goes to the plugin's worker via `plugin.request`. */

export type WorkspaceContext = {
  branch: string
  displayName: string
  terminals: { id: string }[]
} | null

export type HostBridge = {
  readContext(): Promise<WorkspaceContext>
  sendText(terminalId: string, text: string, enter: boolean): Promise<boolean>
}

export type OrcaFrameApi = {
  host: { call(method: string, params?: unknown): Promise<unknown> }
  plugin: { request(name: string, input?: unknown): Promise<unknown> }
}

export function createHostBridge(orca: OrcaFrameApi): HostBridge {
  return {
    async readContext() {
      return (await orca.host.call('workspace.readContext')) as WorkspaceContext
    },
    async sendText(terminalId, text, enter) {
      const input: SendTextInput = { terminalId, text, enter }
      const output = (await orca.plugin.request(SEND_TEXT_REQUEST, input)) as SendTextOutput
      return output.accepted
    }
  }
}
