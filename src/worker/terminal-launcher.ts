import type { OpenTerminalInput } from '../shared/protocol'
import type { OrcaCli } from './orca-cli'

/** Opens commands in terminals of the workspace in focus, each in a tab of its own. */

export type FocusedContext = {
  branch: string
  displayName: string
  terminals: { id: string }[]
} | null

type Worktree = { id: string; displayName: string; branch: string }

export type TerminalLauncherOptions = {
  cli: OrcaCli
  readContext: () => Promise<FocusedContext>
}

export class TerminalLauncher {
  private readonly reusable = new Map<string, string>()

  constructor(private readonly options: TerminalLauncherOptions) {}

  async open({ title, command, reuseKey }: OpenTerminalInput): Promise<void> {
    const context = await this.options.readContext()
    if (!context) {
      throw new Error('No workspace is in focus')
    }
    const known = reuseKey === undefined ? undefined : this.reusable.get(reuseKey)
    if (known && context.terminals.some((terminal) => terminal.id === known)) {
      await this.options.cli(['terminal', 'switch', '--terminal', known])
      return
    }
    const worktree = await this.focusedWorktree(context)
    const created = (await this.options.cli([
      'terminal',
      'create',
      '--worktree',
      `id:${worktree}`,
      '--title',
      title,
      '--command',
      command,
      '--focus'
    ])) as { terminal: { handle: string } }
    if (reuseKey !== undefined) {
      this.reusable.set(reuseKey, created.terminal.handle)
    }
  }

  /** Plugins are told the focused workspace only by name, and two workspaces may share a name. */
  private async focusedWorktree(context: NonNullable<FocusedContext>): Promise<string> {
    const [first] = context.terminals
    if (first) {
      const shown = (await this.options.cli(['terminal', 'show', '--terminal', first.id])) as {
        terminal: { worktreeId: string }
      }
      return shown.terminal.worktreeId
    }
    const { worktrees } = (await this.options.cli(['worktree', 'list'])) as { worktrees: Worktree[] }
    const matching = worktrees.filter(
      (worktree) =>
        worktree.displayName === context.displayName &&
        worktree.branch.replace('refs/heads/', '') === context.branch
    )
    const [only] = matching
    if (matching.length === 1 && only) {
      return only.id
    }
    throw new Error('Open any terminal in this workspace first: its name is not unique')
  }
}
