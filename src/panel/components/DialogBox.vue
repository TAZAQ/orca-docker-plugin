<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'

export type DialogRequest = {
  title: string
  message: string
  /** Named things the action touches, shown as a list. */
  items?: string[]
  confirmLabel: string
  /** "Cancel" unless set. */
  cancelLabel?: string
  danger?: boolean
  input?: {
    placeholder: string
    /** The fixed start of the command, shown before the field. */
    prefix?: string
    /** OK stays off until the value matches. */
    pattern?: RegExp
    /** Offers completions for what has been typed so far. */
    suggest?: (text: string) => Promise<string[]>
  }
  confirm(value: string): void
}

const props = defineProps<{ request: DialogRequest }>()
const emit = defineEmits<{ close: [] }>()

const SUGGEST_DELAY_MS = 300

const value = ref('')
const suggestions = ref<string[]>([])
let suggestTimer: ReturnType<typeof setTimeout> | undefined

watch(value, (text) => {
  const suggest = props.request.input?.suggest
  clearTimeout(suggestTimer)
  if (!suggest || text.trim().length < 2) {
    suggestions.value = []
    return
  }
  suggestTimer = setTimeout(() => {
    suggest(text.trim())
      .then((found) => {
        if (value.value === text) {
          suggestions.value = found
        }
      })
      .catch(() => (suggestions.value = []))
  }, SUGGEST_DELAY_MS)
})

onBeforeUnmount(() => clearTimeout(suggestTimer))
const cancel = useTemplateRef<HTMLButtonElement>('cancel')
const field = useTemplateRef<HTMLInputElement>('field')

const valid = computed(() => {
  const input = props.request.input
  if (!input) {
    return true
  }
  const text = value.value.trim()
  return text !== '' && (input.pattern?.test(text) ?? true)
})

function confirm(): void {
  if (!valid.value) {
    return
  }
  emit('close')
  props.request.confirm(value.value.trim())
}

// Cancel takes the focus, so Enter alone can never confirm something destructive.
onMounted(() => (props.request.input ? field.value : cancel.value)?.focus())
</script>

<template>
  <div class="backdrop" data-test="dialog" @keydown.esc="emit('close')" @click.self="emit('close')">
    <div class="box" role="alertdialog" aria-modal="true">
      <h2 class="box-title">{{ request.title }}</h2>
      <p class="box-message" data-test="dialog-message">{{ request.message }}</p>
      <ul v-if="request.items?.length" class="box-items" data-test="dialog-items">
        <li v-for="item in request.items" :key="item">{{ item }}</li>
      </ul>
      <label v-if="request.input" class="box-field">
        <code v-if="request.input.prefix" class="box-prefix">{{ request.input.prefix }}</code>
        <input
          ref="field"
          v-model="value"
          :placeholder="request.input.placeholder"
          :list="request.input.suggest ? 'dialog-suggestions' : undefined"
          data-test="dialog-input"
          @keydown.enter="confirm"
        />
        <datalist v-if="request.input.suggest" id="dialog-suggestions" data-test="dialog-suggestions">
          <option v-for="item in suggestions" :key="item" :value="item" />
        </datalist>
      </label>
      <div class="box-buttons">
        <button ref="cancel" data-test="dialog-cancel" @click="emit('close')">
          {{ request.cancelLabel ?? 'Cancel' }}
        </button>
        <button
          :class="{ danger: request.danger }"
          :disabled="!valid"
          data-test="dialog-confirm"
          @click="confirm"
        >
          {{ request.confirmLabel }}
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
.box-message {
  margin: 0;
  font-size: 12px;
}
.box-items {
  max-height: 30vh;
  margin: 0;
  padding-left: 16px;
  overflow-y: auto;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.box-field {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.box-field input {
  flex: 1;
  min-width: 120px;
}
.box-prefix {
  font-size: 11px;
  color: var(--orca-muted-foreground);
}
.box-buttons button:disabled {
  opacity: 0.5;
  cursor: default;
}
.box-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.box-buttons button {
  padding: 4px 10px;
  border: 1px solid var(--orca-border);
  border-radius: calc(var(--orca-radius) - 2px);
  background: var(--orca-secondary);
  color: var(--orca-secondary-foreground);
  cursor: pointer;
}
.box-buttons button.danger {
  border-color: var(--orca-destructive);
  background: var(--orca-destructive);
  color: var(--orca-destructive-foreground);
}
</style>
