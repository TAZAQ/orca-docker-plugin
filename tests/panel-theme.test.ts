import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/panel/App.vue', import.meta.url), 'utf8')
const style = source.slice(source.indexOf('<style'))

describe('panel theme', () => {
  it('reads colors only from the --orca-* tokens Orca provides', () => {
    const tokens = [...style.matchAll(/var\(--([a-z-]+)/g)].map((match) => match[1]!)
    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens.filter((token) => !token.startsWith('orca-'))).toEqual([])
  })

  it('has no fixed color that would suit only one theme', () => {
    expect(style.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull()
  })

  it('leaves color-scheme to the Orca shell, which follows the theme of Orca and not of the OS', () => {
    expect(style).not.toContain('color-scheme')
  })
})
