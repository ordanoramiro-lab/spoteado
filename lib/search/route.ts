import type { SearchParams, SearchPath } from './types'
import type { SearchFilter } from '@/lib/vectors'

export function parseSearchParams(raw: Record<string, string | undefined>): SearchParams {
  const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined)
  const tags = clean(raw.tags)?.split(',').map((t) => t.trim()).filter(Boolean)
  return {
    beach: clean(raw.beach),
    from: clean(raw.from),
    to: clean(raw.to),
    timeBlock: clean(raw.timeBlock),
    tags: tags?.length ? tags : undefined,
    q: clean(raw.q),
  }
}

export function decideSearchPath(p: SearchParams): SearchPath {
  return p.q && p.q.trim().length > 0 ? 'semantic' : 'filters'
}

export function buildVectorFilter(p: SearchParams): SearchFilter {
  return {
    beach_slug: p.beach,
    time_block: p.timeBlock,
    tags: p.tags,
    capturedFrom: p.from ? Math.floor(Date.parse(`${p.from}T00:00:00Z`) / 1000) : undefined,
    capturedTo: p.to ? Math.floor(Date.parse(`${p.to}T23:59:59Z`) / 1000) : undefined,
  }
}
