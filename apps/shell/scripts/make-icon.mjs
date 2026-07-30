/**
 * Generates the application icon: build-resources/icon.png, which electron-builder turns
 * into the multi-size .ico used by the exe, the Start-menu entry and the
 * installer.
 *
 * It is generated rather than drawn by hand so the icon cannot drift from the
 * app's own identity. Every value below is taken from the panel's `.logo` rule in
 * src/renderer/style.css - the same rounded square with the same corner ratio,
 * the two accent tokens as the gradient stops, and the same near-black letter.
 * Change the tokens there and re-run this.
 *
 * The game's poke.ico is deliberately not reused: it belongs to Poke IdleWorld,
 * and shipping it as the product icon would present Hecaton as if it were the
 * game.
 *
 * No image library: Node's zlib is a PNG encoder once the chunks and CRC are
 * written by hand, which is less code than a dependency would be - and this
 * project keeps the shipped tree small on purpose.
 *
 * Usage: node scripts/make-icon.mjs
 */
import { deflateSync } from 'node:zlib'
import { Buffer } from 'node:buffer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 512
// 4x4 samples per pixel. The corners and the letter's edges are the only curved
// or thin geometry here, and both look ragged without it.
const SUB = 4

// --- identity, mirroring .logo in style.css -------------------------------
const ACCENT = [0x4c, 0xc3, 0x8a] // --accent, dark theme
const ACCENT_DEEP = [0x2f, 0x8f, 0x63] // --accent, light theme: same family, darker
const INK = [0x0c, 0x13, 0x10] // .logo colour
const RADIUS_RATIO = 9 / 32 // .logo: border-radius 9px on 32px

// A small margin so the rounded corners read as corners at 16px and the icon is
// not flush against the edge of a taskbar button.
const MARGIN = Math.round(SIZE * 0.05)
const BOX = { x0: MARGIN, y0: MARGIN, x1: SIZE - MARGIN, y1: SIZE - MARGIN }
const RADIUS = (BOX.x1 - BOX.x0) * RADIUS_RATIO

// The H, drawn as three rectangles rather than rendered from a font: there is no
// font to embed, and at 16px a geometric H stays legible where a hinted glyph
// would not. Proportions approximate the panel's font-weight 800.
const H_W = SIZE * 0.4
const H_H = SIZE * 0.44
const STEM = SIZE * 0.105
const BAR = SIZE * 0.095
const H = {
  x0: (SIZE - H_W) / 2,
  y0: (SIZE - H_H) / 2,
  x1: (SIZE + H_W) / 2,
  y1: (SIZE + H_H) / 2,
}

/** Signed distance to a rounded rectangle; <= 0 is inside. */
function insideRoundedRect(x, y, box, r) {
  const cx = (box.x0 + box.x1) / 2
  const cy = (box.y0 + box.y1) / 2
  const qx = Math.abs(x - cx) - ((box.x1 - box.x0) / 2 - r)
  const qy = Math.abs(y - cy) - ((box.y1 - box.y0) / 2 - r)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - r <= 0
}

function insideLetter(x, y) {
  const leftStem = x >= H.x0 && x <= H.x0 + STEM && y >= H.y0 && y <= H.y1
  const rightStem = x >= H.x1 - STEM && x <= H.x1 && y >= H.y0 && y <= H.y1
  const midY = (H.y0 + H.y1) / 2
  const crossbar = x >= H.x0 && x <= H.x1 && y >= midY - BAR / 2 && y <= midY + BAR / 2
  return leftStem || rightStem || crossbar
}

/** 135deg, top-left to bottom-right, as in the .logo gradient. */
function gradientAt(x, y) {
  const t = Math.min(Math.max((x - BOX.x0 + (y - BOX.y0)) / (2 * (BOX.x1 - BOX.x0)), 0), 1)
  return ACCENT.map((c, i) => Math.round(c + (ACCENT_DEEP[i] - c) * t))
}

const pixels = Buffer.alloc(SIZE * SIZE * 4)
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let box = 0
    let letter = 0
    for (let sy = 0; sy < SUB; sy++) {
      for (let sx = 0; sx < SUB; sx++) {
        const x = px + (sx + 0.5) / SUB
        const y = py + (sy + 0.5) / SUB
        if (insideRoundedRect(x, y, BOX, RADIUS)) {
          box++
          if (insideLetter(x, y)) letter++
        }
      }
    }
    const samples = SUB * SUB
    const alpha = box / samples
    const ink = letter / samples
    const base = gradientAt(px + 0.5, py + 0.5)
    const at = (py * SIZE + px) * 4
    for (let c = 0; c < 3; c++) {
      pixels[at + c] = Math.round(base[c] * (1 - ink) + INK[c] * ink)
    }
    pixels[at + 3] = Math.round(alpha * 255)
  }
}

// --- minimal PNG writer ---------------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // colour type: RGBA
// 10, 11, 12 stay 0: deflate, adaptive filtering, no interlace

// One filter byte per scanline. Filter 0 (none) keeps this readable; the image is
// mostly flat colour, so deflate does the work regardless.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'build-resources', 'icon.png')
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, png)
console.log(`wrote ${OUT} (${SIZE}x${SIZE}, ${png.length} bytes)`)
