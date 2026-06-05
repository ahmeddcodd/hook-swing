/**
 * Align a horizontal spritesheet by the FEET — every frame centered (by its own
 * body center) with feet on a common bottom baseline, so it animates in place
 * without jitter and stands/lands consistently. Auto-detects figures (sheets
 * are not evenly divisible / figures sit at irregular x), and can take only the
 * first N figures.
 *
 * Pure Node (zlib only) PNG decode/encode for RGBA (8-bit, color type 6).
 *
 * Usage:
 *   node scripts/align-feet-sheet.cjs <input.png> <output.png> [maxFrames]
 *
 * Prints the resulting frame metrics for the theme config.
 */
const fs = require('fs')
const zlib = require('zlib')

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

function decodePNG(buf) {
  let p = 8
  let W = 0
  let H = 0
  let colorType = 0
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.toString('ascii', p + 4, p + 8)
    const data = buf.slice(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      W = data.readUInt32BE(0)
      H = data.readUInt32BE(4)
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    p += 12 + len
  }
  if (colorType !== 6) throw new Error('Only RGBA (color type 6) supported, got ' + colorType)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const ch = 4
  const stride = W * ch
  const out = Buffer.alloc(H * stride)
  let pos = 0
  for (let y = 0; y < H; y++) {
    const f = raw[pos++]
    for (let x = 0; x < stride; x++) {
      const val = raw[pos++]
      const a = x >= ch ? out[y * stride + x - ch] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= ch && y > 0 ? out[(y - 1) * stride + x - ch] : 0
      let v
      if (f === 0) v = val
      else if (f === 1) v = val + a
      else if (f === 2) v = val + b
      else if (f === 3) v = val + ((a + b) >> 1)
      else v = val + paeth(a, b, c)
      out[y * stride + x] = v & 0xff
    }
  }
  return { W, H, data: out }
}

function encodePNG(W, H, data) {
  const ch = 4
  const stride = W * ch
  const rawWithFilter = Buffer.alloc(H * (stride + 1))
  for (let y = 0; y < H; y++) {
    rawWithFilter[y * (stride + 1)] = 0
    data.copy(rawWithFilter, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const compressed = zlib.deflateSync(rawWithFilter, { level: 9 })

  function chunk(type, body) {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(body.length, 0)
    const typeBuf = Buffer.from(type, 'ascii')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])) >>> 0, 0)
    return Buffer.concat([len, typeBuf, body, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c ^ 0xffffffff
}

const ALPHA = 40

function colHasInk(img, x) {
  const ch = 4
  const stride = img.W * ch
  for (let y = 0; y < img.H; y++) if (img.data[y * stride + x * ch + 3] > ALPHA) return true
  return false
}

function detectFigures(img) {
  const runs = []
  let s = -1
  for (let x = 0; x < img.W; x++) {
    const ink = colHasInk(img, x)
    if (ink && s < 0) s = x
    else if (!ink && s >= 0) {
      runs.push([s, x - 1])
      s = -1
    }
  }
  if (s >= 0) runs.push([s, img.W - 1])
  return runs
}

function measure(img, xStart, xEnd) {
  const ch = 4
  const stride = img.W * ch
  let minX = xEnd
  let maxX = xStart
  let minY = img.H
  let maxY = -1
  for (let y = 0; y < img.H; y++) {
    for (let x = xStart; x <= xEnd; x++) {
      if (img.data[y * stride + x * ch + 3] > ALPHA) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return { minX, maxX, minY, maxY }
}

function main() {
  const [input, output, maxFramesStr] = process.argv.slice(2)
  if (!input || !output) {
    console.error('Usage: node align-feet-sheet.cjs <input.png> <output.png> [maxFrames]')
    process.exit(1)
  }
  const img = decodePNG(fs.readFileSync(input))
  let figures = detectFigures(img)
  if (maxFramesStr) figures = figures.slice(0, parseInt(maxFramesStr, 10))
  const frameCount = figures.length

  const m = figures.map(([a, b]) => measure(img, a, b))
  const maxW = Math.max(...m.map((f) => f.maxX - f.minX + 1))
  const maxH = Math.max(...m.map((f) => f.maxY - f.minY + 1))
  const padX = Math.round(maxW * 0.16)
  const padTop = Math.round(maxH * 0.05)
  const padBottom = Math.round(maxH * 0.05)
  const outFW = maxW + padX * 2
  const outFH = maxH + padTop + padBottom

  const ch = 4
  const outW = outFW * frameCount
  const outH = outFH
  const out = Buffer.alloc(outW * outH * ch)
  const srcStride = img.W * ch
  const outStride = outW * ch

  for (let f = 0; f < frameCount; f++) {
    const b = m[f]
    const bodyW = b.maxX - b.minX + 1
    const bodyH = b.maxY - b.minY + 1
    // Center horizontally by body center; feet (maxY) on common bottom baseline.
    const destX0 = f * outFW + Math.round((outFW - bodyW) / 2)
    const destY0 = outFH - padBottom - bodyH
    for (let y = 0; y < bodyH; y++) {
      for (let x = 0; x < bodyW; x++) {
        const sx = (b.minX + x) * ch
        const sy = (b.minY + y) * srcStride
        const dx = (destX0 + x) * ch
        const dy = (destY0 + y) * outStride
        out[dy + dx] = img.data[sy + sx]
        out[dy + dx + 1] = img.data[sy + sx + 1]
        out[dy + dx + 2] = img.data[sy + sx + 2]
        out[dy + dx + 3] = img.data[sy + sx + 3]
      }
    }
  }

  fs.writeFileSync(output, encodePNG(outW, outH, out))
  const feetY = outFH - padBottom
  console.log(
    JSON.stringify(
      {
        output,
        frameCount,
        frameWidth: outFW,
        frameHeight: outFH,
        feetOriginY: +(feetY / outFH).toFixed(4),
        bodyHeight: maxH,
      },
      null,
      2
    )
  )
}

main()
