import type { ProjectAction, ServiceAction } from '../shared/compose'
import type {
  CleanupKind,
  ContainerAction,
  PruneMode,
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
  | { kind: 'images' }
  | { kind: 'containers' }
  | { kind: 'networks' }
  | { kind: 'volumes' }
  | { kind: 'image'; image: TreeImage }

export type MenuActions = {
  images(): TreeImage[]
  compose(project: TreeProject, action: ProjectAction): void
  composeInWorkspaceFolder(): void
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
  removeImage(image: TreeImage): void
  pruneImages(mode: PruneMode): void
  cleanup(kind: CleanupKind): void
  createNetwork(): void
  createVolume(): void
}

const NEEDS_NEWER_ORCA = 'This version of Orca cannot open files from a plugin'
const NOT_RUNNING = 'The container is not running'

function projectMenu(project: TreeProject, actions: MenuActions): MenuEntry[] {
  const compose = (label: string, icon: IconName, action: ProjectAction): MenuItem => ({
    label,
    icon,
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
  const run = (label: string, icon: IconName, action: ServiceAction): MenuItem => ({
    label,
    icon,
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

function imageMenu(image: TreeImage, actions: MenuActions): MenuEntry[] {
  const [tag] = image.tags
  return [
    { label: 'Inspect', icon: 'search', run: () => actions.inspectImage(image.name, image.id) },
    { label: 'Copy Image ID', icon: 'copy', run: () => actions.copy('Image ID', image.id) },
    { label: 'Copy Image Name', icon: 'copy', run: () => actions.copy('Image name', image.name) },
    tag
      ? {
          label: 'Pull',
          icon: 'down',
          run: () => actions.pullImage(tag)
        }
      : { label: 'Pull', icon: 'down', disabledReason: 'The image has no tag' },
    'separator',
    { label: 'Remove Image', icon: 'remove', run: () => actions.removeImage(image) }
  ]
}

function imagesMenu(actions: MenuActions): MenuEntry[] {
  return [
    { label: 'Clean Up', icon: 'remove', run: () => actions.pruneImages('unused') },
    { label: 'Remove Dangling Images', icon: 'remove', run: () => actions.pruneImages('dangling') }
  ]
}

function cleanupItem(kind: CleanupKind, actions: MenuActions): MenuItem {
  return { label: 'Clean Up', icon: 'remove', run: () => actions.cleanup(kind) }
}

function imageItems(container: TreeContainer, actions: MenuActions): MenuEntry[] {
  const image = actions.images().find((item) => item.id === container.imageId)
  if (image) {
    return imageMenu(image, actions)
  }
  return [{ label: 'The image is no longer listed', disabledReason: 'Refresh the tree' }]
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
      // A project with no containers yet is not in the tree, so this is how it gets started.
      label: 'Compose Up in Workspace Folder',
      icon: 'deploy',
      run: () => actions.composeInWorkspaceFolder()
    }
  ]
}

function containerMenu(
  container: TreeContainer,
  actions: MenuActions,
  compose?: { project: TreeProject; service: TreeService }
): MenuEntry[] {
  const running = isRunning(container)
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
    { label: 'Attach', ...whenRunning, run: () => actions.attach(container) },
    { label: 'Exec', ...whenRunning, run: () => actions.exec(container) },
    {
      label: 'Create Terminal',
      icon: 'terminal',
      ...whenRunning,
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
    case 'images':
      return imagesMenu(actions)
    case 'containers':
      return [cleanupItem('containers', actions)]
    case 'networks':
      return [{ label: 'Create Network', icon: 'add', run: () => actions.createNetwork() }, cleanupItem('networks', actions)]
    case 'volumes':
      return [{ label: 'Create Volume', icon: 'add', run: () => actions.createVolume() }, cleanupItem('volumes', actions)]
    case 'image':
      return imageMenu(target.image, actions)
  }
}
