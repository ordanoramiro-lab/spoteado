import { createClient } from '@/lib/supabase/server'
import { thumbUrl, previewUrl } from '@/lib/photos/public-url'
import { Masonry } from '@/components/photo/masonry'
import type { PhotoResult } from '@/lib/search/types'

export default async function FotografoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: prof } = await supabase.from('profiles').select('display_name').eq('id', slug).single()
  const { data: photos } = await supabase
    .from('photos').select('id, price, vote_count, width, height')
    .eq('photographer_id', slug).eq('status', 'ready').order('captured_at', { ascending: false })

  const results: PhotoResult[] = (photos ?? []).map((r) => ({
    id: r.id, thumbUrl: thumbUrl(r.id), previewUrl: previewUrl(r.id),
    price: r.price, photographerSlug: slug, voteCount: r.vote_count, width: r.width, height: r.height,
  }))

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="font-serif text-2xl">{prof?.display_name ?? 'Fotógrafo'}</h1>
      <Masonry photos={results} />
    </main>
  )
}
