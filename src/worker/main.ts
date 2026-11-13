import { homedir } from 'node:os'
import { emptyTree, LOGS_EVENT, TREE_CHANGED_EVENT, type TreeContext } from '../shared/protocol'
import { formatStatus, summarizeProjects } from './compose-status'
import { CrashNotifier } from './crash-notifier'
import { DockerApi } from './docker-api'
import { describeEndpoint, listContexts, resolveDockerEndpoint } from './docker-endpoint'
import { buildTree, TREE_EVENT_TYPES, TREE_EVENTS, TreePublisher } from './docker-tree'
import { buildDashboard } from './docker-dashboard'
import { cleanup, previewCleanup, previewSystemCleanup, systemCleanup } from './docker-cleanup'
import { previewPrune, removeImageWithContainers } from './docker-images'
import { EventWatcher } from './event-watcher'
import { LogStreams } from './log-streams'
import { orcaCli } from './orca-cli'
import { registerPanelRequests } from './panel-requests'
import { TerminalLauncher, type FocusedContext } from './terminal-launcher'

/** The `activate(orca)` surface of Orca's plugin worker. */
export type OrcaApi = {
  commands: { register(commandId: string, handler: (args: unknown) => unknown): void }
  events: { on(event: string, handler: (payload: unknown) => void | Promise<void>): void }
  host: { call(method: string, params?: unknown): Promise<unknown> }
  panels: {
    handle(name: string, handler: (input: unknown) => unknown): void
    post(event: string, payload: unknown): void
  }
  log(message: string): void
}

const NOTIFICATIONS_KEY = 'jb-containers.crash-notifications'
/** The context chosen in the panel; absent means the docker CLI's current one. */
const CONTEXT_KEY = 'jb-containers.docker-context'
/** Orca reaps a worker after 5 idle minutes; any host call counts as activity. */
export const KEEPALIVE_MS = 2 * 60_000

let stopWorker: (() => Promise<void>) | null = null

