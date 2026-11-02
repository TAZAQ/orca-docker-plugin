import { describe, expect, it, vi } from 'vitest'
import { TerminalLauncher, type FocusedContext } from '../src/worker/terminal-launcher'

function setup(context: FocusedContext, worktrees: unknown[] = []) {
  const calls: string[][] = []
  const cli = vi.fn(async (args: string[]) => {
    calls.push(args)
    if (args[1] === 'show') {
      return { terminal: { worktreeId: 'repo::/work' } }
    }
    if (args[1] === 'create') {
      return { terminal: { handle: 'term_new' } }
    }
    return args[0] === 'worktree' ? { worktrees } : {}
  })
  let current = context
  const launcher = new TerminalLauncher({ cli, readContext: async () => current })
  return { calls, launcher, focus: (value: FocusedContext) => (current = value) }
}

const focused = { displayName: 'master', branch: 'master', terminals: [{ id: 'term_1' }] }
const shell = { title: 'web sh', command: 'docker exec -it web sh', reuseKey: 'sh:web' }

describe('TerminalLauncher', () => {
  it('opens the command in a new focused tab of the workspace in focus', async () => {
    const { calls, launcher } = setup(focused)
    await launcher.open({ title: 'shop pull', command: 'docker compose pull' })
    expect(calls).toEqual([
      ['terminal', 'show', '--terminal', 'term_1'],
      [
        'terminal',
        'create',
        '--worktree',
        'id:repo::/work',
        '--title',
        'shop pull',
        '--command',
        'docker compose pull',
        '--focus'
      ]
    ])
  })

  it('never reuses a terminal for a one-off command', async () => {
    const { calls, launcher, focus } = setup(focused)
    await launcher.open({ title: 'pull', command: 'docker pull x' })
    focus({ ...focused, terminals: [...focused.terminals, { id: 'term_new' }] })
    await launcher.open({ title: 'pull', command: 'docker pull x' })
    expect(calls.filter((args) => args[1] === 'create')).toHaveLength(2)
  })

  it('returns to the open shell of a container', async () => {
    const { calls, launcher, focus } = setup(focused)
    await launcher.open(shell)
    focus({ ...focused, terminals: [...focused.terminals, { id: 'term_new' }] })
    await launcher.open(shell)
    expect(calls.at(-1)).toEqual(['terminal', 'switch', '--terminal', 'term_new'])
    expect(calls.filter((args) => args[1] === 'create')).toHaveLength(1)
  })

  it('opens a new shell when the old one was closed', async () => {
    const { calls, launcher } = setup(focused)
    await launcher.open(shell)
    await launcher.open(shell)
    expect(calls.filter((args) => args[1] === 'create')).toHaveLength(2)
  })

  it('finds a workspace with no terminals by its name and branch', async () => {
    const { calls, launcher } = setup({ ...focused, terminals: [] }, [
      { id: 'a::/one', displayName: 'master', branch: 'refs/heads/master' },
      { id: 'b::/two', displayName: 'other', branch: 'refs/heads/master' }
    ])
    await launcher.open({ title: 't', command: 'c' })
    expect(calls.at(-1)).toContain('id:a::/one')
  })

  it('refuses to guess between workspaces of the same name', async () => {
    const twin = { displayName: 'master', branch: 'refs/heads/master' }
    const { calls, launcher } = setup({ ...focused, terminals: [] }, [
      { id: 'a::/one', ...twin },
      { id: 'b::/two', ...twin }
    ])
    await expect(launcher.open({ title: 't', command: 'c' })).rejects.toThrow('Open any terminal')
    expect(calls.some((args) => args[1] === 'create')).toBe(false)
  })

  it('says when no workspace is in focus', async () => {
    const { launcher } = setup(null)
    await expect(launcher.open({ title: 't', command: 'c' })).rejects.toThrow('No workspace')
  })
})
