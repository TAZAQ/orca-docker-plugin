import { describe, expect, it, vi } from 'vitest'
import { IMAGE_REFERENCE, loadView, saveView, systemCleanupDialog } from '../src/panel/panel-dialogs'

const nothing = { containers: [], networks: [], volumes: [], images: [], buildCacheBytes: 0 }

describe('systemCleanupDialog', () => {
  it('asks nothing when nothing is unused', () => {
    expect(systemCleanupDialog(nothing, () => undefined)).toBeNull()
  })

  it('mentions volume data only when volumes go', () => {
    const containersOnly = systemCleanupDialog(
      { ...nothing, containers: [{ id: 'c', name: 'old', detail: 'Exited' }] },
      () => undefined
    )
    expect(containersOnly?.message).not.toContain('Volume data')
  })

  it('confirms with the build cache only when there is some', () => {
    const confirm = vi.fn()
    systemCleanupDialog({ ...nothing, images: [{ id: 'sha256:x', name: 'x', detail: '1 MB' }] }, confirm)?.confirm('')
    expect(confirm).toHaveBeenCalledWith({ containers: [], networks: [], volumes: [], images: ['sha256:x'], buildCache: false })
  })
})

describe('IMAGE_REFERENCE', () => {
  it.each(['postgres', 'postgres:16', 'ghcr.io/acme/api:1.4', 'redis@sha256:abc'])('accepts %s', (name) => {
    expect(IMAGE_REFERENCE.test(name)).toBe(true)
  })

  it.each(['', 'a b', 'x;rm', '-flag', '$(id)'])('refuses %j', (name) => {
    expect(IMAGE_REFERENCE.test(name)).toBe(false)
  })
})

describe('view options storage', () => {
  it('falls back to showing everything when storage refuses', () => {
    const broken = { getItem: () => { throw new Error('denied') } }
    expect(loadView(broken)).toEqual({ showStopped: true, showUntagged: true })
    expect(() =>
      saveView({ showStopped: false, showUntagged: true }, { setItem: () => { throw new Error('denied') } })
    ).not.toThrow()
  })
})
