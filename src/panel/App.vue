<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  DOCKER_NAME,
  emptyTree,
  type CleanupKind,
  type ContainerAction,
  type Dashboard,
  type DockerTree,
  type NetworkCreateInput,
  type ObjectKind,
  type PruneMode,
  type TreeImage,
  type TreeContainer,
  type TreeProject
} from '../shared/protocol'
import {
  containerAttachCommand,
  containerExecCommand,
  composeScaleCommand,
  containerShellCommand,
  imagePullCommand,
  projectCommand,
  serviceCommand,
  type ComposeTarget
} from '../shared/compose'
import type { HostBridge, Subscription, WorkspaceContext } from './bridge'
import ActionIcon from './components/ActionIcon.vue'
import { copyText } from './clipboard'
import { dockerPushCommand } from '../shared/docker-run'
import ComposeDialog from './components/ComposeDialog.vue'
import RunDialog from './components/RunDialog.vue'
import ContextMenu from './components/ContextMenu.vue'
import DetailsViewer, { type Details } from './components/DetailsViewer.vue'
import DashboardView from './components/DashboardView.vue'
import DialogBox, { type DialogRequest } from './components/DialogBox.vue'
import NetworkDialog from './components/NetworkDialog.vue'
import LogViewer from './components/LogViewer.vue'
import ServicesTree from './components/ServicesTree.vue'
import { formatSize, isRunning, isUp } from './container-state'
import { buildMenu, type MenuActions, type MenuEntry, type MenuTarget, type ViewOptions } from './menus'
import { counted, IMAGE_REFERENCE, loadView, saveView, systemCleanupDialog, systemCleanupSummary } from './panel-dialogs'

const props = defineProps<{ host: HostBridge }>()

const TREE_POLL_MS = 30_000

const context = ref<WorkspaceContext>(null)
const loading = ref(true)


const lastCommand = ref('')
const status = ref<{ kind: 'info' | 'error'; text: string } | null>(null)

const tree = ref<DockerTree | null>(null)
const logsContainer = ref<TreeContainer | null>(null)
const menu = ref<{ x: number; y: number; items: MenuEntry[] } | null>(null)
const details = ref<Details | null>(null)
const dialog = ref<DialogRequest | null>(null)
const creatingNetwork = ref(false)
const runImage = ref<string | null>(null)
const composeDialog = ref<{ project: TreeProject; mode: 'deploy' | 'down' } | null>(null)
const view = ref<ViewOptions>(loadView())
const dashboard = ref<{ data: Dashboard | null; error: string | null } | null>(null)
let dashboardRequest = 0
let treePoll: ReturnType<typeof setInterval> | undefined
let treeSubscription: Subscription | undefined
let contextSubscription: Subscription | undefined


