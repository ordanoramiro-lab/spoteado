# Fase 0 — Fundaciones: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar una app Next.js 16 deployable con auth por roles (fotógrafo/surfista), el sistema visual editorial, y los esqueletos de infraestructura (Supabase, env, testing) sobre los que se construyen las fases siguientes.

**Architecture:** Monolito Next (App Router) en TypeScript. Supabase para Auth + Postgres vía `@supabase/ssr` (server/browser clients + middleware de refresh de sesión). La tabla `profiles` extiende `auth.users` con un `role`, poblada por un trigger en el signup. Toda la lógica sensible vive en Server Actions / DAL; RLS prendido como defensa en profundidad.

**Tech Stack:** Next.js 16.2.6, React 19, TypeScript, Tailwind 4, `@supabase/ssr` + `@supabase/supabase-js`, `zod` (validación de env), Vitest + Testing Library (tests).

**Convenciones (Next 16 — confirmadas en `node_modules/next/dist/docs`):**
- `cookies()` es **async**: `const store = await cookies()`.
- `params` / `searchParams` son **Promises** en páginas.
- Server Actions: archivo con `'use server'` arriba; `redirect` desde `next/navigation`.
- Alias de imports: `@/*` → raíz del repo (ej. `@/lib/env`).
- Fonts vía `next/font/google` con `variable`, aplicadas en `app/layout.tsx`.

---

## File Structure

```
.env.example                      template de variables (committeado)
.env.local                        variables reales (gitignored)
vitest.config.ts                  config del runner
vitest.setup.ts                   setup de Testing Library / jsdom
middleware.ts                     refresh de sesión Supabase en cada request
lib/env.ts                        validación de env con zod (server)
lib/env.test.ts
lib/supabase/server.ts            server client (cookies async)
lib/supabase/client.ts            browser client (solo NEXT_PUBLIC_*)
lib/supabase/middleware.ts        helper updateSession
lib/auth/roles.ts                 tipo Role + parseRole + assertRole (lógica pura)
lib/auth/roles.test.ts
lib/auth/dal.ts                   getUser / requireUser / requireRole (IO)
app/(auth)/actions.ts             server actions: signUp / signIn / signOut
app/(auth)/login/page.tsx         pantalla de login
app/(auth)/signup/page.tsx        pantalla de signup (elige rol)
app/(auth)/auth-form.tsx          form client compartido (pending state)
app/globals.css                   tokens del sistema visual editorial (modificar)
app/layout.tsx                    fonts (serif + sans) + shell (modificar)
app/page.tsx                      home placeholder editorial (modificar)
app/(dashboard)/dashboard/page.tsx  página gateada de prueba (requireRole)
components/layout/top-bar.tsx     barra superior
components/layout/bottom-nav.tsx  bottom tab bar (client)
components/layout/bottom-nav.test.tsx
components/ui/button.tsx          botón base (variantes)
supabase/migrations/0001_profiles.sql  tabla profiles + trigger + RLS
```

Responsabilidad por archivo: cada `lib/*` encapsula un servicio externo o una pieza de lógica con un contrato chico. Los componentes de layout son tontos (solo presentación + navegación). La lógica testeable (roles, validación de env) vive aislada de la IO.

---

## Task 0: Infraestructura de testing (Vitest)

**Files:**
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Modify: `package.json` (scripts)
- Test: `lib/smoke.test.ts` (temporal, se borra al final de la tarea)

- [ ] **Step 1: Instalar dependencias de test**

```bash
npm install -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Crear la config de Vitest**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
})
```

- [ ] **Step 3: Crear el setup de Testing Library**

```ts
// vitest.setup.ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 4: Agregar scripts a package.json**

En `package.json`, dentro de `"scripts"`, agregar:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Escribir un test smoke para verificar el runner**

```ts
// lib/smoke.test.ts
import { describe, it, expect } from 'vitest'

