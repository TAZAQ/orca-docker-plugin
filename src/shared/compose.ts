/** Builds the `docker compose` command lines the panel types into a terminal. */

export type ComposeTarget = {
  /** `-p`; empty means compose derives it from the directory. */
  projectName: string
  /** `-f`, in order; empty means compose looks for compose.yaml in the cwd. */
  files: string[]
  /** `--profile`. */
  profiles: string[]
}

export type ProjectAction = 'up' | 'restart' | 'stop' | 'down' | 'ps' | 'logs' | 'pull' | 'build'
export type ServiceAction = 'up' | 'restart' | 'stop' | 'logs' | 'shell' | 'rebuild'

export const LOG_TAIL_LINES = 200

const PROJECT_ARGS: Record<ProjectAction, string[]> = {
  up: ['up', '-d'],
  restart: ['restart'],
  stop: ['stop'],
  down: ['down'],
  ps: ['ps', '-a'],
  logs: ['logs', '-f', '--tail', String(LOG_TAIL_LINES)],
  pull: ['pull'],
  build: ['build']
}

const SERVICE_ARGS: Record<ServiceAction, string[]> = {
  up: ['up', '-d'],
  restart: ['restart'],
  stop: ['stop'],
  logs: ['logs', '-f', '--tail', String(LOG_TAIL_LINES)],
  shell: ['exec'],
  rebuild: ['up', '-d', '--build']
}

const SAFE_ARG = /^[A-Za-z0-9_@%+=:,./-]+$/

/** POSIX single-quote quoting; the terminal is assumed to run a POSIX shell. */
export function shellQuote(arg: string): string {
  if (arg !== '' && SAFE_ARG.test(arg)) {
    return arg
  }
  return `'${arg.replaceAll("'", `'\\''`)}'`
}

/** Splits a free-form field ("a.yml, b.yml" or one per line) into non-empty items. */
export function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function targetArgs(target: ComposeTarget): string[] {
  const args: string[] = []
  const projectName = target.projectName.trim()
  if (projectName !== '') {
    args.push('-p', projectName)
  }
  for (const file of target.files) {
    args.push('-f', file)
  }
  for (const profile of target.profiles) {
    args.push('--profile', profile)
  }
  return args
}

function render(args: string[]): string {
  return ['docker', 'compose', ...args].map(shellQuote).join(' ')
}

export function projectCommand(target: ComposeTarget, action: ProjectAction): string {
  return render([...targetArgs(target), ...PROJECT_ARGS[action]])
}

export function serviceCommand(
  target: ComposeTarget,
  action: ServiceAction,
  service: string
): string {
  const name = service.trim()
  if (name === '') {
    throw new Error('service name is required')
  }
  const tail = action === 'shell' ? [name, 'sh'] : [name]
  return render([...targetArgs(target), ...SERVICE_ARGS[action], ...tail])
}
