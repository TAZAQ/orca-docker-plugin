<script setup lang="ts">
export type TreeIconName =
  | 'docker'
  | 'compose'
  | 'devContainers'
  | 'containers'
  | 'images'
  | 'networks'
  | 'volumes'

defineProps<{ name: TreeIconName; active?: boolean; problem?: boolean }>()

// Lucide-style 24px stroke paths, inlined so the panel stays one file.
const PATHS: Record<TreeIconName, string[]> = {
  docker: ['M3 13h18c0 4-3.5 7-9 7s-9-3-9-7z', 'M6 13V9h4v4', 'M10 13V9h4v4', 'M10 9V5h4v4'],
  compose: [
    'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z',
    'M8 8h3v3H8z',
    'M13 8h3v3h-3z',
    'M8 13h3v3H8z',
    'M13 13h3v3h-3z'
  ],
  devContainers: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M4 7.5l8 4.5 8-4.5', 'M12 12v9'],
  containers: ['M4 4h7v7H4z', 'M4 14h7v7H4z', 'M14 14h7v7h-7z'],
  images: [
    'M4 7a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0z',
    'M13 7a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0z',
    'M4 17a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0z'
  ],
  networks: ['M14 3h7v6h-7z', 'M3 15h7v6H3z', 'M17 9v6h-7', 'M7 15v-3'],
  volumes: [
    'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z',
    'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6',
    'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'
  ]
}
</script>

<template>
  <span class="icon">
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path v-for="path in PATHS[name]" :key="path" :d="path" />
    </svg>
    <span v-if="active || problem" class="badge" :class="{ problem }" />
  </span>
</template>

<style scoped>
.icon {
  position: relative;
  flex: none;
  display: inline-flex;
  color: var(--orca-muted-foreground);
}
.badge {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 7px;
  height: 7px;
  box-sizing: border-box;
  border-radius: 50%;
  border: 1px solid var(--orca-background);
  background: var(--docker-running);
}
.badge.problem {
  background: var(--orca-destructive);
}
</style>
