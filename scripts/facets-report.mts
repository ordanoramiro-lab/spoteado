// scripts/facets-report.mts
// Reporte de auditoría: lista cada foto ready con su URL de preview + las facetas que la IA le asignó.
// Sirve para comparar a ojo lo que clasificó la IA contra la imagen real.
// Uso: npx tsx --env-file=.env.local scripts/facets-report.mts
import { createClient } from '@supabase/supabase-js'
import { previewUrl } from '@/lib/photos/public-url'
import { FACET_CATEGORIES } from '@/lib/facets'

const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const { data: photos } = await a
  .from('photos')
  .select('id, original_path, status, embedding_status')
  .eq('status', 'ready')
  .order('created_at', { ascending: false })

const { data: facetRows } = await a.from('photo_facets').select('photo_id, category, value')
const byPhoto = new Map<string, Record<string, string>>()
for (const r of facetRows ?? []) {
  const m = byPhoto.get(r.photo_id) ?? {}
  m[r.category] = r.value
  byPhoto.set(r.photo_id, m)
}

let conFacetas = 0
let sinFacetas = 0
const cobertura: Record<string, number> = {}

console.log(`\n=== ${photos?.length ?? 0} fotos ready ===\n`)
for (const p of photos ?? []) {
  const f = byPhoto.get(p.id) ?? {}
  const keys = Object.keys(f)
  if (keys.length) { conFacetas++; for (const k of keys) cobertura[k] = (cobertura[k] ?? 0) + 1 }
  else sinFacetas++
  const resumen = FACET_CATEGORIES.map((c) => `${c}=${f[c] ?? '·'}`).join('  ')
  console.log(`${p.id.slice(0, 8)}  ${previewUrl(p.id)}`)
  console.log(`   ${keys.length ? resumen : '(sin facetas — IA no estuvo segura)'}`)
}

console.log(`\n=== resumen ===`)
console.log(`con facetas: ${conFacetas} | sin facetas: ${sinFacetas}`)
console.log(`cobertura por categoría:`, JSON.stringify(cobertura))
