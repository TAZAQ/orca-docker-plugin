import { describe, expect, it } from 'vitest'
import { formatStatus, NOTIFICATION_BODY_MAX, summarizeProjects } from '../src/worker/compose-status'
import type { DockerContainer } from '../src/worker/docker-api'

function container(name: string, State: string, Status: string, project?: string): DockerContainer {
  const Labels: Record<string, string> = project
    ? { 'com.docker.compose.project': project, 'com.docker.compose.service': name }
    : {}
  return { Id: `${name}-id-0000000000`, Names: [`/${name}`], State, Status, Image: 'nginx', Ports: [], Labels }
}

describe('summarizeProjects', () => {
  it('groups by compose project and lists what is wrong', () => {
    const projects = summarizeProjects([
      container('redis', 'running', 'Up 2 hours', 'medods'),
      container('postgres', 'running', 'Up 2 hours (unhealthy)', 'medods'),
      container('kafka', 'restarting', 'Restarting (1) 3 seconds ago', 'medods'),
      container('mongo', 'exited', 'Exited (0) 3 minutes ago', 'medods'),
      container('netrika_proxy', 'running', 'Up 1 hour'),
      container('analytics', 'running', 'Up 5 minutes', 'alpha')
    ])
    expect(projects).toEqual([
      { project: 'alpha', running: 1, total: 1, problems: [] },
      { project: 'medods', running: 2, total: 4, problems: ['postgres unhealthy', 'kafka restarting'] },
      { project: '(standalone)', running: 1, total: 1, problems: [] }
    ])
    expect(formatStatus(projects)).toBe(
      'alpha: 1/1 running\nmedods: 2/4 running — postgres unhealthy, kafka restarting\n(standalone): 1/1 running'
    )
  })

  it('fits the notification body limit', () => {
    const many = Array.from({ length: 200 }, (_, i) => container(`service_${i}`, 'restarting', 'Restarting (1)', 'big'))
    expect(formatStatus(summarizeProjects(many)).length).toBe(NOTIFICATION_BODY_MAX)
    expect(formatStatus([])).toBe('No containers')
  })
})