async function refresh(): Promise<void> {
  try {
    context.value = await props.host.readContext()
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

function refreshAll(): void {
  void refresh()
  void refreshTree()
}

async function refreshTree(): Promise<void> {
  try {
    tree.value = await props.host.loadTree()
  } catch (error) {
    tree.value = emptyTree(error instanceof Error ? error.message : String(error))
  }
}

async function runContainerAction(container: TreeContainer, action: ContainerAction): Promise<void> {
  try {
    await props.host.containerAction(container.id, action)
    status.value = { kind: 'info', text: `${container.name}: ${action} done` }
  } catch (error) {
    showError(error)
  }
}

function openShell(container: TreeContainer, shell = 'sh', user?: string): void {
  const as = user ? ` as ${user}` : ''
  void runInTerminal(
    `${container.name} ${shell}${as}`,
    containerShellCommand(container.name, shell, user),
    `${shell}${as}:${container.id}`
  )
}

function openContainer(container: TreeContainer): void {
  if (isRunning(container)) {
    openShell(container)
  } else {
    status.value = { kind: 'info', text: `${container.name} is not running` }
  }
}

function pointAt(project: TreeProject): ComposeTarget {
  return { projectName: project.name, files: project.configFiles }
}

function projectContainers(project: TreeProject): TreeContainer[] {
  const current = tree.value?.projects.find((item) => item.name === project.name)
  return current?.services.flatMap((service) => service.containers) ?? []
}

async function runProjectAction(project: TreeProject, action: 'start' | 'stop' | 'restart'): Promise<void> {
  try {
    for (const container of projectContainers(project)) {
      if (action === 'start' ? isUp(container) : action === 'stop' && !isUp(container)) {
        continue
      }
      if (container.state === 'paused') {
        await props.host.containerAction(container.id, 'unpause')
      }
      await props.host.containerAction(container.id, action)
    }
    status.value = { kind: 'info', text: `${project.name}: ${action} done` }
  } catch (error) {
    showError(error)
  } finally {
    await refreshTree()
  }
}

function askToDownProject(project: TreeProject): void {
  const containers = projectContainers(project)
  const networks = tree.value?.networks.filter((network) => network.composeProject === project.name) ?? []
  const dockerContext = tree.value?.context?.active
  dialog.value = {
    title: `Down ${project.name}?`,
    message: 'Stops and removes these containers and Compose-owned networks. Volumes and images stay. No Compose file is needed.',
    items: [
      ...containers.map((container) => `Container: ${container.name}`),
      ...networks.map((network) => `Network: ${network.name}`)
    ],
    confirmLabel: 'Down',
    danger: true,
    confirm: () => void (async () => {
      try {
        if (tree.value?.context?.active !== dockerContext) {
          throw new Error('Docker context changed. Open Down again to review its resources.')
        }
        for (const container of containers) {
          if (container.state === 'paused') {
            await props.host.containerAction(container.id, 'unpause')
          }
          if (isUp(container)) {
            await props.host.containerAction(container.id, 'stop')
          }
          await props.host.containerAction(container.id, 'remove')
        }
        for (const network of networks) {
          await props.host.remove('network', network.id)
        }
        status.value = { kind: 'info', text: `${project.name}: down done` }
      } catch (error) {
        showError(error)
      } finally {
        await refreshTree()
      }
    })()
  }
}

async function showDetails(
  title: string,
  load: () => Promise<string>,
  browse?: Details['browse']
): Promise<void> {
  const request = { title, text: '', loading: true, browse }
  details.value = request
  try {
    const text = await load()
    if (details.value === request || details.value?.title === title) {
      details.value = { ...request, text, loading: false }
    }
  } catch (error) {
    details.value = { ...request, loading: false, text: errorText(error) }
  }
}

function browseFiles(container: TreeContainer, path: string): void {
  void showDetails(`Files: ${container.name}`, () => props.host.files(container.id, path), {
    path,
    open: (next) => browseFiles(container, next)
  })
}

function formatProcesses(titles: string[], processes: string[][]): string {
  const rows = [titles, ...processes]
  const widths = titles.map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? '').length))
  )
  return rows
    .map((row) => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  ').trimEnd())
    .join('\n')
}

async function copy(label: string, text: string): Promise<void> {
  status.value = (await copyText(text))
    ? { kind: 'info', text: `${label} copied` }
    : { kind: 'error', text: `Could not copy. ${label}: ${text}` }
}

const PRUNE_LIST_MAX = 100


function askToRemoveImage(image: TreeImage): void {
  const containers = (tree.value?.containers ?? []).filter((item) => item.imageId === image.id)
  const tags = image.tags.length > 1 ? ` All its tags go too: ${image.tags.join(', ')}.` : ''
  dialog.value = {
    title: `Remove ${image.name}?`,
    message:
      containers.length > 0
        ? `${containers.length === 1 ? 'The 1 container' : `All ${containers.length} containers`} based on this image will be removed too, even if running, and whatever they keep outside volumes is lost.${tags}`
        : `No container uses this image.${tags}`,
    items: containers.map((item) => `${item.name} (${item.status})`),
    confirmLabel: containers.length > 0 ? 'Remove image and containers' : 'Remove image',
    danger: true,
    confirm: () =>
      void removeImage(
        image,
        containers.map((item) => item.id)
      )
  }
}

async function removeImage(image: TreeImage, containerIds: string[]): Promise<void> {
  status.value = { kind: 'info', text: `Removing ${image.name}…` }
  try {
    await props.host.removeImage(image.id, containerIds)
    status.value = { kind: 'info', text: `${image.name} removed` }
  } catch (error) {
    showError(error)
  }
}

