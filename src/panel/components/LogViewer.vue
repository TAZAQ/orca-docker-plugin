<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { LOGS_RENEW_MS, type LogsPayload, type TreeContainer } from '../../shared/protocol'
import type { HostBridge, Subscription } from '../bridge'

const props = defineProps<{ host: HostBridge; container: TreeContainer }>()
const emit = defineEmits<{ close: [] }>()

/** Older lines go first, so a chatty container cannot eat the panel's memory. */
const MAX_LINES = 5000

const lines = ref<string[]>([])
const follow = ref(true)
const filter = ref('')
const ended = ref<string | null>(null)
const output = useTemplateRef<HTMLElement>('output')

const shownLines = computed(() => {
  const query = filter.value.trim().toLowerCase()
  return query === '' ? lines.value : lines.value.filter((line) => line.toLowerCase().includes(query))
})

let streamId: string | null = null
let closed = false
/** The start of a line still being written: the text of a chunk may end anywhere. */
let partial = ''
let renewTimer: ReturnType<typeof setInterval> | undefined
let subscription: Subscription | undefined

function appendText(text: string): void {
  const parts = (partial + text).split('\n')
  partial = parts.pop() ?? ''
  lines.value = [...lines.value, ...parts].slice(-MAX_LINES)
  if (follow.value) {
    void nextTick(() => {
      if (output.value) {
        output.value.scrollTop = output.value.scrollHeight
      }
    })
  }
}

function endStream(reason: string): void {
  ended.value = reason
  clearInterval(renewTimer)
}

function onPayload(payload: LogsPayload): void {
  if (payload.streamId !== streamId) {
    return
  }
  if (payload.kind === 'text') {
    appendText(payload.text)
  } else {
    if (partial !== '') {
      appendText('\n')
    }
    endStream(payload.error ?? 'End of logs')
  }
}

async function renew(): Promise<void> {
  try {
    if (streamId && !(await props.host.renewLogs(streamId))) {
      endStream('The stream was stopped')
    }
  } catch (error) {
    endStream(error instanceof Error ? error.message : String(error))
  }
}

onMounted(async () => {
  subscription = props.host.onLogs(onPayload)
  try {
    streamId = await props.host.startLogs(props.container.id)
  } catch (error) {
    endStream(error instanceof Error ? error.message : String(error))
    return
  }
  if (closed) {
    void props.host.stopLogs(streamId)
    return
  }
  renewTimer = setInterval(() => void renew(), LOGS_RENEW_MS)
})

onBeforeUnmount(() => {
  closed = true
  clearInterval(renewTimer)
  subscription?.dispose()
  if (streamId) {
    void props.host.stopLogs(streamId).catch(() => undefined)
  }
})
</script>

<template>
  <section class="section log-viewer">
    <div class="log-header">
      <h2 class="title log-title">{{ container.name }}</h2>
      <label class="follow"><input v-model="follow" type="checkbox" data-test="logs-follow" /> Follow</label>
      <button class="link" data-test="logs-clear" @click="lines = []">Clear</button>
      <button class="link" data-test="logs-close" @click="emit('close')">Close</button>
    </div>
    <input v-model="filter" type="search" placeholder="Filter lines" data-test="logs-filter" />
    <pre ref="output" class="log-output" data-test="logs">{{ shownLines.join('\n') }}</pre>
    <p v-if="ended" class="note" data-test="logs-ended">{{ ended }}</p>
  </section>
</template>

<style scoped>
.log-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.log-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-transform: none;
  letter-spacing: 0;
}
.follow {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--orca-muted-foreground);
}
.link {
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 12px;
  color: var(--orca-muted-foreground);
  cursor: pointer;
}
.link:hover {
  color: var(--orca-foreground);
}
.log-output {
  height: 35vh;
  margin: 0;
  padding: 6px 8px;
  overflow: auto;
  border-radius: calc(var(--orca-radius) - 2px);
  background: var(--orca-muted);
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
