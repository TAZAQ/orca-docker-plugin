<script setup lang="ts">
import { computed, ref, watch } from 'vue'

export type Details = {
  title: string
  text: string
  loading: boolean
  /** Set for a listing that can move to another path. */
  browse?: { path: string; open(path: string): void }
}

const props = defineProps<{ details: Details }>()
const emit = defineEmits<{ close: [] }>()

const filter = ref('')
const path = ref(props.details.browse?.path ?? '')
watch(
  () => props.details.browse?.path,
  (value) => (path.value = value ?? '')
)

const shownText = computed(() => {
  const query = filter.value.trim().toLowerCase()
  if (query === '') {
    return props.details.text
  }
  return props.details.text
    .split('\n')
    .filter((line) => line.toLowerCase().includes(query))
    .join('\n')
})

function openPath(): void {
  const target = path.value.trim()
  if (target.startsWith('/')) {
    props.details.browse?.open(target)
  }
}
</script>

<template>
  <section class="section">
    <div class="details-header">
      <h2 class="details-title">{{ details.title }}</h2>
      <button class="details-close" data-test="details-close" @click="emit('close')">Close</button>
    </div>
    <input
      v-if="details.browse"
      v-model="path"
      placeholder="/absolute/path"
      data-test="details-path"
      @keydown.enter="openPath"
    />
    <input v-model="filter" type="search" placeholder="Filter lines" data-test="details-filter" />
    <p v-if="details.loading" class="details-note">Loading…</p>
    <pre v-else class="details-output" data-test="details-text">{{ shownText }}</pre>
  </section>
</template>

<style scoped>
.details-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.details-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  color: var(--orca-muted-foreground);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.details-close {
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 12px;
  color: var(--orca-muted-foreground);
  cursor: pointer;
}
.details-close:hover {
  color: var(--orca-foreground);
}
.details-note {
  margin: 0;
  font-size: 12px;
  color: var(--orca-muted-foreground);
}
.details-output {
  max-height: 35vh;
  margin: 0;
  padding: 6px 8px;
  overflow: auto;
  border-radius: calc(var(--orca-radius) - 2px);
  background: var(--orca-muted);
  font-size: 11px;
  line-height: 1.4;
}
</style>
