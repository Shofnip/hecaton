/**
 * Copies the renderer's static assets into dist.
 *
 * `tsc` emits JavaScript and nothing else, so index.html and style.css would be
 * missing from a build that otherwise looks complete — the window would open
 * blank with no error, since a failed file load is not an exception.
 *
 * A named list rather than a directory sweep: the renderer must never ship a
 * file nobody chose to ship, and this is the same reasoning that keeps
 * `git add -A` blocked in this repository.
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FROM = join(HERE, '..', 'src', 'renderer')
const TO = join(HERE, '..', 'dist', 'renderer')

// Paths relative to the renderer dir. The bundled font and game icon ship here
// too — the runtime is offline (connect-src 'none'), so both are packaged, never
// fetched. Sora-OFL.txt travels with the font it licenses.
const ASSETS = [
  'index.html',
  'style.css',
  'assets/sora-latin.woff2',
  'assets/sora-latin-ext.woff2',
  'assets/Sora-OFL.txt',
  'assets/poke.ico',
]

for (const asset of ASSETS) {
  const target = join(TO, asset)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(join(FROM, asset), target)
}
console.log(`copied ${ASSETS.length} renderer assets to dist/renderer`)
