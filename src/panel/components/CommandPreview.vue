<script setup lang="ts">
import { computed } from 'vue'

/** A command line that wraps only between its arguments: a browser would also break after a hyphen. */

const props = defineProps<{ command: string }>()

const words = computed(() => props.command.split(' '))
</script>

<template>
  <code class="preview"
    ><template v-for="(word, index) in words" :key="index"
      ><span class="word">{{ word }}</span>{{ index < words.length - 1 ? ' ' : '' }}</template
    ></code
  >
</template>

<style scoped>
.preview {
  padding: 6px 8px;
  border-radius: calc(var(--orca-radius) - 2px);
  background: var(--orca-muted);
  font-size: 11px;
}
.word {
  white-space: nowrap;
}
</style>