describe('test runner', () => {
  it('corre', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `npm test`
Expected: PASS (1 test). Confirma que Vitest + alias `@` funcionan.

- [ ] **Step 7: Borrar el smoke test y commitear**

```bash
rm lib/smoke.test.ts
git add -A
git commit -m "chore: configurar Vitest + Testing Library"
```

---

## Task 1: Validación de variables de entorno (`lib/env.ts`)

**Files:**
- Create: `lib/env.ts`
- Create: `lib/env.test.ts`
- Create: `.env.example`

- [ ] **Step 1: Instalar zod**

```bash
npm install zod
```

- [ ] **Step 2: Escribir el test que falla**

```ts
// lib/env.test.ts
import { describe, it, expect } from 'vitest'
import { parseEnv } from '@/lib/env'

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
}

describe('parseEnv', () => {
  it('devuelve el env tipado cuando está completo', () => {
    expect(parseEnv(valid).NEXT_PUBLIC_SUPABASE_URL).toBe('https://x.supabase.co')
  })

  it('tira si falta una variable requerida', () => {
    const { NEXT_PUBLIC_SUPABASE_ANON_KEY, ...incomplete } = valid
    expect(() => parseEnv(incomplete)).toThrow()
  })

  it('tira si la URL no es válida', () => {
    expect(() => parseEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: 'no-es-url' })).toThrow()
  })
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npm test lib/env.test.ts`
Expected: FAIL — `parseEnv` no existe / no se puede importar.

- [ ] **Step 4: Implementar `lib/env.ts`**

```ts
// lib/env.ts
import { z } from 'zod'

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
})

export type Env = z.infer<typeof schema>

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source)
  if (!result.success) {
    throw new Error(`Variables de entorno inválidas: ${result.error.message}`)
  }
  return result.data
}

// Validado una sola vez al importar desde el servidor.
export const env = parseEnv(process.env)
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npm test lib/env.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Crear `.env.example`**

```bash
# .env.example
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Crear `.env.local` con los valores reales del proyecto Supabase (Dashboard → Project Settings → API). Verificar que `.gitignore` ya ignora `.env*` (el `.gitignore` de create-next-app lo hace; si no, agregar la línea `.env*`).

- [ ] **Step 7: Commitear**

```bash
git add lib/env.ts lib/env.test.ts .env.example package.json package-lock.json
git commit -m "feat: validación de variables de entorno con zod"
```

---

## Task 2: Clientes Supabase + middleware de sesión

**Files:**
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/middleware.ts`
- Create: `middleware.ts`

> Estos archivos son *wiring* alrededor de `@supabase/ssr`. No se testean por unidad (sería testear la librería); se verifican al typecheckear/buildear y al usarlos en el flujo de auth (Task 6+). No agregar tests acá.

- [ ] **Step 1: Instalar Supabase**

```bash
npm install @supabase/ssr @supabase/supabase-js
```

- [ ] **Step 2: Crear el server client (cookies async — Next 16)**

```ts
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Llamado desde un Server Component: el middleware refresca la sesión.
          }
        },
      },
    }
  )
}
```

- [ ] **Step 3: Crear el browser client (solo NEXT_PUBLIC_*)**

```ts
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

// Usa process.env directo (Next inlinea NEXT_PUBLIC_* en el bundle del cliente).
// NO importar lib/env.ts acá: arrastraría el service role key al cliente.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 4: Crear el helper de middleware**

```ts
// lib/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/lib/env'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresca la sesión. NO meter lógica entre createServerClient y getUser.
  await supabase.auth.getUser()

  return response
}
```

- [ ] **Step 5: Crear `middleware.ts` en la raíz**

```ts
// middleware.ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    // Todo menos assets estáticos e imágenes.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 6: Verificar typecheck/build**

Run: `npx tsc --noEmit`
Expected: sin errores de tipos en estos archivos.

- [ ] **Step 7: Commitear**

```bash
git add lib/supabase middleware.ts package.json package-lock.json
git commit -m "feat: clientes Supabase (server/browser) + middleware de sesión"
```

---

## Task 3: Migración `profiles` + trigger + RLS

**Files:**
- Create: `supabase/config.toml` (vía `supabase init`)
- Create: `supabase/migrations/0001_profiles.sql`

- [ ] **Step 1: Inicializar Supabase CLI en el repo**

```bash
npx supabase init
```
Esto crea `supabase/config.toml`. (Requiere la CLI de Supabase; si no está, instalar con `npm install -D supabase`.)

- [ ] **Step 2: Escribir la migración**

```sql
-- supabase/migrations/0001_profiles.sql

create type public.user_role as enum ('photographer', 'surfer');

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         public.user_role not null,
  display_name text,
  avatar_url   text,
  bio          text,
  instagram    text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Lectura pública del perfil (datos no sensibles).
create policy "perfiles visibles para todos"
  on public.profiles for select
  using (true);

-- Cada usuario edita solo su propio perfil.
create policy "el usuario edita su perfil"
  on public.profiles for update
  using (auth.uid() = id);

-- Crear el profile automáticamente al registrarse, tomando el rol del metadata.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'role', 'surfer')::public.user_role,
    new.raw_user_meta_data ->> 'display_name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 3: Aplicar la migración**

