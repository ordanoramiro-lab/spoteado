import { requireRole } from '@/lib/auth/dal'

export default async function DashboardPage() {
  await requireRole('photographer')
  return (
    <main className="flex flex-1 flex-col gap-2 p-6">
      <h1 className="font-serif text-2xl">Dashboard del fotógrafo</h1>
      <p className="text-ink/60">Las herramientas de gestión llegan en la Fase 1.</p>
    </main>
  )
}
