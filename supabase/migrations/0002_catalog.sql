-- 0002_catalog.sql — catálogo: beaches, sessions, photos, tags, photo_tags + RLS
create type public.photo_status as enum ('processing', 'ready', 'failed');
create type public.embedding_status as enum ('pending', 'done', 'failed');
create type public.time_block as enum ('dawn', 'morning', 'midday', 'afternoon', 'sunset');

create table public.beaches (
  id     uuid primary key default gen_random_uuid(),
  name   text not null,
  slug   text not null unique,
  region text
);

create table public.sessions (
  id              uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.profiles (id) on delete cascade,
  beach_id        uuid not null references public.beaches (id),
  session_date    date not null,
  time_block      public.time_block,
  title           text,
  pack_price      numeric(12,2),
  cover_photo_id  uuid,
  created_at      timestamptz not null default now()
);

create table public.photos (
  id               uuid primary key default gen_random_uuid(),
  photographer_id  uuid not null references public.profiles (id) on delete cascade,
  session_id       uuid references public.sessions (id) on delete set null,
  beach_id         uuid not null references public.beaches (id),
  captured_at      timestamptz not null,
  time_block       public.time_block,
  price            numeric(12,2),
  original_path    text not null,
  preview_path     text,
  thumb_path       text,
  width            int,
  height           int,
  status           public.photo_status not null default 'processing',
  embedding_status public.embedding_status not null default 'pending',
  vote_count       int not null default 0,
  contest_week     date,
  created_at       timestamptz not null default now()
);
create index photos_beach_captured_idx on public.photos (beach_id, captured_at desc);

create table public.tags (
  id   uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique
);
create table public.photo_tags (
  photo_id uuid references public.photos (id) on delete cascade,
  tag_id   uuid references public.tags (id) on delete cascade,
  primary key (photo_id, tag_id)
);

-- RLS
alter table public.beaches    enable row level security;
alter table public.sessions   enable row level security;
alter table public.photos     enable row level security;
alter table public.tags       enable row level security;
alter table public.photo_tags enable row level security;

create policy "beaches visibles"   on public.beaches    for select using (true);
create policy "tags visibles"      on public.tags        for select using (true);
create policy "phototags visibles" on public.photo_tags for select using (true);
create policy "sessions visibles"  on public.sessions   for select using (true);
create policy "fotos ready visibles" on public.photos   for select
  using (status = 'ready' or photographer_id = auth.uid());

create policy "fotografo gestiona sus sessions" on public.sessions for all
  using (photographer_id = auth.uid()) with check (photographer_id = auth.uid());
create policy "fotografo gestiona sus fotos" on public.photos for all
  using (photographer_id = auth.uid()) with check (photographer_id = auth.uid());

-- Watermark del fotógrafo (lo usa el pipeline processPhoto de esta fase).
alter table public.profiles
  add column watermark_path     text,
  add column watermark_position text default 'bottom-right',
  add column watermark_opacity  numeric default 0.6;
