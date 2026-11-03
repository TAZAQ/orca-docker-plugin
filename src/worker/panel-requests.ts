import {
  CLEANUP_KINDS,
  CLEANUP_PREVIEW_REQUEST,
  CLEANUP_REQUEST,
  CONTAINER_ACTION_REQUEST,
  CONTAINER_ACTIONS,
  DOCKER_NAME,
  FILES_REQUEST,
  IMAGE_PRUNE_PREVIEW_REQUEST,
  IMAGE_PRUNE_REQUEST,
  IMAGE_REMOVE_REQUEST,
  INSPECT_REQUEST,
  LOGS_RENEW_REQUEST,
  LOGS_START_REQUEST,
  LOGS_STOP_REQUEST,
  NETWORK_CREATE_REQUEST,
  NETWORK_DRIVERS,
  OPEN_TERMINAL_REQUEST,
  PROCESSES_REQUEST,
  PRUNE_MODES,
  VOLUME_CREATE_REQUEST,
  TREE_REQUEST,
  type CleanupInput,
  type CleanupKind,
  type CleanupPreview,
  type CleanupResult,
  type ContainerAction,
  type ContainerActionInput,
  type ContainerInput,
  type DockerTree,
  type FilesInput,
  type FilesOutput,
  type ImageRemoveInput,
  type InspectInput,
  type LogsRenewOutput,
  type LogsStartOutput,
  type LogsStreamInput,
  type NetworkCreateInput,
  type NetworkDriver,
  type ProcessesOutput,
  type PruneInput,
  type PruneMode,
  type PrunePreview,
  type PruneResult,
  type VolumeCreateInput,
  type OpenTerminalInput
} from '../shared/protocol'

/** Requests the panel sends through `orca.plugin.request`. */

type PanelRequestsApi = {
  panels: { handle(name: string, handler: (input: unknown) => unknown): void }
}

type PanelRequestsDeps = {
  terminals: { open(input: OpenTerminalInput): Promise<void> }
  tree: { current(): Promise<DockerTree> }
  containerAction(id: string, action: ContainerAction): Promise<void>
  inspect(kind: InspectInput['kind'], id: string): Promise<unknown>
  processes(id: string): Promise<{ Titles: string[]; Processes: string[][] | null }>
  files(id: string, path: string): Promise<string>
  removeImage(id: string, containerIds: string[]): Promise<void>
  previewPrune(mode: PruneMode): Promise<PrunePreview>
  pruneImages(mode: PruneMode): Promise<PruneResult>
  previewCleanup(kind: CleanupKind): Promise<CleanupPreview>
  cleanup(kind: CleanupKind, ids: string[]): Promise<CleanupResult>
  createNetwork(input: NetworkCreateInput): Promise<void>
  createVolume(name: string): Promise<void>
  logs: {
    start(id: string): string
    renew(streamId: string): boolean
    stop(streamId?: string): void
  }
}

/** The id goes into a Docker API path, so nothing but a container id may get there. */
const CONTAINER_ID = /^[0-9a-f]{12,64}$/

const IMAGE_ID = /^sha256:[0-9a-f]{64}$/

function invalidParams(request: string): Error {
  return Object.assign(new Error(`${request}: malformed input`), { code: 'invalid_params' })
}

function isContainerInput(input: unknown): input is ContainerInput {
  const value = input as Partial<ContainerInput> | null
  return typeof value?.id === 'string' && CONTAINER_ID.test(value.id)
}

function isInspectInput(input: unknown): input is InspectInput {
  const value = input as Partial<InspectInput> | null
  return (
    typeof value?.id === 'string' &&
    ((value.kind === 'container' && CONTAINER_ID.test(value.id)) ||
      (value.kind === 'image' && IMAGE_ID.test(value.id)))
  )
}

function isImageRemoveInput(input: unknown): input is ImageRemoveInput {
  const value = input as Partial<ImageRemoveInput> | null
  return (
    typeof value?.id === 'string' &&
    IMAGE_ID.test(value.id) &&
    Array.isArray(value.containerIds) &&
    value.containerIds.every((id) => typeof id === 'string' && CONTAINER_ID.test(id))
  )
}

function isPruneInput(input: unknown): input is PruneInput {
  return PRUNE_MODES.includes((input as Partial<PruneInput> | null)?.mode as PruneMode)
}

function isCleanupKind(kind: unknown): kind is CleanupKind {
  return CLEANUP_KINDS.includes(kind as CleanupKind)
}

/** Containers and networks go by id, volumes by name: each has to look like one. */
function isCleanupInput(input: unknown): input is CleanupInput {
  const value = input as Partial<CleanupInput> | null
  if (!isCleanupKind(value?.kind) || !Array.isArray(value.ids)) {
    return false
  }
  const pattern = value.kind === 'volumes' ? DOCKER_NAME : CONTAINER_ID
  return value.ids.every((id) => typeof id === 'string' && pattern.test(id))
}

function isNetworkCreateInput(input: unknown): input is NetworkCreateInput {
  const value = input as Partial<NetworkCreateInput> | null
  return (
    typeof value?.name === 'string' &&
    DOCKER_NAME.test(value.name) &&
    NETWORK_DRIVERS.includes(value.driver as NetworkDriver) &&
    typeof value.attachable === 'boolean' &&
    typeof value.internal === 'boolean'
  )
}

function isVolumeCreateInput(input: unknown): input is VolumeCreateInput {
  const value = input as Partial<VolumeCreateInput> | null
  return typeof value?.name === 'string' && DOCKER_NAME.test(value.name)
}

