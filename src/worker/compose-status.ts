import type { DockerContainer } from './docker-api'

export const PROJECT_LABEL = 'com.docker.compose.project'
export const SERVICE_LABEL = 'com.docker.compose.service'

export type ProjectStatus = {
  project: string
  running: number
  total: number
  /** Containers that are unhealthy, crash-looping or dead; plain stopped ones are not a problem. */
  problems: string[]
}

const STANDALONE = '(standalone)'

function containerName(container: DockerContainer): string {
  return container.Labels[SERVICE_LABEL] ?? container.Names[0]?.replace(/^\//, '') ?? container.Id.slice(0, 12)
}

export function summarizeProjects(containers: DockerContainer[]): ProjectStatus[] {
  const byProject = new Map<string, ProjectStatus>()
  for (const container of containers) {
    const project = container.Labels[PROJECT_LABEL] ?? STANDALONE
    const status = byProject.get(project) ?? { project, running: 0, total: 0, problems: [] }
    status.total += 1
    if (container.State === 'running') {
      status.running += 1
      if (container.Status.includes('(unhealthy)')) {
        status.problems.push(`${containerName(container)} unhealthy`)
      }
    } else if (container.State === 'restarting' || container.State === 'dead') {
      status.problems.push(`${containerName(container)} ${container.State}`)
    }
    byProject.set(project, status)
  }
  return [...byProject.values()].sort(
    (a, b) => Number(a.project === STANDALONE) - Number(b.project === STANDALONE) || a.project.localeCompare(b.project)
  )
}

/** notifications.show caps the body at 1000 characters. */
export const NOTIFICATION_BODY_MAX = 1000

export function formatStatus(projects: ProjectStatus[]): string {
  if (projects.length === 0) {
    return 'No containers'
  }
  const lines = projects.map((status) => {
    const head = `${status.project}: ${status.running}/${status.total} running`
    return status.problems.length === 0 ? head : `${head} — ${status.problems.join(', ')}`
  })
  const text = lines.join('\n')
  return text.length <= NOTIFICATION_BODY_MAX ? text : `${text.slice(0, NOTIFICATION_BODY_MAX - 1)}…`
}
