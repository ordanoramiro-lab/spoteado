import { createClient } from '@/lib/supabase/server'
import { thumbUrl, previewUrl } from '@/lib/photos/public-url'
import { Masonry } from '@/components/photo/masonry'
import type { PhotoResult } from '@/lib/search/types'

export default async function SesionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: session } = await supabase
    .from('sessions').select('title, pack_price, photographer_id').eq('id', id).single()
  const { data: photos } = await supabase
    .from('photos').select('id, price, vote_count, width, height')
    .eq('session_id', id).eq('status', 'ready')

  const results: PhotoResult[] = (photos ?? []).map((r) => ({
    id: r.id, thumbUrl: thumbUrl(r.id), previewUrl: previewUrl(r.id),
    price: r.price, photographerSlug: session?.photographer_id ?? '', voteCount: r.vote_count,
    width: r.width, height: r.height,
  }))

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="font-serif text-2xl">{session?.title ?? 'Sesión'}</h1>
        {session?.pack_price != null && (
          <span className="text-sm">Pack completo: <strong>${session.pack_price}</strong></span>
        )}
      </header>
      <Masonry photos={results} />
    </main>
  )
}
