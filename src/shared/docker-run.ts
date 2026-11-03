import { shellQuote } from './compose'

/** `docker run` and `docker push` from the options of a JetBrains Docker Image run configuration. */

export type RunOptions = {
  image: string
  /** Empty lets Docker pick a name. */
  name: string
  /** -P: every exposed port on a random host port. */
  publishAll: boolean
  /** One `-p` each, such as `8080:80` or `127.0.0.1:5432:5432/udp`. */
  ports: string[]
  /** One `-v` each, such as `/srv/data:/data:ro` or `pgdata:/var/lib/postgresql/data`. */
  volumes: string[]
  /** One `-e` each, as NAME=value. */
  env: string[]
  entrypoint: string
  /** Typed by the person and passed on as written, like the Command field. */
  command: string
  /** Other `docker run` options, passed on as written, like Run options. */
  runOptions: string
  pull: 'missing' | 'always' | 'never'
  detach: boolean
  autoRemove: boolean
}

export const DEFAULT_RUN: Omit<RunOptions, 'image'> = {
  name: '',
  publishAll: false,
  ports: [],
  volumes: [],
  env: [],
  entrypoint: '',
  command: '',
  runOptions: '',
  pull: 'missing',
  detach: true,
  autoRemove: false
}

export const PORT_BINDING = /^((\d{1,3}\.){3}\d{1,3}:)?(\d{1,5}(-\d{1,5})?:)?\d{1,5}(-\d{1,5})?(\/(tcp|udp|sctp))?$/
export const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** Every structured field is quoted; the two free-text fields go in as written, as in JetBrains IDEs. */
export function dockerRunCommand(options: RunOptions): string {
  const structured = [
    'docker',
    'run',
    ...(options.detach ? ['-d'] : []),
    ...(options.autoRemove ? ['--rm'] : []),
    ...(options.name.trim() === '' ? [] : ['--name', options.name.trim()]),
    ...(options.publishAll ? ['-P'] : []),
    ...options.ports.flatMap((port) => ['-p', port]),
    ...options.volumes.flatMap((volume) => ['-v', volume]),
    ...options.env.flatMap((pair) => ['-e', pair]),
    ...(options.entrypoint.trim() === '' ? [] : ['--entrypoint', options.entrypoint.trim()]),
    ...(options.pull === 'missing' ? [] : [`--pull=${options.pull}`])
  ].map(shellQuote)
  return [
    ...structured,
    ...(options.runOptions.trim() === '' ? [] : [options.runOptions.trim()]),
    shellQuote(options.image),
    ...(options.command.trim() === '' ? [] : [options.command.trim()])
  ].join(' ')
}

/** Tags first when the target is a new name, as Push Image does. */
export function dockerPushCommand(source: string, target: string): string {
  const push = ['docker', 'push', target].map(shellQuote).join(' ')
  return source === target ? push : `${['docker', 'tag', source, target].map(shellQuote).join(' ')} && ${push}`
}
