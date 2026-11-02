<script setup lang="ts">
export type IconName = 'play' | 'restart' | 'stop' | 'down' | 'logs' | 'terminal' | 'build'

defineProps<{ name: IconName }>()

// Lucide-style 24px stroke paths, inlined because panels cannot load assets.
const PATHS: Record<IconName, string[]> = {
  play: ['M6 4l14 8-14 8z'],
  restart: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5'],
  stop: ['M6 6h12v12H6z'],
  down: ['M12 4v12', 'M6 10l6 6 6-6', 'M4 20h16'],
  logs: ['M4 6h16', 'M4 12h16', 'M4 18h10'],
  terminal: ['M4 17l6-6-6-6', 'M12 19h8'],
  build: ['M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-3-3z']
}
</script>

<template>
  <svg
    class="icon"
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="d in PATHS[name]" :key="d" :d="d" />
  </svg>
</template>

<style scoped>
.icon {
  flex: none;
}
</style>
