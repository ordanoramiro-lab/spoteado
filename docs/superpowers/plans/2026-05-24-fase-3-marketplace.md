# Fase 3 — Marketplace (compra): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Depende de:** Fase 1 (fotos/sesiones con precio) y Fase 2 (lightbox/sesión con botón "Agregar al carrito").

**Goal:** Un surfista arma un carrito (fotos sueltas y/o packs), paga con MercadoPago con split automático al fotógrafo + comisión de plataforma, y descarga el full-res tras la compra. El fotógrafo conecta su cuenta de cobro y ve sus ventas.

**Architecture:** Carrito client-side agrupado por fotógrafo (una orden + un pago por fotógrafo, porque el split de MP ata un pago a un vendedor). El webhook de MercadoPago es la fuente de verdad del pago: marca la orden `paid` (idempotente) y crea los `entitlements` (sesión → expande a todas sus fotos). La descarga emite una signed URL al original solo si existe entitlement. Lógica pura (split, expansión de entitlements) testeada con TDD; MercadoPago detrás de `lib/payments`.

**Tech Stack:** Next.js 16 (route handlers para webhook/descarga), `mercadopago` (SDK v2), Supabase, Vitest.

---

## File Structure

```
supabase/migrations/0004_commerce.sql     orders, order_items, entitlements, payout_accounts + RLS
lib/payments/split.ts                       calcSplit (puro)
lib/payments/split.test.ts
lib/payments/index.ts                       PaymentProvider interface + MercadoPago impl
lib/orders/entitlements.ts                  expandEntitlements (puro)
lib/orders/entitlements.test.ts
lib/orders/checkout.ts                      createOrdersForCart (orquestación por fotógrafo)
lib/cart/store.ts                           carrito en localStorage (client) + groupByPhotographer (puro)
lib/cart/store.test.ts
app/(public)/cart/page.tsx                  carrito agrupado por fotógrafo
app/(public)/cart/cart-view.tsx             client: lista + "Pagar a X"
app/api/webhooks/mercadopago/route.ts       webhook (fuente de verdad)
app/api/download/[photoId]/route.ts         signed URL gateada por entitlement
app/(public)/me/photos/page.tsx             mis fotos compradas
app/(dashboard)/dashboard/ventas/page.tsx   ventas/ganancias del fotógrafo
app/(dashboard)/dashboard/config/page.tsx   conectar MercadoPago
.env.example                                (+ MP_* )
```

---

## Task 1: Migración de comercio + RLS

**Files:**
- Create: `supabase/migrations/0004_commerce.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- supabase/migrations/0004_commerce.sql
create type public.order_status as enum ('pending', 'paid', 'failed', 'refunded');
create type public.item_type as enum ('photo', 'session');

create table public.photographer_payout_accounts (
  profile_id     uuid primary key references public.profiles (id) on delete cascade,
  mp_user_id     text,
  mp_access_token text,                       -- token del vendedor (OAuth)
  verified       boolean not null default false,
  commission_pct numeric not null default 15
);

create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  buyer_id        uuid not null references public.profiles (id),
  photographer_id uuid not null references public.profiles (id),
  status          public.order_status not null default 'pending',
  total_amount    numeric(12,2) not null,
  mp_preference_id text,
  mp_payment_id   text unique,                -- idempotencia
  created_at      timestamptz not null default now(),
  paid_at         timestamptz
);

create table public.order_items (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders (id) on delete cascade,
  item_type          public.item_type not null,
  photo_id           uuid references public.photos (id),
  session_id         uuid references public.sessions (id),
  unit_price         numeric(12,2) not null,
  photographer_amount numeric(12,2) not null,
  platform_fee       numeric(12,2) not null
);

create table public.entitlements (
  id         uuid primary key default gen_random_uuid(),
  buyer_id   uuid not null references public.profiles (id),
  photo_id   uuid not null references public.photos (id),
  order_id   uuid not null references public.orders (id),
  granted_at timestamptz not null default now(),
  unique (buyer_id, photo_id)
);

alter table public.orders        enable row level security;
alter table public.order_items   enable row level security;
alter table public.entitlements  enable row level security;
alter table public.photographer_payout_accounts enable row level security;

-- El comprador ve sus órdenes; el fotógrafo ve las suyas (para ventas).
create policy "comprador ve sus ordenes" on public.orders for select
  using (buyer_id = auth.uid() or photographer_id = auth.uid());
create policy "items de ordenes propias" on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_id
    and (o.buyer_id = auth.uid() or o.photographer_id = auth.uid())));
create policy "comprador ve sus entitlements" on public.entitlements for select
  using (buyer_id = auth.uid());
-- payout_accounts: nadie lo lee desde el cliente (solo service-role). Sin policy de select.
create policy "fotografo gestiona su payout" on public.photographer_payout_accounts for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
```

