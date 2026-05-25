'use server'

import { requireRole, requireUser } from '@/lib/auth/dal'
import { createClient } from '@/lib/supabase/server'

export async function createUploadTarget(input: {
  fileName: string
  beachId: string
  sessionId: string | null
  capturedAt: string
}) {
  await requireRole('photographer')
  const user = await requireUser()
  const supabase = await createClient()

  const path = `${user.id}/${crypto.randomUUID()}-${input.fileName}`
  const { data: signed, error: sErr } = await supabase.storage
    .from('originals')
    .createSignedUploadUrl(path)
  if (sErr || !signed) throw new Error('No se pudo crear la URL de subida')

  const { data: photo, error: pErr } = await supabase
    .from('photos')
    .insert({
      photographer_id: user.id,
      beach_id: input.beachId,
      session_id: input.sessionId,
      captured_at: input.capturedAt,
      original_path: path,
      status: 'processing',
    })
    .select('id')
    .single()
  if (pErr || !photo) throw new Error('No se pudo crear la foto')

  return { photoId: photo.id, token: signed.token, path }
}
