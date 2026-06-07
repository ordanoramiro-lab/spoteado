// Geometría pura del recorte: de un bounding box normalizado (0..1) a píxeles,
// expandido con margen y clampeado a los límites de la imagen.
export type Box = { x: number; y: number; w: number; h: number } // normalizado 0..1
export type PixelCrop = { left: number; top: number; width: number; height: number }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

// margin = fracción del tamaño del box que se agrega a cada lado (para ver ola/contexto).
export function computeCrop(imgW: number, imgH: number, box: Box, margin = 0.5): PixelCrop {
  const mx = box.w * margin
  const my = box.h * margin
  const x0 = clamp01(box.x - mx)
  const y0 = clamp01(box.y - my)
  const x1 = clamp01(box.x + box.w + mx)
  const y1 = clamp01(box.y + box.h + my)
  const left = Math.round(x0 * imgW)
  const top = Math.round(y0 * imgH)
  const width = Math.max(1, Math.round((x1 - x0) * imgW))
  const height = Math.max(1, Math.round((y1 - y0) * imgH))
  return { left, top, width, height }
}

// Un box es usable si no es degenerado ni cubre casi toda la imagen (en cuyo caso no aporta zoom).
export function isUsableBox(box: Box): boolean {
  if (!(box.w > 0.01 && box.h > 0.01)) return false
  if (box.w >= 0.95 && box.h >= 0.95) return false
  return true
}
