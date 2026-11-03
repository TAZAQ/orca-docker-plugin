/** Builds the `docker compose` command lines the panel types into a terminal. */

export type ComposeTarget = {
  /** `-p`; empty means compose derives it from the directory. */
  projectName: string
  /** `-f`, in order; empty means compose looks for compose.yaml in the cwd. */
  files: string[]
}

export type ProjectAction = 'up' | 'start' | 'restart' | 'stop' | 'down' | 'ps' | 'logs' | 'pull' | 'build'
export type ServiceAction = 'up' | 'restart' | 'stop' | 'logs' | 'shell' | 'rebuild'

export const LOG_TAIL_LINES = 200

const PROJECT_ARGS: Record<ProjectAction, string[]> = {
  up: ['up', '-d'],
  start: ['start'],
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

function targetArgs(target: ComposeTarget): string[] {
  const args: string[] = []
  const projectName = target.projectName.trim()
  if (projectName !== '') {
    args.push('-p', projectName)
  }
  for (const file of target.files) {
    args.push('-f', file)
  }
  return args
}

function render(args: string[]): string {
  return ['docker', 'compose', ...args].map(shellQuote).join(' ')
}

export function containerShellCommand(container: string, shell = 'sh', user?: string): string {
  const as = user ? ['-u', user] : []
  return ['docker', 'exec', '-it', ...as, container, shell].map(shellQuote).join(' ')
}

/** The command itself is what the person typed, so it stays as they wrote it. */
export function containerExecCommand(container: string, command: string): string {
  return `${['docker', 'exec', '-it', container].map(shellQuote).join(' ')} ${command.trim()}`
}

/** Without --sig-proxy=false, Ctrl+C in the terminal would stop the container. */
export function containerAttachCommand(container: string): string {
  return ['docker', 'attach', '--sig-proxy=false', container].map(shellQuote).join(' ')
}

export function imagePullCommand(image: string): string {
  return ['docker', 'pull', image].map(shellQuote).join(' ')
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

/** The options of a Docker Compose run configuration in JetBrains IDEs that `up` understands. */
export type DeployOptions = {
  /** Empty means every service. */
  services: string[]
  profiles: string[]
  envFiles: string[]
  build: 'missing' | 'never' | 'always'
  recreate: 'changed' | 'all' | 'none'
  removeOrphans: boolean
  /** -V: new anonymous volumes instead of the old data. */
  renewAnonVolumes: boolean
  alwaysRecreateDeps: boolean
}

export type DownOptions = {
  /** -v: named and anonymous volumes go too, with their data. */
  removeVolumes: boolean
  removeImages: 'none' | 'local' | 'all'
  removeOrphans: boolean
  /** Seconds before a container is killed; empty keeps Compose's default. */
  timeout: number | null
}

export const DEFAULT_DEPLOY: DeployOptions = {
  services: [],
  profiles: [],
  envFiles: [],
  build: 'missing',
  recreate: 'changed',
  removeOrphans: false,
  renewAnonVolumes: false,
  alwaysRecreateDeps: false
}

export const DEFAULT_DOWN: DownOptions = {
  removeVolumes: false,
  removeImages: 'none',
  removeOrphans: false,
  timeout: null
}

/** Profiles and env files are options of `docker compose` itself, so they go before `up`. */
function globalArgs(target: ComposeTarget, profiles: string[], envFiles: string[]): string[] {
  return [
    ...targetArgs(target),
    ...profiles.flatMap((profile) => ['--profile', profile]),
    ...envFiles.flatMap((file) => ['--env-file', file])
  ]
}

export function composeUpCommand(target: ComposeTarget, options: DeployOptions): string {
  return render([
    ...globalArgs(target, options.profiles, options.envFiles),
    'up',
    '-d',
    ...{ missing: [], never: ['--no-build'], always: ['--build'] }[options.build],
    ...{ changed: [], all: ['--force-recreate'], none: ['--no-recreate'] }[options.recreate],
    ...(options.removeOrphans ? ['--remove-orphans'] : []),
    ...(options.renewAnonVolumes ? ['-V'] : []),
    ...(options.alwaysRecreateDeps ? ['--always-recreate-deps'] : []),
    ...options.services
  ])
}

export function composeDownCommand(target: ComposeTarget, options: DownOptions): string {
  return render([
    ...targetArgs(target),
    'down',
    ...(options.removeVolumes ? ['-v'] : []),
    ...(options.removeImages === 'none' ? [] : ['--rmi', options.removeImages]),
    ...(options.removeOrphans ? ['--remove-orphans'] : []),
    ...(options.timeout === null ? [] : ['-t', String(options.timeout)])
  ])
}

/** --no-recreate leaves the running containers of the service as they are. */
export function composeScaleCommand(target: ComposeTarget, service: string, count: number): string {
  return render([...targetArgs(target), 'up', '-d', '--no-recreate', '--scale', `${service}=${count}`, service])
}