Opción A (proyecto linkeado): `npx supabase link --project-ref <ref>` y luego `npx supabase db push`.
Opción B (manual): copiar el SQL en el Dashboard → SQL Editor → Run.

Verificar en el Dashboard → Table Editor que existe la tabla `public.profiles` con RLS activado.

- [ ] **Step 4: Commitear**

```bash
git add supabase/
git commit -m "feat: migración de profiles + trigger de signup + RLS"
```

---

## Task 4: Módulo de roles (lógica pura) — TDD

**Files:**
- Create: `lib/auth/roles.ts`
- Create: `lib/auth/roles.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// lib/auth/roles.test.ts
import { describe, it, expect } from 'vitest'
import { parseRole, assertRole, ROLES } from '@/lib/auth/roles'

describe('parseRole', () => {
  it('acepta roles válidos', () => {
    expect(parseRole('photographer')).toBe('photographer')
    expect(parseRole('surfer')).toBe('surfer')
  })
  it('devuelve null para inválidos', () => {
    expect(parseRole('admin')).toBeNull()
    expect(parseRole(undefined)).toBeNull()
  })
})

describe('assertRole', () => {
  it('es true cuando el rol coincide', () => {
    expect(assertRole('photographer', 'photographer')).toBe(true)
  })
  it('es false cuando no coincide', () => {
    expect(assertRole('surfer', 'photographer')).toBe(false)
  })
})

describe('ROLES', () => {
  it('contiene los dos roles', () => {
    expect(ROLES).toEqual(['photographer', 'surfer'])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test lib/auth/roles.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar `lib/auth/roles.ts`**

```ts
// lib/auth/roles.ts
export const ROLES = ['photographer', 'surfer'] as const
export type Role = (typeof ROLES)[number]

export function parseRole(value: unknown): Role | null {
  return ROLES.includes(value as Role) ? (value as Role) : null
}

export function assertRole(userRole: Role, required: Role): boolean {
  return userRole === required
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test lib/auth/roles.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commitear**

```bash
git add lib/auth/roles.ts lib/auth/roles.test.ts
git commit -m "feat: módulo de roles (parseRole/assertRole)"
```

---

## Task 5: Auth DAL (`lib/auth/dal.ts`)

**Files:**
- Create: `lib/auth/dal.ts`

> El DAL es IO (Supabase + redirect). La lógica pura ya está testeada en Task 4 (`assertRole`). Acá envolvemos esa lógica con la IO; se verifica end-to-end en Task 10. No agregar tests de unidad sobre los wrappers de IO.

- [ ] **Step 1: Implementar el DAL**

```ts
// lib/auth/dal.ts
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { assertRole, parseRole, type Role } from '@/lib/auth/roles'

export async function getUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export async function requireUser() {
  const user = await getUser()
  if (!user) redirect('/login')
  return user
}

/** Devuelve el rol del usuario logueado, o null si no hay sesión. */
export async function getRole(): Promise<Role | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  return parseRole(profile?.role)
}

/** Exige sesión + rol específico; si no, redirige. */
export async function requireRole(required: Role) {
  const role = await getRole()
  if (!role) redirect('/login')
  if (!assertRole(role, required)) redirect('/')
  return role
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commitear**

```bash
git add lib/auth/dal.ts
git commit -m "feat: auth DAL (getUser/requireUser/getRole/requireRole)"
```

---

## Task 6: Server Actions de auth

**Files:**
- Create: `app/(auth)/actions.ts`

- [ ] **Step 1: Implementar las actions**

```ts
// app/(auth)/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { parseRole } from '@/lib/auth/roles'

export type AuthState = { error: string } | null

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const role = parseRole(formData.get('role'))
  const displayName = String(formData.get('display_name') ?? '')

  if (!email || !password) return { error: 'Email y contraseña son obligatorios.' }
  if (!role) return { error: 'Elegí un rol válido.' }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { role, display_name: displayName } },
  })
  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  redirect('/')
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: 'Email o contraseña incorrectos.' }

  revalidatePath('/', 'layout')
  redirect('/')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/')
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commitear**

```bash
git add "app/(auth)/actions.ts"
git commit -m "feat: server actions de auth (signUp/signIn/signOut)"
```

---

## Task 7: Pantallas de auth (login / signup)

**Files:**
- Create: `app/(auth)/auth-form.tsx`
- Create: `app/(auth)/login/page.tsx`
- Create: `app/(auth)/signup/page.tsx`

