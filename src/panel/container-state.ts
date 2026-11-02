import type { TreeContainer } from '../shared/protocol'

export function isRunning(container: TreeContainer): boolean {
  return container.state === 'running'
}

/** Paused or restarting containers exist as processes: they can be stopped but not started. */
export function isUp(container: TreeContainer): boolean {
  return ['running', 'paused', 'restarting'].includes(container.state)
}

export function hasProblem(container: TreeContainer): boolean {
  return (
    container.health === 'unhealthy' || container.state === 'restarting' || container.state === 'dead'
  )
}

/** The CSS class of a status dot summing up these containers. */
export function containerDot(containers: TreeContainer[]): 'problem' | 'running' | 'stopped' {
  if (containers.some(hasProblem)) {
    return 'problem'
  }
  return containers.some(isRunning) ? 'running' : 'stopped'
}

export function runningCount(containers: TreeContainer[]): string {
  return `${containers.filter(isRunning).length}/${containers.length}`
}

export function formatSize(bytes: number): string {
  const megabytes = bytes / 1_000_000
  return megabytes < 1000 ? `${Math.round(megabytes)} MB` : `${(megabytes / 1000).toFixed(1)} GB`
}
