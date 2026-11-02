import type { ProjectAction, ServiceAction } from '../shared/compose'
import type {
  ContainerAction,
  TreeContainer,
  TreeImage,
  TreeProject,
  TreeService
} from '../shared/protocol'
import type { IconName } from './components/ActionIcon.vue'
import { isRunning, isUp } from './container-state'

/** What each right-click offers, following the context menus of the JetBrains Services view. */

export type MenuItem = {
  label: string
  icon?: IconName
  /** Set when the item cannot be used; says why. */
  disabledReason?: string
  run?: () => void
  children?: MenuEntry[]
}
export type MenuEntry = MenuItem | 'separator'

export type MenuTarget =
  | { kind: 'project'; project: TreeProject }
  | { kind: 'service'; project: TreeProject; service: TreeService }
  | {
      kind: 'container'
      container: TreeContainer
      /** Where it came from in the tree, when that was a Compose service. */
      compose?: { project: TreeProject; service: TreeService }
    }
  | { kind: 'docker' }

export type MenuActions = {
  canSend(): boolean
  images(): TreeImage[]
  compose(project: TreeProject, action: ProjectAction): void
  composeInTerminalFolder(): void
  service(project: TreeProject, service: TreeService, action: ServiceAction): void
  containerAction(container: TreeContainer, action: ContainerAction): void
  removeContainer(container: TreeContainer): void
  logs(container: TreeContainer): void
  files(container: TreeContainer): void
  inspectContainer(container: TreeContainer): void
  inspectImage(name: string, id: string): void
  processes(container: TreeContainer): void
  copy(label: string, text: string): void
  attach(container: TreeContainer): void
  exec(container: TreeContainer): void
  shell(container: TreeContainer, shell: string): void
  pullImage(name: string): void
}

const NO_TERMINAL = 'Open a terminal in this worktree first'
const NEEDS_NEWER_ORCA = 'This version of Orca cannot open files from a plugin'
const NOT_RUNNING = 'The container is not running'

function projectMenu(project: TreeProject, actions: MenuActions): MenuEntry[] {
  const terminal = actions.canSend() ? {} : { disabledReason: NO_TERMINAL }
  const compose = (label: string, icon: IconName, action: ProjectAction): MenuItem => ({
    label,
    icon,
    ...terminal,
    run: () => actions.compose(project, action)
  })
  const [composeFile] = project.configFiles
  return [
    compose('Start All', 'play', 'start'),
    compose('Deploy', 'deploy', 'up'),
    compose('Restart', 'restart', 'restart'),
    compose('Stop', 'stop', 'stop'),
    compose('Down', 'down', 'down'),
    'separator',
    compose('Pull', 'down', 'pull'),
    compose('Build', 'build', 'build'),
    compose('Status in Terminal', 'terminal', 'ps'),
    compose('Logs in Terminal', 'logs', 'logs'),
    'separator',
    { label: 'Jump to Source', icon: 'source', disabledReason: NEEDS_NEWER_ORCA },
    composeFile
      ? {
          label: 'Copy Compose File Path',
          icon: 'copy',
          run: () => actions.copy('Compose file path', composeFile)
        }
      : { label: 'Copy Compose File Path', icon: 'copy', disabledReason: 'Compose did not record it' }
  ]
}

function serviceMenu(project: TreeProject, service: TreeService, actions: MenuActions): MenuEntry[] {
  const terminal = actions.canSend() ? {} : { disabledReason: NO_TERMINAL }
  const run = (label: string, icon: IconName, action: ServiceAction): MenuItem => ({
    label,
    icon,
    ...terminal,
    run: () => actions.service(project, service, action)
  })
  return [
    run('Start', 'play', 'up'),
    run('Restart', 'restart', 'restart'),
    run('Stop', 'stop', 'stop'),
    run('Logs in Terminal', 'logs', 'logs'),
    run('Rebuild', 'build', 'rebuild')
  ]
}