async function askToPrune(mode: PruneMode): Promise<void> {
  try {
    const { images } = await props.host.previewPrune(mode)
    if (images.length === 0) {
      status.value = { kind: 'info', text: `No ${mode} images to remove` }
      return
    }
    const total = formatSize(images.reduce((sum, image) => sum + image.size, 0))
    const shown = images.slice(0, PRUNE_LIST_MAX).map((image) => `${image.name} (${formatSize(image.size)})`)
    const more = images.length - shown.length
    const items = more > 0 ? [...shown, `…and ${more} more`] : shown
    const freed = `Frees up to ${total}, less where images share layers. Images used by any container stay, even a stopped one.`
    dialog.value =
      mode === 'unused'
        ? {
            title: 'Clean Up',
            message: `Remove all unused images? That is ${counted(images.length, 'image')}. ${freed}`,
            items,
            confirmLabel: 'Yes',
            cancelLabel: 'No',
            danger: true,
            confirm: () => void prune(mode)
          }
        : {
            title: `Remove ${counted(images.length, `${mode} image`)}?`,
            message: freed,
            items,
            confirmLabel: `Remove ${counted(images.length, 'image')}`,
            danger: true,
            confirm: () => void prune(mode)
          }
  } catch (error) {
    showError(error)
  }
}

async function prune(mode: PruneMode): Promise<void> {
  status.value = { kind: 'info', text: 'Removing images…' }
  try {
    const { removed, reclaimed } = await props.host.pruneImages(mode)
    status.value = { kind: 'info', text: `Removed ${counted(removed, 'image')}, freed ${formatSize(reclaimed)}` }
  } catch (error) {
    showError(error)
  }
}

const CLEANUP_TEXT: Record<CleanupKind, { noun: string; question: string; warning: string }> = {
  containers: {
    noun: 'stopped container',
    question: 'Remove all stopped containers?',
    warning: 'Whatever they keep outside volumes is lost.'
  },
  networks: {
    noun: 'unused network',
    question: 'Remove all unused networks?',
    warning: 'Docker’s own networks stay.'
  },
  volumes: {
    noun: 'unused volume',
    question: 'Remove all unused volumes?',
    warning: 'Their data is deleted for good. A volume of a stopped container is not unused and stays.'
  }
}

async function askToClean(kind: CleanupKind): Promise<void> {
  const text = CLEANUP_TEXT[kind]
  try {
    const { items } = await props.host.previewCleanup(kind)
    if (items.length === 0) {
      status.value = { kind: 'info', text: `No ${text.noun}s to remove` }
      return
    }
    const shown = items.slice(0, PRUNE_LIST_MAX).map((item) => `${item.name} (${item.detail})`)
    const more = items.length - shown.length
    dialog.value = {
      title: 'Clean Up',
      message: `${text.question} That is ${counted(items.length, text.noun)}. ${text.warning}`,
      items: more > 0 ? [...shown, `…and ${more} more`] : shown,
      confirmLabel: 'Yes',
      cancelLabel: 'No',
      danger: true,
      confirm: () =>
        void clean(
          kind,
          items.map((item) => item.id)
        )
    }
  } catch (error) {
    showError(error)
  }
}

async function clean(kind: CleanupKind, ids: string[]): Promise<void> {
  const { noun } = CLEANUP_TEXT[kind]
  status.value = { kind: 'info', text: 'Cleaning up…' }
  try {
    const { removed, skipped, failed } = await props.host.cleanup(kind, ids)
    const parts = [`Removed ${counted(removed, noun.replace(/^\w+ /, ''))}`]
    if (skipped > 0) {
      parts.push(`${skipped} in use again, left alone`)
    }
    if (failed.length > 0) {
      parts.push(`failed: ${failed.map((item) => `${item.name} (${item.error})`).join(', ')}`)
    }
    status.value = { kind: failed.length > 0 ? 'error' : 'info', text: parts.join('; ') }
  } catch (error) {
    showError(error)
  }
}

async function createNetwork(input: NetworkCreateInput): Promise<void> {
  try {
    await props.host.createNetwork(input)
    status.value = { kind: 'info', text: `Network ${input.name} created` }
  } catch (error) {
    showError(error)
  }
}

function askForVolume(): void {
  dialog.value = {
    title: 'Create Volume',
    message: 'Letters, digits, and _ . - after the first character.',
    confirmLabel: 'OK',
    input: { placeholder: 'specify volume name', prefix: 'docker volume create --name', pattern: DOCKER_NAME },
    confirm: (name) => void createVolume(name)
  }
}

