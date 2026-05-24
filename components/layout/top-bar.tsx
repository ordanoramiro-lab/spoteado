import Link from 'next/link'
import { getUser } from '@/lib/auth/dal'
import { signOut } from '@/app/(auth)/actions'

export async function TopBar() {
  const user = await getUser()
  return (
    <header className="flex items-center justify-between border-b border-ink/10 px-6 py-4">
      <Link href="/" className="font-serif text-xl">
        Spoteado
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/ranking" className="hidden text-ink/70 md:inline">
          Ranking
        </Link>
        {user ? (
          <form action={signOut}>
            <button type="submit" className="text-ink/70">Salir</button>
          </form>
        ) : (
          <Link href="/login" className="text-accent">
            Ingresar
          </Link>
        )}
      </nav>
    </header>
  )
}
