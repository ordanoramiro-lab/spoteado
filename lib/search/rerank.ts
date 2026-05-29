export type RerankItem = {
  id: string
  vectorScore: number
  capturedAt: number // epoch segundos
  voteCount: number
}

export type RerankOptions = { recencyWeight?: number; votesWeight?: number }

// score_final = vectorScore + recencyWeight*recencyNorm + votesWeight*votesNorm
// Las normalizaciones son min-max dentro del set para que los boosts sean comparables.
export function rerank(items: RerankItem[], opts: RerankOptions = {}): RerankItem[] {
  const recencyWeight = opts.recencyWeight ?? 0.05
  const votesWeight = opts.votesWeight ?? 0.05
  if (items.length === 0) return []

  const norm = (vals: number[]) => {
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const span = max - min
    return (v: number) => (span === 0 ? 0 : (v - min) / span)
  }
  const recNorm = norm(items.map((i) => i.capturedAt))
  const voteNorm = norm(items.map((i) => i.voteCount))

  return [...items]
    .map((i) => ({
      item: i,
      score: i.vectorScore + recencyWeight * recNorm(i.capturedAt) + votesWeight * voteNorm(i.voteCount),
    }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item)
}
