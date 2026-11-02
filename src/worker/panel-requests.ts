import {
  CONTAINER_ACTION_REQUEST,
  CONTAINER_ACTIONS,
  SEND_TEXT_REQUEST,
  TREE_REQUEST,
  type ContainerAction,
  type ContainerActionInput,
  type DockerTree,
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
}

/** The id goes into a Docker API path, so nothing but a container id may get there. */
const CONTAINER_ID = /^[0-9a-f]{12,64}$/

function invalidParams(request: string): Error {
  return Object.assign(new Error(`${request}: malformed input`), { code: 'invalid_params' })
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

  orca.panels.handle(SEND_TEXT_REQUEST, async (input) => {
    if (!isSendTextInput(input)) {
      throw invalidParams(SEND_TEXT_REQUEST)
    }
    return (await orca.host.call('terminal.sendText', input)) as SendTextOutput
  })
}
