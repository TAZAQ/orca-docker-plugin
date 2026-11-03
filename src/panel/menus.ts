import type { ProjectAction, ServiceAction } from '../shared/compose'
import type {
  CleanupKind,
  ContainerAction,
  PruneMode,
  TreeContainer,
  TreeImage,
  TreeNetwork,
  TreeProject,
  TreeVolume,
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
  /** Set for an option that is on or off; drawn with a check mark. */
  checked?: boolean
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
  | { kind: 'network'; network: TreeNetwork }
  | { kind: 'volume'; volume: TreeVolume }

export type ViewOptions = { showStopped: boolean; showUntagged: boolean }

export type MenuActions = {
  images(): TreeImage[]
  view(): ViewOptions
  setView(view: ViewOptions): void
  pullImagePrompt(): void
  systemCleanup(): void
  openPort(port: number): void
  compose(project: TreeProject, action: ProjectAction): void
  composeDialog(project: TreeProject, mode: 'deploy' | 'down'): void
  scale(project: TreeProject, service: TreeService): void
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
  shell(container: TreeContainer, shell: string, user?: string): void
  pullImage(name: string): void
  removeImage(image: TreeImage): void
  createContainer(image: TreeImage): void
  pushImage(image: TreeImage): void
  pruneImages(mode: PruneMode): void
  cleanup(kind: CleanupKind): void
  createNetwork(): void
  createVolume(): void
  inspectObject(kind: 'network' | 'volume', id: string, name: string): void
  removeObject(kind: 'network' | 'volume', id: string, name: string): void
}

/** Docker's own networks, which cannot be removed. */
const BUILTIN_NETWORKS = new Set(['bridge', 'host', 'none'])

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
    { label: 'Deploy…', icon: 'deploy', run: () => actions.composeDialog(project, 'deploy') },
    compose('Restart', 'restart', 'restart'),
    compose('Stop', 'stop', 'stop'),
    { label: 'Down…', icon: 'down', run: () => actions.composeDialog(project, 'down') },
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
    run('Rebuild', 'build', 'rebuild'),
    { label: 'Scale…', icon: 'layers', run: () => actions.scale(project, service) }
  ]
}

function imageMenu(image: TreeImage, actions: MenuActions): MenuEntry[] {
  const [tag] = image.tags
  return [
    { label: 'Create Container…', icon: 'add', run: () => actions.createContainer(image) },
    tag
      ? { label: 'Push Image…', icon: 'deploy', run: () => actions.pushImage(image) }
      : { label: 'Push Image…', icon: 'deploy', disabledReason: 'Tag the image first' },
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
  const view = actions.view()
  return [
    { label: 'Pull Image…', icon: 'down', run: () => actions.pullImagePrompt() },
    {
      // A project with no containers yet is not in the tree, so this is how it gets started.
      label: 'Compose Up in Workspace Folder',
      icon: 'deploy',
      run: () => actions.composeInWorkspaceFolder()
    },
    { label: 'Clean Up', icon: 'remove', run: () => actions.systemCleanup() },
    'separator',
    {
      label: 'Show Stopped Containers',
      checked: view.showStopped,
      run: () => actions.setView({ ...view, showStopped: !view.showStopped })
    },
    {
      label: 'Show Untagged Images',
      checked: view.showUntagged,
      run: () => actions.setView({ ...view, showUntagged: !view.showUntagged })
    }
  ]
}

/** A published port as a browser link; 0.0.0.0 and :: mean this machine. */
function portItems(container: TreeContainer, actions: MenuActions): MenuEntry[] {
  const ports = container.ports.flatMap((port) => {
    const host = Number(port.split('→')[0])
    return Number.isInteger(host) && host > 0 ? [host] : []
  })
  return ports.map((port) => ({
    label: `http://localhost:${port}`,
    run: () => actions.openPort(port)
  }))
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
    (() => {
      const ports = portItems(container, actions)
      return ports.length > 0
        ? ({ label: 'Open in Browser', icon: 'globe', children: ports } satisfies MenuItem)
        : ({ label: 'Open in Browser', icon: 'globe', disabledReason: 'No port is published' } satisfies MenuItem)
    })(),
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
      children: [
        ...['sh', 'bash'].map((shell) => ({ label: shell, run: () => actions.shell(container, shell) })),
        ...['sh', 'bash'].map((shell) => ({
          label: `${shell} as root`,
          run: () => actions.shell(container, shell, 'root')
        }))
      ]
    },
    ...(compose
      ? [
          {
            label: 'Rebuild Service',
            icon: 'build',
              run: () => actions.service(compose.project, compose.service, 'rebuild')
          } satisfies MenuItem,
          {
            label: 'Scale Service…',
            icon: 'layers',
            run: () => actions.scale(compose.project, compose.service)
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
    case 'network':
      return [
        {
          label: 'Inspect',
          icon: 'search',
          run: () => actions.inspectObject('network', target.network.id, target.network.name)
        },
        BUILTIN_NETWORKS.has(target.network.name)
          ? { label: 'Remove', icon: 'remove', disabledReason: 'Docker’s own network' }
          : {
              label: 'Remove',
              icon: 'remove',
              run: () => actions.removeObject('network', target.network.id, target.network.name)
            }
      ]
    case 'volume':
      return [
        {
          label: 'Inspect',
          icon: 'search',
          run: () => actions.inspectObject('volume', target.volume.name, target.volume.name)
        },
        {
          label: 'Remove',
          icon: 'remove',
          run: () => actions.removeObject('volume', target.volume.name, target.volume.name)
        }
      ]
    case 'volumes':
      return [{ label: 'Create Volume', icon: 'add', run: () => actions.createVolume() }, cleanupItem('volumes', actions)]
    case 'image':
      return imageMenu(target.image, actions)
  }
}
