<script setup lang="ts">
import { computed } from 'vue'
import type { ContainerAction, TreeContainer } from '../../shared/protocol'
import { containerDot } from '../container-state'
import ContainerActions from './ContainerActions.vue'

const props = defineProps<{ container: TreeContainer; busy: boolean }>()
const emit = defineEmits<{ action: [action: ContainerAction]; shell: [] }>()

const meta = computed(() => props.container.ports.join(' ') || props.container.status)
</script>

<template>
  <li class="line" :title="`${container.image} · ${container.status}`">
    <span class="row static">
      <span class="dot" :class="containerDot([container])" />
      <span class="name">{{ container.name }}</span>
      <span class="meta">{{ meta }}</span>
    </span>
    <ContainerActions
      :container="container"
      :busy="busy"
      @action="(action) => emit('action', action)"
      @shell="emit('shell')"
    />
  </li>
</template>
