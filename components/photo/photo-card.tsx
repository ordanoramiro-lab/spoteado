'use client'
import Image from 'next/image'
import type { PhotoResult } from '@/lib/search/types'

export function PhotoCard({ photo, onOpen }: { photo: PhotoResult; onOpen: (p: PhotoResult) => void }) {
  return (
    <button onClick={() => onOpen(photo)} className="group relative mb-3 block w-full break-inside-avoid">
      <Image
        src={photo.thumbUrl}
        alt=""
        width={photo.width ?? 600}
        height={photo.height ?? 400}
        className="w-full bg-ink/5 transition-opacity duration-500 group-hover:opacity-95"
      />
      {photo.price != null && (
        <span className="absolute bottom-2 right-2 bg-canvas/90 px-2 py-0.5 text-xs">${photo.price}</span>
      )}
    </button>
  )
}
