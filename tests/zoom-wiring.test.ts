/** Shell composition guard, not an Electron mock or a native-I/O test. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const main = readFileSync(new URL('../apps/shell/src/main/main.ts', import.meta.url), 'utf8')

describe('automatic zoom is connected to the production shell', () => {
  it('uses the same profile owner for launch and zoom, and the existing window adapter', () => {
    expect(main).toMatch(
      /const launcher = new ChromeLauncher\(accountProfilesDir\(accountId\), BROWSER\)/,
    )
    expect(main).toMatch(/new Orchestrator\(\{\s*launcher,/)
    expect(main).toMatch(/zoom: \{ preferences: launcher, controller: windowManager \}/)
  })

  it('supplies the panel display scale without changing physical placement coordinates', () => {
    const handler = main.split("'screens:layout': (payload) => {")[1]?.split("'overlay:open'")[0]
    expect(handler).toContain('screen.getDisplayMatching(panel.getBounds()).scaleFactor')
    expect(handler).toMatch(/applyScreenLayout\(parseScreenLayout\(payload\), dpiScale\)/)
  })
})
