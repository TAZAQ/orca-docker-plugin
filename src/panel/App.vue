<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  emptyTree,
  type ContainerAction,
  type DockerTree,
  type TreeContainer,
  type TreeProject,
  type TreeService
} from '../shared/protocol'
import {
  containerShellCommand,
  projectCommand,
  serviceCommand,
  splitList,
  type ComposeTarget,
  type ProjectAction,
  type ServiceAction
} from '../shared/compose'
import type { HostBridge, Subscription, WorkspaceContext } from './bridge'
import ActionIcon, { type IconName } from './components/ActionIcon.vue'
import LogViewer from './components/LogViewer.vue'
import ServicesTree from './components/ServicesTree.vue'

const props = defineProps<{ host: HostBridge }>()

const TREE_POLL_MS = 30_000

const context = ref<WorkspaceContext>(null)
const loading = ref(true)
const terminalId = ref('')
const runImmediately = ref(true)

// Not persisted yet, so these live only while the panel is open.
const projectName = ref('')
const files = ref('')
const profiles = ref('')
const service = ref('')
const recentServices = ref<string[]>([])

const lastCommand = ref('')
const status = ref<{ kind: 'info' | 'error'; text: string } | null>(null)
const confirmingDown = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | undefined

const tree = ref<DockerTree | null>(null)
const busyContainers = ref<ReadonlySet<string>>(new Set())
const logsContainer = ref<TreeContainer | null>(null)
let treePoll: ReturnType<typeof setInterval> | undefined
let treeSubscription: Subscription | undefined

const target = computed<ComposeTarget>(() => ({
  projectName: projectName.value,
  files: splitList(files.value),
  profiles: splitList(profiles.value)
}))
const terminals = computed(() => context.value?.terminals ?? [])
const canSend = computed(() => terminalId.value !== '')
const hasService = computed(() => service.value.trim() !== '')

