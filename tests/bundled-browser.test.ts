/**
 * Holds the four places that describe the bundled browser to each other.
 *
 * Since ADR-0016 the app ships its own Chromium, and four files have to agree
 * about it without any of them being able to see the others:
 *
 *   - `browser-paths.ts` joins `process.resourcesPath` with a relative path;
 *   - `electron-builder.yml` puts the tree at that path in the package;
 *   - `scripts/fetch-chromium.mjs` puts it there in development, and holds the
 *     revision and SHA256 pin;
 *   - `docs/releasing.md` carries the ritual for raising that pin.
 *
 * Every one of those agreements is currently true by somebody having read all
 * four, which is the shape of quality signal this repository has been wrong
 * about before — see the header of `repo-consistency.test.ts`. Breaking any of
 * them produces a package whose browser is not where the app looks, discovered
 * by a user rather than by the build, or a release document describing a
 * revision nobody ships.
 *
 * Deliberately string-matching against the real files rather than importing
 * anything from them: the yml and the .mjs have no exports to import, and a test
 * that parsed them properly would be a second implementation to keep correct.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUNDLED_BROWSER_SUBPATH, bundledBrowserPath } from '@hecaton/browser-engine'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

const builderConfig = read('apps/shell/electron-builder.yml')
const fetchScript = read('scripts/fetch-chromium.mjs')
const releasing = read('docs/releasing.md')

/** The layout as the app sees it, with forward slashes, e.g. `chromium/chrome-win`. */
const TREE_SUBPATH = BUNDLED_BROWSER_SUBPATH.replace(/\\/g, '/').replace(/\/[^/]+$/, '')

describe('the packaged browser lands where the app looks for it', () => {
  it('is a directory under resources, plus one executable', () => {
    // Guards the derivation above: if the constant ever stopped being
    // `<dir>/<dir>/<exe>`, the two tests below would compare something else and
    // pass while meaning nothing.
    expect(TREE_SUBPATH).toBe('chromium/chrome-win')
    expect(bundledBrowserPath('R')).toBe(`R\\${BUNDLED_BROWSER_SUBPATH}`)
  })

  it('electron-builder copies it to exactly that path', () => {
    // `to:` is relative to resources/, which is what process.resourcesPath is in
    // the packaged app.
    expect(builderConfig).toContain(`to: ${TREE_SUBPATH}`)
  })

  it('electron-builder takes it from where the fetch script unpacks it', () => {
    expect(builderConfig).toContain('from: ../../vendor/chromium/chrome-win')
    expect(fetchScript).toContain("join(ROOT, 'vendor', 'chromium')")
  })

  it('the fetch script links it to the same place for development', () => {
    // Anything else and `npm start` would launch nothing while the packaged
    // build worked, or the reverse — the second load path ADR-0007 decision 2
    // exists to prevent.
    expect(fetchScript).toContain("join(ELECTRON_RESOURCES, 'chromium')")
    expect(fetchScript).toContain("join(ROOT, 'node_modules', 'electron', 'dist', 'resources')")
  })
})

describe('the revision pin is the same one the release ritual describes', () => {
  const pinned = /^const REVISION = '(\d+)'$/m.exec(fetchScript)
  const hashed = /^const SHA256 = '([0-9a-f]{64})'$/m.exec(fetchScript)
  const versioned = /^const VERSION = '([\d.]+)'$/m.exec(fetchScript)

  it('finds the pin in the fetch script at all', () => {
    // Without this the three below pass vacuously the moment the script is
    // reformatted.
    expect(pinned?.[1]).toBeTruthy()
    expect(hashed?.[1]).toBeTruthy()
    expect(versioned?.[1]).toBeTruthy()
  })

  it('docs/releasing.md names the same revision', () => {
    // The browser stops updating itself the moment it is bundled, so the release
    // is the only occasion that raises it. A document naming a revision nobody
    // ships turns that ritual into theatre.
    expect(releasing).toContain(pinned![1]!)
  })

  it('docs/releasing.md names the same version and hash', () => {
    expect(releasing).toContain(versioned![1]!)
    expect(releasing).toContain(hashed![1]!)
  })
})

describe('the browser is never committed', () => {
  it('vendor/ is ignored', () => {
    // 440 MB of somebody else's build output, and the reason the SHA256 pin
    // exists instead. An accidental commit would be permanent.
    expect(read('.gitignore')).toMatch(/^vendor\/$/m)
  })
})
