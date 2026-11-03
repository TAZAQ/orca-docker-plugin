<script setup lang="ts">
import CommandPreview from './CommandPreview.vue'
import { computed, ref } from 'vue'
import {
  composeDownCommand,
  composeUpCommand,
  DEFAULT_DEPLOY,
  DEFAULT_DOWN,
  type DeployOptions,
  type DownOptions
} from '../../shared/compose'
import type { TreeProject } from '../../shared/protocol'

/** Deploy… and Down with the options of a JetBrains Docker Compose run configuration. */

const props = defineProps<{ project: TreeProject; mode: 'deploy' | 'down' }>()
const emit = defineEmits<{ run: [command: string]; close: [] }>()

const target = computed(() => ({ projectName: props.project.name, files: props.project.configFiles }))

const deploy = ref<DeployOptions>({ ...DEFAULT_DEPLOY, services: [] })
const down = ref<DownOptions>({ ...DEFAULT_DOWN })
const profiles = ref('')
const envFiles = ref('')
const timeout = ref('')

const list = (text: string): string[] =>
  text
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '')

const timeoutValid = computed(() => /^\d{0,4}$/.test(timeout.value.trim()))

const command = computed(() =>
  props.mode === 'deploy'
    ? composeUpCommand(target.value, {
        ...deploy.value,
        profiles: list(profiles.value),
        envFiles: list(envFiles.value)
      })
    : composeDownCommand(target.value, {
        ...down.value,
        timeout: timeout.value.trim() === '' ? null : Number(timeout.value)
      })
)

const DEPLOY_SWITCHES = [
  { key: 'removeOrphans', flag: '--remove-orphans', note: 'Remove containers of services no longer in the file' },
  { key: 'renewAnonVolumes', flag: '-V', note: 'New anonymous volumes instead of the old data' },
  { key: 'alwaysRecreateDeps', flag: '--always-recreate-deps', note: 'Recreate the services it depends on too' }
] as const

const DOWN_SWITCHES = [
  { key: 'removeVolumes', flag: '-v', note: 'Remove named and anonymous volumes, with their data' },
  { key: 'removeOrphans', flag: '--remove-orphans', note: 'Remove containers of services no longer in the file' }
] as const

function toggleService(name: string): void {
  const services = deploy.value.services
  deploy.value.services = services.includes(name) ? services.filter((item) => item !== name) : [...services, name]
}

function run(): void {
  if (!timeoutValid.value) {
    return
  }
  // The command first: closing clears the project the parent names the terminal after.
  emit('run', command.value)
  emit('close')
}
</script>