async function createVolume(name: string): Promise<void> {
  try {
    await props.host.createVolume(name)
    status.value = { kind: 'info', text: `Volume ${name} created` }
  } catch (error) {
    showError(error)
  }
}

/** Only the latest selection may fill the dashboard: answers can arrive out of order. */
async function showDashboard(kind: ObjectKind, id: string): Promise<void> {
  const request = ++dashboardRequest
  dashboard.value = { data: null, error: null }
  try {
    const data = await props.host.dashboard(kind, id)
    if (request === dashboardRequest) {
      dashboard.value = { data, error: null }
    }
  } catch (error) {
    if (request === dashboardRequest) {
      dashboard.value = { data: null, error: errorText(error) }
    }
  }
}

function askToRemoveObject(kind: 'network' | 'volume', id: string, name: string): void {
  dialog.value = {
    title: `Remove ${kind} ${name}?`,
    message:
      kind === 'volume'
        ? 'Its data is deleted for good. Docker refuses while a container uses it.'
        : 'Docker refuses while a container uses it.',
    confirmLabel: 'Remove',
    danger: true,
    confirm: () =>
      void props.host
        .remove(kind, id)
        .then(() => (status.value = { kind: 'info', text: `${name} removed` }))
        .catch(showError)
  }
}

async function askToCleanEverything(): Promise<void> {
  status.value = { kind: 'info', text: 'Looking for what is unused…' }
  try {
    const preview = await props.host.previewSystemCleanup()
    const request = systemCleanupDialog(preview, (input) => void cleanEverything(input))
    status.value = request ? null : { kind: 'info', text: 'Nothing to clean up' }
    dialog.value = request
  } catch (error) {
    showError(error)
  }
}

async function cleanEverything(input: Parameters<HostBridge['systemCleanup']>[0]): Promise<void> {
  status.value = { kind: 'info', text: 'Cleaning up…' }
  try {
    const result = await props.host.systemCleanup(input)
    status.value = { kind: result.failed.length > 0 ? 'error' : 'info', text: systemCleanupSummary(result) }
  } catch (error) {
    showError(error)
  }
}

function askToPull(): void {
  dialog.value = {
    title: 'Pull Image',
    message: 'Runs docker pull in a new terminal, where you see its progress.',
    confirmLabel: 'Pull',
    input: {
      placeholder: 'image name, e.g. postgres:16',
      prefix: 'docker pull',
      pattern: IMAGE_REFERENCE,
      suggest: (text) => props.host.searchImages(text)
    },
    confirm: (name) => void runInTerminal(`pull ${name}`, imagePullCommand(name))
  }
}

function openPort(port: number): void {
  const url = `http://localhost:${port}`
  props.host
    .openExternal(url)
    .then((opened) => {
      status.value = opened ? { kind: 'info', text: `Opened ${url}` } : { kind: 'info', text: `Not opened: ${url}` }
    })
    .catch(showError)
}

