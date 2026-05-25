'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function SearchBar({ beaches }: { beaches: { slug: string; name: string }[] }) {
  const router = useRouter()
  const [beach, setBeach] = useState('')
  const [date, setDate] = useState('')
  const [q, setQ] = useState('')
  function go() {
    const params = new URLSearchParams()
    if (beach) params.set('beach', beach)
    if (date) { params.set('from', date); params.set('to', date) }
    if (q) params.set('q', q)
    router.push(`/buscar?${params.toString()}`)
  }
  return (
    <div className="flex w-full max-w-md flex-col gap-3 bg-canvas/95 p-4">
      <select value={beach} onChange={(e) => setBeach(e.target.value)} className="border-b border-ink/15 bg-transparent py-2">
        <option value="">Playa</option>
        {beaches.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
      </select>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border-b border-ink/15 bg-transparent py-2" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="describí tu foto…" className="border-b border-ink/15 bg-transparent py-2" />
      <button onClick={go} className="rounded-sm bg-accent px-4 py-2 text-canvas">Buscar</button>
    </div>
  )
}
