import type { SystemCleanupInput, SystemCleanupPreview, SystemCleanupResult } from '../shared/protocol'
import type { DialogRequest } from './components/DialogBox.vue'
import { formatSize } from './container-state'
import type { ViewOptions } from './menus'

/** Dialog wording and small view settings, kept out of App so they can be tested on their own. */

/** Roughly what `docker pull` accepts: registry, path, tag and digest. */
export const IMAGE_REFERENCE = /^[a-z0-9][a-z0-9._/:@-]{0,254}$/i

const LIST_MAX = 100
const VIEW_KEY = 'jb-containers.view'
const DEFAULT_VIEW: ViewOptions = { showStopped: true, showUntagged: true }

export function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function systemCleanupDialog(
  preview: SystemCleanupPreview,
  confirm: (input: SystemCleanupInput) => void
): DialogRequest | null {
  const groups = [
    ['container', preview.containers],
    ['network', preview.networks],
    ['volume', preview.volumes],
    ['image', preview.images]
  ] as const
  const items = groups.flatMap(([noun, list]) => list.map((item) => `${noun}: ${item.name} (${item.detail})`))
  const cache = preview.buildCacheBytes > 0
  if (items.length === 0 && !cache) {
    return null
  }
  const shown = items.slice(0, LIST_MAX)
  const parts = groups.flatMap(([noun, list]) => (list.length > 0 ? [counted(list.length, noun)] : []))
  if (cache) {
    parts.push(`${formatSize(preview.buildCacheBytes)} of build cache`)
    shown.push(`build cache: ${formatSize(preview.buildCacheBytes)}`)
  }
  const more = items.length - Math.min(items.length, LIST_MAX)
  return {
    title: 'Clean Up',
    message:
      'Remove stopped containers, unused networks and volumes, dangling images and the build cache? ' +
      `That is ${parts.join(', ')}.` +
      (preview.volumes.length > 0 ? ' Volume data is deleted for good.' : ''),
    items: more > 0 ? [...shown, `…and ${more} more`] : shown,
    confirmLabel: 'Yes',
    cancelLabel: 'No',
    danger: true,
    confirm: () =>
      confirm({
        containers: preview.containers.map((item) => item.id),
        networks: preview.networks.map((item) => item.id),
        volumes: preview.volumes.map((item) => item.id),
        images: preview.images.map((item) => item.id),
        buildCache: cache
      })
  }
}

export function systemCleanupSummary(result: SystemCleanupResult): string {
  const parts = [`Removed ${counted(result.removed, 'item')}`]
  if (result.buildCacheFreed > 0) {
    parts.push(`freed ${formatSize(result.buildCacheFreed)} of build cache`)
  }
  if (result.skipped > 0) {
    parts.push(`${result.skipped} in use again, left alone`)
  }
  if (result.failed.length > 0) {
    parts.push(`failed: ${result.failed.map((item) => `${item.name} (${item.error})`).join(', ')}`)
  }
  return parts.join('; ')
}

/** Browser storage of the panel's frame: it may be missing or refuse, and then defaults apply. */
export function loadView(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): ViewOptions {
  try {
    const stored = JSON.parse(storage?.getItem(VIEW_KEY) ?? 'null') as Partial<ViewOptions> | null
    return {
      showStopped: stored?.showStopped ?? DEFAULT_VIEW.showStopped,
      showUntagged: stored?.showUntagged ?? DEFAULT_VIEW.showUntagged
    }
  } catch {
    return DEFAULT_VIEW
  }
}

export function saveView(
  view: ViewOptions,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage
): void {
  try {
    storage?.setItem(VIEW_KEY, JSON.stringify(view))
  } catch {
    // Not remembering the choice is fine; it still applies until the panel closes.
  }
}
