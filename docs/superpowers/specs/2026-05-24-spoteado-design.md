# Spoteado — Documento de Diseño (Arquitectura)

- **Fecha:** 2026-05-24
- **Estado:** Aprobado para pasar a plan de implementación
- **Alcance de este doc:** arquitectura del MVP. El diseño visual/UI se aborda en una fase posterior.

---

## 1. Visión

Spoteado conecta **surfistas** con **fotógrafos** de surf. En un pico hay decenas de surfistas y varios fotógrafos sacando fotos desde afuera del agua. Hoy el surfista busca su foto manualmente entre cientos, foto por foto, por Instagram. Spoteado resuelve ese dolor: el fotógrafo **centraliza su producto** y el surfista **encuentra su foto rápido** combinando filtros con búsqueda en lenguaje natural (AI). Además, monetiza la venta de la foto dentro de la plataforma y suma un ranking comunitario de las mejores fotos semanales.

## 2. Usuarios y roles

- **Surfista:** busca/browse, vota, compra y descarga lo que compró.
- **Fotógrafo:** todo lo del surfista + sube fotos, las agrupa en sesiones, setea tags/precios/watermark, y ve su dashboard de ventas.
- **Anónimo:** puede buscar, hacer browse y ver previews; para votar o comprar debe iniciar sesión.

Un rol por cuenta, elegido al registrarse.

## 3. Decisiones clave (del brainstorming)

| Tema | Decisión |
|---|---|
| Motor de búsqueda | Filtros de metadata (playa, fecha, franja horaria, tags) **+** lenguaje natural vía CLIP (text-to-image). Sin reconocimiento facial. |
| Modelo de negocio | Marketplace con venta integrada (previews con watermark, descarga full-res tras compra). |
| Pagos | MercadoPago (Argentina/LatAm), checkout + split de pagos (payout al fotógrafo + comisión de plataforma). Moneda ARS. |
| Unidad de venta | Fotos sueltas **y** packs/sesiones; el precio lo fija el fotógrafo. |
| Ranking | Global semanal; votan usuarios registrados; 1 voto por foto. |
| Escala inicial | MVP chico (1 o pocas playas, puñado de fotógrafos, cientos–pocos miles de fotos/semana). Lean, tiers managed/gratuitos. |
| Enfoque de arquitectura | Monolito Next + servicios managed + API hosteada de CLIP, con el pipeline de AI/imagen detrás de interfaces limpias. |

## 4. Stack tecnológico

- **Frontend + backend:** Next.js 16 (App Router, React 19), Tailwind 4, TypeScript. Desplegado en Vercel. Toda la lógica de negocio vive en Server Actions / Route Handlers.
- **Datos / Auth / Storage:** Supabase (Postgres + Auth + Storage).
- **Vectores:** Qdrant Cloud (managed).
- **Embeddings CLIP:** API multimodal hosteada (imagen y texto en el mismo espacio). Default recomendado: Jina AI `jina-clip-v2` o Cloudflare Workers AI; se confirma el proveedor en el plan de implementación. La dimensión del vector de la colección de Qdrant se fija según el modelo elegido.
- **Procesamiento de imagen:** `sharp` (en funciones de Next) para watermark + thumbnails.
- **Pagos:** MercadoPago (checkout + split marketplace + webhooks).

**Interfaces limpias (límites del sistema):** `lib/db`, `lib/vectors`, `lib/payments`, `lib/embeddings`, `lib/images`. Cada servicio externo queda detrás de su interfaz para ser testeable y reemplazable. Next es el único orquestador; los demás son servicios "tontos".

## 5. Arquitectura del sistema

```
                          ┌─────────────────────────────┐
   Surfista  ───────────► │     Next.js 16 (Vercel)     │ ◄─────────  Fotógrafo
  (busca,compra,vota)     │  UI + Server Actions/Routes │        (sube, taggea, vende)
                          │   (toda la lógica de negocio)│
                          └──────┬──────┬──────┬─────────┘
         ┌───────────────────────┘      │      └────────────────────────┐
         ▼                              ▼                                ▼
┌──────────────────┐         ┌────────────────────┐          ┌────────────────────┐
│    Supabase      │         │   Qdrant Cloud     │          │    MercadoPago     │
│ • Postgres       │         │ • vectores CLIP    │          │ • checkout + split │
│ • Auth (roles)   │         │ • payload p/filtrar│          │ • webhooks de pago │
│ • Storage:       │         └────────▲───────────┘          └────────────────────┘
│   - originals 🔒 │                  │
│   - public  🌊   │         ┌────────┴───────────┐
└──────────────────┘         │  Embedding API CLIP │  imagen ⇄ texto
         ▲                   └────────────────────┘
         │  sharp (watermark + thumbnails)
```

