import {
  CLEANUP_PREVIEW_REQUEST,
  CLEANUP_REQUEST,
  CONTAINER_ACTION_REQUEST,
  CONTEXT_USE_REQUEST,
  DASHBOARD_REQUEST,
  FILES_REQUEST,
  IMAGE_SEARCH_REQUEST,
  IMAGE_PRUNE_PREVIEW_REQUEST,
  IMAGE_PRUNE_REQUEST,
  IMAGE_REMOVE_REQUEST,
  INSPECT_REQUEST,
  LOGS_EVENT,
  LOGS_RENEW_REQUEST,
  LOGS_START_REQUEST,
  LOGS_STOP_REQUEST,
  NETWORK_CREATE_REQUEST,
  OPEN_TERMINAL_REQUEST,
  PROCESSES_REQUEST,
  REMOVE_REQUEST,
  SYSTEM_CLEANUP_PREVIEW_REQUEST,
  SYSTEM_CLEANUP_REQUEST,
  VOLUME_CREATE_REQUEST,
  TREE_CHANGED_EVENT,
  TREE_REQUEST,
  type CleanupKind,
  type CleanupPreview,
  type CleanupResult,
  type ContainerAction,
  type ContainerActionInput,
  type Dashboard,
  type DockerTree,
  type FilesOutput,
  type ImageSearchOutput,
  type ObjectKind,
  type RemoveInput,
  type LogsPayload,
  type NetworkCreateInput,
  type LogsRenewOutput,
  type LogsStartOutput,
  type ProcessesOutput,
  type PruneMode,
  type PrunePreview,
  type PruneResult,
  type SystemCleanupInput,
  type SystemCleanupPreview,
  type SystemCleanupResult,
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
  inspect(kind: ObjectKind, id: string): Promise<unknown>
  dashboard(kind: ObjectKind, id: string): Promise<Dashboard>
  remove(kind: RemoveInput['kind'], id: string): Promise<void>
  processes(id: string): Promise<ProcessesOutput>
  files(id: string, path: string): Promise<string>
  removeImage(id: string, containerIds: string[]): Promise<void>
  previewPrune(mode: PruneMode): Promise<PrunePreview>
  pruneImages(mode: PruneMode): Promise<PruneResult>
  previewCleanup(kind: CleanupKind): Promise<CleanupPreview>
  cleanup(kind: CleanupKind, ids: string[]): Promise<CleanupResult>
  createNetwork(input: NetworkCreateInput): Promise<void>
  createVolume(name: string): Promise<void>
  searchImages(term: string): Promise<string[]>
  previewSystemCleanup(): Promise<SystemCleanupPreview>
  systemCleanup(input: SystemCleanupInput): Promise<SystemCleanupResult>
  /** False when this Orca cannot open links, or the person cancelled. */
  openExternal(url: string): Promise<boolean>
  useContext(name: string | null): Promise<void>
  startLogs(id: string): Promise<string>
  renewLogs(streamId: string): Promise<boolean>
  stopLogs(streamId: string): Promise<void>
  onLogs(listener: (payload: LogsPayload) => void): Subscription
}

export type Subscription = { dispose(): void }

export type OrcaFrameApi = {
  on(event: string, listener: (payload: never) => void): Subscription
  /** Desktop app only; it needs the click that triggered it. */
  shell?: { openExternal(url: string): Promise<{ opened: boolean }> }
  host: { call(method: string, params?: unknown): Promise<unknown> }
  plugin: {
    request(name: string, input?: unknown, options?: { timeoutMs?: number }): Promise<unknown>
    on(event: string, listener: (payload: never) => void): Subscription
  }
}

/** Longer than the worker's own limit, so its error arrives rather than a bare timeout. */
const CONTAINER_ACTION_TIMEOUT_MS = 70_000
/** The longest Orca lets a request take. A cleanup may run longer and still finish in the worker. */
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
    async dashboard(kind, id) {
      return (await orca.plugin.request(DASHBOARD_REQUEST, { kind, id })) as Dashboard
    },
    async remove(kind, id) {
      await orca.plugin.request(REMOVE_REQUEST, { kind, id })
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
    async previewCleanup(kind) {
      return (await orca.plugin.request(CLEANUP_PREVIEW_REQUEST, { kind })) as CleanupPreview
    },
    async cleanup(kind, ids) {
      return (await orca.plugin.request(
        CLEANUP_REQUEST,
        { kind, ids },
        { timeoutMs: IMAGE_REQUEST_TIMEOUT_MS }
      )) as CleanupResult
    },
    async createNetwork(input) {
      await orca.plugin.request(NETWORK_CREATE_REQUEST, input)
    },
    async createVolume(name) {
      await orca.plugin.request(VOLUME_CREATE_REQUEST, { name })
    },
    async searchImages(term) {
      const output = (await orca.plugin.request(IMAGE_SEARCH_REQUEST, { term })) as ImageSearchOutput
      return output.names
    },
    async previewSystemCleanup() {
      return (await orca.plugin.request(SYSTEM_CLEANUP_PREVIEW_REQUEST, undefined, {
        timeoutMs: IMAGE_REQUEST_TIMEOUT_MS
      })) as SystemCleanupPreview
    },
    async systemCleanup(input) {
      return (await orca.plugin.request(SYSTEM_CLEANUP_REQUEST, input, {
        timeoutMs: IMAGE_REQUEST_TIMEOUT_MS
      })) as SystemCleanupResult
    },
    async useContext(name) {
      await orca.plugin.request(CONTEXT_USE_REQUEST, { name })
    },
    async openExternal(url) {
      if (!orca.shell) {
        return false
      }
      return (await orca.shell.openExternal(url)).opened
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
