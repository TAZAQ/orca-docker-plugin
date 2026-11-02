import { homedir } from 'node:os'
import { TREE_CHANGED_EVENT } from '../shared/protocol'
import { formatStatus, summarizeProjects } from './compose-status'
import { CrashNotifier } from './crash-notifier'
import { DockerApi } from './docker-api'
import { describeEndpoint, resolveDockerEndpoint } from './docker-endpoint'
import { buildTree, TREE_EVENTS, TreePublisher } from './docker-tree'
import { EventWatcher } from './event-watcher'
import { registerPanelRequests } from './panel-requests'

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

const NOTIFICATIONS_KEY = 'crashNotifications'
/** Orca reaps a worker after 5 idle minutes; any host call counts as activity. */
export const KEEPALIVE_MS = 2 * 60_000

let stopWorker: (() => Promise<void>) | null = null

export default async function activate(orca: OrcaApi): Promise<void> {
  const api = async (): Promise<DockerApi> => new DockerApi(await resolveDockerEndpoint(homedir()))
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
    load: async () => buildTree(await (await api()).listContainers()),
    post: (value) => orca.panels.post(TREE_CHANGED_EVENT, value)
  })

  const watcher = new EventWatcher({
    api,
    filters: { type: ['container'], event: TREE_EVENTS },
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

  orca.commands.register('docker-status', async () => {
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

  orca.commands.register('docker-toggle-notifications', async () => {
    const enabled = !(await notificationsEnabled())
    await orca.host.call('storage.set', { key: NOTIFICATIONS_KEY, value: enabled })
    setNotifying(enabled)
    await notify(enabled ? 'Crash notifications on' : 'Crash notifications off')
    return { enabled }
  })

  registerPanelRequests(orca, { tree })

  // Subscribed only so Orca starts the worker early; the watcher is what does the work.
  orca.events.on('workspace.created', () => undefined)
  orca.events.on('agent.status.changed', () => undefined)

  stopWorker = async () => {
    clearInterval(keepalive)
    tree.stop()
    await watcher.stop()
  }

  watcher.start()
  setNotifying(await notificationsEnabled())
  orca.log('docker plugin active')
}

export async function deactivate(): Promise<void> {
  await stopWorker?.()
  stopWorker = null
}
