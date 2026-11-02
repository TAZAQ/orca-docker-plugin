<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  emptyTree,
  type ContainerAction,
  type DockerTree,
  type PanelState,
  type PruneMode,
  type TreeImage,
  type TreeContainer,
  type TreeProject
} from '../shared/protocol'
import {
  containerAttachCommand,
  containerExecCommand,
  containerShellCommand,
  imagePullCommand,
  projectCommand,
  serviceCommand,
  type ComposeTarget
} from '../shared/compose'
import type { HostBridge, Subscription, WorkspaceContext } from './bridge'
import ActionIcon from './components/ActionIcon.vue'
import { copyText } from './clipboard'
import ContextMenu from './components/ContextMenu.vue'
import DetailsViewer, { type Details } from './components/DetailsViewer.vue'
import DialogBox, { type DialogRequest } from './components/DialogBox.vue'
import LogViewer from './components/LogViewer.vue'
import ServicesTree from './components/ServicesTree.vue'
import { formatSize } from './container-state'
import { buildMenu, type MenuActions, type MenuEntry, type MenuTarget } from './menus'

const props = defineProps<{ host: HostBridge }>()

const TREE_POLL_MS = 30_000
const SAVE_DELAY_MS = 500
const NO_TERMINAL = 'Open a terminal in this worktree first'

const context = ref<WorkspaceContext>(null)
const loading = ref(true)
const terminalId = ref('')
const runImmediately = ref(true)


const lastCommand = ref('')
const status = ref<{ kind: 'info' | 'error'; text: string } | null>(null)

const tree = ref<DockerTree | null>(null)
const busyContainers = ref<ReadonlySet<string>>(new Set())
const logsContainer = ref<TreeContainer | null>(null)
const menu = ref<{ x: number; y: number; items: MenuEntry[] } | null>(null)
const details = ref<Details | null>(null)
const dialog = ref<DialogRequest | null>(null)
let treePoll: ReturnType<typeof setInterval> | undefined
let treeSubscription: Subscription | undefined
let contextSubscription: Subscription | undefined
let saveTimer: ReturnType<typeof setTimeout> | undefined
/** Nothing is saved until the stored state is read, or the defaults would overwrite it. */
let stateLoaded = false

const terminals = computed(() => context.value?.terminals ?? [])
const canSend = computed(() => terminalId.value !== '')

function applyContext(value: WorkspaceContext): void {
  context.value = value
  const ids = terminals.value.map((terminal) => terminal.id)
  if (!ids.includes(terminalId.value)) {
    terminalId.value = ids[0] ?? ''
  }
}

async function refresh(): Promise<void> {
  try {
    applyContext(await props.host.readContext())
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function restoreState(): Promise<void> {
  try {
    const stored = await props.host.loadState()
    runImmediately.value = stored?.runImmediately ?? runImmediately.value
  } catch (error) {
    showError(error)
  }
  // After the watcher has seen the restored values, or it would save them straight back.
  await nextTick()
  stateLoaded = true
}

function currentState(): PanelState {
  return { runImmediately: runImmediately.value }
}

function scheduleSave(): void {
  if (!stateLoaded) {
    return
  }
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    props.host.saveState(currentState()).catch(showError)
  }, SAVE_DELAY_MS)
}

async function refreshTree(): Promise<void> {
  try {
    tree.value = await props.host.loadTree()
  } catch (error) {
    tree.value = emptyTree(error instanceof Error ? error.message : String(error))
  }
}

function setBusy(id: string, busy: boolean): void {
  const next = new Set(busyContainers.value)
  if (busy) {
    next.add(id)
  } else {
    next.delete(id)
  }
  busyContainers.value = next
}

async function runContainerAction(container: TreeContainer, action: ContainerAction): Promise<void> {
  setBusy(container.id, true)
  try {
    await props.host.containerAction(container.id, action)
    status.value = { kind: 'info', text: `${container.name}: ${action} done` }
  } catch (error) {
    showError(error)
  } finally {
    setBusy(container.id, false)
  }
}

function sendToTerminal(command: string): void {
  if (!canSend.value) {
    status.value = { kind: 'error', text: NO_TERMINAL }
    return
  }
  void send(command)
}

