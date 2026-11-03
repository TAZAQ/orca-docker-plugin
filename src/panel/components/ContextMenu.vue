<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import type { MenuEntry, MenuItem } from '../menus'
import ActionIcon from './ActionIcon.vue'

const props = defineProps<{ items: MenuEntry[]; x: number; y: number }>()
const emit = defineEmits<{ close: [] }>()

const EDGE_GAP = 4

const root = useTemplateRef<HTMLElement>('root')
const left = ref(props.x)
const top = ref(props.y)
/** The panel is narrow, so a submenu opens in place rather than beside the menu. */
const openSubmenu = ref<string | null>(null)

function enabledButtons(): HTMLButtonElement[] {
  return [...(root.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
}

function fitInPanel(): void {
  const rect = root.value?.getBoundingClientRect()
  if (rect) {
    left.value = Math.max(EDGE_GAP, Math.min(props.x, window.innerWidth - rect.width - EDGE_GAP))
    top.value = Math.max(EDGE_GAP, Math.min(props.y, window.innerHeight - rect.height - EDGE_GAP))
  }
}

function choose(item: MenuItem): void {
  if (item.children) {
    openSubmenu.value = openSubmenu.value === item.label ? null : item.label
    void nextTick(fitInPanel)
    return
  }
  emit('close')
  item.run?.()
}

function moveFocus(step: number): void {
  const buttons = enabledButtons()
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  buttons[(current + step + buttons.length) % buttons.length]?.focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    emit('close')
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveFocus(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveFocus(-1)
  }
}

function onPointerDown(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) {
    emit('close')
  }
}

function close(): void {
  emit('close')
}

onMounted(() => {
  fitInPanel()
  enabledButtons()[0]?.focus()
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('blur', close)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('blur', close)
})
</script>

<template>
  <div
    ref="root"
    class="menu"
    role="menu"
    data-test="context-menu"
    :style="{ left: `${left}px`, top: `${top}px` }"
    @keydown="onKeydown"
  >
    <template v-for="(entry, index) in items" :key="index">
      <hr v-if="entry === 'separator'" />
      <template v-else>
        <button
          class="item"
          role="menuitem"
          :disabled="entry.disabledReason !== undefined"
          :title="entry.disabledReason"
          :aria-checked="entry.checked"
          @click="choose(entry)"
        >
          <span class="glyph">
            <ActionIcon v-if="entry.checked !== undefined" v-show="entry.checked" name="check" />
            <ActionIcon v-else-if="entry.icon" :name="entry.icon" />
          </span>
          <span class="label">{{ entry.label }}</span>
          <span v-if="entry.children" class="more" :class="{ open: openSubmenu === entry.label }" />
        </button>
        <template v-if="entry.children && openSubmenu === entry.label">
          <template v-for="(child, childIndex) in entry.children" :key="childIndex">
            <hr v-if="child === 'separator'" />
            <button
              v-else
              class="item nested"
              role="menuitem"
              :disabled="child.disabledReason !== undefined"
              :title="child.disabledReason"
              @click="choose(child)"
            >
              <span class="glyph"><ActionIcon v-if="child.icon" :name="child.icon" /></span>
              <span class="label">{{ child.label }}</span>
            </button>
          </template>
        </template>
      </template>
    </template>
  </div>
</template>

<style scoped>
.menu {
  position: fixed;
  z-index: 20;
  min-width: 180px;
  max-width: calc(100vw - 8px);
  max-height: calc(100vh - 8px);
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--orca-border);
  border-radius: var(--orca-radius);
  background: var(--orca-popover);
  color: var(--orca-popover-foreground);
  box-shadow: 0 4px 16px rgb(0 0 0 / 25%);
}
hr {
  margin: 4px 2px;
  border: 0;
  border-top: 1px solid var(--orca-border);
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 3px 8px;
  border: 0;
  border-radius: calc(var(--orca-radius) - 2px);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.item.nested {
  padding-left: 22px;
}
.item:hover:not(:disabled),
.item:focus-visible {
  background: var(--orca-accent);
  color: var(--orca-accent-foreground);
  outline: 0;
}
.item:disabled {
  opacity: 0.5;
  cursor: default;
}
.glyph {
  flex: none;
  display: inline-flex;
  width: 14px;
}
.label {
  flex: 1;
  white-space: nowrap;
}
.more {
  flex: none;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid currentColor;
}
.more.open {
  transform: rotate(90deg);
}
</style>