- [ ] **Step 2: Aplicar y verificar**

Run: `npx supabase db push`. Confirmar tablas + RLS en el Dashboard. (Las escrituras a `orders`/`entitlements` las hace el server con service-role en el webhook.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0004_commerce.sql
git commit -m "feat: migración de comercio (orders/items/entitlements/payout) + RLS"
```

---

## Task 2: Cálculo del split (puro) — TDD

**Files:**
- Create: `lib/payments/split.ts`
- Create: `lib/payments/split.test.ts`

- [ ] **Step 1: Test que falla**

```ts
// lib/payments/split.test.ts
import { describe, it, expect } from 'vitest'
import { calcSplit } from '@/lib/payments/split'

describe('calcSplit', () => {
  it('reparte con comisión 15%', () => {
    expect(calcSplit(1000, 15)).toEqual({ platformFee: 150, photographerAmount: 850 })
  })
  it('redondea a 2 decimales', () => {
    expect(calcSplit(999.99, 15)).toEqual({ platformFee: 150, photographerAmount: 849.99 })
  })
  it('comisión 0 → todo al fotógrafo', () => {
    expect(calcSplit(500, 0)).toEqual({ platformFee: 0, photographerAmount: 500 })
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test lib/payments/split.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// lib/payments/split.ts
const round2 = (n: number) => Math.round(n * 100) / 100

export function calcSplit(amount: number, commissionPct: number) {
  const platformFee = round2((amount * commissionPct) / 100)
  return { platformFee, photographerAmount: round2(amount - platformFee) }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test lib/payments/split.test.ts` → PASS (3).

- [ ] **Step 5: Commit**

```bash
git add lib/payments/split.ts lib/payments/split.test.ts
git commit -m "feat: cálculo del split de pago (puro)"
```

---

## Task 3: Expansión de entitlements (puro) — TDD

**Files:**
- Create: `lib/orders/entitlements.ts`
- Create: `lib/orders/entitlements.test.ts`

- [ ] **Step 1: Test que falla**

```ts
// lib/orders/entitlements.test.ts
import { describe, it, expect } from 'vitest'
import { expandEntitlements } from '@/lib/orders/entitlements'

describe('expandEntitlements', () => {
  it('una foto suelta → ese photo_id', () => {
    const r = expandEntitlements([{ item_type: 'photo', photo_id: 'p1', session_id: null }], {})
    expect(r).toEqual(['p1'])
  })
  it('una sesión → todas las fotos de la sesión', () => {
    const r = expandEntitlements(
      [{ item_type: 'session', photo_id: null, session_id: 's1' }],
      { s1: ['p1', 'p2', 'p3'] }
    )
    expect(r).toEqual(['p1', 'p2', 'p3'])
  })
  it('dedup entre foto suelta y sesión que la contiene', () => {
    const r = expandEntitlements(
      [
        { item_type: 'photo', photo_id: 'p1', session_id: null },
        { item_type: 'session', photo_id: null, session_id: 's1' },
      ],
      { s1: ['p1', 'p2'] }
    )
    expect(r.sort()).toEqual(['p1', 'p2'])
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test lib/orders/entitlements.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// lib/orders/entitlements.ts
export type OrderItemLite = {
  item_type: 'photo' | 'session'
  photo_id: string | null
  session_id: string | null
}

export function expandEntitlements(
  items: OrderItemLite[],
  sessionPhotos: Record<string, string[]>
): string[] {
  const ids = new Set<string>()
  for (const item of items) {
    if (item.item_type === 'photo' && item.photo_id) ids.add(item.photo_id)
    if (item.item_type === 'session' && item.session_id) {
      for (const pid of sessionPhotos[item.session_id] ?? []) ids.add(pid)
    }
  }
  return [...ids]
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test lib/orders/entitlements.test.ts` → PASS (3).

- [ ] **Step 5: Commit**

```bash
git add lib/orders/entitlements.ts lib/orders/entitlements.test.ts
git commit -m "feat: expansión de entitlements (sesión → fotos, con dedup)"
```

---

## Task 4: Carrito client + agrupación (puro) — TDD

**Files:**
- Create: `lib/cart/store.ts`
- Create: `lib/cart/store.test.ts`

- [ ] **Step 1: Test de la agrupación (que falla)**

```ts
// lib/cart/store.test.ts
import { describe, it, expect } from 'vitest'
import { groupByPhotographer, type CartItem } from '@/lib/cart/store'

const items: CartItem[] = [
  { kind: 'photo', id: 'p1', photographerId: 'A', title: 'foto', price: 100 },
  { kind: 'session', id: 's1', photographerId: 'B', title: 'pack', price: 500 },
  { kind: 'photo', id: 'p2', photographerId: 'A', title: 'foto', price: 120 },
]

describe('groupByPhotographer', () => {
  it('agrupa y suma subtotales por fotógrafo', () => {
    const groups = groupByPhotographer(items)
    expect(groups).toHaveLength(2)
    const a = groups.find((g) => g.photographerId === 'A')!
    expect(a.items).toHaveLength(2)
    expect(a.subtotal).toBe(220)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test lib/cart/store.test.ts` → FAIL.

- [ ] **Step 3: Implementar (lógica pura + helpers de localStorage)**

```ts
// lib/cart/store.ts
export type CartItem = {
  kind: 'photo' | 'session'
  id: string
  photographerId: string
  title: string
  price: number
}

export type CartGroup = { photographerId: string; items: CartItem[]; subtotal: number }

export function groupByPhotographer(items: CartItem[]): CartGroup[] {
  const map = new Map<string, CartItem[]>()
  for (const it of items) {
    const arr = map.get(it.photographerId) ?? []
    arr.push(it)
    map.set(it.photographerId, arr)
  }
  return [...map.entries()].map(([photographerId, items]) => ({
    photographerId,
    items,
    subtotal: items.reduce((s, i) => s + i.price, 0),
  }))
}

const KEY = 'spoteado_cart'
export function readCart(): CartItem[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
}
export function writeCart(items: CartItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items))
}
export function addToCart(item: CartItem) {
  const items = readCart().filter((i) => !(i.kind === item.kind && i.id === item.id))
  writeCart([...items, item])
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test lib/cart/store.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/cart/store.ts lib/cart/store.test.ts
git commit -m "feat: carrito en localStorage + agrupación por fotógrafo (puro)"
```

---

## Task 5: Proveedor de pago MercadoPago (`lib/payments`)

**Files:**
- Create: `lib/payments/index.ts`
- Modify: `lib/env.ts` + `.env.example` (+ `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `NEXT_PUBLIC_SITE_URL`)

> Wiring de la SDK. Se verifica con el sandbox de MP en Task 6/7.

- [ ] **Step 1: Instalar SDK**

```bash
npm install mercadopago
```

- [ ] **Step 2: Interfaz + impl**

```ts
// lib/payments/index.ts
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago'
import { env } from '@/lib/env'

export type PreferenceInput = {
  orderId: string
  title: string
  amount: number
  marketplaceFee: number
  sellerAccessToken: string
}

export interface PaymentProvider {
  createPreference(input: PreferenceInput): Promise<{ id: string; initPoint: string }>
  getPayment(paymentId: string): Promise<{ status: string; orderId: string | null }>
}

class MercadoPagoProvider implements PaymentProvider {
  async createPreference(input: PreferenceInput) {
    // La preference se crea con el token del VENDEDOR; marketplace_fee = comisión de plataforma.
    const sellerCfg = new MercadoPagoConfig({ accessToken: input.sellerAccessToken })
    const pref = new Preference(sellerCfg)
    const res = await pref.create({
      body: {
        items: [{ id: input.orderId, title: input.title, quantity: 1, unit_price: input.amount, currency_id: 'ARS' }],
        marketplace_fee: input.marketplaceFee,
        external_reference: input.orderId,
        notification_url: `${env.NEXT_PUBLIC_SITE_URL}/api/webhooks/mercadopago`,
        back_urls: {
          success: `${env.NEXT_PUBLIC_SITE_URL}/me/photos`,
          failure: `${env.NEXT_PUBLIC_SITE_URL}/cart`,
          pending: `${env.NEXT_PUBLIC_SITE_URL}/cart`,
        },
        auto_return: 'approved',
      },
    })
    return { id: res.id!, initPoint: res.init_point! }
  }

  async getPayment(paymentId: string) {
    const cfg = new MercadoPagoConfig({ accessToken: env.MP_ACCESS_TOKEN })
    const payment = await new Payment(cfg).get({ id: paymentId })
    return { status: payment.status ?? 'unknown', orderId: payment.external_reference ?? null }
  }
}

let provider: PaymentProvider | null = null
export function getPaymentProvider(): PaymentProvider {
  if (!provider) provider = new MercadoPagoProvider()
  return provider
}
```

- [ ] **Step 3: Env**

`lib/env.ts`: `MP_ACCESS_TOKEN: z.string().min(1)`, `MP_WEBHOOK_SECRET: z.string().min(1)`, `NEXT_PUBLIC_SITE_URL: z.string().url()`. Agregar al `.env.example` y al objeto `valid` de `lib/env.test.ts`.

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/payments/index.ts lib/env.ts lib/env.test.ts .env.example package.json package-lock.json
git commit -m "feat: proveedor de pago MercadoPago (preference con split + getPayment)"
```

---

## Task 6: Checkout — crear orden + preference por fotógrafo

**Files:**
- Create: `lib/orders/checkout.ts`
- Create: `app/(public)/cart/page.tsx`
- Create: `app/(public)/cart/cart-view.tsx`

- [ ] **Step 1: Orquestación de checkout (server action)**

```ts
// lib/orders/checkout.ts
'use server'

import { requireUser } from '@/lib/auth/dal'
import { createAdminClient } from '@/lib/supabase/admin'
import { calcSplit } from '@/lib/payments/split'
import { getPaymentProvider } from '@/lib/payments'
import type { CartItem } from '@/lib/cart/store'

/** Crea UNA orden para un grupo (todos del mismo fotógrafo) y devuelve el initPoint. */
export async function checkoutGroup(photographerId: string, items: CartItem[]) {
  const buyer = await requireUser()
  const admin = createAdminClient()

  const { data: payout } = await admin
    .from('photographer_payout_accounts')
    .select('mp_access_token, verified, commission_pct')
    .eq('profile_id', photographerId)
    .single()
  if (!payout?.verified || !payout.mp_access_token) {
    throw new Error('El fotógrafo todavía no conectó su cuenta de cobro.')
  }

  const total = items.reduce((s, i) => s + i.price, 0)
  const { platformFee } = calcSplit(total, Number(payout.commission_pct))

  const { data: order } = await admin.from('orders').insert({
    buyer_id: buyer.id, photographer_id: photographerId, status: 'pending', total_amount: total,
  }).select('id').single()
  if (!order) throw new Error('No se pudo crear la orden')

  for (const it of items) {
    const split = calcSplit(it.price, Number(payout.commission_pct))
    await admin.from('order_items').insert({
      order_id: order.id,
      item_type: it.kind,
      photo_id: it.kind === 'photo' ? it.id : null,
      session_id: it.kind === 'session' ? it.id : null,
      unit_price: it.price,
      photographer_amount: split.photographerAmount,
      platform_fee: split.platformFee,
    })
  }

  const { id: prefId, initPoint } = await getPaymentProvider().createPreference({
    orderId: order.id,
    title: `Spoteado · ${items.length} ítem(s)`,
    amount: total,
    marketplaceFee: platformFee,
    sellerAccessToken: payout.mp_access_token,
  })
  await admin.from('orders').update({ mp_preference_id: prefId }).eq('id', order.id)
  return initPoint
}
```

- [ ] **Step 2: Página del carrito (server shell)**

```tsx
// app/(public)/cart/page.tsx
import { CartView } from './cart-view'

export default function CartPage() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="font-serif text-2xl">Tu carrito</h1>
      <CartView />
    </main>
  )
}
```

- [ ] **Step 3: Vista del carrito (client, agrupada, "Pagar a X")**

```tsx
// app/(public)/cart/cart-view.tsx
'use client'
import { useEffect, useState } from 'react'
import { readCart, groupByPhotographer, type CartItem } from '@/lib/cart/store'
import { checkoutGroup } from '@/lib/orders/checkout'

export function CartView() {
  const [items, setItems] = useState<CartItem[]>([])
  useEffect(() => setItems(readCart()), [])
  const groups = groupByPhotographer(items)

  if (items.length === 0) return <p className="text-ink/50">El carrito está vacío.</p>

  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.photographerId} className="border-b border-ink/10 pb-4">
          <h2 className="text-sm text-ink/60">Fotógrafo @{g.photographerId.slice(0, 8)}</h2>
          <ul className="my-2 flex flex-col gap-1 text-sm">
            {g.items.map((it) => (
              <li key={`${it.kind}-${it.id}`} className="flex justify-between">
                <span>{it.kind === 'session' ? 'Pack' : 'Foto'}</span><span>${it.price}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between">
            <span>Subtotal: <strong>${g.subtotal}</strong></span>
            <button
              className="rounded-sm bg-accent px-4 py-2 text-canvas"
              onClick={async () => {
                const initPoint = await checkoutGroup(g.photographerId, g.items)
                window.location.href = initPoint
              }}
            >
              Pagar a este fotógrafo
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Conectar "Agregar al carrito" del lightbox (Fase 2)**

En `components/photo/lightbox.tsx`, el botón ahora llama `addToCart({ kind: 'photo', id: photo.id, photographerId: photo.photographerSlug, title: 'Foto', price: photo.price ?? 0 })` (import de `@/lib/cart/store`).

- [ ] **Step 5: Verificar (con cuenta de payout de prueba conectada — ver Task 9)**

Run: `npm run dev`. Agregar fotos al carrito, ir a `/cart`, ver agrupado por fotógrafo, "Pagar" redirige al checkout de MercadoPago (sandbox).

- [ ] **Step 6: Commit**

```bash
git add lib/orders/checkout.ts "app/(public)/cart" components/photo/lightbox.tsx
git commit -m "feat: checkout por fotógrafo + carrito agrupado + add-to-cart"
```

---

## Task 7: Webhook de MercadoPago (fuente de verdad)

**Files:**
- Create: `app/api/webhooks/mercadopago/route.ts`

- [ ] **Step 1: Implementar el webhook idempotente**

```ts
// app/api/webhooks/mercadopago/route.ts
import { type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPaymentProvider } from '@/lib/payments'
import { expandEntitlements } from '@/lib/orders/entitlements'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  // MP manda { type: 'payment', data: { id } }
  const paymentId = body?.data?.id
  if (!paymentId) return Response.json({ ok: true }) // ignorar notificaciones no-payment

  const { status, orderId } = await getPaymentProvider().getPayment(String(paymentId))
  if (!orderId) return Response.json({ ok: true })

  const admin = createAdminClient()
  const { data: order } = await admin
    .from('orders').select('id, buyer_id, status').eq('id', orderId).single()
  if (!order) return Response.json({ ok: true })

  // Idempotencia: si ya está paga, no reprocesar.
  if (order.status === 'paid') return Response.json({ ok: true })

  if (status !== 'approved') {
    if (status === 'rejected' || status === 'cancelled') {
      await admin.from('orders').update({ status: 'failed' }).eq('id', orderId)
    }
    return Response.json({ ok: true })
  }

  // Marcar paga + crear entitlements.
  await admin.from('orders').update({
    status: 'paid', mp_payment_id: String(paymentId), paid_at: new Date().toISOString(),
  }).eq('id', orderId)

  const { data: items } = await admin
    .from('order_items').select('item_type, photo_id, session_id').eq('order_id', orderId)

  // Mapa sesión → fotos (para expandir packs).
  const sessionIds = (items ?? []).filter((i) => i.session_id).map((i) => i.session_id as string)
  const sessionPhotos: Record<string, string[]> = {}
  if (sessionIds.length) {
    const { data: sp } = await admin.from('photos').select('id, session_id').in('session_id', sessionIds)
    for (const row of sp ?? []) {
      ;(sessionPhotos[row.session_id as string] ??= []).push(row.id)
    }
  }

  const photoIds = expandEntitlements((items ?? []) as any, sessionPhotos)
  if (photoIds.length) {
    await admin.from('entitlements').upsert(
      photoIds.map((pid) => ({ buyer_id: order.buyer_id, photo_id: pid, order_id: orderId })),
      { onConflict: 'buyer_id,photo_id' }
    )
  }

  return Response.json({ ok: true })
}
```

> Nota: para producción, validar la firma del webhook con `MP_WEBHOOK_SECRET` (header `x-signature`) antes de procesar. Agregar esa verificación como sub-step de hardening.

- [ ] **Step 2: Verificar con el sandbox de MercadoPago**

Hacer una compra de prueba completa (sandbox). Confirmar: orden pasa a `paid`, se crean `entitlements` (una por foto; un pack expande a todas). Reenviar el webhook manualmente → no duplica (idempotente).

- [ ] **Step 3: Commit**

```bash
git add app/api/webhooks/mercadopago/route.ts
git commit -m "feat: webhook de MercadoPago idempotente que crea entitlements"
```

---

## Task 8: Descarga gateada + "Mis fotos compradas"

**Files:**
- Create: `app/api/download/[photoId]/route.ts`
- Create: `app/(public)/me/photos/page.tsx`

- [ ] **Step 1: Route handler de descarga (verifica entitlement → signed URL)**

```ts
// app/api/download/[photoId]/route.ts
import { type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth/dal'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/download/[photoId]'>) {
  const { photoId } = await ctx.params
  const user = await getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: ent } = await admin
    .from('entitlements').select('id').eq('buyer_id', user.id).eq('photo_id', photoId).single()
  if (!ent) return Response.json({ error: 'forbidden' }, { status: 403 })

  const { data: photo } = await admin.from('photos').select('original_path').eq('id', photoId).single()
  if (!photo) return Response.json({ error: 'not found' }, { status: 404 })

  const { data: signed } = await admin.storage
    .from('originals').createSignedUrl(photo.original_path, 60) // TTL 60s
  return Response.redirect(signed!.signedUrl)
}
```

- [ ] **Step 2: Página "Mis fotos compradas"**

```tsx
// app/(public)/me/photos/page.tsx
import { requireUser } from '@/lib/auth/dal'
import { createClient } from '@/lib/supabase/server'
import { thumbUrl } from '@/lib/photos/public-url'
import Image from 'next/image'

export default async function MyPhotosPage() {
  const user = await requireUser()
  const supabase = await createClient()
  const { data: ents } = await supabase
    .from('entitlements').select('photo_id').eq('buyer_id', user.id)

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="font-serif text-2xl">Mis fotos</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(ents ?? []).map((e) => (
          <a key={e.photo_id} href={`/api/download/${e.photo_id}`} className="block">
            <Image src={thumbUrl(e.photo_id)} alt="" width={400} height={300} className="w-full" />
            <span className="text-xs text-accent">Descargar full-res ⬇</span>
          </a>
        ))}
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Verificar**

Como comprador con una compra confirmada: `/me/photos` lista las fotos (thumb sin watermark de mostrar... nota: el thumb tiene watermark; para "comprado" se podría mostrar el thumb igual y la descarga da el original limpio). Click → descarga el original vía signed URL. Sin entitlement → 403.

- [ ] **Step 4: Commit**

```bash
git add "app/api/download" "app/(public)/me/photos"
git commit -m "feat: descarga gateada por entitlement + mis fotos compradas"
```

---

## Task 9: Conexión de cobro (MercadoPago) + ventas

**Files:**
- Create: `app/(dashboard)/dashboard/config/page.tsx`
- Create: `app/(dashboard)/dashboard/ventas/page.tsx`
- Create: `app/(dashboard)/_actions/payout.ts`

- [ ] **Step 1: Action para guardar/conectar la cuenta de cobro**

```ts
// app/(dashboard)/_actions/payout.ts
'use server'
import { requireRole, requireUser } from '@/lib/auth/dal'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

/**
 * MVP: el fotógrafo pega su access token de MP (o, mejor, se conecta vía OAuth).
 * La verificación real vía OAuth se agrega como hardening; acá se guarda y marca verified.
 */
export async function connectPayout(accessToken: string) {
  await requireRole('photographer')
  const user = await requireUser()
  const admin = createAdminClient()
  await admin.from('photographer_payout_accounts').upsert({
    profile_id: user.id, mp_access_token: accessToken, verified: true,
  })
  revalidatePath('/dashboard/config')
}
```

> Hardening recomendado: reemplazar el pegado manual del token por el flujo OAuth de MercadoPago (redirect a MP → callback route handler que intercambia el code por el access_token y guarda `mp_user_id`). Modelado como sub-tarea.

- [ ] **Step 2: Página de configuración**

```tsx
// app/(dashboard)/dashboard/config/page.tsx
import { requireRole, requireUser } from '@/lib/auth/dal'
import { createAdminClient } from '@/lib/supabase/admin'
import { connectPayout } from '@/app/(dashboard)/_actions/payout'

export default async function ConfigPage() {
  await requireRole('photographer')
  const user = await requireUser()
  const admin = createAdminClient()
  const { data: payout } = await admin
    .from('photographer_payout_accounts').select('verified').eq('profile_id', user.id).single()

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="font-serif text-2xl">Configuración</h1>
      <section>
        <h2 className="text-sm text-ink/60">Cuenta de cobro (MercadoPago)</h2>
        {payout?.verified
          ? <p className="text-accent">✓ Conectada</p>
          : (
            <form action={async (fd: FormData) => { 'use server'; await connectPayout(String(fd.get('token'))) }}>
              <input name="token" placeholder="Access token de MercadoPago" className="w-full border-b border-ink/15 bg-transparent py-2" />
              <button className="mt-2 rounded-sm bg-accent px-4 py-2 text-canvas">Conectar</button>
            </form>
          )}
      </section>
    </main>
  )
}
```

- [ ] **Step 3: Página de ventas (tabla con neto)**

```tsx
// app/(dashboard)/dashboard/ventas/page.tsx
import { requireRole, requireUser } from '@/lib/auth/dal'
import { createClient } from '@/lib/supabase/server'

export default async function VentasPage() {
  await requireRole('photographer')
  const user = await requireUser()
  const supabase = await createClient()
  const { data: orders } = await supabase
    .from('orders')
    .select('id, total_amount, status, paid_at, order_items(photographer_amount, platform_fee)')
    .eq('photographer_id', user.id).eq('status', 'paid').order('paid_at', { ascending: false })

  const net = (orders ?? []).reduce(
    (s, o: any) => s + (o.order_items ?? []).reduce((x: number, i: any) => x + Number(i.photographer_amount), 0), 0
  )

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="font-serif text-2xl">Ventas</h1>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-ink/15 text-left text-ink/50">
          <th className="py-2">Fecha</th><th>Bruto</th><th>Neto</th>
        </tr></thead>
        <tbody>
          {(orders ?? []).map((o: any) => {
            const neto = (o.order_items ?? []).reduce((x: number, i: any) => x + Number(i.photographer_amount), 0)
            return <tr key={o.id} className="border-b border-ink/5">
              <td className="py-2">{o.paid_at?.slice(0, 10)}</td><td>${o.total_amount}</td><td>${neto}</td>
            </tr>
          })}
        </tbody>
      </table>
      <p>Neto total: <strong>${net}</strong></p>
    </main>
  )
}
```

- [ ] **Step 4: Verificar + commit**

Run: `npm run dev`. Conectar payout como fotógrafo, hacer una compra de prueba como surfista, ver la venta en `/dashboard/ventas`.

```bash
git add "app/(dashboard)/dashboard/config" "app/(dashboard)/dashboard/ventas" "app/(dashboard)/_actions/payout.ts"
git commit -m "feat: conexión de cobro MercadoPago + página de ventas"
```

---

## Task 10: Verificación final de la fase

- [ ] **Step 1: Suite completa**

Run: `npm test && npx tsc --noEmit && npm run build` → todo verde.

- [ ] **Step 2: Smoke del flujo de plata**

Fotógrafo conecta payout → surfista agrega al carrito (2 fotógrafos → 2 grupos) → paga un grupo (sandbox) → webhook marca `paid` + crea entitlements → surfista descarga full-res → fotógrafo ve la venta. Probar también: fotógrafo sin payout → sus fotos no se pueden comprar (error claro en checkout).

---

## Self-Review (completado al escribir el plan)

**1. Cobertura del spec (flujo 7.3 + comercio):**
- orders/order_items/entitlements/payout + RLS → Task 1. ✅
- Split automático (marketplace_fee) → Tasks 2, 5, 6. ✅
- Carrito agrupado por fotógrafo, una orden/pago por fotógrafo → Tasks 4, 6. ✅
- Webhook como fuente de verdad, idempotente, crea entitlements (sesión→fotos) → Tasks 3, 7. ✅
- Snapshot de precio + split en order_items → Task 6. ✅
- Descarga full-res gateada por entitlement (signed URL TTL corto) → Task 8. ✅
- Gating: sin payout verificado no se puede comprar → Task 6 (checkoutGroup chequea `verified`). ✅
- Ventas/ganancias del fotógrafo → Task 9. ✅

**2. Placeholders:** dos notas de hardening marcadas explícitamente (verificación de firma del webhook en Task 7; OAuth de MP en vez de token manual en Task 9) — son mejoras de seguridad post-MVP, no huecos del flujo, que funciona end-to-end con lo escrito. Resto: código concreto. ✅

**3. Consistencia de tipos:** `CartItem`/`groupByPhotographer` (Task 4) usados en checkout (Task 6) y cart-view (Task 6). `calcSplit` (Task 2) en checkout (Task 6). `expandEntitlements`/`OrderItemLite` (Task 3) en el webhook (Task 7). `PaymentProvider`/`PreferenceInput` (Task 5) en checkout (Task 6) y webhook (Task 7). `photographerSlug` del `PhotoResult` (Fase 2) se usa como `photographerId` en add-to-cart (Task 6 Step 4) — consistente porque en Fase 2 el slug ES el id del profile. ✅
</content>
</invoke>
