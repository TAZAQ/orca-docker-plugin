<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { ContainerAction, TreeContainer } from '../../shared/protocol'
import ActionIcon from './ActionIcon.vue'

const props = defineProps<{ container: TreeContainer; busy: boolean }>()
const emit = defineEmits<{ action: [action: ContainerAction]; shell: []; logs: [] }>()

const CONFIRM_MS = 4000

const running = computed(() => props.container.state === 'running')
const confirmingRemove = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | undefined

function remove(): void {
  if (!confirmingRemove.value) {
    // Sandboxed panels cannot open confirm() dialogs, so removing asks for a second click.
    confirmingRemove.value = true
    confirmTimer = setTimeout(() => (confirmingRemove.value = false), CONFIRM_MS)
    return
  }
  clearTimeout(confirmTimer)
  confirmingRemove.value = false
  emit('action', 'remove')
}

onBeforeUnmount(() => clearTimeout(confirmTimer))
</script>

<template>
  <span class="actions" @click.stop>
    <button title="Show logs" data-test="action-logs" @click="emit('logs')">
      <ActionIcon name="logs" />
    </button>
    <template v-if="running">
      <button title="Stop" :disabled="busy" data-test="action-stop" @click="emit('action', 'stop')">
        <ActionIcon name="stop" />
      </button>
      <button title="Restart" :disabled="busy" data-test="action-restart" @click="emit('action', 'restart')">
        <ActionIcon name="restart" />
      </button>
      <button title="Open a shell in the terminal" data-test="action-shell" @click="emit('shell')">
        <ActionIcon name="terminal" />
      </button>
    </template>
    <template v-else>
      <button title="Start" :disabled="busy" data-test="action-start" @click="emit('action', 'start')">
        <ActionIcon name="play" />
      </button>
      <button
        :class="{ danger: confirmingRemove }"
        :title="confirmingRemove ? 'Click again to remove' : 'Remove'"
        :disabled="busy"
        data-test="action-remove"
        @click="remove"
      >
        <ActionIcon name="remove" />
      </button>
    </template>
  </span>
</template>

<style scoped>
.actions {
  flex: none;
  gap: 1px;
  margin-left: auto;
}
button {
  display: inline-flex;
  padding: 2px 3px;
  border: 0;
  border-radius: calc(var(--orca-radius) - 2px);
  background: transparent;
  cursor: pointer;
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
}
</style>
