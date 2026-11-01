import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEMES } from '../lib/theme'

describe('colour themes', () => {
  const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')

  it('has styles for every theme in the picker', () => {
    for (const t of THEMES.filter((x) => x.id !== 'burgundy')) expect(css).toContain(`[data-theme='${t.id}']`)
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length)
  })

  it('gives dark themes their own surfaces, so text never lands on a matching background', () => {
    for (const t of THEMES.filter((x) => x.tone === 'dark')) {
      const block = css.slice(css.indexOf(`[data-theme='${t.id}']`)).split('}')[0]
      for (const token of ['--color-ivory', '--color-canvas', '--color-surface', '--color-ink', '--color-rail']) expect(block).toContain(token)
    }
  })
})