Responsabilidad única de cada pieza:
- **Next.js:** UI de ambos roles + lógica de negocio; orquesta a los demás.
- **Supabase Postgres:** fuente de verdad relacional.
- **Supabase Auth:** identidad y roles.
- **Supabase Storage:** bucket `originals` (full-res, privado) y `public` (previews con watermark + thumbnails + logos de watermark).
- **Qdrant:** vectores CLIP + payload de metadata para filtrar en la misma query.
- **Embedding API:** embeddings de imagen (al subir) y de texto (al buscar).
- **sharp:** genera preview con watermark + thumbnails.
- **MercadoPago:** checkout, split y webhooks.

## 6. Modelo de datos

Postgres es la fuente de verdad; Qdrant es un índice de búsqueda denormalizado que se mantiene en sync.

### Identidad
- **`profiles`** — extiende `auth.users`. `id`, `role` (`photographer`|`surfer`), `display_name`, `avatar_url`, `bio`, `instagram`, `created_at`. Campos solo-fotógrafo: `watermark_path` (logo subido; si está vacío se usa el watermark default de Spoteado), `watermark_position` (`bottom-right`|`bottom-left`|`center`|…), `watermark_opacity`.
- **`photographer_payout_accounts`** — `profile_id`, `mp_collector_id`, `mp_oauth_token`, `verified`, `commission_pct`. Solo accesible desde el servidor.

### Catálogo
- **`beaches`** — `id`, `name`, `slug`, `region`.
- **`sessions`** — `id`, `photographer_id`, `beach_id`, `session_date`, `time_block`, `title`, `pack_price`, `cover_photo_id`.
- **`photos`** — `id`, `photographer_id`, `session_id` (nullable → foto suelta), `beach_id`, `captured_at`, `time_block`, `price`, `original_path` 🔒, `preview_path` 🌊, `thumb_path` 🌊, `width`, `height`, `status` (`processing`|`ready`|`failed`), `embedding_status` (`pending`|`done`|`failed`), `vote_count` (denormalizado), `contest_week` (derivado de `captured_at`), `created_at`.
- **`tags`** + **`photo_tags`** — tags del fotógrafo (M:N). El `@handle` del surfista destacado se modela como un tag más.

### Comercio
- **`orders`** — `id`, `buyer_id`, `photographer_id`, `status` (`pending`|`paid`|`failed`|`refunded`), `total_amount`, `mp_preference_id`, `mp_payment_id`, `created_at`, `paid_at`.
- **`order_items`** — `id`, `order_id`, `item_type` (`photo`|`session`), `photo_id`/`session_id`, `unit_price`, `photographer_id`, `photographer_amount`, `platform_fee`. Snapshot del precio y el split al momento de comprar.
- **`entitlements`** — `id`, `buyer_id`, `photo_id`, `order_id`, `granted_at`. Comprar una sesión expande a una fila por foto. Gatea la signed URL al original.

### Votación
- **`votes`** — `id`, `voter_id`, `photo_id`, `created_at`. **Unique(`voter_id`, `photo_id`)** → 1 voto por foto por usuario. Guard: no se puede votar la foto propia.
- **`weekly_winners`** — `week_start`, `photo_id`, `rank`, `vote_count`. Snapshot inmutable de las ganadoras al cerrar cada semana.

### Qdrant — colección `photos`
- 1 punto por foto. `vector` = embedding CLIP de imagen (dimensión según modelo). `payload` = `{ photo_id, photographer_id, beach_slug, captured_at, time_block, tags[], status, session_id }`.
- Permite filtro + búsqueda vectorial en una sola query. Se actualiza cuando la foto sube, cambia tags o se borra.

## 7. Flujos

### 7.1 Carga + pipeline de AI
Subida directa + procesamiento por-foto en paralelo (un fotógrafo puede subir 100+ fotos de una sesión):

