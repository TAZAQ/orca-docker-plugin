<script setup lang="ts">
export type IconName = 'play' | 'restart' | 'stop' | 'down' | 'logs' | 'terminal' | 'build' | 'remove' | 'pause' | 'deploy' | 'copy' | 'search' | 'source' | 'add'

defineProps<{ name: IconName }>()

// Lucide-style 24px stroke paths, inlined because panels cannot load assets.
const PATHS: Record<IconName, string[]> = {
  play: ['M6 4l14 8-14 8z'],
  restart: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5'],
  stop: ['M6 6h12v12H6z'],
  down: ['M12 4v12', 'M6 10l6 6 6-6', 'M4 20h16'],
  logs: ['M4 6h16', 'M4 12h16', 'M4 18h10'],
  terminal: ['M4 17l6-6-6-6', 'M12 19h8'],
  build: ['M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-3-3z'],
  remove: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  pause: ['M8 5v14', 'M16 5v14'],
  deploy: ['M4 12h14', 'M14 7l5 5-5 5', 'M5 5h6', 'M5 19h6'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  source: ['M4 20l1-4L16 5l3 3L8 19z'],
  add: ['M12 5v14', 'M5 12h14']
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
