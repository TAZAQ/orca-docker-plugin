import {
  SEND_TEXT_REQUEST,
  TREE_CHANGED_EVENT,
  TREE_REQUEST,
  type DockerTree,
  type SendTextInput,
  type SendTextOutput
} from '../shared/protocol'

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
  loadTree(): Promise<DockerTree>
  onTreeChanged(listener: (tree: DockerTree) => void): Subscription
}

export type Subscription = { dispose(): void }

export type OrcaFrameApi = {
  host: { call(method: string, params?: unknown): Promise<unknown> }
  plugin: {
    request(name: string, input?: unknown): Promise<unknown>
    on(event: string, listener: (payload: never) => void): Subscription
  }
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
    },
    async loadTree() {
      return (await orca.plugin.request(TREE_REQUEST)) as DockerTree
    },
    onTreeChanged(listener) {
      return orca.plugin.on(TREE_CHANGED_EVENT, listener)
    }
  }
}
