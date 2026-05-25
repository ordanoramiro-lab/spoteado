import { describe, it, expect, beforeAll } from 'vitest'
import sharp from 'sharp'
import { makeThumbnail, watermarkPreview } from '@/lib/images'

let original: Buffer

beforeAll(async () => {
  original = await sharp({
    create: { width: 2000, height: 1500, channels: 3, background: '#3366aa' },
  }).jpeg().toBuffer()
})

describe('makeThumbnail', () => {
  it('reduce el lado mayor a <= 600px manteniendo aspect ratio', async () => {
    const out = await makeThumbnail(original)
    const meta = await sharp(out).metadata()
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(600)
    expect(meta.width! / meta.height!).toBeCloseTo(2000 / 1500, 1)
  })
})

describe('watermarkPreview', () => {
  it('devuelve una imagen válida del mismo aspect ratio', async () => {
    const out = await watermarkPreview(original, { text: 'Spoteado' })
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width! / meta.height!).toBeCloseTo(2000 / 1500, 1)
  })
})
