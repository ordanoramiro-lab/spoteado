// components/search/search-bar.tsx
'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

const FILTER_GROUPS: { category: string; label: string; values: { value: string; label: string }[] }[] = [
  { category: 'board_type', label: 'Tabla', values: [
    { value: 'longboard', label: 'Longboard' }, { value: 'tabla-corta', label: 'Tabla corta' },
    { value: 'fish', label: 'Fish' }, { value: 'evolutiva', label: 'Evolutiva' }, { value: 'gun', label: 'Gun' },
    { value: 'espuma', label: 'Espuma' }, { value: 'sup', label: 'SUP' }, { value: 'bodyboard', label: 'Bodyboard' },
    { value: 'bodysurf', label: 'Bodysurf' },
  ] },
  { category: 'maneuver', label: 'Maniobra', values: [
    { value: 'remando', label: 'Remando' }, { value: 'drop', label: 'Drop' },
    { value: 'bottom-turn', label: 'Bottom turn' }, { value: 'cutback', label: 'Cutback' },
    { value: 'floater', label: 'Floater' }, { value: 'aereo', label: 'Aéreo' },
    { value: 're-entry', label: 'Re-entry' }, { value: 'tubo', label: 'Tubo' },
    { value: 'caida', label: 'Caída' }, { value: 'caminando', label: 'Caminando' },
    { value: 'maniobra', label: 'Maniobra' },
  ] },
  { category: 'stance', label: 'Stance', values: [{ value: 'goofy', label: 'Goofy' }, { value: 'regular', label: 'Regular' }] },
  { category: 'sexo', label: 'Surfista', values: [{ value: 'hombre', label: 'Hombre' }, { value: 'mujer', label: 'Mujer' }] },
  { category: 'patas_de_rana', label: 'Patas de rana', values: [{ value: 'si', label: 'Con' }, { value: 'no', label: 'Sin' }] },
]

export function SearchBar({ beaches }: { beaches: { slug: string; name: string }[] }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [beach, setBeach] = useState('')
  const [date, setDate] = useState('')
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<Record<string, string[]>>({})

  function toggle(category: string, value: string) {
    setSel((s) => {
      const cur = s[category] ?? []
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
      return { ...s, [category]: next }
    })
  }

  function go() {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (beach) params.set('beach', beach)
    if (date) { params.set('from', date); params.set('to', date) }
    for (const [cat, vals] of Object.entries(sel)) if (vals.length) params.set(cat, vals.join(','))
    router.push(`/buscar?${params.toString()}`)
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-3 bg-canvas/95 p-4">
      <input
        value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') go() }}
        placeholder="describí tu sesión: dónde, cuándo, cómo ibas…"
        className="border-b border-ink/15 bg-transparent py-2 text-lg"
      />
      <button onClick={() => setOpen((o) => !o)} className="self-start text-sm text-ink/60 underline">
        {open ? 'Ocultar filtros' : 'Filtros'}
      </button>
      {open && (
        <div className="flex flex-col gap-3">
          <select value={beach} onChange={(e) => setBeach(e.target.value)} className="border-b border-ink/15 bg-transparent py-2">
            <option value="">Playa</option>
            {beaches.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border-b border-ink/15 bg-transparent py-2" />
          {FILTER_GROUPS.map((g) => (
            <div key={g.category} className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-ink/40">{g.label}</span>
              <div className="flex flex-wrap gap-2">
                {g.values.map((v) => {
                  const active = (sel[g.category] ?? []).includes(v.value)
                  return (
                    <button
                      key={v.value} onClick={() => toggle(g.category, v.value)}
                      className={`rounded-full border px-3 py-1 text-sm ${active ? 'border-accent bg-accent text-canvas' : 'border-ink/20 text-ink/70'}`}
                    >{v.label}</button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <button onClick={go} className="rounded-sm bg-accent px-4 py-2 text-canvas">Buscar</button>
    </div>
  )
}
