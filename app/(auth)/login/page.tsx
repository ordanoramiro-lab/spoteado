import Link from 'next/link'
import { AuthForm } from '../auth-form'
import { signIn } from '../actions'

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
      <h1 className="font-serif text-3xl">Ingresar</h1>
      <AuthForm action={signIn} mode="login" />
      <p className="text-sm text-ink/60">
        ¿No tenés cuenta?{' '}
        <Link href="/signup" className="text-accent">
          Registrate
        </Link>
      </p>
    </main>
  )
}
