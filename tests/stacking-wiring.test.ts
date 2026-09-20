/** Composition guard only. Real native stacking is tested in the adapter suite. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const main = readFileSync(new URL('../apps/shell/src/main/main.ts', import.meta.url), 'utf8')

describe('embedded stacking after panel reactivation', () => {
  it('restores native stacking after the focus callback, independently of layout geometry', () => {
    const restoresAfterFocus =
      /panel\.on\('focus',\s*\(\)\s*=>\s*\{\s*setImmediate\(\(\)\s*=>\s*windowManager\?\.restoreEmbeddedZOrder\(\)\)/
    expect(restoresAfterFocus.test(main)).toBe(true)
  })
})