function imageItems(container: TreeContainer, actions: MenuActions): MenuEntry[] {
  const name = actions.images().find((image) => image.id === container.imageId)?.tags[0] ?? container.image
  return [
    { label: 'Inspect', icon: 'search', run: () => actions.inspectImage(name, container.imageId) },
    { label: 'Copy Image Name', icon: 'copy', run: () => actions.copy('Image name', name) },
    {
      label: 'Pull',
      ...(actions.canSend() ? {} : { disabledReason: NO_TERMINAL }),
      run: () => actions.pullImage(name)
    }
  ]
}

function lifecycleItems(container: TreeContainer, actions: MenuActions): MenuEntry[] {
  const action = (label: string, icon: IconName, name: ContainerAction): MenuItem => ({
    label,
    icon,
    run: () => actions.containerAction(container, name)
  })
  if (container.state === 'paused') {
    return [action('Unpause Container', 'play', 'unpause'), action('Stop Container', 'stop', 'stop')]
  }
  if (!isUp(container)) {
    return [action('Start Container', 'play', 'start')]
  }
  return [
    action('Restart Container', 'restart', 'restart'),
    action('Pause Container', 'pause', 'pause'),
    action('Stop Container', 'stop', 'stop')
  ]
}

function dockerMenu(actions: MenuActions): MenuEntry[] {
  return [
    {
      label: 'Compose Up in Terminal Folder',
      icon: 'deploy',
      // A project with no containers yet is not in the tree, so this is how it gets started.
      ...(actions.canSend() ? {} : { disabledReason: NO_TERMINAL }),
      run: () => actions.composeInTerminalFolder()
    }
  ]
}

function containerMenu(
  container: TreeContainer,
  actions: MenuActions,
  compose?: { project: TreeProject; service: TreeService }
): MenuEntry[] {
  const running = isRunning(container)
  /** Runs in a terminal, inside the container, so it needs both. */
  const inside = (): Pick<MenuItem, 'disabledReason'> => {
    if (!running) {
      return { disabledReason: NOT_RUNNING }
    }
    return actions.canSend() ? {} : { disabledReason: NO_TERMINAL }
  }
  const whenRunning = running ? {} : { disabledReason: NOT_RUNNING }
  return [
    ...lifecycleItems(container, actions),
    { label: 'Image', children: imageItems(container, actions) },
    { label: 'Show Logs', icon: 'logs', run: () => actions.logs(container) },
    { label: 'Show Files', ...whenRunning, run: () => actions.files(container) },
    { label: 'Copy Container ID', icon: 'copy', run: () => actions.copy('Container ID', container.id) },
    { label: 'Copy Image ID', icon: 'copy', run: () => actions.copy('Image ID', container.imageId) },
    { label: 'Inspect', icon: 'search', run: () => actions.inspectContainer(container) },
    { label: 'Show Processes', ...whenRunning, run: () => actions.processes(container) },
    { label: 'Attach', ...inside(), run: () => actions.attach(container) },
    { label: 'Exec', ...inside(), run: () => actions.exec(container) },
    {
      label: 'Create Terminal',
      icon: 'terminal',
      ...inside(),
      children: ['sh', 'bash'].map((shell) => ({
        label: shell,
        run: () => actions.shell(container, shell)
      }))
    },
    ...(compose
      ? [
          {
            label: 'Rebuild Service',
            icon: 'build',
            ...(actions.canSend() ? {} : { disabledReason: NO_TERMINAL }),
            run: () => actions.service(compose.project, compose.service, 'rebuild')
          } satisfies MenuItem
        ]
      : []),
    ...(isUp(container)
      ? []
      : ([
          'separator',
          { label: 'Remove Container', icon: 'remove', run: () => actions.removeContainer(container) }
        ] satisfies MenuEntry[]))
  ]
}

export function buildMenu(target: MenuTarget, actions: MenuActions): MenuEntry[] {
  switch (target.kind) {
    case 'project':
      return projectMenu(target.project, actions)
    case 'service':
      return serviceMenu(target.project, target.service, actions)
    case 'container':
      return containerMenu(target.container, actions, target.compose)
    case 'docker':
      return dockerMenu(actions)
  }
}
