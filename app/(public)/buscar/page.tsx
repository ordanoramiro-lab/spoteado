// app/(public)/buscar/page.tsx
import { createClient } from '@/lib/supabase/server'
import { getEmbedder } from '@/lib/embeddings'
import { getUnderstander } from '@/lib/search/understand'
import { searchPhotos, scrollPhotos, type SearchFilter } from '@/lib/vectors'
import { runSearch, type SearchDeps } from '@/lib/search/execute'
import type { PhotoResult, ParsedFilters, QueryUnderstanding } from '@/lib/search/types'
import { FACET_CATEGORIES, type FacetCategory } from '@/lib/facets'
import { previewUrl, thumbUrl } from '@/lib/photos/public-url'
import { Masonry } from '@/components/photo/masonry'
import type { RerankItem } from '@/lib/search/rerank'

type Row = { id: string; price: number | null; vote_count: number; width: number | null; height: number | null; photographer_id: string; captured_at: string }

function toResult(r: Row): PhotoResult {
  return {
    id: r.id, thumbUrl: thumbUrl(r.id), previewUrl: previewUrl(r.id),
    price: r.price, photographerSlug: r.photographer_id, voteCount: r.vote_count,
    width: r.width, height: r.height,
  }
}

// Lee los filtros del panel manual desde el query string (CSV por categoría).
function parseManualFilters(raw: Record<string, string | undefined>): ParsedFilters {
  const csv = (v?: string) => (v && v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined)
  const facets: Partial<Record<FacetCategory, string[]>> = {}
  for (const c of FACET_CATEGORIES) { const vals = csv(raw[c]); if (vals) facets[c] = vals }
  return {
    beach_slug: raw.beach?.trim() || undefined,
    timeBlock: csv(raw.timeBlock),
    from: raw.from?.trim() || undefined,
    to: raw.to?.trim() || undefined,
    facets: Object.keys(facets).length ? facets : undefined,
  }
}

export default async function BuscarPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  const raw = await searchParams
  const supabase = await createClient()
  const select = 'id, price, vote_count, width, height, photographer_id, captured_at'
  const q = raw.q?.trim() ?? ''
  const manual = parseManualFilters(raw)

  // Capa de entendimiento (con fallback robusto: si el LLM falla, va CLIP sobre el texto crudo).
  let understanding: QueryUnderstanding = { filters: {}, visualQuery: q }
  if (q) {
    try {
      const { data: beaches } = await supabase.from('beaches').select('slug, name')
      understanding = await getUnderstander().understand(q, {
        beaches: beaches ?? [],
        today: new Date().toISOString().slice(0, 10),
      })
    } catch {
      understanding = { filters: {}, visualQuery: q }
    }
  }

  const fetchByFilters = async (filter: SearchFilter): Promise<RerankItem[]> => {
    // Todo el filtro (beach + fecha + facetas, con "vacío no excluye") vive en el payload de
    // Qdrant: scroll trae los IDs que matchean; Postgres aporta captured_at + vote_count.
    // Nota: solo aparecen fotos con embedding indexado (las de embedding_status='failed' quedan fuera).
    const ids = await scrollPhotos(filter, 60)
    if (ids.length === 0) return []
    const { data } = await supabase.from('photos').select('id, vote_count, captured_at').in('id', ids)
    return (data ?? []).map((r) => ({
      id: r.id, vectorScore: 0,
      capturedAt: Math.floor(Date.parse(r.captured_at) / 1000), voteCount: r.vote_count,
    }))
  }

  const deps: SearchDeps = {
    embedText: (text) => getEmbedder().embedText(text),
    vectorSearch: (vector, filter) => searchPhotos(vector, filter),
    fetchByFilters,
    fetchResults: async (ids) => {
      if (ids.length === 0) return []
      const { data } = await supabase.from('photos').select(select).in('id', ids)
      const byId = new Map((data ?? []).map((r) => [r.id, toResult(r as Row)]))
      return ids.map((id) => byId.get(id)).filter((r): r is PhotoResult => Boolean(r)) // preserva orden del rerank
    },
  }

  const results = await runSearch(deps, understanding, manual)

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <p className="text-sm text-ink/60">{results.length} fotos</p>
      {results.length === 0 ? (
        <p className="py-12 text-center text-ink/50">
          No encontramos fotos con eso — probá sacar un filtro o describilo distinto.
        </p>
      ) : (
        <Masonry photos={results} />
      )}
    </main>
  )
}
