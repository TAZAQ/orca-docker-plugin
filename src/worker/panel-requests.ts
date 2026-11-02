import {
  CONTAINER_ACTION_REQUEST,
  CONTAINER_ACTIONS,
  FILES_REQUEST,
  IMAGE_PRUNE_PREVIEW_REQUEST,
  IMAGE_PRUNE_REQUEST,
  IMAGE_REMOVE_REQUEST,
  INSPECT_REQUEST,
  LOGS_RENEW_REQUEST,
  LOGS_START_REQUEST,
  LOGS_STOP_REQUEST,
  PROCESSES_REQUEST,
  PRUNE_MODES,
  SEND_TEXT_REQUEST,
  TREE_REQUEST,
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
  type ProcessesOutput,
  type PruneInput,
  type PruneMode,
  type PrunePreview,
  type PruneResult,
  type SendTextInput,
  type SendTextOutput
} from '../shared/protocol'

/** Requests the panel sends through `orca.plugin.request`. */

type PanelRequestsApi = {
  panels: { handle(name: string, handler: (input: unknown) => unknown): void }
  host: { call(method: string, params?: unknown): Promise<unknown> }
}

type PanelRequestsDeps = {
  tree: { current(): Promise<DockerTree> }
  containerAction(id: string, action: ContainerAction): Promise<void>
  inspect(kind: InspectInput['kind'], id: string): Promise<unknown>
  processes(id: string): Promise<{ Titles: string[]; Processes: string[][] | null }>
  files(id: string, path: string): Promise<string>
  removeImage(id: string, containerIds: string[]): Promise<void>
  previewPrune(mode: PruneMode): Promise<PrunePreview>
  pruneImages(mode: PruneMode): Promise<PruneResult>
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

function isSendTextInput(input: unknown): input is SendTextInput {
  const value = input as Partial<SendTextInput> | null
  return (
    typeof value?.terminalId === 'string' &&
    value.terminalId !== '' &&
    typeof value.text === 'string' &&
    typeof value.enter === 'boolean'
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

  orca.panels.handle(SEND_TEXT_REQUEST, async (input) => {
    if (!isSendTextInput(input)) {
      throw invalidParams(SEND_TEXT_REQUEST)
    }
    return (await orca.host.call('terminal.sendText', input)) as SendTextOutput
  })
}