export default async function activate(orca: OrcaApi): Promise<void> {
  let contextOverride: string | null = null
  const api = async (): Promise<DockerApi> =>
    new DockerApi(await resolveDockerEndpoint(homedir(), process.platform, contextOverride))
  const treeContext = async (): Promise<TreeContext> => {
    const { names, cli } = await listContexts(homedir())
    return { active: contextOverride ?? cli, cli, names }
  }
  const notifier = new CrashNotifier()
  let keepalive: ReturnType<typeof setInterval> | undefined
  let notifying = false

  async function notify(title: string, body?: string): Promise<void> {
    try {
      await orca.host.call('notifications.show', body ? { title, body } : { title })
    } catch (error) {
      orca.log(`notification failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const tree = new TreePublisher({
    load: async () => {
      // The context comes along even when the daemon fails, so the panel can switch away from it.
      const context = await treeContext()
      try {
        const docker = await api()
        const [containers, images, networks, volumes] = await Promise.all([
          docker.listContainers(),
          docker.listImages(),
          docker.listNetworks(),
          docker.listVolumes()
        ])
        return { ...buildTree(containers, { images, networks, volumes }), context }
      } catch (error) {
        return { ...emptyTree(error instanceof Error ? error.message : String(error)), context }
      }
    },
    post: (value) => orca.panels.post(TREE_CHANGED_EVENT, value)
  })

  const watcher = new EventWatcher({
    api,
    filters: { type: TREE_EVENT_TYPES, event: TREE_EVENTS },
    onEvent: (event) => {
      tree.schedule()
      const notification = notifying ? notifier.handle(event, Date.now()) : null
      if (notification) {
        void notify(notification.title, notification.body)
      }
    },
    log: (message) => orca.log(message)
  })

  function setNotifying(enabled: boolean): void {
    notifying = enabled
    clearInterval(keepalive)
    if (!enabled) {
      return
    }
    // Without this the worker, and the event stream with it, would be reaped after 5 minutes.
    // An open panel keeps it alive on its own by asking for the tree.
    keepalive = setInterval(() => {
      void orca.host.call('storage.get', { key: NOTIFICATIONS_KEY }).catch(() => undefined)
    }, KEEPALIVE_MS)
  }

  async function notificationsEnabled(): Promise<boolean> {
    const stored = (await orca.host.call('storage.get', { key: NOTIFICATIONS_KEY })) as {
      value: unknown
    } | null
    return stored?.value !== false
  }

  orca.commands.register('jb-containers-docker-status', async () => {
    try {
      const docker = await api()
      const projects = summarizeProjects(await docker.listContainers())
      await notify('Docker Compose', formatStatus(projects))
      return { projects }
    } catch (error) {
      const endpoint = describeEndpoint(await resolveDockerEndpoint(homedir()))
      const message = error instanceof Error ? error.message : String(error)
      await notify('Docker is not reachable', `${endpoint}: ${message}`)
      return { error: message }
    }
  })

  orca.commands.register('jb-containers-docker-toggle-notifications', async () => {
    const enabled = !(await notificationsEnabled())
    await orca.host.call('storage.set', { key: NOTIFICATIONS_KEY, value: enabled })
    setNotifying(enabled)
    await notify(enabled ? 'Crash notifications on' : 'Crash notifications off')
    return { enabled }
  })

  const logs = new LogStreams({
    follow: async (id, onText, signal) => (await api()).followLogs(id, onText, signal),
    post: (payload) => orca.panels.post(LOGS_EVENT, payload)
  })

  const terminals = new TerminalLauncher({
    cli: orcaCli(homedir()),
    readContext: async () => (await orca.host.call('workspace.readContext')) as FocusedContext
  })

  registerPanelRequests(orca, {
    terminals,
    tree,
    logs,
    containerAction: async (id, action) => (await api()).containerAction(id, action),
    inspect: async (kind, id) => (await api()).inspect(kind, id),
    dashboard: async (kind, id) => buildDashboard(await api(), kind, id),
    remove: async (kind, id) => {
      const docker = await api()
      await (kind === 'network' ? docker.removeNetwork(id) : docker.removeVolume(id))
    },
    processes: async (id) => (await api()).containerProcesses(id),
    files: async (id, path) => (await api()).execOutput(id, ['ls', '-la', path]),
    removeImage: async (id, containerIds) =>
      removeImageWithContainers(await api(), id, containerIds),
    previewPrune: async (mode) => previewPrune(await api(), mode),
    pruneImages: async (mode) => (await api()).pruneImages(mode),
    previewCleanup: async (kind) => previewCleanup(await api(), kind),
    cleanup: async (kind, ids) => cleanup(await api(), kind, ids),
    createNetwork: async (input) => (await api()).createNetwork(input),
    createVolume: async (name) => (await api()).createVolume(name),
    searchImages: async (term) => (await api()).searchImages(term),
    previewSystemCleanup: async () => previewSystemCleanup(await api()),
    systemCleanup: async (input) => systemCleanup(await api(), input),
    useContext: async (name) => {
      const { names, cli } = await listContexts(homedir())
      if (name !== null && !names.includes(name)) {
        throw Object.assign(new Error(`There is no Docker context ${name}`), { code: 'invalid_params' })
      }
      contextOverride = name === cli ? null : name
      await orca.host.call('storage.set', { key: CONTEXT_KEY, value: contextOverride })
      logs.stop()
      await watcher.stop()
      watcher.start()
      tree.schedule()
    }
  })

  // Subscribed only so Orca starts the worker early; the watcher is what does the work.
  orca.events.on('workspace.created', () => undefined)
  orca.events.on('agent.status.changed', () => undefined)

  stopWorker = async () => {
    clearInterval(keepalive)
    tree.stop()
    logs.stop()
    await watcher.stop()
  }

  const stored = (await orca.host.call('storage.get', { key: CONTEXT_KEY })) as { value: unknown } | null
  contextOverride = typeof stored?.value === 'string' ? stored.value : null
  watcher.start()
  setNotifying(await notificationsEnabled())
  orca.log('docker plugin active')
}

export async function deactivate(): Promise<void> {
  await stopWorker?.()
  stopWorker = null
}
