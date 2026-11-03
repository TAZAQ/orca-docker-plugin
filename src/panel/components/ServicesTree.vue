<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DockerTree, ObjectKind, TreeContainer, TreeProject, TreeService } from '../../shared/protocol'
import {
  containerDot,
  formatSize,
  hasProblem,
  isRunning,
  runningCount
} from '../container-state'
import type { MenuTarget, ViewOptions } from '../menus'
import { applyView, filterTree, isTreeEmpty } from '../tree-filter'
import ContainerLine from './ContainerLine.vue'
import TreeIcon from './TreeIcon.vue'

const props = defineProps<{ tree: DockerTree | null; view: ViewOptions }>()
const emit = defineEmits<{
  open: [container: TreeContainer]
  select: [kind: ObjectKind, id: string]
  menu: [event: MouseEvent, target: MenuTarget]
}>()

const ROOT = 'docker'

const expanded = ref(new Set([ROOT]))
/** The row last clicked. A container under a service and under Containers are two rows. */
const active = ref<string | null>(null)
const search = ref('')
const searching = computed(() => search.value.trim() !== '')
const shown = computed(() =>
  props.tree ? filterTree(applyView(props.tree, props.view), search.value) : null
)
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
  active.value = key
  const next = new Set(expanded.value)
  if (!next.delete(key)) {
    next.add(key)
  }
  expanded.value = next
}

function openContainer(key: string, container: TreeContainer): void {
  active.value = key
  emit('select', 'container', container.id)
  emit('open', container)
}

function select(key: string, kind: ObjectKind, id: string): void {
  active.value = key
  emit('select', kind, id)
}

function clickService(key: string, service: TreeService): void {
  active.value = key
  const [only] = service.containers
  if (service.containers.length === 1 && only) {
    emit('select', 'container', only.id)
    emit('open', only)
  }
}

