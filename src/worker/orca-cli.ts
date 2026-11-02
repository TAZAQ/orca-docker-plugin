import { execFile } from 'node:child_process'
import { join } from 'node:path'

/** Runs the Orca CLI. A plugin has no host method to open a terminal yet, but the CLI does. */

export type OrcaCli = (args: string[]) => Promise<unknown>

const CLI_TIMEOUT_MS = 15_000

class CliNotFound extends Error {}

function run(file: string, args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args, '--json'], { timeout: CLI_TIMEOUT_MS }, (error, stdout) => {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
        reject(new CliNotFound(file))
        return
      }
      try {
        const answer = JSON.parse(stdout) as {
          ok: boolean
          result?: unknown
          error?: { message: string }
        }
        if (answer.ok) {
          resolve(answer.result)
        } else {
          reject(new Error(answer.error?.message ?? 'orca failed'))
        }
      } catch {
        reject(error ?? new Error('orca gave an unreadable answer'))
      }
    })
  })
}

/** Never plain `orca`: on Linux desktops that is usually the GNOME screen reader. */
export function orcaCli(home: string): OrcaCli {
  const candidates = ['orca-ide', join(home, '.config/orca/linux-orca-cli-shim/orca')]
  return async (args) => {
    for (const file of candidates) {
      try {
        return await run(file, args)
      } catch (error) {
        if (!(error instanceof CliNotFound)) {
          throw error
        }
      }
    }
    throw new Error('The Orca command line tool was not found')
  }
}