- [ ] **Step 1: Crear el form client compartido (estado de pending + error)**

```tsx
// app/(auth)/auth-form.tsx
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
```

- [ ] **Step 2: Crear la página de login**

```tsx
// app/(auth)/login/page.tsx
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
```

- [ ] **Step 3: Crear la página de signup**

```tsx
// app/(auth)/signup/page.tsx
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
```

- [ ] **Step 4: Verificar en el navegador**

Run: `npm run dev`
Ir a `http://localhost:3000/signup`, crear una cuenta de prueba (elegí "Surfista"), verificar que redirige a `/`. En el Dashboard de Supabase → Table Editor → `profiles`, confirmar que se creó la fila con `role = surfer`. Repetir con "Fotógrafo".

- [ ] **Step 5: Commitear**

```bash
git add "app/(auth)"
git commit -m "feat: pantallas de login y signup con elección de rol"
```

---

## Task 8: Sistema visual editorial (tokens + fonts)

**Files:**
- Modify: `app/globals.css` (reemplazar contenido)
- Modify: `app/layout.tsx` (fonts serif + sans, metadata)

- [ ] **Step 1: Reemplazar `app/globals.css` con los tokens editoriales**

```css
/* app/globals.css */
@import "tailwindcss";

@theme {
  --color-canvas: #FAFAF9;   /* fondo blanco cálido */
  --color-ink: #0A0A0A;      /* texto casi negro */
  --color-accent: #0E7C86;   /* teal océano (interactivo) */
  --color-heart: #FF6B5E;    /* coral (voto) */

  --font-sans: var(--font-geist-sans);
  --font-serif: var(--font-fraunces);
}

body {
  background: var(--color-canvas);
  color: var(--color-ink);
  font-family: var(--font-sans), Arial, Helvetica, sans-serif;
}
```

> Nota: se elimina el bloque `@media (prefers-color-scheme: dark)` del scaffold — el modo oscuro está fuera de alcance (ver spec de diseño).

- [ ] **Step 2: Actualizar `app/layout.tsx` con la pareja tipográfica**

```tsx
// app/layout.tsx
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Fraunces } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Spoteado",
  description: "Encontrá tus fotos de surf.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Verificar que compila y se ve**

Run: `npm run dev`
Ir a `/login`: el fondo debe ser blanco cálido, el título "Ingresar" en serif (Fraunces), y el botón en teal. Confirmar que `font-serif`, `bg-accent`, `text-heart`, etc. resuelven (no quedan sin estilo).

- [ ] **Step 4: Commitear**

```bash
git add app/globals.css app/layout.tsx
git commit -m "feat: sistema visual editorial (tokens + Fraunces/Geist)"
```

---

## Task 9: Componentes base + shell de navegación

**Files:**
- Create: `components/ui/button.tsx`
- Create: `components/layout/top-bar.tsx`
- Create: `components/layout/bottom-nav.tsx`
- Create: `components/layout/bottom-nav.test.tsx`

- [ ] **Step 1: Crear el botón base**

```tsx
// components/ui/button.tsx
import { type ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost'
}

export function Button({ variant = 'primary', className = '', ...props }: Props) {
  const base = 'rounded-sm px-4 py-2 text-sm transition-colors disabled:opacity-50'
  const variants = {
    primary: 'bg-accent text-canvas hover:opacity-90',
    ghost: 'border border-ink/15 text-ink hover:bg-ink/5',
  }
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />
}
```

- [ ] **Step 2: Escribir el test del bottom-nav (que falla)**

```tsx
// components/layout/bottom-nav.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BottomNav } from './bottom-nav'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

