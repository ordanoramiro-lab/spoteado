import { type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmbedder } from '@/lib/embeddings'
import { makeThumbnail, watermarkPreview } from '@/lib/images'
import { upsertPhoto } from '@/lib/vectors'
import { processPhoto } from '@/lib/photos/process'

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const admin = createAdminClient()

  const { data: photo } = await admin
    .from('photos')
    .select('id, original_path, photographer_id, beach_id, session_id, captured_at, time_block')
    .eq('id', id)
    .single()
  if (!photo) return Response.json({ error: 'not found' }, { status: 404 })

  const { data: prof } = await admin
    .from('profiles')
    .select('watermark_position, watermark_opacity')
    .eq('id', photo.photographer_id)
    .single()
  const { data: beach } = await admin.from('beaches').select('slug').eq('id', photo.beach_id).single()

  await processPhoto(
    {
      downloadOriginal: async (path: string) => {
        const { data } = await admin.storage.from('originals').download(path)
        return Buffer.from(await data!.arrayBuffer())
      },
      uploadPublic: async (path: string, buf: Buffer) => {
        await admin.storage.from('public').upload(path, buf, { contentType: 'image/jpeg', upsert: true })
      },
      makePreview: (orig: Buffer) =>
        watermarkPreview(orig, {
          position: (prof?.watermark_position as 'bottom-right' | 'bottom-left' | 'center') ?? 'bottom-right',
          opacity: prof?.watermark_opacity ?? 0.6,
        }),
      makeThumb: (orig: Buffer) => makeThumbnail(orig),
      embedImage: (img: Buffer) => getEmbedder().embedImage(img),
      indexVector: (vector: number[]) =>
        upsertPhoto(vector, {
          id: photo.id,
          photographer_id: photo.photographer_id,
          beach_slug: beach?.slug ?? '',
          captured_at: photo.captured_at,
          time_block: photo.time_block,
          tags: [],
          status: 'ready',
          session_id: photo.session_id,
        }),
      updatePhoto: async (patch: Record<string, unknown>) => {
        await admin.from('photos').update(patch).eq('id', id)
      },
    },
    { id: photo.id, original_path: photo.original_path }
  )

  return Response.json({ ok: true })
}
