import { describe, expect, it } from 'vitest'
import { DEFAULT_RUN, dockerPushCommand, dockerRunCommand, ENV_ASSIGNMENT, PORT_BINDING } from '../src/shared/docker-run'

describe('dockerRunCommand', () => {
  it('runs detached with nothing else by default', () => {
    expect(dockerRunCommand({ ...DEFAULT_RUN, image: 'redis:7' })).toBe('docker run -d redis:7')
  })

  it('quotes structured values and leaves the free-text fields as typed', () => {
    expect(
      dockerRunCommand({
        ...DEFAULT_RUN,
        image: 'redis:7',
        detach: false,
        publishAll: true,
        env: ["GREETING=it's"],
        entrypoint: 'sh',
        command: '-c "redis-server --port 7000"',
        runOptions: '--memory 256m'
      })
    ).toBe(`docker run -P -e 'GREETING=it'\\''s' --entrypoint sh --memory 256m redis:7 -c "redis-server --port 7000"`)
  })
})

describe('dockerPushCommand', () => {
  it('pushes as is, or tags first under a new name', () => {
    expect(dockerPushCommand('acme/api:1', 'acme/api:1')).toBe('docker push acme/api:1')
    expect(dockerPushCommand('acme/api:1', 'ghcr.io/acme/api:1')).toBe(
      'docker tag acme/api:1 ghcr.io/acme/api:1 && docker push ghcr.io/acme/api:1'
    )
  })
})

describe('field patterns', () => {
  it.each(['80', '8080:80', '127.0.0.1:5432:5432', '9000-9001:9000-9001/udp'])('accepts port %s', (port) => {
    expect(PORT_BINDING.test(port)).toBe(true)
  })

  it.each(['', 'eighty', '80:80 -v /:/host', '80/http'])('refuses port %j', (port) => {
    expect(PORT_BINDING.test(port)).toBe(false)
  })

  it('wants a variable name before the =', () => {
    expect(ENV_ASSIGNMENT.test('A_1=')).toBe(true)
    expect(ENV_ASSIGNMENT.test('=x')).toBe(false)
  })
})
