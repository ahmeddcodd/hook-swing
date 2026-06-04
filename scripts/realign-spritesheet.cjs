/**
 * Re-align a horizontal spritesheet so every frame's character shares the same
 * anchor (horizontally centered, feet on a common baseline). This removes the
 * "slides left-right" effect caused by the body being drawn at a different spot
 * in each source frame.
 *
 * Pure Node (zlib only) PNG decode/encode for RGBA (8-bit, color type 6).
 *
 * Usage:
 *   node scripts/realign-spritesheet.cjs <input.png> <frameCount> <output.png>
 *
 * Prints the resulting frame size so it can be recorded in the theme config.
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
    rawWithFilter[y * (stride + 1)] = 0 // filter: none
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
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
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

/** Find the opaque bounding box of a sub-rectangle [x0, x0+fw) of the image. */
function bbox(img, x0, fw) {
  const ch = 4
  const stride = img.W * ch
  let minX = fw
  let maxX = -1
  let minY = img.H
  let maxY = -1
  for (let y = 0; y < img.H; y++) {
    for (let xx = 0; xx < fw; xx++) {
      const alpha = img.data[y * stride + (x0 + xx) * ch + 3]
      if (alpha > 20) {
        if (xx < minX) minX = xx
        if (xx > maxX) maxX = xx
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return { minX, maxX, minY, maxY }
}

function main() {
  const [input, frameCountStr, output] = process.argv.slice(2)
  if (!input || !frameCountStr || !output) {
    console.error('Usage: node realign-spritesheet.cjs <input.png> <frameCount> <output.png>')
    process.exit(1)
  }
  const frameCount = parseInt(frameCountStr, 10)
  const img = decodePNG(fs.readFileSync(input))
  const srcFW = img.W / frameCount
  if (!Number.isInteger(srcFW)) throw new Error('Width not divisible by frameCount')

  // Measure each frame's body box.
  const boxes = []
  for (let f = 0; f < frameCount; f++) {
    boxes.push(bbox(img, f * srcFW, srcFW))
  }

  // Output frame size = widest body + symmetric padding, tallest body to feet.
  const maxBodyW = Math.max(...boxes.map((b) => b.maxX - b.minX + 1))
  const maxBodyH = Math.max(...boxes.map((b) => b.maxY - b.minY + 1))
  const padX = Math.round(maxBodyW * 0.18)
  const padTop = Math.round(maxBodyH * 0.06)
  const padBottom = Math.round(maxBodyH * 0.04)
  const outFW = maxBodyW + padX * 2
  const outFH = maxBodyH + padTop + padBottom

  const ch = 4
  const outW = outFW * frameCount
  const outH = outFH
  const out = Buffer.alloc(outW * outH * ch) // transparent
  const srcStride = img.W * ch
  const outStride = outW * ch

  for (let f = 0; f < frameCount; f++) {
    const b = boxes[f]
    const bodyW = b.maxX - b.minX + 1
    const bodyH = b.maxY - b.minY + 1
    // Center horizontally; align feet (maxY) to common baseline (outFH - padBottom).
    const destX0 = f * outFW + Math.round((outFW - bodyW) / 2)
    const destY0 = outFH - padBottom - bodyH
    for (let y = 0; y < bodyH; y++) {
      for (let x = 0; x < bodyW; x++) {
        const sx = (f * srcFW + b.minX + x) * ch
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
  // Feet baseline in the aligned frame:
  const feetY = outFH - padBottom
  console.log(
    JSON.stringify(
      {
        output,
        frameCount,
        frameWidth: outFW,
        frameHeight: outFH,
        feetY,
        feetOriginY: +(feetY / outFH).toFixed(4),
        bodyTopY: padTop,
        bodyHeight: maxBodyH,
      },
      null,
      2
    )
  )
}

main()
