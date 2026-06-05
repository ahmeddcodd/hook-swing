/**
 * Align a swing spritesheet so every frame's GRAB POINT (the raised hands)
 * sits at the same spot — horizontally centered, hands on a common top
 * baseline. The body then dangles below that point, so when the frame's origin
 * is placed on the rope's end, the hands stay locked on the rope through the
 * whole animation (no jitter/drift).
 *
 * Auto-detects the figures (the source sheets are NOT evenly divisible and the
 * figures sit at irregular x positions/widths), so frameCount is inferred.
 *
 * Pure Node (zlib only) PNG decode/encode for RGBA (8-bit, color type 6).
 *
 * Usage:
 *   node scripts/align-swing-sheet.cjs <input.png> <output.png>
 *
 * Prints the resulting frame metrics (frameWidth/Height, handOriginX/Y,
 * bodyHeight) to record in the theme config.
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

/** Detect figures as contiguous columns that contain opaque pixels. */
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

/** Bounding box within a figure's x-range, plus the hand x (centroid of the
 *  top band of opaque pixels). */
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
  // hand x = centroid of opaque pixels in the top 18px band (the raised hands)
  let sx = 0
  let n = 0
  for (let y = minY; y < minY + 18; y++) {
    for (let x = xStart; x <= xEnd; x++) {
      if (img.data[y * stride + x * ch + 3] > ALPHA) {
        sx += x
        n++
      }
    }
  }
  const handX = n ? sx / n : (minX + maxX) / 2
  return { minX, maxX, minY, maxY, handX }
}

function main() {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) {
    console.error('Usage: node align-swing-sheet.cjs <input.png> <output.png>')
    process.exit(1)
  }
  const img = decodePNG(fs.readFileSync(input))
  const figures = detectFigures(img)
  const frameCount = figures.length

  const m = figures.map(([a, b]) => measure(img, a, b))

  // Frames are anchored on the HAND, which is offset from the body center, so
  // size the frame from the worst-case reach on EACH side of the hand (plus the
  // height from hands to lowest feet). This guarantees no limb is clipped.
  const maxLeftOfHand = Math.max(...m.map((f) => f.handX - f.minX))
  const maxRightOfHand = Math.max(...m.map((f) => f.maxX - f.handX))
  const maxH = Math.max(...m.map((f) => f.maxY - f.minY + 1))
  const halfW = Math.ceil(Math.max(maxLeftOfHand, maxRightOfHand))
  const padX = Math.round(halfW * 0.12)
  const padTop = Math.round(maxH * 0.05)
  const padBottom = Math.round(maxH * 0.08)
  // Symmetric around the hand so the centered anchor holds for every frame.
  const outFW = (halfW + padX) * 2
  const outFH = maxH + padTop + padBottom

  const ch = 4
  const outW = outFW * frameCount
  const outH = outFH
  const out = Buffer.alloc(outW * outH * ch)
  const srcStride = img.W * ch
  const outStride = outW * ch

  // Common hand anchor in the output frame: horizontally centered, near the top.
  const anchorX = outFW / 2
  const anchorTopY = padTop

  for (let f = 0; f < frameCount; f++) {
    const b = m[f]
    const bodyW = b.maxX - b.minX + 1
    const bodyH = b.maxY - b.minY + 1
    // Place so this frame's hand x → anchorX, and its top (hands) → anchorTopY.
    const handOffsetInBody = b.handX - b.minX
    const destX0 = Math.round(anchorX - handOffsetInBody)
    const destY0 = anchorTopY
    for (let y = 0; y < bodyH; y++) {
      for (let x = 0; x < bodyW; x++) {
        const sx = (b.minX + x) * ch
        const sy = (b.minY + y) * srcStride
        const dxBase = destX0 + x
        if (dxBase < 0 || dxBase >= outFW) continue
        const dx = (f * outFW + dxBase) * ch
        const dy = (destY0 + y) * outStride
        out[dy + dx] = img.data[sy + sx]
        out[dy + dx + 1] = img.data[sy + sx + 1]
        out[dy + dx + 2] = img.data[sy + sx + 2]
        out[dy + dx + 3] = img.data[sy + sx + 3]
      }
    }
  }

  fs.writeFileSync(output, encodePNG(outW, outH, out))
  console.log(
    JSON.stringify(
      {
        output,
        frameCount,
        frameWidth: outFW,
        frameHeight: outFH,
        handOriginX: +(anchorX / outFW).toFixed(4),
        handOriginY: +(anchorTopY / outFH).toFixed(4),
        bodyHeight: maxH,
      },
      null,
      2
    )
  )
}

main()