<template>
  <div class="backdrop" data-test="compose-dialog" @keydown.esc="emit('close')" @click.self="emit('close')">
    <div class="box" role="dialog" aria-modal="true">
      <h2 class="box-title">{{ mode === 'deploy' ? 'Deploy' : 'Down' }} {{ project.name }}</h2>
      <CommandPreview :command="command" data-test="compose-command" />

      <template v-if="mode === 'deploy'">
        <fieldset class="group">
          <legend>Services <span class="note">(none checked: all)</span></legend>
          <label v-for="service in project.services" :key="service.name" class="check">
            <input
              type="checkbox"
              :checked="deploy.services.includes(service.name)"
              :data-test="`compose-service-${service.name}`"
              @change="toggleService(service.name)"
            />
            {{ service.name }}
          </label>
        </fieldset>
        <label class="row">
          <span>Profiles</span>
          <input v-model="profiles" placeholder="debug, tools" data-test="compose-profiles" />
        </label>
        <label class="row">
          <span>Env files</span>
          <input v-model="envFiles" placeholder=".env.local" data-test="compose-env-files" />
        </label>
        <label class="row">
          <span>Build</span>
          <select v-model="deploy.build" data-test="compose-build">
            <option value="missing">Only missing images</option>
            <option value="always">Always (--build)</option>
            <option value="never">Never (--no-build)</option>
          </select>
        </label>
        <label class="row">
          <span>Recreate</span>
          <select v-model="deploy.recreate" data-test="compose-recreate">
            <option value="changed">Changed configuration</option>
            <option value="all">All (--force-recreate)</option>
            <option value="none">None (--no-recreate)</option>
          </select>
        </label>
        <button
          v-for="option in DEPLOY_SWITCHES"
          :key="option.key"
          type="button"
          class="option"
          :class="{ on: deploy[option.key] }"
          :aria-pressed="deploy[option.key]"
          :data-test="`compose-${option.key}`"
          @click="deploy[option.key] = !deploy[option.key]"
        >
          <span class="switch" />
          <span class="option-text"><code>{{ option.flag }}</code><span class="note">{{ option.note }}</span></span>
        </button>
      </template>

      <template v-else>
        <p class="note">Stops and removes the containers and networks of the project.</p>
        <label class="row">
          <span>Images</span>
          <select v-model="down.removeImages" data-test="compose-rmi">
            <option value="none">Keep</option>
            <option value="local">Remove those built here (--rmi local)</option>
            <option value="all">Remove all (--rmi all)</option>
          </select>
        </label>
        <label class="row">
          <span>Timeout, s</span>
          <input v-model="timeout" placeholder="10" inputmode="numeric" data-test="compose-timeout" />
        </label>
        <button
          v-for="option in DOWN_SWITCHES"
          :key="option.key"
          type="button"
          class="option"
          :class="{ on: down[option.key], danger: option.key === 'removeVolumes' && down.removeVolumes }"
          :aria-pressed="down[option.key]"
          :data-test="`compose-${option.key}`"
          @click="down[option.key] = !down[option.key]"
        >
          <span class="switch" />
          <span class="option-text"><code>{{ option.flag }}</code><span class="note">{{ option.note }}</span></span>
        </button>
      </template>

      <div class="buttons">
        <button type="button" data-test="compose-cancel" @click="emit('close')">Cancel</button>
        <button
          type="button"
          :class="mode === 'down' ? 'danger' : 'primary'"
          :disabled="!timeoutValid"
          data-test="compose-run"
          @click="run"
        >
          {{ mode === 'deploy' ? 'Deploy' : 'Down' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  background: rgb(0 0 0 / 40%);
}
.box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  padding: 12px;
  border: 1px solid var(--orca-border);
  border-radius: var(--orca-radius);
  background: var(--orca-popover);
  color: var(--orca-popover-foreground);
}
.box-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--orca-border);
  border-radius: calc(var(--orca-radius) - 2px);
  font-size: 12px;
}
.check {
  display: flex;
  align-items: center;
  gap: 4px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.row > span {
  flex: none;
  width: 70px;
  color: var(--orca-muted-foreground);
}
.row input,
.row select {
  flex: 1;
  min-width: 0;
}
.note {
  margin: 0;
  font-size: 11px;
  color: var(--orca-muted-foreground);
}
.option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: 1px solid var(--orca-border);
  border-radius: calc(var(--orca-radius) - 2px);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.option.on {
  border-color: var(--orca-ring);
  background: var(--orca-accent);
  color: var(--orca-accent-foreground);
}
.option.danger {
  border-color: var(--orca-destructive);
}
.option-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.option-text code {
  font-size: 12px;
}
/* A small switch: the knob moves right and fills when the flag is on. */
.switch {
  position: relative;
  flex: none;
  width: 26px;
  height: 14px;
  border-radius: 7px;
  background: var(--orca-input);
}
.switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--orca-background);
}
.option.on .switch {
  background: var(--orca-primary);
}
.option.on .switch::after {
  left: 14px;
  background: var(--orca-primary-foreground);
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.buttons button {
  padding: 4px 12px;
  border: 1px solid var(--orca-border);
  border-radius: calc(var(--orca-radius) - 2px);
  background: var(--orca-secondary);
  color: var(--orca-secondary-foreground);
  cursor: pointer;
}
.buttons button.primary {
  border-color: var(--orca-primary);
  background: var(--orca-primary);
  color: var(--orca-primary-foreground);
}
.buttons button.danger {
  border-color: var(--orca-destructive);
  background: var(--orca-destructive);
  color: var(--orca-destructive-foreground);
}
.buttons button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
