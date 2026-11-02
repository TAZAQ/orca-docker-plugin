<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  ContainerAction,
  DockerTree,
  TreeContainer,
  TreeProject,
  TreeService
} from '../../shared/protocol'
import {
  containerDot,
  formatSize,
  hasProblem,
  isRunning,
  runningCount
} from '../container-state'
import ContainerActions from './ContainerActions.vue'
import ContainerLine from './ContainerLine.vue'
import TreeIcon from './TreeIcon.vue'

const props = defineProps<{ tree: DockerTree | null; busy: ReadonlySet<string> }>()
const emit = defineEmits<{
  pick: [project: TreeProject, service: TreeService | null]
  action: [container: TreeContainer, action: ContainerAction]
  shell: [container: TreeContainer]
}>()

const ROOT = 'docker'

const expanded = ref(new Set([ROOT]))
const allContainers = computed(() => props.tree?.containers ?? [])

function toggle(key: string): void {
  const next = new Set(expanded.value)
  if (!next.delete(key)) {
    next.add(key)
  }
  expanded.value = next
}

function containersOf(project: TreeProject): TreeContainer[] {
  return project.services.flatMap((service) => service.containers)
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
  toggle(`project:${project.name}`)
}
</script>

<template>
  <p v-if="tree === null" class="note">Loading…</p>
  <ul v-else class="tree scroll" data-test="tree">
    <li>
      <button class="row" data-test="group-docker" @click="toggle(ROOT)">
        <span class="chevron" :class="{ open: expanded.has(ROOT) }" />
        <TreeIcon name="docker" :active="!tree.error" />
        <span class="name">Docker</span>
      </button>
      <p v-if="tree.error" class="note error" data-test="tree-error">{{ tree.error }}</p>
      <ul v-if="expanded.has(ROOT)" class="tree nested">
        <li v-for="project in tree.projects" :key="project.name">
          <button class="row" :data-test="`project-row-${project.name}`" @click="pickProject(project)">
            <span class="chevron" :class="{ open: expanded.has(`project:${project.name}`) }" />
            <TreeIcon
              name="compose"
              :active="containersOf(project).some(isRunning)"
              :problem="containersOf(project).some(hasProblem)"
            />
            <span class="name">Docker-compose: {{ project.name }}</span>
            <span class="meta">{{ runningCount(containersOf(project)) }}</span>
          </button>
          <ul v-if="expanded.has(`project:${project.name}`)" class="tree nested">
            <li v-for="service in project.services" :key="service.name">
              <div class="line">
                <button
                  class="row"
                  :title="service.containers.map((item) => `${item.name} · ${item.image} · ${item.status}`).join('\n')"
                  :data-test="`service-row-${project.name}-${service.name}`"
                  @click="emit('pick', project, service)"
                >
                  <span class="dot" :class="containerDot(service.containers)" />
                  <span class="name">{{ service.name }}</span>
                  <span class="meta">{{ serviceMeta(service) }}</span>
                </button>
                <ContainerActions
                  v-if="service.containers.length === 1"
                  :container="service.containers[0]!"
                  :busy="busy.has(service.containers[0]!.id)"
                  @action="(action) => emit('action', service.containers[0]!, action)"
                  @shell="emit('shell', service.containers[0]!)"
                />
              </div>
              <ul v-if="service.containers.length > 1" class="tree nested">
                <ContainerLine
                  v-for="container in service.containers"
                  :key="container.id"
                  :container="container"
                  :busy="busy.has(container.id)"
                  @action="(action) => emit('action', container, action)"
                  @shell="emit('shell', container)"
                />
              </ul>
            </li>
          </ul>
        </li>

        <li>
          <button class="row" data-test="group-devContainers" @click="toggle('devContainers')">
            <span class="chevron" :class="{ open: expanded.has('devContainers'), hidden: tree.devContainers.length === 0 }" />
            <TreeIcon name="devContainers" :active="tree.devContainers.some(isRunning)" />
            <span class="name">Dev Containers</span>
          </button>
          <ul v-if="expanded.has('devContainers')" class="tree nested">
            <ContainerLine
              v-for="container in tree.devContainers"
              :key="container.id"
              :container="container"
              :busy="busy.has(container.id)"
              @action="(action) => emit('action', container, action)"
              @shell="emit('shell', container)"
            />
          </ul>
        </li>

        <li>
          <button class="row" data-test="group-containers" @click="toggle('containers')">
            <span class="chevron" :class="{ open: expanded.has('containers'), hidden: allContainers.length === 0 }" />
            <TreeIcon name="containers" />
            <span class="name">Containers</span>
            <span class="meta">{{ runningCount(allContainers) }}</span>
          </button>
          <ul v-if="expanded.has('containers')" class="tree nested">
            <ContainerLine
              v-for="container in allContainers"
              :key="container.id"
              :container="container"
              :busy="busy.has(container.id)"
              @action="(action) => emit('action', container, action)"
              @shell="emit('shell', container)"
            />
          </ul>
        </li>

        <li>
          <button class="row" data-test="group-images" @click="toggle('images')">
            <span class="chevron" :class="{ open: expanded.has('images'), hidden: tree.images.length === 0 }" />
            <TreeIcon name="images" />
            <span class="name">Images</span>
            <span class="meta">{{ tree.images.length }}</span>
          </button>
          <ul v-if="expanded.has('images')" class="tree nested">
            <li v-for="image in tree.images" :key="image.id" class="row static" :title="image.tags.join('\n')">
              <span class="name">{{ image.name }}</span>
              <span class="meta">{{ formatSize(image.size) }}</span>
            </li>
          </ul>
        </li>

        <li>
          <button class="row" data-test="group-networks" @click="toggle('networks')">
            <span class="chevron" :class="{ open: expanded.has('networks'), hidden: tree.networks.length === 0 }" />
            <TreeIcon name="networks" />
            <span class="name">Networks</span>
            <span class="meta">{{ tree.networks.length }}</span>
          </button>
          <ul v-if="expanded.has('networks')" class="tree nested">
            <li v-for="network in tree.networks" :key="network.id" class="row static">
              <span class="name">{{ network.name }}</span>
              <span class="meta">{{ network.driver }}</span>
            </li>
          </ul>
        </li>

        <li>
          <button class="row" data-test="group-volumes" @click="toggle('volumes')">
            <span class="chevron" :class="{ open: expanded.has('volumes'), hidden: tree.volumes.length === 0 }" />
            <TreeIcon name="volumes" />
            <span class="name">Volumes</span>
            <span class="meta">{{ tree.volumes.length }}</span>
          </button>
          <ul v-if="expanded.has('volumes')" class="tree nested">
            <li v-for="volume in tree.volumes" :key="volume.name" class="row static">
              <span class="name">{{ volume.name }}</span>
              <span class="meta">{{ volume.driver }}</span>
            </li>
          </ul>
        </li>
      </ul>
    </li>
  </ul>
</template>

<!-- Not scoped: ContainerLine draws the same rows. -->
<style>
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
.chevron.hidden {
  visibility: hidden;
}
.line {
  display: flex;
  align-items: center;
  min-width: 0;
}
.line > .actions {
  display: none;
}
.line:hover > .actions,
.line:focus-within > .actions {
  display: flex;
}
.line:hover > .row .meta,
.line:focus-within > .row .meta {
  display: none;
}
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  box-sizing: border-box;
  border-radius: 50%;
  border: 1.5px solid var(--orca-muted-foreground);
}
.dot.running {
  border-color: var(--docker-running);
  background: var(--docker-running);
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
.meta {
  flex: none;
  margin-left: auto;
  font-size: 11px;
  color: var(--orca-muted-foreground);
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
