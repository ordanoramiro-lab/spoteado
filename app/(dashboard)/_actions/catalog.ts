'use server'

import { requireUser } from '@/lib/auth/dal'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

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