describe('BottomNav', () => {
  it('muestra las 4 pestañas del surfista', () => {
    render(<BottomNav />)
    expect(screen.getByText('Buscar')).toBeInTheDocument()
    expect(screen.getByText('Ranking')).toBeInTheDocument()
    expect(screen.getByText('Carrito')).toBeInTheDocument()
    expect(screen.getByText('Mis fotos')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npm test components/layout/bottom-nav.test.tsx`
Expected: FAIL — `BottomNav` no existe.

- [ ] **Step 4: Implementar el bottom-nav**

```tsx
// components/layout/bottom-nav.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/', label: 'Buscar' },
  { href: '/ranking', label: 'Ranking' },
  { href: '/cart', label: 'Carrito' },
  { href: '/me/photos', label: 'Mis fotos' },
]

export function BottomNav() {
  const pathname = usePathname()
  return (
    <nav className="fixed inset-x-0 bottom-0 flex border-t border-ink/10 bg-canvas md:hidden">
      {TABS.map((tab) => {
        const active = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex-1 py-3 text-center text-xs ${active ? 'text-accent' : 'text-ink/60'}`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npm test components/layout/bottom-nav.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 6: Implementar la top bar (server component, muestra sesión)**

```tsx
// components/layout/top-bar.tsx
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
```

- [ ] **Step 7: Commitear**

```bash
git add components/
git commit -m "feat: componentes base (Button, TopBar, BottomNav)"
```

---

## Task 10: Wiring del shell + home placeholder + ruta gateada

**Files:**
- Modify: `app/layout.tsx` (montar TopBar + BottomNav)
- Modify: `app/page.tsx` (reemplazar con home editorial placeholder)
- Create: `app/(dashboard)/dashboard/page.tsx` (ruta gateada de prueba)

- [ ] **Step 1: Montar el shell en el root layout**

Reemplazar el `<body>` de `app/layout.tsx` para incluir la navegación:

```tsx
// app/layout.tsx  (solo cambia el return; mantener imports/fonts de Task 8)
import { TopBar } from "@/components/layout/top-bar";
import { BottomNav } from "@/components/layout/bottom-nav";

// ... (geistSans, fraunces, metadata sin cambios)

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col pb-16 md:pb-0">
        <TopBar />
        <div className="flex flex-1 flex-col">{children}</div>
        <BottomNav />
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Reemplazar la home con un placeholder editorial**

```tsx
// app/page.tsx
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-serif text-4xl tracking-tight">Encontrá tu ola.</h1>
      <p className="max-w-md text-ink/60">
        El buscador llega en la próxima fase. Por ahora, creá tu cuenta.
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Crear una ruta gateada de prueba (verifica requireRole)**

```tsx
// app/(dashboard)/dashboard/page.tsx
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
```

- [ ] **Step 4: Verificar el gating end-to-end**

Run: `npm run dev`
- Sin sesión → ir a `/dashboard` → debe redirigir a `/login`.
- Logueado como **surfista** → `/dashboard` → debe redirigir a `/` (rol incorrecto).
- Logueado como **fotógrafo** → `/dashboard` → debe mostrar "Dashboard del fotógrafo".
- La top bar muestra "Ingresar" sin sesión y "Salir" con sesión; la bottom bar aparece en viewport móvil.

- [ ] **Step 5: Verificar build + tests + typecheck completos**

```bash
npm test && npx tsc --noEmit && npm run build
```
Expected: tests PASS, sin errores de tipos, build exitoso.

- [ ] **Step 6: Commitear**

```bash
git add "app/layout.tsx" "app/page.tsx" "app/(dashboard)"
git commit -m "feat: shell de navegación + home placeholder + ruta gateada por rol"
```

---

## Self-Review (completado al escribir el plan)

**1. Cobertura del spec (sección "Auth, roles y seguridad" del spec de arquitectura + sistema visual del spec de diseño):**
- Supabase Auth + roles → Tasks 3, 4, 5, 6, 7. ✅
- `profiles` con role + trigger + RLS → Task 3. ✅
- Server Actions para mutaciones + DAL → Tasks 5, 6. ✅
- Secretos solo en server (service role no llega al cliente) → Task 2 Step 3 (browser client no importa `lib/env`). ✅
- Sistema visual editorial (canvas/ink/accent/heart, serif+sans) → Task 8. ✅
- Bottom tab bar (surfista) + top bar → Task 9, 10. ✅
- *Fuera de Fase 0 (correcto):* Google OAuth (se puede sumar en una sub-tarea futura; el MVP arranca con email/password), buckets de Storage y Qdrant (Fase 1).

**2. Placeholders:** sin "TBD"/"implementar después"; cada step tiene código o comando concreto. ✅

**3. Consistencia de tipos:** `Role` y `parseRole`/`assertRole` (Task 4) se usan igual en `dal.ts` (Task 5) y `actions.ts` (Task 6). `AuthState` definido en `actions.ts` (Task 6) y consumido en `auth-form.tsx` (Task 7) con la misma firma `(prev, formData) => Promise<AuthState>`. Tokens de color (`canvas/ink/accent/heart`) definidos en Task 8 y usados en Tasks 7, 9, 10. ✅

**Nota de alcance:** Google OAuth quedó fuera de Fase 0 a propósito (el spec lo menciona como método; se agrega como sub-tarea cuando se priorice). Si se quiere en Fase 0, es una tarea adicional con `supabase.auth.signInWithOAuth` + callback route handler.
</content>
</invoke>