const menuActions: MenuActions = {
  images: () => tree.value?.images ?? [],
  view: () => view.value,
  context: () => tree.value?.context,
  useContext: (name) => {
    status.value = { kind: 'info', text: `Switching to Docker context ${name}…` }
    props.host
      .useContext(name === tree.value?.context?.cli ? null : name)
      .then(() => {
        status.value = { kind: 'info', text: `Docker context: ${name}` }
        return refreshTree()
      })
      .catch(showError)
  },
  setView: (next) => {
    view.value = next
    saveView(next)
  },
  pullImagePrompt: askToPull,
  systemCleanup: () => void askToCleanEverything(),
  openPort,
  inspectObject: (kind, id, name) =>
    void showDetails(`Inspect: ${name}`, async () => JSON.stringify(await props.host.inspect(kind, id), null, 2)),
  removeObject: askToRemoveObject,
  down: askToDownProject,
  composeDialog: (project, mode) => (composeDialog.value = { project, mode }),
  scale: (project, service) => {
    dialog.value = {
      title: `Scale ${service.name}`,
      message: `It runs ${counted(service.containers.length, 'container')} now. Running ones stay as they are.`,
      confirmLabel: 'Scale',
      input: { placeholder: 'number of containers', prefix: `--scale ${service.name}=`, pattern: /^\d{1,3}$/ },
      confirm: (count) =>
        void runInTerminal(
          `${service.name} scale`,
          composeScaleCommand(pointAt(project), service.name, Number(count))
        )
    }
  },
  compose: (project, action) => {
    if (action === 'start' || action === 'stop' || action === 'restart') {
      void runProjectAction(project, action)
    } else {
      void runInTerminal(`${project.name} ${action}`, projectCommand(pointAt(project), action))
    }
  },
  composeInWorkspaceFolder: () =>
    void runInTerminal('compose up', projectCommand({ projectName: '', files: [] }, 'up')),
  service: (project, service, action) =>
    void runInTerminal(`${service.name} ${action}`, serviceCommand(pointAt(project), action, service.name)),
  containerAction: (container, action) => void runContainerAction(container, action),
  removeContainer: (container) => {
    dialog.value = {
      title: `Remove ${container.name}?`,
      message: 'Its volumes stay.',
      confirmLabel: 'Remove',
      danger: true,
      confirm: () => void runContainerAction(container, 'remove')
    }
  },
  logs: (container) => (logsContainer.value = container),
  files: (container) => browseFiles(container, '/'),
  inspectContainer: (container) =>
    void showDetails(`Inspect: ${container.name}`, async () =>
      JSON.stringify(await props.host.inspect('container', container.id), null, 2)
    ),
  inspectImage: (name, id) =>
    void showDetails(`Inspect: ${name}`, async () =>
      JSON.stringify(await props.host.inspect('image', id), null, 2)
    ),
  processes: (container) =>
    void showDetails(`Processes: ${container.name}`, async () => {
      const { titles, processes } = await props.host.processes(container.id)
      return formatProcesses(titles, processes)
    }),
  copy: (label, text) => void copy(label, text),
  attach: (container) =>
    void runInTerminal(`${container.name} attach`, containerAttachCommand(container.name)),
  exec: (container) => {
    dialog.value = {
      title: `Exec in ${container.name}`,
      message: 'The command runs in a new terminal.',
      confirmLabel: 'Run',
      input: { placeholder: 'ls -la /app' },
      confirm: (command) =>
        void runInTerminal(`${container.name} exec`, containerExecCommand(container.name, command))
    }
  },
  shell: openShell,
  pullImage: (name) => void runInTerminal(`pull ${name}`, imagePullCommand(name)),
  removeImage: askToRemoveImage,
  createContainer: (image) => (runImage.value = image.tags[0] ?? image.id),
  pushImage: (image) => {
    const source = image.tags[0] ?? image.id
    dialog.value = {
      title: `Push ${source}`,
      message: 'A new name is tagged first. Log in to the registry beforehand (docker login).',
      confirmLabel: 'Push',
      input: { placeholder: 'registry/repository:tag', prefix: 'docker push', pattern: IMAGE_REFERENCE, value: source },
      confirm: (target) => void runInTerminal(`push ${target}`, dockerPushCommand(source, target))
    }
  },
  pruneImages: (mode) => void askToPrune(mode),
  cleanup: (kind) => void askToClean(kind),
  createNetwork: () => (creatingNetwork.value = true),
  createVolume: askForVolume
}

