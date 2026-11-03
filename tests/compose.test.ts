import { describe, expect, it } from 'vitest'
import {
  composeDownCommand,
  composeScaleCommand,
  composeUpCommand,
  DEFAULT_DEPLOY,
  DEFAULT_DOWN,
  containerShellCommand, projectCommand, serviceCommand, shellQuote, type ComposeTarget } from '../src/shared/compose'

const plain: ComposeTarget = { projectName: '', files: [] }

describe('shellQuote', () => {
  it('leaves safe words alone', () => {
    expect(shellQuote('docker-compose.dev.yml')).toBe('docker-compose.dev.yml')
  })

  it('quotes spaces, shell metacharacters and empty strings', () => {
    expect(shellQuote('my file.yml')).toBe("'my file.yml'")
    expect(shellQuote('a;rm -rf ~')).toBe("'a;rm -rf ~'")
    expect(shellQuote('$(id)')).toBe("'$(id)'")
    expect(shellQuote('')).toBe("''")
  })

  it('escapes embedded single quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })
})

describe('projectCommand', () => {
  it('maps the IDEA toolbar to compose subcommands', () => {
    expect(projectCommand(plain, 'up')).toBe('docker compose up -d')
    expect(projectCommand(plain, 'restart')).toBe('docker compose restart')
    expect(projectCommand(plain, 'stop')).toBe('docker compose stop')
    expect(projectCommand(plain, 'down')).toBe('docker compose down')
    expect(projectCommand(plain, 'logs')).toBe('docker compose logs -f --tail 200')
  })

  it('puts project and files before the subcommand', () => {
    const target = {
      projectName: ' brave-medods ',
      files: ['compose.yml', 'dev overrides.yml']
    }
    expect(projectCommand(target, 'up')).toBe(
      "docker compose -p brave-medods -f compose.yml -f 'dev overrides.yml' up -d"
    )
  })
})

describe('serviceCommand', () => {
  it('targets one service', () => {
    expect(serviceCommand(plain, 'stop', ' postgres ')).toBe('docker compose stop postgres')
    expect(serviceCommand(plain, 'rebuild', 'api_gateway')).toBe('docker compose up -d --build api_gateway')
    expect(serviceCommand(plain, 'shell', 'redis')).toBe('docker compose exec redis sh')
  })

  it('quotes a hostile service name', () => {
    expect(serviceCommand(plain, 'logs', 'x; reboot')).toBe("docker compose logs -f --tail 200 'x; reboot'")
  })

  it('refuses an empty service', () => {
    expect(() => serviceCommand(plain, 'stop', '  ')).toThrow('service name is required')
  })
})

describe('containerShellCommand', () => {
  it('quotes the container name', () => {
    expect(containerShellCommand('web')).toBe('docker exec -it web sh')
    expect(containerShellCommand('web', 'bash')).toBe('docker exec -it web bash')
    expect(containerShellCommand('web', 'sh', 'root')).toBe('docker exec -it -u root web sh')
    expect(containerShellCommand("a b'c")).toBe(`docker exec -it 'a b'\\''c' sh`)
  })
})

describe('compose deploy and down', () => {
  const target = { projectName: 'shop', files: ['/srv/compose.yaml'] }

  it('deploys with no extra flags by default', () => {
    expect(composeUpCommand(target, DEFAULT_DEPLOY)).toBe('docker compose -p shop -f /srv/compose.yaml up -d')
  })

  it('puts profiles and env files before up, and quotes what needs it', () => {
    expect(
      composeUpCommand(target, {
        ...DEFAULT_DEPLOY,
        profiles: ['debug'],
        envFiles: ['my env'],
        build: 'never',
        recreate: 'none',
        renewAnonVolumes: true,
        alwaysRecreateDeps: true,
        services: ['web', 'db']
      })
    ).toBe(
      "docker compose -p shop -f /srv/compose.yaml --profile debug --env-file 'my env' up -d --no-build --no-recreate -V --always-recreate-deps web db"
    )
  })

  it('downs with volumes, images, orphans and a timeout', () => {
    expect(composeDownCommand(target, DEFAULT_DOWN)).toBe('docker compose -p shop -f /srv/compose.yaml down')
    expect(
      composeDownCommand(target, { removeVolumes: true, removeImages: 'all', removeOrphans: true, timeout: 0 })
    ).toBe('docker compose -p shop -f /srv/compose.yaml down -v --rmi all --remove-orphans -t 0')
  })

  it('scales without recreating what runs', () => {
    expect(composeScaleCommand(target, 'web', 3)).toBe(
      'docker compose -p shop -f /srv/compose.yaml up -d --no-recreate --scale web=3 web'
    )
  })
})
