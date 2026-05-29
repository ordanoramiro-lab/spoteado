import type { ProcessDeps, PhotoRow } from './types'

/**
 * Pipeline idempotente por foto. La imagen es obligatoria (si falla → failed).
 * El embedding es best-effort: si falla, la foto queda 'ready' (buscable por
 * filtros) con embedding_status='failed' para reintento posterior.
 */
export async function processPhoto(deps: ProcessDeps, photo: PhotoRow): Promise<void> {
  let original: Buffer
  let preview: Buffer
  let thumb: Buffer
  try {
    original = await deps.downloadOriginal(photo.original_path)
    preview = await deps.makePreview(original)
    thumb = await deps.makeThumb(original)
    const { width, height } = await deps.readDimensions(original)
    await deps.uploadPublic(`${photo.id}/preview.jpg`, preview)
    await deps.uploadPublic(`${photo.id}/thumb.jpg`, thumb)
    await deps.updatePhoto({
      preview_path: `${photo.id}/preview.jpg`,
      thumb_path: `${photo.id}/thumb.jpg`,
      width,
      height,
      status: 'ready',
    })
  } catch {
    await deps.updatePhoto({ status: 'failed' })
    return
  }

  // Embedding + auto-clasificación de facetas, best-effort (no tumban el 'ready').
  try {
    const vector = await deps.embedImage(original)
    await deps.indexVector(vector)
    await deps.updatePhoto({ embedding_status: 'done' })
  } catch {
    await deps.updatePhoto({ embedding_status: 'failed' })
  }

  try {
    const facets = await deps.classifyFacets(original)
    await deps.indexFacets(facets)
  } catch {
    // clasificación best-effort: la foto queda sin facetas (null → no excluye en búsqueda)
  }
}