function openMenu(event: MouseEvent, target: MenuTarget): void {
  menu.value = { x: event.clientX, y: event.clientY, items: buildMenu(target, menuActions) }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function showError(error: unknown): void {
  status.value = { kind: 'error', text: errorText(error) }
}

async function runInTerminal(title: string, command: string, reuseKey?: string): Promise<void> {
  lastCommand.value = command
  try {
    await props.host.openTerminal({ title, command, ...(reuseKey ? { reuseKey } : {}) })
    status.value = { kind: 'info', text: `Opened in a terminal: ${title}` }
  } catch (error) {
    showError(error)
  }
}

function onVisible(): void {
  if (document.visibilityState === 'visible') {
    void refresh()
  }
}

onMounted(() => {
  void refresh()
  contextSubscription = props.host.onContextChanged((value) => (context.value = value))
  treeSubscription = props.host.onTreeChanged((value) => {
    if (value) {
      tree.value = value
    } else {
      void refreshTree()
    }
  })
  void refreshTree()
  // Covers a restarted daemon, and asking keeps the worker from being reaped while the panel is open.
  treePoll = setInterval(() => void refreshTree(), TREE_POLL_MS)
  window.addEventListener('focus', refresh)
  document.addEventListener('visibilitychange', onVisible)
})

onBeforeUnmount(() => {
  clearInterval(treePoll)
  treeSubscription?.dispose()
  contextSubscription?.dispose()
  window.removeEventListener('focus', refresh)
  document.removeEventListener('visibilitychange', onVisible)
})
</script>

<template>
  <main class="panel">
    <header class="header">
      <div class="workspace">
        <template v-if="context">
          <span class="workspace-name">{{ context.displayName }}</span>
          <span v-if="context.branch !== context.displayName" class="branch">{{ context.branch }}</span>
        </template>
        <span v-else-if="!loading" class="muted">No focused worktree</span>
      </div>
      <button class="icon-button" title="Refresh" data-test="refresh" @click="refreshAll">
        <ActionIcon name="restart" />
      </button>
    </header>

    <section class="section">
      <h2 class="title">Services</h2>
      <ServicesTree
        :tree="tree"
        :view="view"
        @open="openContainer"
        @select="showDashboard"
        @menu="openMenu"
      />
    </section>

    <DashboardView
      v-if="dashboard"
      :dashboard="dashboard.data"
      :error="dashboard.error"
      @close="dashboard = null"
    />

    <DetailsViewer v-if="details" :details="details" @close="details = null" />

    <LogViewer
      v-if="logsContainer"
      :key="logsContainer.id"
      :host="host"
      :container="logsContainer"
      @close="logsContainer = null"
    />

    <footer class="footer">
      <code v-if="lastCommand" class="command" data-test="last-command">{{ lastCommand }}</code>
      <p v-if="status" class="status" :class="status.kind" data-test="status">{{ status.text }}</p>
    </footer>

    <ContextMenu
      v-if="menu"
      :items="menu.items"
      :x="menu.x"
      :y="menu.y"
      @close="menu = null"
    />
    <DialogBox v-if="dialog" :request="dialog" @close="dialog = null" />
    <ComposeDialog
      v-if="composeDialog"
      :project="composeDialog.project"
      :mode="composeDialog.mode"
      @run="(command) => void runInTerminal(`${composeDialog?.project.name} ${composeDialog?.mode}`, command)"
      @close="composeDialog = null"
    />
    <RunDialog
      v-if="runImage"
      :image="runImage"
      @run="(command) => void runInTerminal(`run ${runImage}`, command)"
      @close="runImage = null"
    />
    <NetworkDialog
      v-if="creatingNetwork"
      @create="createNetwork"
      @close="creatingNetwork = false"
    />
  </main>
</template>

<style>
/* Orca has no success token, so the green is ours. Its shell keeps these classes on the theme. */
html.light {
  --docker-running: #1a7f37;
}
html.dark {
  --docker-running: #3fb950;
}
body {
  margin: 0;
  font-family: system-ui, sans-serif;
  font-size: 13px;
  color: var(--orca-foreground);
  background: var(--orca-background);
}
button,
input,
select {
  font: inherit;
  color: inherit;
}
input:not([type='checkbox']),
select {
  padding: 5px 8px;
  border: 1px solid var(--orca-input);
  border-radius: calc(var(--orca-radius) - 2px);
  background: transparent;
}
</style>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 12px;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.workspace {
  display: flex;
  gap: 6px;
  align-items: baseline;
  min-width: 0;
}
.workspace-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.branch,
.muted {
  color: var(--orca-muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--orca-muted-foreground);
}
.icon-button {
  display: inline-flex;
  padding: 4px 6px;
  border: 1px solid var(--orca-border);
  border-radius: calc(var(--orca-radius) - 2px);
  background: var(--orca-secondary);
  color: var(--orca-secondary-foreground);
  cursor: pointer;
}
button:hover:not(:disabled) {
  background: var(--orca-accent);
  color: var(--orca-accent-foreground);
}
.footer {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.command {
  padding: 6px 8px;
  border-radius: calc(var(--orca-radius) - 2px);
  background: var(--orca-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.status {
  margin: 0;
  font-size: 12px;
  color: var(--orca-muted-foreground);
}
.status.error {
  color: var(--orca-destructive);
}
</style>
