'use client'

import { useActionState } from 'react'
import type { AuthState } from './actions'

type Action = (prev: AuthState, formData: FormData) => Promise<AuthState>

export function AuthForm({
  action,
  mode,
}: {
  action: Action
  mode: 'login' | 'signup'
}) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, null)

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      {mode === 'signup' && (
        <>
          <input
            name="display_name"
            placeholder="Tu nombre"
            className="border-b border-ink/15 bg-transparent py-2 outline-none focus:border-accent"
          />
          <label className="flex gap-4 text-sm text-ink/70">
            <span className="flex items-center gap-2">
              <input type="radio" name="role" value="surfer" defaultChecked /> Surfista
            </span>
            <span className="flex items-center gap-2">
              <input type="radio" name="role" value="photographer" /> Fotógrafo
            </span>
          </label>
        </>
      )}
      <input
        name="email"
        type="email"
        placeholder="Email"
        required
        className="border-b border-ink/15 bg-transparent py-2 outline-none focus:border-accent"
      />
      <input
        name="password"
        type="password"
        placeholder="Contraseña"
        required
        className="border-b border-ink/15 bg-transparent py-2 outline-none focus:border-accent"
      />
      {state?.error && <p className="text-sm text-heart">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-sm bg-accent px-4 py-2 text-canvas disabled:opacity-50"
      >
        {pending ? '...' : mode === 'login' ? 'Ingresar' : 'Crear cuenta'}
      </button>
    </form>
  )
}
