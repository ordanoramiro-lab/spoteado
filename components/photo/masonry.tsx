'use client'
import { useState } from 'react'
import type { PhotoResult } from '@/lib/search/types'
import { PhotoCard } from './photo-card'
import { Lightbox } from './lightbox'

export function Masonry({ photos }: { photos: PhotoResult[] }) {
  const [open, setOpen] = useState<PhotoResult | null>(null)
  if (photos.length === 0) {
    return <p className="py-12 text-center text-ink/50">No encontramos fotos. Probá ampliar los filtros.</p>
  }
  return (
    <>
      <div className="columns-2 gap-3 md:columns-3 lg:columns-4">
        {photos.map((p) => <PhotoCard key={p.id} photo={p} onOpen={setOpen} />)}
      </div>
      {open && <Lightbox photo={open} onClose={() => setOpen(null)} />}
    </>
  )
}
