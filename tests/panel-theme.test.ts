import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const panelFiles = ['App.vue', ...readdirSync(new URL('../src/panel/components/', import.meta.url)).map((file) => `components/${file}`)]
const style = panelFiles
  .map((file) => readFileSync(new URL(`../src/panel/${file}`, import.meta.url), 'utf8'))
  .map((source) => source.slice(source.indexOf('<style')))
  .join('\n')

describe('panel theme', () => {
  it('reads colors only from the --orca-* tokens Orca provides', () => {
    const tokens = [...style.matchAll(/var\(--([a-z-]+)/g)].map((match) => match[1]!)
    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens.filter((token) => !token.startsWith('orca-') && token !== 'docker-running')).toEqual([])
  })

  it('has no fixed color that would suit only one theme', () => {
    const fixed = style.replace(/html\.(light|dark) {[^}]*}/g, '')
    expect(fixed.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull()
  })

  it('gives the running color a value per theme, in plain rules', () => {
    // The CSS minifier rewrites light-dark() into a polyfill that is not a valid color here.
    expect(style).not.toContain('light-dark(')
    expect(style).toMatch(/html\.light {\s*--docker-running: #[0-9a-f]{6};/)
    expect(style).toMatch(/html\.dark {\s*--docker-running: #[0-9a-f]{6};/)
  })

  it('leaves color-scheme to the Orca shell, which follows the theme of Orca and not of the OS', () => {
    expect(style).not.toMatch(/color-scheme\s*:/)
  })
})
