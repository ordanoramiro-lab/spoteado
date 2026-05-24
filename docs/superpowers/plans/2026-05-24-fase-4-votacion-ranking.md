# Fase 4 — Votación + Ranking semanal: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Depende de:** Fase 1 (fotos `ready`, columna `contest_week`/`vote_count`) y Fase 2 (photo card / masonry / home).

**Goal:** Cualquier usuario registrado vota fotos (1 voto por foto, no la propia). La home muestra el ranking en vivo de la semana; un cron semanal congela las ganadoras en un "Hall of fame".

**Architecture:** `votes` con constraint único y un trigger que mantiene `photos.vote_count` denormalizado. Cada foto compite en `contest_week` (lunes de su `captured_at`, seteado por trigger). El ranking en vivo es una lectura por `vote_count`. Un Vercel Cron pega a un route handler protegido que congela el top N en `weekly_winners`. Lógica pura (semana de competencia, guard de voto, ranking) testeada con TDD.

**Tech Stack:** Next.js 16 (Server Actions + route handler + Vercel Cron), Supabase (trigger SQL), Vitest + Testing Library.

---

## File Structure

```
supabase/migrations/0005_voting.sql      votes, weekly_winners, triggers (vote_count, contest_week) + RLS
lib/voting/week.ts                         contestWeek / currentContestWeek (puro)
lib/voting/week.test.ts
lib/voting/guard.ts                        canVote (puro)
lib/voting/guard.test.ts
lib/voting/ranking.ts                      rankWinners (puro)
lib/voting/ranking.test.ts
app/(public)/_actions/vote.ts              toggleVote (server action)
app/api/cron/close-week/route.ts           congela ganadoras (protegido por CRON_SECRET)
components/photo/vote-button.tsx           corazón optimista (client)
components/photo/vote-button.test.tsx
app/(public)/ranking/page.tsx              ranking en vivo + hall of fame
app/page.tsx                               home final (hero + buscador + ganadoras) (modificar)
vercel.json                                cron semanal
.env.example                               (+ CRON_SECRET)
```

---

## Task 1: Migración de votación + triggers

**Files:**
- Create: `supabase/migrations/0005_voting.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- supabase/migrations/0005_voting.sql
create table public.votes (
  id         uuid primary key default gen_random_uuid(),
  voter_id   uuid not null references public.profiles (id) on delete cascade,
  photo_id   uuid not null references public.photos (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (voter_id, photo_id)               -- 1 voto por foto por usuario
);

create table public.weekly_winners (
  week_start date not null,
  photo_id   uuid not null references public.photos (id) on delete cascade,
  rank       int not null,
  vote_count int not null,
  primary key (week_start, photo_id)
);

alter table public.votes          enable row level security;
alter table public.weekly_winners enable row level security;

-- Conteos/ganadoras públicos; el usuario gestiona solo sus votos.
create policy "winners visibles" on public.weekly_winners for select using (true);
create policy "votos visibles"   on public.votes for select using (true);
create policy "usuario inserta su voto" on public.votes for insert
  with check (
    voter_id = auth.uid()
    and not exists (select 1 from public.photos p where p.id = photo_id and p.photographer_id = auth.uid())
  );
create policy "usuario borra su voto" on public.votes for delete
  using (voter_id = auth.uid());

-- Mantener photos.vote_count denormalizado.
create function public.bump_vote_count()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT') then
    update public.photos set vote_count = vote_count + 1 where id = new.photo_id;
  elsif (tg_op = 'DELETE') then
    update public.photos set vote_count = greatest(0, vote_count - 1) where id = old.photo_id;
  end if;
  return null;
end; $$;

create trigger votes_count_ins after insert on public.votes
  for each row execute function public.bump_vote_count();
create trigger votes_count_del after delete on public.votes
  for each row execute function public.bump_vote_count();

-- Setear contest_week = lunes de captured_at (ISO week).
create function public.set_contest_week()
returns trigger language plpgsql as $$
begin
  new.contest_week := (date_trunc('week', new.captured_at))::date;
  return new;
end; $$;

create trigger photos_contest_week before insert or update of captured_at on public.photos
  for each row execute function public.set_contest_week();
```

