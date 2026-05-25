import sharp from 'sharp'

const PREVIEW_MAX = 1400
const THUMB_MAX = 600

export async function makeThumbnail(original: Buffer): Promise<Buffer> {
  return sharp(original)
    .resize(THUMB_MAX, THUMB_MAX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer()
}

export type WatermarkOptions = {
  text?: string
  logo?: Buffer
  position?: 'bottom-right' | 'bottom-left' | 'center'
  opacity?: number
}

export async function watermarkPreview(
  original: Buffer,
  opts: WatermarkOptions = {}
): Promise<Buffer> {
  const base = sharp(original).resize(PREVIEW_MAX, PREVIEW_MAX, {
    fit: 'inside',
    withoutEnlargement: true,
  })
  const meta = await base.clone().metadata()
  const w = meta.width ?? PREVIEW_MAX
  const h = meta.height ?? PREVIEW_MAX

  const gravity =
    opts.position === 'center' ? 'center'
    : opts.position === 'bottom-left' ? 'southwest'
    : 'southeast'

  let overlay: Buffer
  if (opts.logo) {
    const logoW = Math.round(w * 0.25)
    overlay = await sharp(opts.logo)
      .resize(logoW)
      .ensureAlpha(opts.opacity ?? 0.6)
      .png()
      .toBuffer()
  } else {
    const text = opts.text ?? 'Spoteado'
    const fontSize = Math.round(w * 0.04)
    const padding = 20
    const svgW = Math.round(text.length * fontSize * 0.6) + padding * 2
    const svgH = fontSize + padding * 2
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">
      <text x="${svgW - padding}" y="${fontSize + padding / 2}" text-anchor="end"
        font-family="sans-serif" font-size="${fontSize}"
        fill="white" fill-opacity="${opts.opacity ?? 0.6}">${text}</text></svg>`
    overlay = Buffer.from(svg)
  }

  return base
    .composite([{ input: overlay, gravity }])
    .jpeg({ quality: 82 })
    .toBuffer()
}
