// scripts/reclassify-all.mts
// Re-clasifica TODAS las fotos ready con el clasificador actual y reemplaza limpio
// las facetas en Postgres (photo_facets) y en el payload de Qdrant (borra las viejas).
// Uso: npx tsx --env-file=.env.local scripts/reclassify-all.mts
import { createClient } from '@supabase/supabase-js'
import { QdrantClient } from '@qdrant/js-client-rest'
import { getClassifier, applyThreshold } from '@/lib/classify'
import { FACET_CATEGORIES } from '@/lib/facets'
import { PHOTOS_COLLECTION } from '@/lib/vectors'

const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const q = new QdrantClient({ url: process.env.QDRANT_URL!, apiKey: process.env.QDRANT_API_KEY! })

async function download(path: string): Promise<Buffer | null> {
  for (let i = 0; i < 4; i++) {
    const { data } = await a.storage.from('originals').download(path)
    if (data) return Buffer.from(await data.arrayBuffer())
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

const { data: photos } = await a.from('photos').select('id, original_path').eq('status', 'ready').eq('embedding_status', 'done')
console.log(`Re-clasificando ${photos?.length ?? 0} fotos`)
let ok = 0, fail = 0
for (const p of photos ?? []) {
  try {
    const buf = await download(p.original_path)
    if (!buf) { console.log(`  SKIP ${p.id.slice(0, 8)} (download)`); fail++; continue }
    const facets = applyThreshold(await getClassifier().classify(buf)) as Record<string, string>

    // Postgres: borrar y reinsertar.
    await a.from('photo_facets').delete().eq('photo_id', p.id)
    const rows = Object.entries(facets).map(([category, value]) => ({ photo_id: p.id, category, value }))
    if (rows.length) await a.from('photo_facets').insert(rows)

    // Qdrant: limpiar todas las claves de faceta y setear las nuevas.
    await q.deletePayload(PHOTOS_COLLECTION, { keys: FACET_CATEGORIES as unknown as string[], points: [p.id] })
    if (rows.length) await q.setPayload(PHOTOS_COLLECTION, { payload: facets, points: [p.id] })

    ok++
    if (ok % 10 === 0) console.log(`  ${ok} ok…`)
  } catch (e: unknown) {
    fail++
    console.log(`  FALLA ${p.id.slice(0, 8)}: ${(e as Error).message?.slice(0, 90)}`)
  }
}
console.log(`Listo. ok=${ok} fail=${fail}`)
