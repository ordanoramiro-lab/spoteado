'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { createSession } from '@/app/(dashboard)/_actions/catalog'
import { createUploadTarget } from '@/app/(dashboard)/_actions/upload'

type Item = { name: string; status: 'subiendo' | 'procesando' | 'listo' | 'error' }

export function Uploader({ beaches }: { beaches: { id: string; name: string }[] }) {
  const [beachId, setBeachId] = useState(beaches[0]?.id ?? '')
  const [date, setDate] = useState('')
  const [items, setItems] = useState<Item[]>([])

  async function onFiles(files: FileList) {
    const sessionId = await createSession({
      beachId, sessionDate: date, timeBlock: null, title: '',
    })
    const supabase = createClient()
    for (const file of Array.from(files)) {
      setItems((p) => [...p, { name: file.name, status: 'subiendo' }])
      const setStatus = (s: Item['status']) =>
        setItems((p) => p.map((it) => (it.name === file.name ? { ...it, status: s } : it)))
      try {
        const { photoId, token, path } = await createUploadTarget({
          fileName: file.name, beachId, sessionId, capturedAt: new Date(date).toISOString(),
        })
        const { error } = await supabase.storage.from('originals').uploadToSignedUrl(path, token, file)
        if (error) throw error
        setStatus('procesando')
        await fetch(`/api/photos/${photoId}/process`, { method: 'POST' })
        setStatus('listo')
      } catch {
        setStatus('error')
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3">
        <select value={beachId} onChange={(e) => setBeachId(e.target.value)} className="border-b border-ink/15 bg-transparent py-2">
          {beaches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border-b border-ink/15 bg-transparent py-2" />
      </div>
      <input type="file" multiple accept="image/*" disabled={!beachId || !date}
        onChange={(e) => e.target.files && onFiles(e.target.files)} />
      <ul className="flex flex-col gap-1 text-sm">
        {items.map((it, i) => (
          <li key={i} className="flex justify-between border-b border-ink/5 py-1">
            <span>{it.name}</span>
            <span className={it.status === 'error' ? 'text-heart' : 'text-ink/60'}>{it.status}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
