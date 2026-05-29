export type FacetCategory =
  | 'board_type'
  | 'maneuver'
  | 'stance'
  | 'sexo'
  | 'patas_de_rana'

// Vocabulario controlado en jerga surfera (slugs sin acento, aptos como keyword Qdrant / valor FK).
export const FACET_VOCAB: Record<FacetCategory, string[]> = {
  board_type: ['longboard', 'tabla-corta', 'fish', 'evolutiva', 'gun', 'espuma', 'sup', 'bodyboard', 'bodysurf'],
  maneuver: ['remando', 'drop', 'bottom-turn', 'cutback', 'floater', 'aereo', 're-entry', 'tubo', 'caida', 'caminando', 'maniobra'],
  stance: ['goofy', 'regular'],
  sexo: ['hombre', 'mujer'],
  patas_de_rana: ['si', 'no'],
}

export const FACET_CATEGORIES = Object.keys(FACET_VOCAB) as FacetCategory[]

export type Facet = { category: FacetCategory; value: string }

export function isValidFacet(category: string, value: string): boolean {
  const vals = FACET_VOCAB[category as FacetCategory]
  return Boolean(vals && vals.includes(value))
}

export function sanitizeFacets(facets: { category: string; value: string }[]): Facet[] {
  return facets.filter((f) => isValidFacet(f.category, f.value)) as Facet[]
}
