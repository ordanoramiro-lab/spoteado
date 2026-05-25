import { requireRole } from '@/lib/auth/dal'
import { createClient } from '@/lib/supabase/server'
import { setPhotoPrice } from '@/app/(dashboard)/_actions/catalog'

export default async function FotosPage() {
  await requireRole('photographer')
  const supabase = await createClient()
  const { data: photos } = await supabase
    .from('photos')
    .select('id, price, status, thumb_path, session_id')
    .order('created_at', { ascending: false })

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="font-serif text-2xl">Mis fotos</h1>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(photos ?? []).map((p) => (
          <li key={p.id} className="flex flex-col gap-2 border border-ink/10 p-2">
            <span className="text-xs text-ink/50">{p.status}</span>
            <form action={async (fd: FormData) => { 'use server'; await setPhotoPrice(p.id, Number(fd.get('price'))) }}>
              <input name="price" type="number" defaultValue={p.price ?? ''} placeholder="$ precio"
                className="w-full border-b border-ink/15 bg-transparent py-1 text-sm" />
            </form>
          </li>
        ))}
      </ul>
    </main>
  )
}
