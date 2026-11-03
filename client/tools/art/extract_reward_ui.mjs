import path from 'node:path'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import console from 'node:console'
import { fileURLToPath, pathToFileURL } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { default: sharp } = await import(
  process.env.ARCHIVE_SHARP ? pathToFileURL(process.env.ARCHIVE_SHARP).href : 'sharp'
)
const dir = path.resolve(__dirname, '../../public/assets/ui/rewards')
async function crop(source, name, x, y, w, h, shape) {
  const normalized = await sharp(path.join(dir, source)).resize(1600, 1600).png().toBuffer()
  let img = sharp(normalized).extract({ left: x, top: y, width: w, height: h })
  if (shape)
    img = img.composite([
      { input: Buffer.from(`<svg width="${w}" height="${h}">${shape}</svg>`), blend: 'dest-in' },
    ])
  const output = path.join(dir, `ui_reward_${name}.png`)
  if (name === 'header') {
    await img.png().toFile(output)
    return
  }
  const buffer = await img.png().toBuffer()
  const top = await sharp(buffer).extract({ left: 0, top: 0, width: w, height: 535 }).toBuffer()
  const bottom = await sharp(buffer)
    .extract({ left: 0, top: 535, width: w, height: h - 535 })
    .toBuffer()
  const strip = await sharp(buffer)
    .extract({ left: 0, top: 534, width: w, height: 1 })
    .resize(w, 70, { fit: 'fill' })
    .toBuffer()
  await sharp({
    create: { width: w, height: h + 70, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: top, left: 0, top: 0 },
      { input: strip, left: 0, top: 535 },
      { input: bottom, left: 0, top: 605 },
    ])
    .png()
    .toFile(output)
}
;(async () => {
  const pixel = 'reward-reference-pixel.png',
    painted = 'reward-reference-painted.png'
  const mask =
    '<path d="M 7 62 L 25 47 L 124 35 C 130 -8 237 -8 243 35 L 343 47 L 360 63 L 360 606 L 341 629 Q 184 647 26 629 L 7 606 Z" fill="white"/>'
  await crop(pixel, 'survival', 44, 334, 372, 650, mask)
  await crop(pixel, 'utility', 445, 334, 372, 650, mask)
  await crop(pixel, 'firepower', 844, 334, 372, 650, mask)
  // Painted variants supply movement and growth imagery while retaining the matching card geometry.
  await crop(painted, 'growth', 51, 334, 372, 650, mask)
  await crop(painted, 'speed', 851, 334, 372, 650, mask)
  await crop(
    pixel,
    'header',
    20,
    0,
    1200,
    327,
    '<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="white" stop-opacity="0"/><stop offset=".13" stop-color="white"/><stop offset=".92" stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient></defs><rect width="1200" height="327" fill="url(#fade)"/>',
  )
  console.log('Reward card illustrations extracted')
})()
