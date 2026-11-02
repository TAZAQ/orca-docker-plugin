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
import { filterTree, isTreeEmpty } from '../tree-filter'
import ContainerActions from './ContainerActions.vue'
import ContainerLine from './ContainerLine.vue'
import TreeIcon from './TreeIcon.vue'

const props = defineProps<{ tree: DockerTree | null; busy: ReadonlySet<string> }>()
const emit = defineEmits<{
  pick: [project: TreeProject, service: TreeService | null]
  action: [container: TreeContainer, action: ContainerAction]
  shell: [container: TreeContainer]
  logs: [container: TreeContainer]
}>()

const ROOT = 'docker'

const expanded = ref(new Set([ROOT]))
const search = ref('')
const searching = computed(() => search.value.trim() !== '')
const shown = computed(() => (props.tree ? filterTree(props.tree, search.value) : null))
const noMatches = computed(() => searching.value && shown.value !== null && isTreeEmpty(shown.value))

/** A search opens every group it found something in; collapsing returns when it is cleared. */
function isOpen(key: string): boolean {
  return searching.value || expanded.value.has(key)
}

/** While searching, an empty group is just noise. */
function isGroupShown(items: readonly unknown[]): boolean {
  return !searching.value || items.length > 0
}

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
  <template v-else>
    <input
      v-model="search"
      class="search"
      type="search"
      placeholder="Search containers, images…"
      data-test="tree-search"
      @keydown.esc="search = ''"
    />
    <p v-if="noMatches" class="note" data-test="tree-no-matches">Nothing found</p>
    <ul v-else-if="shown" class="tree scroll" data-test="tree">
      <li>
        <button class="row" data-test="group-docker" @click="toggle(ROOT)">
          <span class="chevron" :class="{ open: isOpen(ROOT) }" />
          <TreeIcon name="docker" :active="!tree.error" />
          <span class="name">Docker</span>
        </button>
        <p v-if="tree.error" class="note error" data-test="tree-error">{{ tree.error }}</p>
        <ul v-if="isOpen(ROOT)" class="tree nested">
          <li v-for="project in shown.projects" :key="project.name">
            <button class="row" :data-test="`project-row-${project.name}`" @click="pickProject(project)">
              <span class="chevron" :class="{ open: isOpen(`project:${project.name}`) }" />
              <TreeIcon
                name="compose"
                :active="containersOf(project).some(isRunning)"
                :problem="containersOf(project).some(hasProblem)"
              />
              <span class="name">Docker-compose: {{ project.name }}</span>
              <span class="meta">{{ runningCount(containersOf(project)) }}</span>
            </button>
            <ul v-if="isOpen(`project:${project.name}`)" class="tree nested">
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
                    @logs="emit('logs', service.containers[0]!)"
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
                    @logs="emit('logs', container)"
                  />
                </ul>
              </li>
            </ul>
          </li>

          <li v-if="isGroupShown(shown.devContainers)">
            <button class="row" data-test="group-devContainers" @click="toggle('devContainers')">
              <span class="chevron" :class="{ open: isOpen('devContainers'), hidden: shown.devContainers.length === 0 }" />
              <TreeIcon name="devContainers" :active="shown.devContainers.some(isRunning)" />
              <span class="name">Dev Containers</span>
            </button>
            <ul v-if="isOpen('devContainers')" class="tree nested">
              <ContainerLine
                v-for="container in shown.devContainers"
                :key="container.id"
                :container="container"
                :busy="busy.has(container.id)"
                @action="(action) => emit('action', container, action)"
                @shell="emit('shell', container)"
                @logs="emit('logs', container)"
              />
            </ul>
          </li>

          <li v-if="isGroupShown(shown.containers)">
            <button class="row" data-test="group-containers" @click="toggle('containers')">
              <span class="chevron" :class="{ open: isOpen('containers'), hidden: shown.containers.length === 0 }" />
              <TreeIcon name="containers" />
              <span class="name">Containers</span>
              <span class="meta">{{ runningCount(shown.containers) }}</span>
            </button>
            <ul v-if="isOpen('containers')" class="tree nested">
              <ContainerLine
                v-for="container in shown.containers"
                :key="container.id"
                :container="container"
                :busy="busy.has(container.id)"
                @action="(action) => emit('action', container, action)"
                @shell="emit('shell', container)"
                @logs="emit('logs', container)"
              />
            </ul>
          </li>

          <li v-if="isGroupShown(shown.images)">
            <button class="row" data-test="group-images" @click="toggle('images')">
              <span class="chevron" :class="{ open: isOpen('images'), hidden: shown.images.length === 0 }" />
              <TreeIcon name="images" />
              <span class="name">Images</span>
              <span class="meta">{{ shown.images.length }}</span>
            </button>
            <ul v-if="isOpen('images')" class="tree nested">
              <li v-for="image in shown.images" :key="image.id" class="row static" :title="image.tags.join('\n')">
                <span class="name">{{ image.name }}</span>
                <span class="meta">{{ formatSize(image.size) }}</span>
              </li>
            </ul>
          </li>

          <li v-if="isGroupShown(shown.networks)">
            <button class="row" data-test="group-networks" @click="toggle('networks')">
              <span class="chevron" :class="{ open: isOpen('networks'), hidden: shown.networks.length === 0 }" />
              <TreeIcon name="networks" />
              <span class="name">Networks</span>
              <span class="meta">{{ shown.networks.length }}</span>
            </button>
            <ul v-if="isOpen('networks')" class="tree nested">
              <li v-for="network in shown.networks" :key="network.id" class="row static">
                <span class="name">{{ network.name }}</span>
                <span class="meta">{{ network.driver }}</span>
              </li>
            </ul>
          </li>

          <li v-if="isGroupShown(shown.volumes)">
            <button class="row" data-test="group-volumes" @click="toggle('volumes')">
              <span class="chevron" :class="{ open: isOpen('volumes'), hidden: shown.volumes.length === 0 }" />
              <TreeIcon name="volumes" />
              <span class="name">Volumes</span>
              <span class="meta">{{ shown.volumes.length }}</span>
            </button>
            <ul v-if="isOpen('volumes')" class="tree nested">
              <li v-for="volume in shown.volumes" :key="volume.name" class="row static">
                <span class="name">{{ volume.name }}</span>
                <span class="meta">{{ volume.driver }}</span>
              </li>
            </ul>
          </li>
        </ul>
      </li>
    </ul>
  </template>
</template>

<!-- Not scoped: ContainerLine draws the same rows. -->
<style>
.search {
  width: 100%;
  box-sizing: border-box;
}
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
