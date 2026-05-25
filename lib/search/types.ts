export type SearchParams = {
  beach?: string
  from?: string      // ISO date (yyyy-mm-dd)
  to?: string
  timeBlock?: string
  tags?: string[]
  q?: string         // lenguaje natural
}
export type SearchPath = 'filters' | 'semantic'

export type PhotoResult = {
  id: string
  thumbUrl: string
  previewUrl: string
  price: number | null
  photographerSlug: string
  voteCount: number
  width: number | null
  height: number | null
}
