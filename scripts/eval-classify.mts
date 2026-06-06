// scripts/eval-classify.mts
// Mini-eval de clasificación contra ground-truth (correcciones del usuario sobre 5 fotos).
// Clasifica el ORIGINAL de cada foto con el clasificador actual y compara.
// Uso: npx tsx --env-file=.env.local scripts/eval-classify.mts
import { createClient } from '@supabase/supabase-js'
import { getClassifier, applyThreshold } from '@/lib/classify'

const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Ground-truth del usuario. "!x" = NO debe ser x. "*" = debe haber algo (no vacío).
const GT: Record<string, { label: string; expect: Record<string, string> }> = {
  'fcfee338-52b8-48a5-954a-53e2e0159207': { label: 's2', expect: { board_type:'tabla-corta', maneuver:'cutback', stance:'regular', sexo:'mujer', patas_de_rana:'no' } },
  'bd2710e8-c458-4420-9827-6b47b475b845': { label: 's5', expect: { maneuver:'tubo' } },
  '2f39829f-98d3-41fc-9326-ba1295b8cef0': { label: 's3', expect: { board_type:'bodyboard', patas_de_rana:'si', maneuver:'!tubo' } },
  '7d86f3f9-f67b-4e62-a735-a947a418fcda': { label: 's4', expect: { maneuver:'drop', stance:'regular' } },
  'bdd6c477-3dda-407e-bc1b-19173d8736dc': { label: 's1', expect: { __any__:'*' } },
}

let aciertos = 0, errores = 0
for (const [id, { label, expect }] of Object.entries(GT)) {
  const { data: photo } = await a.from('photos').select('original_path').eq('id', id).single()
  let blob: Blob | null = null
  for (let i = 0; i < 4 && !blob; i++) {
    const r = await a.storage.from('originals').download(photo!.original_path)
    blob = r.data
    if (!blob) await new Promise((res) => setTimeout(res, 500))
  }
  if (!blob) { console.log(`${label} ${id.slice(0,8)}  (download falló tras reintentos)`); continue }
  const buf = Buffer.from(await blob.arrayBuffer())
  let pred: Record<string, string> = {}
  try { pred = applyThreshold(await getClassifier().classify(buf)) as Record<string, string> }
  catch (e: unknown) { console.log(`  (classify FALLA: ${(e as Error).message?.slice(0, 80)})`) }

  const marks: string[] = []
  for (const [cat, want] of Object.entries(expect)) {
    if (cat === '__any__') { const ok = Object.keys(pred).length > 0; marks.push(`${ok?'✓':'✗'}no-vacío`); ok?aciertos++:errores++; continue }
    const got = (pred as Record<string,string>)[cat]
    if (want.startsWith('!')) { const ok = got !== want.slice(1); marks.push(`${ok?'✓':'✗'}${cat}≠${want.slice(1)}`); ok?aciertos++:errores++ }
    else { const ok = got === want; marks.push(`${ok?'✓':'✗'}${cat}=${want}${ok?'':`(dio:${got??'·'})`}`); ok?aciertos++:errores++ }
  }
  console.log(`${label} ${id.slice(0,8)}  pred=${JSON.stringify(pred)}`)
  console.log(`     ${marks.join('  ')}`)
}
console.log(`\nSCORE: ${aciertos} aciertos / ${aciertos+errores} chequeos  (errores: ${errores})`)
