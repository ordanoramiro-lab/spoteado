'use server'

import { requireUser } from '@/lib/auth/dal'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { setPhotoTagsPayload } from '@/lib/vectors'

export async function createSession(input: {
  beachId: string; sessionDate: string; timeBlock: string | null; title: string
}) {
  const user = await requireUser()
  const supabase = await createClient()
  const { data, error } = await supabase.from('sessions').insert({
    photographer_id: user.id,
    beach_id: input.beachId,
    session_date: input.sessionDate,
    time_block: input.timeBlock,
    title: input.title,
  }).select('id').single()
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/fotos')
  return data.id as string
}

export async function setPhotoPrice(photoId: string, price: number) {
  const user = await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.from('photos').update({ price })
    .eq('id', photoId).eq('photographer_id', user.id) // authz: solo lo propio
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/fotos')
}

export async function setPackPrice(sessionId: string, packPrice: number) {
  const user = await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.from('sessions').update({ pack_price: packPrice })
    .eq('id', sessionId).eq('photographer_id', user.id)
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/fotos')
}

export async function setPhotoTags(photoId: string, tagNames: string[]) {
  const user = await requireUser()
  const supabase = await createClient()

  const { data: photo } = await supabase.from('photos')
    .select('id, embedding_status').eq('id', photoId).eq('photographer_id', user.id).single()
  if (!photo) throw new Error('Foto no encontrada')

  const slugify = (s: string) => s.toLowerCase().trim().replace(/\s+/g, '-')
  for (const name of tagNames) {
    const slug = slugify(name)
    const { data: tag } = await supabase.from('tags')
      .upsert({ name, slug }, { onConflict: 'slug' }).select('id').single()
    if (tag) await supabase.from('photo_tags').upsert({ photo_id: photoId, tag_id: tag.id })
  }

  // Mantener el filtro de tags de la búsqueda en sync (sin re-embeddear).
  if (photo.embedding_status === 'done') {
    await setPhotoTagsPayload(photoId, tagNames.map(slugify))
  }
  revalidatePath('/dashboard/fotos')
}
