import {
  CONTAINER_ACTION_REQUEST,
  FILES_REQUEST,
  IMAGE_PRUNE_PREVIEW_REQUEST,
  IMAGE_PRUNE_REQUEST,
  IMAGE_REMOVE_REQUEST,
  INSPECT_REQUEST,
  LOGS_EVENT,
  LOGS_RENEW_REQUEST,
  LOGS_START_REQUEST,
  LOGS_STOP_REQUEST,
  OPEN_TERMINAL_REQUEST,
  PROCESSES_REQUEST,
  TREE_CHANGED_EVENT,
  TREE_REQUEST,
  type ContainerAction,
  type ContainerActionInput,
  type DockerTree,
  type FilesOutput,
  type InspectInput,
  type LogsPayload,
  type LogsRenewOutput,
  type LogsStartOutput,
  type ProcessesOutput,
  type PruneMode,
  type PrunePreview,
  type PruneResult,
  type OpenTerminalInput
} from '../shared/protocol'

/** The panel's view of Orca: the frame API `window.orca`. Anything a panel may not do itself
 * (opening a terminal, talking to Docker) goes to the plugin's worker via `plugin.request`. */

export type WorkspaceContext = {
  branch: string
  displayName: string
} | null

export type HostBridge = {
  readContext(): Promise<WorkspaceContext>
  onContextChanged(listener: (context: WorkspaceContext) => void): Subscription
  openTerminal(input: OpenTerminalInput): Promise<void>
  loadTree(): Promise<DockerTree>
  containerAction(id: string, action: ContainerAction): Promise<void>
  onTreeChanged(listener: (tree: DockerTree | null) => void): Subscription
  inspect(kind: InspectInput['kind'], id: string): Promise<unknown>
  processes(id: string): Promise<ProcessesOutput>
  files(id: string, path: string): Promise<string>
  removeImage(id: string, containerIds: string[]): Promise<void>
  previewPrune(mode: PruneMode): Promise<PrunePreview>
  pruneImages(mode: PruneMode): Promise<PruneResult>
  startLogs(id: string): Promise<string>
  renewLogs(streamId: string): Promise<boolean>
  stopLogs(streamId: string): Promise<void>
  onLogs(listener: (payload: LogsPayload) => void): Subscription
}

export type Subscription = { dispose(): void }

export type OrcaFrameApi = {
  on(event: string, listener: (payload: never) => void): Subscription
  host: { call(method: string, params?: unknown): Promise<unknown> }
  plugin: {
    request(name: string, input?: unknown, options?: { timeoutMs?: number }): Promise<unknown>
    on(event: string, listener: (payload: never) => void): Subscription
  }
}

/** Longer than the worker's own limit, so its error arrives rather than a bare timeout. */
const CONTAINER_ACTION_TIMEOUT_MS = 70_000
/** The longest Orca lets a request take. A prune may run longer and still finish in the worker. */
const IMAGE_REQUEST_TIMEOUT_MS = 120_000

export function createHostBridge(orca: OrcaFrameApi): HostBridge {
  return {
    async readContext() {
      return (await orca.host.call('workspace.readContext')) as WorkspaceContext
    },
    onContextChanged(listener) {
      return orca.on('workspace.changed', ({ context }: { context: WorkspaceContext }) =>
        listener(context)
      )
    },
    async openTerminal(input) {
      await orca.plugin.request(OPEN_TERMINAL_REQUEST, input)
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
    },
    inspect(kind, id) {
      return orca.plugin.request(INSPECT_REQUEST, { kind, id })
    },
    async processes(id) {
      return (await orca.plugin.request(PROCESSES_REQUEST, { id })) as ProcessesOutput
    },
    async files(id, path) {
      const output = (await orca.plugin.request(FILES_REQUEST, { id, path })) as FilesOutput
      return output.text
    },
    async removeImage(id, containerIds) {
      await orca.plugin.request(
        IMAGE_REMOVE_REQUEST,
        { id, containerIds },
        { timeoutMs: IMAGE_REQUEST_TIMEOUT_MS }
      )
    },
    async previewPrune(mode) {
      return (await orca.plugin.request(IMAGE_PRUNE_PREVIEW_REQUEST, { mode })) as PrunePreview
    },
    async pruneImages(mode) {
      return (await orca.plugin.request(
        IMAGE_PRUNE_REQUEST,
        { mode },
        { timeoutMs: IMAGE_REQUEST_TIMEOUT_MS }
      )) as PruneResult
    },
    async startLogs(id) {
      const output = (await orca.plugin.request(LOGS_START_REQUEST, { id })) as LogsStartOutput
      return output.streamId
    },
    async renewLogs(streamId) {
      const output = (await orca.plugin.request(LOGS_RENEW_REQUEST, { streamId })) as LogsRenewOutput
      return output.alive
    },
    async stopLogs(streamId) {
      await orca.plugin.request(LOGS_STOP_REQUEST, { streamId })
    },
    onLogs(listener) {
      return orca.plugin.on(LOGS_EVENT, listener)
    }
  }
}
