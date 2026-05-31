// scripts/backfill-facets.mts
// Re-procesa fotos ready ya cargadas: auto-clasifica facetas + re-indexa payload.
// Uso: npx tsx --env-file=.env.local scripts/backfill-facets.mts
import { createClient } from '@supabase/supabase-js'
import { getClassifier, applyThreshold } from '@/lib/classify'
import { ensureCollection, setPhotoFacetsPayload } from '@/lib/vectors'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

await ensureCollection() // crea los índices de payload nuevos (board_type, stance, etc.)

const { data: photos, error } = await admin
  .from('photos')
  .select('id, original_path')
  .eq('status', 'ready')
  .eq('embedding_status', 'done')
if (error) throw new Error(error.message)

console.log(`Backfilling ${photos?.length ?? 0} fotos`)
for (const photo of photos ?? []) {
  const { data: blob, error: dlErr } = await admin.storage.from('originals').download(photo.original_path)
  if (dlErr || !blob) { console.log(`  ${photo.id}: SKIP (download falló: ${dlErr?.message})`); continue }
  const buf = Buffer.from(await blob.arrayBuffer())
  const facets = applyThreshold(await getClassifier().classify(buf))
  const rows = Object.entries(facets).map(([category, value]) => ({ photo_id: photo.id, category, value }))
  if (rows.length) {
    const { error: upErr } = await admin.from('photo_facets').upsert(rows, { onConflict: 'photo_id,category' })
    if (upErr) { console.log(`  ${photo.id}: ERROR upsert ${upErr.message}`); continue }
  }
  await setPhotoFacetsPayload(photo.id, facets)
  console.log(`  ${photo.id}: ${JSON.stringify(facets)}`)
}
console.log('Listo.')
