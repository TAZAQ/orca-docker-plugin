<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import { shellQuote } from '../../shared/compose'
import { DOCKER_NAME, NETWORK_DRIVERS, type NetworkCreateInput, type NetworkDriver } from '../../shared/protocol'

const emit = defineEmits<{ create: [input: NetworkCreateInput]; close: [] }>()

const DRIVER_NOTES: Record<NetworkDriver, string> = {
  bridge: 'The default: containers on this host',
  overlay: 'Spans hosts; needs Docker Swarm',
  macvlan: 'Gives containers their own MAC address',
  ipvlan: 'Shares the host interface by IP'
}

const OPTIONS = [
  { key: 'attachable', flag: '--attachable', note: 'Enable manual container attachment' },
  { key: 'internal', flag: '--internal', note: 'Restrict external access to the network' }
] as const

const name = ref('')
const driver = ref<NetworkDriver>('bridge')
const flags = ref({ attachable: false, internal: false })
const field = useTemplateRef<HTMLInputElement>('field')

const valid = computed(() => DOCKER_NAME.test(name.value.trim()))
/** What the person is about to run, the way the Docker CLI would spell it. */
const command = computed(() =>
  [
    'docker network create',
    ...(driver.value === 'bridge' ? [] : [`--driver ${driver.value}`]),
    ...OPTIONS.filter((option) => flags.value[option.key]).map((option) => option.flag),
    name.value.trim() === '' ? '<name>' : shellQuote(name.value.trim())
  ].join(' ')
)

function create(): void {
  if (!valid.value) {
    return
  }
  emit('close')
  emit('create', { name: name.value.trim(), driver: driver.value, ...flags.value })
}

onMounted(() => field.value?.focus())
</script>

<template>
  <div class="backdrop" data-test="network-dialog" @keydown.esc="emit('close')" @click.self="emit('close')">
    <div class="box" role="dialog" aria-modal="true" aria-label="Create Network">
      <h2 class="box-title">Create Network</h2>
      <code class="preview" data-test="network-command">{{ command }}</code>
      <input
        ref="field"
        v-model="name"
        placeholder="specify network name"
        data-test="network-name"
        @keydown.enter="create"
      />
      <label class="driver">
        <span>Driver</span>
        <select v-model="driver" data-test="network-driver">
          <option v-for="item in NETWORK_DRIVERS" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <p class="note">{{ DRIVER_NOTES[driver] }}</p>
      <div class="options">
        <button
          v-for="option in OPTIONS"
          :key="option.key"
          type="button"
          class="option"
          :class="{ on: flags[option.key] }"
          :aria-pressed="flags[option.key]"
          :data-test="`network-${option.key}`"
          @click="flags[option.key] = !flags[option.key]"
        >
          <span class="switch" />
          <span class="option-text">
            <code>{{ option.flag }}</code>
            <span class="note">{{ option.note }}</span>
          </span>
        </button>
      </div>
      <div class="buttons">
        <button type="button" data-test="network-cancel" @click="emit('close')">Cancel</button>
        <button type="button" class="primary" :disabled="!valid" data-test="network-ok" @click="create">OK</button>
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
}
.preview {
  padding: 6px 8px;
  border-radius: calc(var(--orca-radius) - 2px);
  background: var(--orca-muted);
  font-size: 11px;
  /* Wraps between flags; a flag splits only if it cannot fit a line on its own. */
  overflow-wrap: break-word;
}
.driver {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.driver select {
  flex: 1;
}
.note {
  margin: 0;
  font-size: 11px;
  color: var(--orca-muted-foreground);
}
.options {
  display: flex;
  flex-direction: column;
  gap: 4px;
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
