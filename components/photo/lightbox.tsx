'use client'
import Image from 'next/image'
import Link from 'next/link'
import type { PhotoResult } from '@/lib/search/types'

export function Lightbox({ photo, onClose }: { photo: PhotoResult; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas md:flex-row">
      <button aria-label="cerrar" onClick={onClose} className="absolute right-4 top-4 z-10 text-xl">✕</button>
      <div className="flex flex-1 items-center justify-center bg-ink/5 p-4">
        <Image src={photo.previewUrl} alt="" width={photo.width ?? 1200} height={photo.height ?? 800} className="max-h-full w-auto" />
      </div>
      <aside className="flex w-full flex-col gap-3 p-6 md:max-w-xs">
        <Link href={`/fotografo/${photo.photographerSlug}`} className="text-sm text-accent">
          @{photo.photographerSlug}
        </Link>
        {photo.price != null && <p className="font-serif text-2xl">${photo.price}</p>}
        <button className="rounded-sm bg-accent px-4 py-2 text-canvas">Agregar al carrito</button>
      </aside>
    </div>
  )
}