function isFilesInput(input: unknown): input is FilesInput {
  const value = input as Partial<FilesInput> | null
  return isContainerInput(input) && typeof value?.path === 'string' && value.path.startsWith('/')
}

function isLogsStreamInput(input: unknown): input is LogsStreamInput {
  return typeof (input as Partial<LogsStreamInput> | null)?.streamId === 'string'
}

function isContainerActionInput(input: unknown): input is ContainerActionInput {
  const value = input as Partial<ContainerActionInput> | null
  return (
    typeof value?.id === 'string' &&
    CONTAINER_ID.test(value.id) &&
    CONTAINER_ACTIONS.includes(value.action as ContainerAction)
  )
}

function isOpenTerminalInput(input: unknown): input is OpenTerminalInput {
  const value = input as Partial<OpenTerminalInput> | null
  return (
    typeof value?.title === 'string' &&
    typeof value.command === 'string' &&
    value.command !== '' &&
    (value.reuseKey === undefined || typeof value.reuseKey === 'string')
  )
}

export function registerPanelRequests(orca: PanelRequestsApi, deps: PanelRequestsDeps): void {
  orca.panels.handle(TREE_REQUEST, () => deps.tree.current())

  orca.panels.handle(CONTAINER_ACTION_REQUEST, async (input) => {
    if (!isContainerActionInput(input)) {
      throw invalidParams(CONTAINER_ACTION_REQUEST)
    }
    await deps.containerAction(input.id, input.action)
    return null
  })

  orca.panels.handle(INSPECT_REQUEST, (input) => {
    if (!isInspectInput(input)) {
      throw invalidParams(INSPECT_REQUEST)
    }
    return deps.inspect(input.kind, input.id)
  })

  orca.panels.handle(PROCESSES_REQUEST, async (input): Promise<ProcessesOutput> => {
    if (!isContainerInput(input)) {
      throw invalidParams(PROCESSES_REQUEST)
    }
    const { Titles, Processes } = await deps.processes(input.id)
    return { titles: Titles, processes: Processes ?? [] }
  })

  orca.panels.handle(FILES_REQUEST, async (input): Promise<FilesOutput> => {
    if (!isFilesInput(input)) {
      throw invalidParams(FILES_REQUEST)
    }
    return { text: await deps.files(input.id, input.path) }
  })

  orca.panels.handle(IMAGE_REMOVE_REQUEST, async (input) => {
    if (!isImageRemoveInput(input)) {
      throw invalidParams(IMAGE_REMOVE_REQUEST)
    }
    await deps.removeImage(input.id, input.containerIds)
    return null
  })

  orca.panels.handle(IMAGE_PRUNE_PREVIEW_REQUEST, (input) => {
    if (!isPruneInput(input)) {
      throw invalidParams(IMAGE_PRUNE_PREVIEW_REQUEST)
    }
    return deps.previewPrune(input.mode)
  })

  orca.panels.handle(IMAGE_PRUNE_REQUEST, (input) => {
    if (!isPruneInput(input)) {
      throw invalidParams(IMAGE_PRUNE_REQUEST)
    }
    return deps.pruneImages(input.mode)
  })

  orca.panels.handle(CLEANUP_PREVIEW_REQUEST, (input) => {
    const kind = (input as { kind?: unknown } | null)?.kind
    if (!isCleanupKind(kind)) {
      throw invalidParams(CLEANUP_PREVIEW_REQUEST)
    }
    return deps.previewCleanup(kind)
  })

  orca.panels.handle(CLEANUP_REQUEST, (input) => {
    if (!isCleanupInput(input)) {
      throw invalidParams(CLEANUP_REQUEST)
    }
    return deps.cleanup(input.kind, input.ids)
  })

  orca.panels.handle(NETWORK_CREATE_REQUEST, async (input) => {
    if (!isNetworkCreateInput(input)) {
      throw invalidParams(NETWORK_CREATE_REQUEST)
    }
    const { name, driver, attachable, internal } = input
    await deps.createNetwork({ name, driver, attachable, internal })
    return null
  })

  orca.panels.handle(VOLUME_CREATE_REQUEST, async (input) => {
    if (!isVolumeCreateInput(input)) {
      throw invalidParams(VOLUME_CREATE_REQUEST)
    }
    await deps.createVolume(input.name)
    return null
  })

  orca.panels.handle(LOGS_START_REQUEST, (input): LogsStartOutput => {
    if (!isContainerInput(input)) {
      throw invalidParams(LOGS_START_REQUEST)
    }
    return { streamId: deps.logs.start(input.id) }
  })

  orca.panels.handle(LOGS_RENEW_REQUEST, (input): LogsRenewOutput => {
    if (!isLogsStreamInput(input)) {
      throw invalidParams(LOGS_RENEW_REQUEST)
    }
    return { alive: deps.logs.renew(input.streamId) }
  })

  orca.panels.handle(LOGS_STOP_REQUEST, (input) => {
    if (!isLogsStreamInput(input)) {
      throw invalidParams(LOGS_STOP_REQUEST)
    }
    deps.logs.stop(input.streamId)
    return null
  })

  orca.panels.handle(OPEN_TERMINAL_REQUEST, async (input) => {
    if (!isOpenTerminalInput(input)) {
      throw invalidParams(OPEN_TERMINAL_REQUEST)
    }
    await deps.terminals.open(input)
    return null
  })
}
