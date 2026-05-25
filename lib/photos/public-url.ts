const BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/public`
export const previewUrl = (photoId: string) => `${BASE}/${photoId}/preview.jpg`
export const thumbUrl = (photoId: string) => `${BASE}/${photoId}/thumb.jpg`
