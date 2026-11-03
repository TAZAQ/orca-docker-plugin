<script setup lang="ts">
import type { Dashboard } from '../../shared/protocol'

defineProps<{ dashboard: Dashboard | null; error: string | null }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <section class="section dashboard" data-test="dashboard">
    <div class="dash-header">
      <h2 class="dash-title">{{ dashboard?.title ?? 'Dashboard' }}</h2>
      <button class="dash-close" data-test="dashboard-close" @click="emit('close')">Close</button>
    </div>
    <p v-if="error" class="dash-note error" data-test="dashboard-error">{{ error }}</p>
    <p v-else-if="!dashboard" class="dash-note">Loading…</p>
    <template v-else>
      <dl class="fields">
        <template v-for="field in dashboard.fields.filter((item) => item.value !== '')" :key="field.label">
          <dt>{{ field.label }}</dt>
          <dd>{{ field.value }}</dd>
        </template>
      </dl>
      <details v-for="table in dashboard.tables" :key="table.title" class="table" :open="table.rows.length <= 12">
        <summary>{{ table.title }} <span class="count">{{ table.rows.length }}</span></summary>
        <p v-if="table.rows.length === 0" class="dash-note">None</p>
        <table v-else>
          <thead>
            <tr>
              <th v-for="column in table.columns" :key="column">{{ column }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in table.rows" :key="index">
              <td v-for="(cell, column) in row" :key="column">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </template>
  </section>
</template>

<style scoped>
.dash-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dash-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dash-close {
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 12px;
  color: var(--orca-muted-foreground);
  cursor: pointer;
}
.dash-close:hover {
  color: var(--orca-foreground);
}
.dash-note {
  margin: 0;
  font-size: 12px;
  color: var(--orca-muted-foreground);
}
.dash-note.error {
  color: var(--orca-destructive);
}
.fields {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 10px;
  margin: 0;
  font-size: 12px;
}
.fields dt {
  color: var(--orca-muted-foreground);
}
.fields dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.table summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}
.count {
  font-weight: 400;
  color: var(--orca-muted-foreground);
}
table {
  width: 100%;
  margin-top: 4px;
  border-collapse: collapse;
  font-size: 11px;
  table-layout: fixed;
}
th {
  text-align: left;
  font-weight: 500;
  color: var(--orca-muted-foreground);
}
th,
td {
  padding: 2px 4px;
  border-bottom: 1px solid var(--orca-border);
  overflow-wrap: anywhere;
  vertical-align: top;
}
</style>