- [ ] **Step 2: Aplicar y verificar**

Run: `npx supabase db push`. Verificar: votar (insert manual) sube `photos.vote_count`; borrar lo baja; fotos existentes — backfill: `update photos set captured_at = captured_at;` (dispara el trigger y rellena `contest_week`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_voting.sql
git commit -m "feat: migración de votación (votes/weekly_winners) + triggers"
```

---

## Task 2: Semana de competencia (puro) — TDD

**Files:**
- Create: `lib/voting/week.ts`
- Create: `lib/voting/week.test.ts`

- [ ] **Step 1: Test que falla**

```ts
// lib/voting/week.test.ts
import { describe, it, expect } from 'vitest'
import { contestWeek, currentContestWeek } from '@/lib/voting/week'

describe('contestWeek', () => {
  it('devuelve el lunes (UTC) de la semana de la fecha', () => {
    // 2026-05-24 es domingo → su lunes ISO es 2026-05-18
    expect(contestWeek(new Date('2026-05-24T09:00:00Z'))).toBe('2026-05-18')
    // 2026-05-18 es lunes → se devuelve a sí mismo
    expect(contestWeek(new Date('2026-05-18T00:00:00Z'))).toBe('2026-05-18')
  })
})

describe('currentContestWeek', () => {
  it('usa la fecha provista', () => {
    expect(currentContestWeek(new Date('2026-05-20T12:00:00Z'))).toBe('2026-05-18')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test lib/voting/week.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// lib/voting/week.ts
/** Lunes (UTC) de la semana ISO de `date`, en formato yyyy-mm-dd. */
export function contestWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() // 0=domingo..6=sábado
  const diff = (day === 0 ? -6 : 1) - day // mover al lunes
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}

export function currentContestWeek(now: Date = new Date()): string {
  return contestWeek(now)
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test lib/voting/week.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/voting/week.ts lib/voting/week.test.ts
git commit -m "feat: cálculo de la semana de competencia (puro)"
```

---

## Task 3: Guard de voto (puro) — TDD

**Files:**
- Create: `lib/voting/guard.ts`
- Create: `lib/voting/guard.test.ts`

- [ ] **Step 1: Test que falla**

```ts
// lib/voting/guard.test.ts
import { describe, it, expect } from 'vitest'
import { canVote } from '@/lib/voting/guard'

describe('canVote', () => {
  it('permite votar fotos de otros', () => {
    expect(canVote('userA', 'photographerB')).toBe(true)
  })
  it('prohíbe votar la foto propia', () => {
    expect(canVote('userA', 'userA')).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test lib/voting/guard.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// lib/voting/guard.ts
export function canVote(voterId: string, photographerId: string): boolean {
  return voterId !== photographerId
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test lib/voting/guard.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/voting/guard.ts lib/voting/guard.test.ts
git commit -m "feat: guard de voto (no votar la foto propia)"
```

---

## Task 4: Server action `toggleVote`

**Files:**
- Create: `app/(public)/_actions/vote.ts`

- [ ] **Step 1: Implementar**

```ts
// app/(public)/_actions/vote.ts
'use server'

import { requireUser } from '@/lib/auth/dal'
import { createClient } from '@/lib/supabase/server'
import { canVote } from '@/lib/voting/guard'

/** Inserta o borra el voto del usuario para una foto. Devuelve si quedó votada. */
export async function toggleVote(photoId: string): Promise<{ voted: boolean }> {
  const user = await requireUser()
  const supabase = await createClient()

  const { data: photo } = await supabase.from('photos').select('photographer_id').eq('id', photoId).single()
  if (!photo || !canVote(user.id, photo.photographer_id)) {
    throw new Error('No podés votar esta foto.')
  }

  const { data: existing } = await supabase
    .from('votes').select('id').eq('voter_id', user.id).eq('photo_id', photoId).maybeSingle()

  if (existing) {
    await supabase.from('votes').delete().eq('id', existing.id)
    return { voted: false }
  }
  await supabase.from('votes').insert({ voter_id: user.id, photo_id: photoId })
  return { voted: true }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add "app/(public)/_actions/vote.ts"
git commit -m "feat: server action toggleVote (con guard + RLS)"
```

---

## Task 5: Ranking de ganadoras (puro) + cron de cierre

**Files:**
- Create: `lib/voting/ranking.ts`
- Create: `lib/voting/ranking.test.ts`
- Create: `app/api/cron/close-week/route.ts`
- Create: `vercel.json`
- Modify: `lib/env.ts` + `.env.example` (+ `CRON_SECRET`)

- [ ] **Step 1: Test de rankWinners (que falla)**

```ts
// lib/voting/ranking.test.ts
import { describe, it, expect } from 'vitest'
import { rankWinners } from '@/lib/voting/ranking'

describe('rankWinners', () => {
  it('ordena por votos desc y asigna rank desde 1', () => {
    const r = rankWinners([
      { id: 'a', vote_count: 3 },
      { id: 'b', vote_count: 10 },
      { id: 'c', vote_count: 7 },
    ], 2)
    expect(r).toEqual([
      { photo_id: 'b', rank: 1, vote_count: 10 },
      { photo_id: 'c', rank: 2, vote_count: 7 },
    ])
  })
  it('descarta fotos con 0 votos', () => {
    expect(rankWinners([{ id: 'a', vote_count: 0 }], 5)).toEqual([])
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test lib/voting/ranking.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// lib/voting/ranking.ts
export function rankWinners(
  photos: { id: string; vote_count: number }[],
  topN: number
): { photo_id: string; rank: number; vote_count: number }[] {
  return photos
    .filter((p) => p.vote_count > 0)
    .sort((a, b) => b.vote_count - a.vote_count)
    .slice(0, topN)
    .map((p, i) => ({ photo_id: p.id, rank: i + 1, vote_count: p.vote_count }))
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test lib/voting/ranking.test.ts` → PASS.

- [ ] **Step 5: Route handler del cron (protegido)**

```ts
// app/api/cron/close-week/route.ts
import { type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { currentContestWeek } from '@/lib/voting/week'
import { rankWinners } from '@/lib/voting/ranking'
import { env } from '@/lib/env'

const TOP_N = 10

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const week = currentContestWeek()
  const admin = createAdminClient()

  const { data: photos } = await admin
    .from('photos').select('id, vote_count').eq('contest_week', week).eq('status', 'ready')

  const winners = rankWinners((photos ?? []) as any, TOP_N)
  if (winners.length) {
    await admin.from('weekly_winners').upsert(
      winners.map((w) => ({ week_start: week, ...w })),
      { onConflict: 'week_start,photo_id' }
    )
  }
  return Response.json({ week, winners: winners.length })
}
```

- [ ] **Step 6: Configurar el cron + env**

```json
// vercel.json
{
  "crons": [{ "path": "/api/cron/close-week", "schedule": "5 0 * * 1" }]
}
```
(Lunes 00:05 UTC: congela la semana que termina.) `lib/env.ts`: `CRON_SECRET: z.string().min(1)`. Agregar a `.env.example` y al `valid` de `lib/env.test.ts`. (Vercel inyecta `Authorization: Bearer $CRON_SECRET` si se configura el env `CRON_SECRET` en el proyecto.)

- [ ] **Step 7: Verificar + commit**

Probar local: `curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/close-week` → responde `{ week, winners }`; sin header → 401.

```bash
git add lib/voting/ranking.ts lib/voting/ranking.test.ts app/api/cron/close-week vercel.json lib/env.ts lib/env.test.ts .env.example
git commit -m "feat: cron de cierre semanal + ranking de ganadoras (puro)"
```

---

## Task 6: Botón de voto (corazón optimista) — TDD

**Files:**
- Create: `components/photo/vote-button.tsx`
- Create: `components/photo/vote-button.test.tsx`

- [ ] **Step 1: Test que falla**

```tsx
// components/photo/vote-button.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VoteButton } from './vote-button'

describe('VoteButton', () => {
  it('muestra el conteo inicial', () => {
    render(<VoteButton photoId="p1" initialCount={5} initialVoted={false} onToggle={vi.fn(async () => ({ voted: true }))} />)
    expect(screen.getByText('5')).toBeInTheDocument()
  })
  it('incrementa optimista al tocar', async () => {
    const onToggle = vi.fn(async () => ({ voted: true }))
    render(<VoteButton photoId="p1" initialCount={5} initialVoted={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByText('6')).toBeInTheDocument()
    expect(onToggle).toHaveBeenCalledWith('p1')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test components/photo/vote-button.test.tsx` → FAIL.

- [ ] **Step 3: Implementar (con `onToggle` inyectable para testear)**

```tsx
// components/photo/vote-button.tsx
'use client'
import { useState } from 'react'

type Toggle = (photoId: string) => Promise<{ voted: boolean }>

export function VoteButton({
  photoId, initialCount, initialVoted, onToggle,
}: {
  photoId: string
  initialCount: number
  initialVoted: boolean
  onToggle: Toggle
}) {
  const [count, setCount] = useState(initialCount)
  const [voted, setVoted] = useState(initialVoted)

  async function handle() {
    const next = !voted
    setVoted(next)
    setCount((c) => c + (next ? 1 : -1)) // optimista
    try {
      const res = await onToggle(photoId)
      setVoted(res.voted)
    } catch {
      setVoted(voted)
      setCount(initialCount) // rollback
    }
  }

  return (
    <button onClick={handle} className={`flex items-center gap-1 text-sm ${voted ? 'text-heart' : 'text-ink/60'}`}>
      <span>{voted ? '❤' : '♡'}</span>
      <span>{count}</span>
    </button>
  )
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test components/photo/vote-button.test.tsx` → PASS.

- [ ] **Step 5: Montar el botón en el lightbox**

En `components/photo/lightbox.tsx`, importar `VoteButton` y `toggleVote`, y renderizar `<VoteButton photoId={photo.id} initialCount={photo.voteCount} initialVoted={false} onToggle={toggleVote} />` en el header del overlay. (El `initialVoted` real se puede hidratar luego; en el MVP arranca en false.)

- [ ] **Step 6: Commit**

```bash
git add components/photo/vote-button.tsx components/photo/vote-button.test.tsx components/photo/lightbox.tsx
git commit -m "feat: botón de voto optimista + integración en lightbox"
```

---

## Task 7: Página de ranking + home final

**Files:**
- Create: `app/(public)/ranking/page.tsx`
- Modify: `app/page.tsx` (hero + buscador + ganadoras de la semana)

- [ ] **Step 1: Página de ranking (en vivo + hall of fame)**

```tsx
// app/(public)/ranking/page.tsx
import { createClient } from '@/lib/supabase/server'
import { currentContestWeek } from '@/lib/voting/week'
import { thumbUrl } from '@/lib/photos/public-url'
import Image from 'next/image'

export default async function RankingPage() {
  const supabase = await createClient()
  const week = currentContestWeek()

  const { data: live } = await supabase
    .from('photos').select('id, vote_count')
    .eq('contest_week', week).eq('status', 'ready')
    .order('vote_count', { ascending: false }).limit(10)

  const { data: past } = await supabase
    .from('weekly_winners').select('photo_id, rank, week_start, vote_count')
    .order('week_start', { ascending: false }).limit(30)

  return (
    <main className="flex flex-1 flex-col gap-8 p-6">
      <section>
        <h1 className="font-serif text-2xl">Mejores de la semana</h1>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          {(live ?? []).map((p) => (
            <figure key={p.id} className="relative">
              <Image src={thumbUrl(p.id)} alt="" width={300} height={300} className="w-full" />
              <figcaption className="absolute bottom-1 right-1 bg-canvas/90 px-1 text-xs">❤ {p.vote_count}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section>
        <h2 className="font-serif text-xl text-ink/70">Hall of fame</h2>
        <div className="mt-4 grid grid-cols-3 gap-3 md:grid-cols-6">
          {(past ?? []).map((w) => (
            <Image key={`${w.week_start}-${w.photo_id}`} src={thumbUrl(w.photo_id)} alt="" width={200} height={200} className="w-full" />
          ))}
        </div>
      </section>
    </main>
  )
}
```

- [ ] **Step 2: Home final (hero + buscador + ganadoras)**

```tsx
// app/page.tsx
import { createClient } from '@/lib/supabase/server'
import { currentContestWeek } from '@/lib/voting/week'
import { thumbUrl } from '@/lib/photos/public-url'
import { SearchBar } from '@/components/search/search-bar'
import Image from 'next/image'
import Link from 'next/link'

export default async function Home() {
  const supabase = await createClient()
  const { data: beaches } = await supabase.from('beaches').select('slug, name').order('name')
  const { data: winners } = await supabase
    .from('photos').select('id, vote_count')
    .eq('contest_week', currentContestWeek()).eq('status', 'ready')
    .order('vote_count', { ascending: false }).limit(8)

  return (
    <main className="flex flex-1 flex-col">
      <section className="relative flex min-h-[60vh] items-center justify-center">
        <div className="absolute inset-0 bg-ink/5" />{/* placeholder de foto hero */}
        <div className="relative">
          <SearchBar beaches={beaches ?? []} />
        </div>
      </section>
      <section className="p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-xl">Mejores de la semana 🏆</h2>
          <Link href="/ranking" className="text-sm text-accent">Ver todo</Link>
        </div>
        <div className="mt-4 flex gap-3 overflow-x-auto">
          {(winners ?? []).map((p) => (
            <Image key={p.id} src={thumbUrl(p.id)} alt="" width={160} height={160} className="h-40 w-40 flex-none object-cover" />
          ))}
        </div>
      </section>
    </main>
  )
}
```

- [ ] **Step 3: Verificar + commit**

Run: `npm run dev`. Votar fotos desde el lightbox → el conteo sube; ir a `/ranking` y a la home → aparecen ordenadas por votos. Correr el cron local → las ganadoras quedan en hall of fame.

```bash
git add "app/(public)/ranking" app/page.tsx
git commit -m "feat: página de ranking + home final con ganadoras de la semana"
```

---

## Task 8: Verificación final de la fase

- [ ] **Step 1: Suite completa**

Run: `npm test && npx tsc --noEmit && npm run build` → todo verde.

- [ ] **Step 2: Smoke del flujo de votación**

Como usuario registrado: votar varias fotos (no se puede votar la propia → error); el conteo sube en vivo; el ranking refleja el orden; correr `/api/cron/close-week` con el secret → congela el top en `weekly_winners` y aparece en el hall of fame de la home.

---

## Self-Review (completado al escribir el plan)

**1. Cobertura del spec (flujo 7.4 + votación):**
- `votes` con unique(voter_id, photo_id) + guard "no votar lo propio" → Task 1 (RLS) + Task 3 (lógica) + Task 4 (action). ✅
- `vote_count` denormalizado por trigger → Task 1. ✅
- `contest_week` = lunes de captured_at → Task 1 (trigger) + Task 2 (helper JS para queries). ✅
- Ranking en vivo (top por vote_count de la semana) → Task 7. ✅
- Cron semanal que congela ganadoras en `weekly_winners` → Task 5. ✅
- Toggle optimista (corazón coral) → Task 6. ✅
- Home con ganadoras + página de ranking → Task 7. ✅
- Anti-abuso MVP (solo registrados + constraint único) → Task 1 (RLS insert exige `voter_id = auth.uid()`) + Task 4 (`requireUser`). ✅

**2. Placeholders:** sin TBD; el hero usa un `bg-ink/5` como placeholder de la foto destacada (decisión consciente del MVP, no un hueco). Resto: código y comandos concretos. ✅

**3. Consistencia de tipos:** `currentContestWeek` (Task 2) usado en el cron (Task 5), ranking (Task 7) y home (Task 7). `rankWinners` (Task 5) consistente con la tabla `weekly_winners` (Task 1: `week_start, photo_id, rank, vote_count`). `toggleVote` (Task 4) devuelve `{ voted }`, igual a la firma `Toggle` esperada por `VoteButton` (Task 6). `thumbUrl`/`PhotoResult.voteCount` reutilizados de Fase 2. ✅
</content>
</invoke>
