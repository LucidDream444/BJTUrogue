import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import console from 'node:console'
import { fileURLToPath, pathToFileURL } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { default: sharp } = await import(
  process.env.ARCHIVE_SHARP ? pathToFileURL(process.env.ARCHIVE_SHARP).href : 'sharp'
)
const dir = path.resolve(__dirname, '../../public/assets/ui/codex'),
  source = path.join(dir, 'notebook-reference.png')
let normalized
async function crop(name, x, y, w, h, mask) {
  let img = sharp(normalized).extract({ left: x, top: y, width: w, height: h })
  if (mask)
    img = img.composite([
      { input: Buffer.from(`<svg width="${w}" height="${h}">${mask}</svg>`), blend: 'dest-in' },
    ])
  await img.png().toFile(path.join(dir, `ui_notebook_${name}.png`))
}
;(async () => {
  normalized = await sharp(source).resize(1600, 1600).png().toBuffer()
  await crop(
    'grimoire',
    545,
    120,
    385,
    395,
    '<polygon points="34,49 246,3 372,253 288,311 284,374 253,361 240,337 168,355 65,321 2,97" fill="white"/>',
  )
  for (const [name, x, y, w, h] of [
    ['crystal', 1090, 239, 87, 99],
    ['book', 1225, 237, 94, 100],
    ['orb', 1374, 234, 94, 105],
    ['paper', 1091, 399, 94, 94],
    ['sakura', 1226, 403, 94, 92],
    ['stone', 1374, 401, 94, 93],
  ]) {
    await crop(
      name,
      x,
      y,
      w,
      h,
      `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="white"/>`,
    )
  }
  await crop(
    'seal',
    1395,
    65,
    109,
    126,
    '<ellipse cx="54.5" cy="63" rx="54" ry="62" fill="white"/>',
  )
  const l = await sharp(normalized)
    .extract({ left: 1148, top: 595, width: 75, height: 103 })
    .toBuffer()
  const r = await sharp(normalized)
    .extract({ left: 1331, top: 595, width: 75, height: 103 })
    .toBuffer()
  const mid = await sharp(normalized)
    .extract({ left: 1215, top: 595, width: 6, height: 103 })
    .resize(210, 103, { fit: 'fill' })
    .toBuffer()
  await sharp({ create: { width: 360, height: 103, channels: 4, background: '#244a98' } })
    .composite([
      { input: l, left: 0, top: 0 },
      { input: mid, left: 75, top: 0 },
      { input: r, left: 285, top: 0 },
    ])
    .png()
    .toFile(path.join(dir, 'ui_notebook_button.png'))
  fs.writeFileSync(
    path.join(dir, 'extraction.json'),
    JSON.stringify(
      {
        source: 'notebook-reference.png',
        original: 'D:/课后勇者/1793698131289-92qwihroaw/textures/1793698131289-92qwihroaw.png',
        usage: 'Decorations only; monsters, rank names, prices and stats are live game data.',
      },
      null,
      2,
    ),
  )
  // Reconstruct the book crease at the runtime left-column boundary, preserving the raw generated page.
  const sourcePage = path.join(dir, 'notebook-light-source.png')
  if (fs.existsSync(sourcePage)) {
    const pieces = []
    for (const [x, w, dw, left] of [
      [0, 116, 490, 0],
      [116, 42, 50, 490],
      [158, 866, 1060, 540],
    ]) {
      const part = await sharp(sourcePage)
        .extract({ left: x, top: 0, width: w, height: 1024 })
        .toBuffer()
      pieces.push({
        input: await sharp(part).resize(dw, 900, { fit: 'fill' }).toBuffer(),
        left,
        top: 0,
      })
    }
    await sharp({ create: { width: 1600, height: 900, channels: 4, background: '#e8e9ef' } })
      .composite(pieces)
      .png()
      .toFile(path.join(dir, 'ui_notebook_light.png'))
  }
  console.log('Notebook assets extracted')
})()
