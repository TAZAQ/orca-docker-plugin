import {
  CONTAINER_ACTION_REQUEST,
  SEND_TEXT_REQUEST,
  TREE_CHANGED_EVENT,
  TREE_REQUEST,
  type ContainerAction,
  type ContainerActionInput,
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
  containerAction(id: string, action: ContainerAction): Promise<void>
  onTreeChanged(listener: (tree: DockerTree) => void): Subscription
}

export type Subscription = { dispose(): void }

export type OrcaFrameApi = {
  host: { call(method: string, params?: unknown): Promise<unknown> }
  plugin: {
    request(name: string, input?: unknown, options?: { timeoutMs?: number }): Promise<unknown>
    on(event: string, listener: (payload: never) => void): Subscription
  }
}

/** Longer than the worker's own limit, so its error arrives rather than a bare timeout. */
const CONTAINER_ACTION_TIMEOUT_MS = 70_000

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
    async containerAction(id, action) {
      const input: ContainerActionInput = { id, action }
      await orca.plugin.request(CONTAINER_ACTION_REQUEST, input, {
        timeoutMs: CONTAINER_ACTION_TIMEOUT_MS
      })
    },
    onTreeChanged(listener) {
      return orca.plugin.on(TREE_CHANGED_EVENT, listener)
    }
  }
}
