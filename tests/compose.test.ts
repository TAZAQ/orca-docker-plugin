import { describe, expect, it } from 'vitest'
import { containerShellCommand, projectCommand, serviceCommand, shellQuote, splitList, type ComposeTarget } from '../src/shared/compose'

const plain: ComposeTarget = { projectName: '', files: [], profiles: [] }

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

describe('splitList', () => {
  it('splits on commas and newlines and drops blanks', () => {
    expect(splitList(' a.yml, b.yml ,\n\nc.yml,')).toEqual(['a.yml', 'b.yml', 'c.yml'])
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

  it('puts project, files and profiles before the subcommand', () => {
    const target = {
      projectName: ' brave-medods ',
      files: ['compose.yml', 'dev overrides.yml'],
      profiles: ['kafka']
    }
    expect(projectCommand(target, 'up')).toBe(
      "docker compose -p brave-medods -f compose.yml -f 'dev overrides.yml' --profile kafka up -d"
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
    expect(containerShellCommand("a b'c")).toBe(`docker exec -it 'a b'\\''c' sh`)
  })
})
