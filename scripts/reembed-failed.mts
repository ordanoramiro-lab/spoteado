// scripts/reembed-failed.mts
// Re-embebe e indexa en Qdrant las fotos con embedding_status='failed'
// (p.ej. las que fallaron porque el original era demasiado grande para Jina).
// Embebe el THUMB e incluye en el payload las facetas ya guardadas en Postgres.
// Uso: npx tsx --env-file=.env.local scripts/reembed-failed.mts
import { createClient } from '@supabase/supabase-js'
import { getEmbedder } from '@/lib/embeddings'
import { makeThumbnail } from '@/lib/images'
import { upsertPhoto, ensureCollection, type PhotoFacets } from '@/lib/vectors'

const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
await ensureCollection()

const { data: photos, error } = await a
  .from('photos')
  .select('id, original_path, photographer_id, beach_id, session_id, captured_at, time_block')
  .eq('status', 'ready')
  .eq('embedding_status', 'failed')
if (error) throw new Error(error.message)

console.log(`Re-embebiendo ${photos?.length ?? 0} fotos`)
let ok = 0, fail = 0
for (const p of photos ?? []) {
  try {
    const { data: beach } = await a.from('beaches').select('slug').eq('id', p.beach_id).single()
    const { data: facetRows } = await a.from('photo_facets').select('category, value').eq('photo_id', p.id)
    const facets: PhotoFacets = {}
    for (const r of facetRows ?? []) (facets as Record<string, string>)[r.category] = r.value

    const { data: blob } = await a.storage.from('originals').download(p.original_path)
    const orig = Buffer.from(await blob!.arrayBuffer())
    const thumb = await makeThumbnail(orig)
    const vector = await getEmbedder().embedImage(thumb)

    await upsertPhoto(vector, {
      id: p.id,
      photographer_id: p.photographer_id,
      beach_slug: beach?.slug ?? '',
      captured_at: p.captured_at,
      time_block: p.time_block,
      facets,
      status: 'ready',
      session_id: p.session_id,
    })
    await a.from('photos').update({ embedding_status: 'done' }).eq('id', p.id)
    ok++
    if (ok % 10 === 0) console.log(`  ${ok} ok…`)
  } catch (e: unknown) {
    fail++
    console.log(`  FALLA ${p.id.slice(0, 8)}: ${(e as Error).message?.slice(0, 100)}`)
  }
}
console.log(`Listo. ok=${ok} fail=${fail}`)