function showMenu(event: MouseEvent, key: string, target: MenuTarget): void {
  active.value = key
  emit('menu', event, target)
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

function serviceTarget(project: TreeProject, service: TreeService): MenuTarget {
  const [only] = service.containers
  return service.containers.length === 1 && only
    ? { kind: 'container', container: only, compose: { project, service } }
    : { kind: 'service', project, service }
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
        <button
          class="row"
          :class="{ active: active === ROOT }"
          data-test="group-docker"
          @click="toggle(ROOT)"
          @contextmenu.prevent="showMenu($event, ROOT, { kind: 'docker' })"
        >
          <span class="chevron" :class="{ open: isOpen(ROOT) }" />
          <TreeIcon name="docker" :active="!tree.error" />
          <span class="name">Docker</span>
          <span v-if="tree.context && tree.context.active !== 'default'" class="meta" data-test="docker-context">
            {{ tree.context.active }}
          </span>
        </button>
        <p v-if="tree.error" class="note error" data-test="tree-error">{{ tree.error }}</p>
        <ul v-if="isOpen(ROOT)" class="tree nested">
          <li v-for="project in shown.projects" :key="project.name">
            <button
              class="row"
              :class="{ active: active === `project:${project.name}` }"
              :data-test="`project-row-${project.name}`"
              @click="toggle(`project:${project.name}`)"
              @contextmenu.prevent="showMenu($event, `project:${project.name}`, { kind: 'project', project })"
            >
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
                <button
                  class="row"
                  :class="{ active: active === `service:${project.name}/${service.name}` }"
                  :title="service.containers.map((item) => `${item.name} · ${item.image} · ${item.status}`).join('\n')"
                  :data-test="`service-row-${project.name}-${service.name}`"
                  @click="clickService(`service:${project.name}/${service.name}`, service)"
                  @contextmenu.prevent="
                    showMenu($event, `service:${project.name}/${service.name}`, serviceTarget(project, service))
                  "
                >
                  <span class="dot" :class="containerDot(service.containers)" />
                  <span class="name">{{ service.name }}</span>
                  <span class="meta">{{ serviceMeta(service) }}</span>
                </button>
                <ul v-if="service.containers.length > 1" class="tree nested">
                  <ContainerLine
                    v-for="container in service.containers"
                    :key="container.id"
                    :container="container"
                    :active="active === `compose:${container.id}`"
                    @open="openContainer(`compose:${container.id}`, container)"
                    @menu="(event) => showMenu(event, `compose:${container.id}`, { kind: 'container', container })"
                  />
                </ul>
              </li>
            </ul>
          </li>

          <li v-if="isGroupShown(shown.devContainers)">
            <button
              class="row"
              :class="{ active: active === 'devContainers' }"
              data-test="group-devContainers"
              @click="toggle('devContainers')"
            >
              <span class="chevron" :class="{ open: isOpen('devContainers'), hidden: shown.devContainers.length === 0 }" />
              <TreeIcon name="devContainers" :active="shown.devContainers.some(isRunning)" />
              <span class="name">Dev Containers</span>
            </button>
            <ul v-if="isOpen('devContainers')" class="tree nested">
              <ContainerLine
                v-for="container in shown.devContainers"
                :key="container.id"
                :container="container"
                :active="active === `dev:${container.id}`"
                @open="openContainer(`dev:${container.id}`, container)"
                @menu="(event) => showMenu(event, `dev:${container.id}`, { kind: 'container', container })"
              />
            </ul>
          </li>

          <li v-if="isGroupShown(shown.containers)">
            <button
              class="row"
              :class="{ active: active === 'containers' }"
              data-test="group-containers"
              @click="toggle('containers')"
              @contextmenu.prevent="showMenu($event, 'containers', { kind: 'containers' })"
            >
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
                :active="active === `all:${container.id}`"
                @open="openContainer(`all:${container.id}`, container)"
                @menu="(event) => showMenu(event, `all:${container.id}`, { kind: 'container', container })"
              />
            </ul>
          </li>

          <li v-if="isGroupShown(shown.images)">
            <button
              class="row"
              :class="{ active: active === 'images' }"
              data-test="group-images"
              @click="toggle('images')"
              @contextmenu.prevent="showMenu($event, 'images', { kind: 'images' })"
            >
              <span class="chevron" :class="{ open: isOpen('images'), hidden: shown.images.length === 0 }" />
              <TreeIcon name="images" />
              <span class="name">Images</span>
              <span class="meta">{{ shown.images.length }}</span>
            </button>
            <ul v-if="isOpen('images')" class="tree nested">
              <li v-for="image in shown.images" :key="image.id">
                <button
                  class="row"
                  :class="{ active: active === `image:${image.id}` }"
                  :title="image.tags.join('\n')"
                  :data-test="`image-row-${image.name}`"
                  @click="select(`image:${image.id}`, 'image', image.id)"
                  @contextmenu.prevent="showMenu($event, `image:${image.id}`, { kind: 'image', image })"
                >
                  <span class="name">{{ image.name }}</span>
                  <span class="meta">{{ formatSize(image.size) }}</span>
                </button>
              </li>
            </ul>
          </li>

          <li v-if="isGroupShown(shown.networks)">
            <button
              class="row"
              :class="{ active: active === 'networks' }"
              data-test="group-networks"
              @click="toggle('networks')"
              @contextmenu.prevent="showMenu($event, 'networks', { kind: 'networks' })"
            >
              <span class="chevron" :class="{ open: isOpen('networks'), hidden: shown.networks.length === 0 }" />
              <TreeIcon name="networks" />
              <span class="name">Networks</span>
              <span class="meta">{{ shown.networks.length }}</span>
            </button>
            <ul v-if="isOpen('networks')" class="tree nested">
              <li v-for="network in shown.networks" :key="network.id">
                <button
                  class="row"
                  :class="{ active: active === `network:${network.id}` }"
                  :data-test="`network-row-${network.name}`"
                  @click="select(`network:${network.id}`, 'network', network.id)"
                  @contextmenu.prevent="showMenu($event, `network:${network.id}`, { kind: 'network', network })"
                >
                  <span class="name">{{ network.name }}</span>
                  <span class="meta">{{ network.driver }}</span>
                </button>
              </li>
            </ul>
          </li>

          <li v-if="isGroupShown(shown.volumes)">
            <button
              class="row"
              :class="{ active: active === 'volumes' }"
              data-test="group-volumes"
              @click="toggle('volumes')"
              @contextmenu.prevent="showMenu($event, 'volumes', { kind: 'volumes' })"
            >
              <span class="chevron" :class="{ open: isOpen('volumes'), hidden: shown.volumes.length === 0 }" />
              <TreeIcon name="volumes" />
              <span class="name">Volumes</span>
              <span class="meta">{{ shown.volumes.length }}</span>
            </button>
            <ul v-if="isOpen('volumes')" class="tree nested">
              <li v-for="volume in shown.volumes" :key="volume.name">
                <button
                  class="row"
                  :class="{ active: active === `volume:${volume.name}` }"
                  :data-test="`volume-row-${volume.name}`"
                  @click="select(`volume:${volume.name}`, 'volume', volume.name)"
                  @contextmenu.prevent="showMenu($event, `volume:${volume.name}`, { kind: 'volume', volume })"
                >
                  <span class="name">{{ volume.name }}</span>
                  <span class="meta">{{ volume.driver }}</span>
                </button>
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
/* Stays lit under the context menu, so it is clear what the menu is for. */
.row.active {
  background: var(--orca-accent);
  color: var(--orca-accent-foreground);
}
.row:hover {
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
