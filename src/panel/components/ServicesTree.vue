<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DockerTree, TreeContainer, TreeProject, TreeService } from '../../shared/protocol'

const props = defineProps<{ tree: DockerTree | null }>()
const emit = defineEmits<{ pick: [project: TreeProject, service: TreeService | null] }>()

const STANDALONE = 'Containers'

const collapsed = ref(new Set<string>())
const isEmpty = computed(
  () => props.tree !== null && props.tree.projects.length === 0 && props.tree.containers.length === 0
)

function toggle(key: string): void {
  const next = new Set(collapsed.value)
  if (!next.delete(key)) {
    next.add(key)
  }
  collapsed.value = next
}

function containersOf(project: TreeProject): TreeContainer[] {
  return project.services.flatMap((service) => service.containers)
}

function isRunning(container: TreeContainer): boolean {
  return container.state === 'running'
}

function hasProblem(container: TreeContainer): boolean {
  return (
    container.health === 'unhealthy' || container.state === 'restarting' || container.state === 'dead'
  )
}

function dotClass(containers: TreeContainer[]): string {
  if (containers.some(hasProblem)) {
    return 'problem'
  }
  return containers.some(isRunning) ? 'running' : 'stopped'
}

function runningCount(containers: TreeContainer[]): string {
  return `${containers.filter(isRunning).length}/${containers.length}`
}

/** A service with one container shows it on its own row: two identical rows say nothing more. */
function serviceMeta(service: TreeService): string {
  const [only] = service.containers
  if (service.containers.length > 1 || !only) {
    return runningCount(service.containers)
  }
  return only.ports.join(' ') || only.status
}

function pickProject(project: TreeProject): void {
  emit('pick', project, null)
  toggle(project.name)
}
</script>

<template>
  <p v-if="tree === null" class="note">Loading…</p>
  <p v-else-if="tree.error" class="note error" data-test="tree-error">{{ tree.error }}</p>
  <p v-else-if="isEmpty" class="note">No containers</p>
  <ul v-else class="tree scroll" data-test="tree">
    <li v-for="project in tree.projects" :key="project.name">
      <button class="row" :data-test="`project-row-${project.name}`" @click="pickProject(project)">
        <span class="chevron" :class="{ open: !collapsed.has(project.name) }" />
        <span class="dot" :class="dotClass(containersOf(project))" />
        <span class="name strong">{{ project.name }}</span>
        <span class="meta">{{ runningCount(containersOf(project)) }}</span>
      </button>
      <ul v-if="!collapsed.has(project.name)" class="tree nested">
        <li v-for="service in project.services" :key="service.name">
          <button
            class="row"
            :title="service.containers.map((item) => `${item.name} · ${item.image} · ${item.status}`).join('\n')"
            :data-test="`service-row-${project.name}-${service.name}`"
            @click="emit('pick', project, service)"
          >
            <span class="dot" :class="dotClass(service.containers)" />
            <span class="name">{{ service.name }}</span>
            <span class="meta">{{ serviceMeta(service) }}</span>
          </button>
          <ul v-if="service.containers.length > 1" class="tree nested">
            <li
              v-for="container in service.containers"
              :key="container.id"
              class="row static"
              :title="`${container.image} · ${container.status}`"
            >
              <span class="dot" :class="dotClass([container])" />
              <span class="name muted">{{ container.name }}</span>
              <span class="meta">{{ container.status }}</span>
            </li>
          </ul>
        </li>
      </ul>
    </li>
    <li v-if="tree.containers.length > 0">
      <button class="row" data-test="standalone-row" @click="toggle(STANDALONE)">
        <span class="chevron" :class="{ open: !collapsed.has(STANDALONE) }" />
        <span class="dot" :class="dotClass(tree.containers)" />
        <span class="name strong">{{ STANDALONE }}</span>
        <span class="meta">{{ runningCount(tree.containers) }}</span>
      </button>
      <ul v-if="!collapsed.has(STANDALONE)" class="tree nested">
        <li
          v-for="container in tree.containers"
          :key="container.id"
          class="row static"
          :title="`${container.image} · ${container.status}`"
        >
          <span class="dot" :class="dotClass([container])" />
          <span class="name">{{ container.name }}</span>
          <span class="meta">{{ container.ports.join(' ') || container.status }}</span>
        </li>
      </ul>
    </li>
  </ul>
</template>

<style scoped>
.scroll {
  max-height: 45vh;
  overflow-y: auto;
}
.tree {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.nested {
  padding-left: 14px;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  padding: 2px 4px;
  border: 0;
  border-radius: calc(var(--orca-radius) - 2px);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.row.static {
  cursor: default;
}
.row:hover:not(.static) {
  background: var(--orca-accent);
  color: var(--orca-accent-foreground);
}
.chevron {
  flex: none;
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid var(--orca-muted-foreground);
}
.chevron.open {
  transform: rotate(90deg);
}
/* Shape and theme tokens only: Orca has no green token, and a fixed color would suit one theme. */
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  box-sizing: border-box;
  border-radius: 50%;
  border: 1.5px solid var(--orca-muted-foreground);
}
.dot.running {
  border-color: var(--orca-primary);
  background: var(--orca-primary);
}
.dot.problem {
  border-color: var(--orca-destructive);
  background: var(--orca-destructive);
}
.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.strong {
  font-weight: 600;
}
.muted,
.meta {
  color: var(--orca-muted-foreground);
}
.meta {
  flex: none;
  margin-left: auto;
  font-size: 11px;
}
.note {
  margin: 0;
  font-size: 12px;
  color: var(--orca-muted-foreground);
}
.note.error {
  color: var(--orca-destructive);
}
</style>
