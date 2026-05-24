import Link from 'next/link'
import { AuthForm } from '../auth-form'
import { signUp } from '../actions'

export default function SignupPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
      <h1 className="font-serif text-3xl">Crear cuenta</h1>
      <AuthForm action={signUp} mode="signup" />
      <p className="text-sm text-ink/60">
        ¿Ya tenés cuenta?{' '}
        <Link href="/login" className="text-accent">
          Ingresá
        </Link>
      </p>
    </main>
  )
}
