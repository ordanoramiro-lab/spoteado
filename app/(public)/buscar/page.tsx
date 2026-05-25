import { createClient } from '@/lib/supabase/server'
import { getEmbedder } from '@/lib/embeddings'
import { searchPhotos } from '@/lib/vectors'
import { parseSearchParams } from '@/lib/search/route'
import { runSearch } from '@/lib/search/execute'
import type { PhotoResult } from '@/lib/search/types'
import { previewUrl, thumbUrl } from '@/lib/photos/public-url'
import { Masonry } from '@/components/photo/masonry'

type Row = {
  id: string; price: number | null; vote_count: number; width: number | null; height: number | null; photographer_id: string
}

function toResult(r: Row): PhotoResult {
  return {
    id: r.id, thumbUrl: thumbUrl(r.id), previewUrl: previewUrl(r.id),
    price: r.price, photographerSlug: r.photographer_id, voteCount: r.vote_count,
    width: r.width, height: r.height,
  }
}

export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = parseSearchParams(await searchParams)
  const supabase = await createClient()
  const select = 'id, price, vote_count, width, height, photographer_id'

  const results = await runSearch(
    {
      embedText: (q) => getEmbedder().embedText(q),
      vectorSearch: (vector, filter) => searchPhotos(vector, filter),
      fetchByFilters: async (p) => {
        let query = supabase.from('photos').select(select).eq('status', 'ready')
        if (p.beach) {
          const { data: b } = await supabase.from('beaches').select('id').eq('slug', p.beach).single()
          if (b) query = query.eq('beach_id', b.id)
        }
        if (p.from) query = query.gte('captured_at', `${p.from}T00:00:00Z`)
        if (p.to) query = query.lte('captured_at', `${p.to}T23:59:59Z`)
        const { data } = await query.order('captured_at', { ascending: false }).limit(60)
        return (data ?? []).map((r) => toResult(r as Row))
      },
      fetchByIds: async (ids) => {
        const { data } = await supabase.from('photos').select(select).in('id', ids)
        return (data ?? []).map((r) => toResult(r as Row))
      },
    },
    params
  )

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <p className="text-sm text-ink/60">{results.length} fotos</p>
      <Masonry photos={results} />
    </main>
  )
}
