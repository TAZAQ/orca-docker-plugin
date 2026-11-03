<script setup lang="ts">
import { computed, ref } from 'vue'
import { DEFAULT_RUN, dockerRunCommand, ENV_ASSIGNMENT, PORT_BINDING, type RunOptions } from '../../shared/docker-run'
import { DOCKER_NAME } from '../../shared/protocol'

/** Create Container from an image, with the fields of a JetBrains Docker Image run configuration. */

const props = defineProps<{ image: string }>()
const emit = defineEmits<{ run: [command: string]; close: [] }>()

const options = ref<Omit<RunOptions, 'image' | 'ports' | 'volumes' | 'env'>>({ ...DEFAULT_RUN })
const ports = ref('')
const volumes = ref('')
const env = ref('')

const lines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

const problems = computed(() => {
  const found: string[] = []
  if (options.value.name.trim() !== '' && !DOCKER_NAME.test(options.value.name.trim())) {
    found.push('The name may have letters, digits and _ . - only')
  }
  const badPort = lines(ports.value).find((port) => !PORT_BINDING.test(port))
  if (badPort) {
    found.push(`Not a port binding: ${badPort}`)
  }
  const badVolume = lines(volumes.value).find((volume) => !volume.includes(':'))
  if (badVolume) {
    found.push(`A volume binding needs source:destination: ${badVolume}`)
  }
  const badEnv = lines(env.value).find((pair) => !ENV_ASSIGNMENT.test(pair))
  if (badEnv) {
    found.push(`Not NAME=value: ${badEnv}`)
  }
  return found
})

const command = computed(() =>
  dockerRunCommand({
    ...options.value,
    image: props.image,
    ports: lines(ports.value),
    volumes: lines(volumes.value),
    env: lines(env.value)
  })
)

const SWITCHES = [
  { key: 'detach', flag: '-d', note: 'Run in the background' },
  { key: 'publishAll', flag: '-P', note: 'Publish all exposed ports on random host ports' },
  { key: 'autoRemove', flag: '--rm', note: 'Remove the container when it exits' }
] as const

function run(): void {
  if (problems.value.length > 0) {
    return
  }
  emit('run', command.value)
  emit('close')
}
</script>

<template>
  <div class="backdrop" data-test="run-dialog" @keydown.esc="emit('close')" @click.self="emit('close')">
    <div class="box" role="dialog" aria-modal="true">
      <h2 class="box-title">Create Container from {{ image }}</h2>
      <code class="preview" data-test="run-command">{{ command }}</code>
      <label class="row">
        <span>Name</span>
        <input v-model="options.name" placeholder="random if empty" data-test="run-name" />
      </label>
      <label class="row top">
        <span>Ports</span>
        <textarea v-model="ports" rows="2" placeholder="8080:80, one per line" data-test="run-ports" />
      </label>
      <label class="row top">
        <span>Volumes</span>
        <textarea v-model="volumes" rows="2" placeholder="pgdata:/data or /srv:/srv:ro" data-test="run-volumes" />
      </label>
      <label class="row top">
        <span>Env</span>
        <textarea v-model="env" rows="2" placeholder="NAME=value" data-test="run-env" />
      </label>
      <label class="row">
        <span>Entrypoint</span>
        <input v-model="options.entrypoint" placeholder="image default" data-test="run-entrypoint" />
      </label>
      <label class="row">
        <span>Command</span>
        <input v-model="options.command" placeholder="image default" data-test="run-cmd" />
      </label>
      <label class="row">
        <span>Run options</span>
        <input v-model="options.runOptions" placeholder="--network my-net" data-test="run-options" />
      </label>
      <label class="row">
        <span>Pull</span>
        <select v-model="options.pull" data-test="run-pull">
          <option value="missing">Missing</option>
          <option value="always">Always</option>
          <option value="never">Never</option>
        </select>
      </label>
      <button
        v-for="option in SWITCHES"
        :key="option.key"
        type="button"
        class="option"
        :class="{ on: options[option.key] }"
        :aria-pressed="options[option.key]"
        :data-test="`run-${option.key}`"
        @click="options[option.key] = !options[option.key]"
      >
        <span class="switch" />
        <span class="option-text"><code>{{ option.flag }}</code><span class="note">{{ option.note }}</span></span>
      </button>
      <p v-for="problem in problems" :key="problem" class="note error" data-test="run-problem">{{ problem }}</p>
      <div class="buttons">
        <button type="button" data-test="run-cancel" @click="emit('close')">Cancel</button>
        <button type="button" class="primary" :disabled="problems.length > 0" data-test="run-ok" @click="run">
          Run
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
  gap: 6px;
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
.preview {
  padding: 6px 8px;
  border-radius: calc(var(--orca-radius) - 2px);
  background: var(--orca-muted);
  font-size: 11px;
  overflow-wrap: break-word;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.row.top {
  align-items: flex-start;
}
.row > span {
  flex: none;
  width: 76px;
  color: var(--orca-muted-foreground);
}
.row input,
.row select,
.row textarea {
  flex: 1;
  min-width: 0;
  font: inherit;
}
.row textarea {
  padding: 4px 8px;
  border: 1px solid var(--orca-input);
  border-radius: calc(var(--orca-radius) - 2px);
  background: transparent;
  color: inherit;
  resize: vertical;
}
.note {
  margin: 0;
  font-size: 11px;
  color: var(--orca-muted-foreground);
}
.note.error {
  color: var(--orca-destructive);
}
.option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
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
.buttons button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