1. El fotógrafo crea/elige una sesión (playa, fecha, franja) o sube fotos sueltas.
2. Pide signed upload URLs a Next y sube los **originales directo a Storage** 🔒 (no pasan por Next).
3. Por cada foto llama a `processPhoto(photoId)` — **una invocación corta e idempotente por foto, en paralelo**:
   a. crea/actualiza fila `photos` → `status=processing`;
   b. baja el original (service role);
   c. `sharp` compone el watermark del fotógrafo (o default) → preview 🌊 + thumbnail 🌊;
   d. sube preview + thumb al bucket público;
   e. `lib/embeddings`: manda una versión reducida a la API CLIP → vector;
   f. `lib/vectors`: upsert del punto en Qdrant (vector + payload);
   g. update `photos`: paths, dimensiones, `status=ready`, `embedding_status=done`.
4. El dashboard hace polling/realtime del status (⏳ → ✅).
5. El fotógrafo setea tags + precios (por foto y/o `pack_price` de la sesión).

### 7.2 Búsqueda del surfista
El surfista combina filtros con un campo de texto libre opcional. Dos caminos:

- **Camino A — solo filtros (sin texto):** query directa a **Postgres** (playa+fecha+hora+tags). Sin cómputo vectorial. Sort: reciente / más votada. Cubre el "browse" y ver fotos de otros surfers.
- **Camino B — lenguaje natural (+ filtros):**
  1. `lib/embeddings`: CLIP text-encode de la query;
  2. `lib/vectors`: Qdrant filtered search (vector = texto, filter = payload: playa, rango de fecha, franja, tags, `status=ready`);
  3. top-K por similitud con **umbral** (descarta ruido);
  4. Postgres: traer metadata de esos IDs.
- Resultados = previews con watermark + precio + fotógrafo. Si el camino B no supera el umbral → fallback a lo filtrado + sugerencia de ampliar.
- Los filtros (playa + fecha) hacen el trabajo pesado de achicar el universo; CLIP refina pero no distingue personas parecidas.

### 7.3 Compra / marketplace
El carrito se agrupa **por fotógrafo**, y cada grupo es su propia orden con su propio pago split (el split de MercadoPago vincula un pago a un solo vendedor).

1. Carrito client-side (localStorage) con fotos sueltas y/o packs.
2. Checkout → Next agrupa por fotógrafo; por cada grupo: valida ítems, crea `orders` (`pending`) + `order_items` con snapshot de precio y split, y crea la preference de MercadoPago con `marketplace_fee` y el `mp_collector_id` del fotógrafo. Devuelve `init_point`.
3. El surfista paga en MercadoPago.
4. **Webhook** `POST /api/webhooks/mercadopago` (fuente de verdad del pago): verifica firma, consulta el estado, y si `approved` → orden `paid`, set `mp_payment_id`/`paid_at`, crea `entitlements` (sesión → expande a todas sus fotos). Idempotente por `mp_payment_id`.
5. "Mis fotos compradas": Next verifica el entitlement y emite una **signed URL** de TTL corto al original 🔒. El original nunca se hace público.

### 7.4 Votación / ranking semanal
- Usuario registrado toca ❤️ → `toggleVote(photoId)`: INSERT en `votes` (o DELETE si ya votó). Un trigger ajusta `photos.vote_count ±1`.
- **Home / galería:** ranking en vivo de la semana actual (`WHERE contest_week = semana_actual ORDER BY vote_count DESC LIMIT N`) + "Hall of fame" de `weekly_winners`.
- **Cron semanal** (Vercel Cron → `/api/cron/close-week`): toma el top N de la semana que cierra y lo congela en `weekly_winners`.
- Anti-abuso MVP: voto solo con sesión iniciada + constraint único. Rate-limit por usuario si hiciera falta.

## 8. Auth, roles y seguridad (RLS)

- Supabase Auth + tabla `profiles` con `role`. Métodos: email/contraseña + Google OAuth (baja fricción para surfers).
- **Todas las mutaciones y lecturas sensibles pasan por Server Actions de Next** (service role); **RLS prendido en todas las tablas** como defensa en profundidad.
- Reglas de acceso:
  - `photos`/`sessions`: lectura pública solo de fotos `ready` y solo campos públicos; el `original_path` nunca se expone; escritura solo por el fotógrafo dueño.
  - `orders`/`order_items`/`entitlements`: legibles solo por el comprador.
  - `votes`: insert/delete por el propio usuario; conteos públicos vía `vote_count`.
  - `photographer_payout_accounts`: solo servidor (tiene tokens).