function openShell(container: TreeContainer): void {
  sendToTerminal(containerShellCommand(container.name))
}

function pointAt(project: TreeProject): ComposeTarget {
  return { projectName: project.name, files: project.configFiles }
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

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

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
    dialog.value = {
      title: `Remove ${counted(images.length, `${mode} image`)}?`,
      message: `Frees up to ${total}, less where images share layers. Images used by any container stay, even a stopped one.`,
      items: more > 0 ? [...shown, `…and ${more} more`] : shown,
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

const menuActions: MenuActions = {
  canSend: () => canSend.value,
  images: () => tree.value?.images ?? [],
  compose: (project, action) => {
    if (action === 'down') {
      dialog.value = {
        title: `Down ${project.name}?`,
        message: 'This stops and removes the containers and networks of the project. Volumes stay.',
        confirmLabel: 'Down',
        danger: true,
        confirm: () => sendToTerminal(projectCommand(pointAt(project), 'down'))
      }
      return
    }
    sendToTerminal(projectCommand(pointAt(project), action))
  },
  composeInTerminalFolder: () => sendToTerminal(projectCommand({ projectName: '', files: [] }, 'up')),
  service: (project, service, action) =>
    sendToTerminal(serviceCommand(pointAt(project), action, service.name)),
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
  attach: (container) => sendToTerminal(containerAttachCommand(container.name)),
  exec: (container) => {
    dialog.value = {
      title: `Exec in ${container.name}`,
      message: 'The command runs in the chosen terminal.',
      confirmLabel: 'Run',
      input: { placeholder: 'ls -la /app' },
      confirm: (command) => sendToTerminal(containerExecCommand(container.name, command))
    }
  },
  shell: (container, shell) => sendToTerminal(containerShellCommand(container.name, shell)),
  pullImage: (name) => sendToTerminal(imagePullCommand(name)),
  removeImage: askToRemoveImage,
  pruneImages: (mode) => void askToPrune(mode)
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

async function send(command: string): Promise<void> {
  if (!canSend.value) {
    return
  }
  lastCommand.value = command
  try {
    const accepted = await props.host.sendText(terminalId.value, command, runImmediately.value)
    status.value = accepted
      ? { kind: 'info', text: runImmediately.value ? 'Sent to terminal' : 'Typed into terminal' }
      : { kind: 'error', text: 'The terminal did not accept the command' }
  } catch (error) {
    showError(error)
    void refresh()
  }
}

watch(terminalId, () => (status.value = null))
watch(runImmediately, scheduleSave)

function onVisible(): void {
  if (document.visibilityState === 'visible') {
    void refresh()
  }
}

onMounted(() => {
  void refresh()
  void restoreState()
  contextSubscription = props.host.onContextChanged(applyContext)
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
  clearTimeout(saveTimer)
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
      <button class="icon-button" title="Refresh terminals" data-test="refresh" @click="refresh">
        <ActionIcon name="restart" />
      </button>
    </header>

    <section class="section">
      <h2 class="title">Services</h2>
      <ServicesTree
        :tree="tree"
        :busy="busyContainers"
        @action="runContainerAction"
        @shell="openShell"
        @logs="(container) => (logsContainer = container)"
        @menu="openMenu"
      />
    </section>

    <DetailsViewer v-if="details" :details="details" @close="details = null" />

    <LogViewer
      v-if="logsContainer"
      :key="logsContainer.id"
      :host="host"
      :container="logsContainer"
      @close="logsContainer = null"
    />

    <section class="section">
      <label class="field">
        <span class="label">Terminal</span>
        <select v-model="terminalId" :disabled="terminals.length === 0" data-test="terminal">
          <option v-if="terminals.length === 0" value="">Open a terminal in this worktree</option>
          <option v-for="(terminal, index) in terminals" :key="terminal.id" :value="terminal.id">
            {{ terminal.title ?? `Terminal ${index + 1}` }}
          </option>
        </select>
      </label>
      <label class="check">
        <input v-model="runImmediately" type="checkbox" data-test="run-immediately" />
        Run immediately (otherwise only type the command)
      </label>
    </section>

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
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.label {
  font-size: 12px;
  color: var(--orca-muted-foreground);
}
.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
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
