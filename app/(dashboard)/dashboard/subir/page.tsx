import { requireRole } from '@/lib/auth/dal'
import { createClient } from '@/lib/supabase/server'
import { Uploader } from './uploader'

export default async function SubirPage() {
  await requireRole('photographer')
  const supabase = await createClient()
  const { data: beaches } = await supabase.from('beaches').select('id, name').order('name')
  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <h1 className="font-serif text-2xl">Subir fotos</h1>
      <Uploader beaches={beaches ?? []} />
    </main>
  )
}