async function refresh(): Promise<void> {
  try {
    context.value = await props.host.readContext()
    const ids = terminals.value.map((terminal) => terminal.id)
    if (!ids.includes(terminalId.value)) {
      terminalId.value = ids[0] ?? ''
    }
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function refreshTree(): Promise<void> {
  try {
    tree.value = await props.host.loadTree()
  } catch (error) {
    tree.value = emptyTree(error instanceof Error ? error.message : String(error))
  }
}

/** Points the Project and Service sections at what was clicked in the tree. */
function pickService(project: TreeProject, picked: TreeService | null): void {
  projectName.value = project.name
  files.value = project.configFiles.join(', ')
  if (picked) {
    service.value = picked.name
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

function openShell(container: TreeContainer): void {
  if (!canSend.value) {
    status.value = { kind: 'error', text: 'Open a terminal in this worktree first' }
    return
  }
  void send(containerShellCommand(container.name))
}

function showError(error: unknown): void {
  status.value = { kind: 'error', text: error instanceof Error ? error.message : String(error) }
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

function runProject(action: ProjectAction): void {
  if (action === 'down' && !confirmingDown.value) {
    // Sandboxed panels cannot open confirm() dialogs, so Down asks for a second click.
    confirmingDown.value = true
    clearTimeout(confirmTimer)
    confirmTimer = setTimeout(() => (confirmingDown.value = false), 4000)
    return
  }
  confirmingDown.value = false
  void send(projectCommand(target.value, action))
}

function runService(action: ServiceAction): void {
  const name = service.value.trim()
  if (name === '') {
    return
  }
  recentServices.value = [name, ...recentServices.value.filter((item) => item !== name)].slice(0, 12)
  void send(serviceCommand(target.value, action, name))
}

const projectActions: { action: ProjectAction; label: string; icon: IconName }[] = [
  { action: 'up', label: 'Start All', icon: 'play' },
  { action: 'restart', label: 'Restart', icon: 'restart' },
  { action: 'stop', label: 'Stop', icon: 'stop' },
  { action: 'down', label: 'Down', icon: 'down' }
]
const projectExtras: { action: ProjectAction; label: string }[] = [
  { action: 'ps', label: 'ps' },
  { action: 'logs', label: 'Logs' },
  { action: 'pull', label: 'Pull' },
  { action: 'build', label: 'Build' }
]
const serviceActions: { action: ServiceAction; label: string; icon: IconName }[] = [
  { action: 'up', label: 'Start', icon: 'play' },
  { action: 'restart', label: 'Restart', icon: 'restart' },
  { action: 'stop', label: 'Stop', icon: 'stop' },
  { action: 'logs', label: 'Logs', icon: 'logs' },
  { action: 'shell', label: 'Shell', icon: 'terminal' },
  { action: 'rebuild', label: 'Rebuild', icon: 'build' }
]

watch(terminalId, () => (status.value = null))

function onVisible(): void {
  if (document.visibilityState === 'visible') {
    void refresh()
  }
}

onMounted(() => {
  void refresh()
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
  clearTimeout(confirmTimer)
  clearInterval(treePoll)
  treeSubscription?.dispose()
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
          <span class="branch">{{ context.branch }}</span>
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
        @pick="pickService"
        @action="runContainerAction"
        @shell="openShell"
        @logs="(container) => (logsContainer = container)"
      />
    </section>

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
            Terminal {{ index + 1 }}
          </option>
        </select>
      </label>
      <label class="check">
        <input v-model="runImmediately" type="checkbox" data-test="run-immediately" />
        Run immediately (otherwise only type the command)
      </label>
    </section>

    <details class="section">
      <summary class="label">Compose options</summary>
      <label class="field">
        <span class="label">Project name (-p)</span>
        <input v-model="projectName" placeholder="from directory" data-test="project-name" />
      </label>
      <label class="field">
        <span class="label">Compose files (-f), comma separated</span>
        <input v-model="files" placeholder="compose.yaml" data-test="files" />
      </label>
      <label class="field">
        <span class="label">Profiles, comma separated</span>
        <input v-model="profiles" data-test="profiles" />
      </label>
    </details>

    <section class="section">
      <h2 class="title">Project</h2>
      <div class="toolbar">
        <button
          v-for="item in projectActions"
          :key="item.action"
          :class="{ danger: item.action === 'down' && confirmingDown }"
          :disabled="!canSend"
          :data-test="`project-${item.action}`"
          @click="runProject(item.action)"
        >
          <ActionIcon :name="item.icon" />
          {{ item.action === 'down' && confirmingDown ? 'Confirm Down' : item.label }}
        </button>
      </div>
      <div class="toolbar secondary">
        <button
          v-for="item in projectExtras"
          :key="item.action"
          :disabled="!canSend"
          :data-test="`project-${item.action}`"
          @click="runProject(item.action)"
        >
          {{ item.label }}
        </button>
      </div>
    </section>

    <section class="section">
      <h2 class="title">Service</h2>
      <input
        v-model="service"
        class="service-input"
        placeholder="service name, e.g. postgres"
        data-test="service"
        @keydown.enter="runService('logs')"
      />
      <div v-if="recentServices.length > 0" class="chips">
        <button
          v-for="name in recentServices"
          :key="name"
          class="chip"
          :class="{ active: name === service.trim() }"
          @click="service = name"
        >
          {{ name }}
        </button>
      </div>
      <div class="toolbar">
        <button
          v-for="item in serviceActions"
          :key="item.action"
          :disabled="!canSend || !hasService"
          :data-test="`service-${item.action}`"
          @click="runService(item.action)"
        >
          <ActionIcon :name="item.icon" />
          {{ item.label }}
        </button>
      </div>
    </section>

    <footer class="footer">
      <code v-if="lastCommand" class="command" data-test="last-command">{{ lastCommand }}</code>
      <p v-if="status" class="status" :class="status.kind" data-test="status">{{ status.text }}</p>
    </footer>
  </main>
</template>

<style>
:root {
  /* Orca has no success token; light-dark() follows the color-scheme its shell sets. */
  --docker-running: light-dark(#1a7f37, #3fb950);
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
details.section > summary {
  cursor: pointer;
  margin-bottom: 4px;
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
input:not([type='checkbox']),
select {
  padding: 5px 8px;
  border: 1px solid var(--orca-input);
  border-radius: calc(var(--orca-radius) - 2px);
  background: transparent;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.toolbar button,
.icon-button,
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: 1px solid var(--orca-border);
  border-radius: calc(var(--orca-radius) - 2px);
  background: var(--orca-secondary);
  color: var(--orca-secondary-foreground);
  cursor: pointer;
}
.toolbar.secondary button {
  background: transparent;
  font-size: 12px;
}
.icon-button {
  padding: 4px 6px;
}
button:hover:not(:disabled) {
  background: var(--orca-accent);
  color: var(--orca-accent-foreground);
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
button.danger,
button.danger:hover {
  background: var(--orca-destructive);
  color: var(--orca-destructive-foreground);
  border-color: var(--orca-destructive);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chip {
  padding: 1px 8px;
  border-radius: 999px;
  background: transparent;
  font-size: 12px;
}
.chip.active {
  border-color: var(--orca-ring);
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