- **Garantías clave:**
  1. Full-res inalcanzable sin compra (bucket privado + signed URL gateada por entitlement).
  2. Secretos (service role key, tokens de payout, secrets de MP) solo en el servidor; el cliente solo ve la anon key.
  3. Webhook de MercadoPago con firma verificada.
  4. Authz explícita en cada server action.

## 9. Manejo de errores

- **Pipeline de carga:** cada paso falla independiente (idempotente). Imagen corrupta → `status=failed`. API de embeddings caída → la foto queda buscable por filtros aunque no por NL (`embedding_status=failed`), con reintento + job de reconciliación. Upsert a Qdrant falla → reconciliación re-indexa.
- **Búsqueda:** embed de texto o Qdrant caídos → fallback a resultados por filtros + aviso suave. Nunca falla duro.
- **Pagos:** pago rechazado → `failed`, sin entitlement. Webhook que no llega → cron poolea MP las órdenes `pending` viejas. Webhook duplicado → idempotente. Reembolso → `refunded` + revoca entitlements (signed URLs expiran por TTL). Payout inválido → fotos no comprables hasta verificar.
- **Consistencia Postgres ↔ Qdrant:** Postgres manda; borrar foto propaga a Qdrant + Storage; job de reconciliación cubre desfasajes.
- **General:** Server Actions devuelven resultados tipados (`success`/`error`), no excepciones crudas; errores user-facing amables; logging estructurado.

## 10. Estrategia de testing

- **Unit:** lógica de negocio con servicios externos mockeados detrás de su interfaz — cálculo del split, expansión de entitlements, toggle de voto + conteo, derivación de `contest_week`, ruteo de búsqueda (filtros vs NL), guards de authz.
- **Integración:** contra Supabase + Qdrant de test, con MercadoPago y embeddings mockeados — queries reales, RLS, pipeline de carga end-to-end con embedding fake, flujo compra→webhook→entitlement→signed-URL con webhook simulado.
- **E2E (caminos críticos, Playwright):** fotógrafo sube → `ready`; surfista busca → ve preview; surfista compra (sandbox MP) → webhook → descarga; surfista vota → sube el conteo.
- **Seguridad:** original inalcanzable sin entitlement; RLS niega lecturas cruzadas de órdenes/entitlements.
- **TDD:** tests primero para la lógica core (split, entitlements, voto, ruteo de búsqueda) durante la implementación.

## 11. Alcance del MVP / fuera de alcance (YAGNI)

**Dentro:** roles fotógrafo/surfista, carga + pipeline de embeddings, búsqueda (filtros + NL), marketplace con MercadoPago (split), votación con ranking global semanal, seguridad (RLS + signed URLs).

**Fuera (futuro):**
- Reconocimiento facial / "subí una selfie y encontrá tus fotos" (capa de face-embeddings opcional a futuro).
- Rankings por playa/región (arrancamos solo con el global).
- Carrito con pago único multi-fotógrafo (arrancamos con una orden por fotógrafo).
- Suscripciones, apps móviles nativas, multi-moneda/multi-región.

## 12. Restricciones / notas de implementación

- **⚠️ Next.js 16 tiene cambios de API respecto a versiones previas** (ver `AGENTS.md`). Antes de escribir código hay que leer la guía relevante en `node_modules/next/dist/docs/`.
- Dependencias ya saneadas: `next@16.2.6`, override de `postcss@^8.5.10`, 0 vulnerabilidades.
- Todo detrás de las interfaces `lib/*` para mantener límites limpios y piezas reemplazables.

## 13. Riesgos abiertos / a decidir en el plan

- **CLIP no identifica personas específicas:** los filtros (playa + fecha) cargan el peso de achicar el universo. Validar con usuarios reales que la combinación filtros + NL alcanza para "encontrar mi foto".
- **Proveedor de embeddings:** confirmar Jina vs Cloudflare Workers AI vs Replicate en el plan (costo, latencia, dimensión del vector).
- **Inflación / pricing en ARS:** consideración de producto, no de arquitectura, pero a tener presente.
- **Términos legales:** venta de fotos donde aparecen personas (derechos de imagen) — revisar antes de lanzar.
