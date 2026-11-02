<script setup lang="ts">
import { computed } from 'vue'
import type { TreeContainer } from '../../shared/protocol'
import { containerDot } from '../container-state'

const props = defineProps<{ container: TreeContainer; active: boolean }>()
const emit = defineEmits<{ open: []; menu: [event: MouseEvent] }>()

const meta = computed(() => props.container.ports.join(' ') || props.container.status)
</script>

<template>
  <li>
    <button
      class="row"
      :class="{ active }"
      :title="`${container.image} · ${container.status}`"
      :data-test="`container-row-${container.name}`"
      @click="emit('open')"
      @contextmenu.prevent="emit('menu', $event)"
    >
      <span class="dot" :class="containerDot([container])" />
      <span class="name">{{ container.name }}</span>
      <span class="meta">{{ meta }}</span>
    </button>
  </li>
</template>
