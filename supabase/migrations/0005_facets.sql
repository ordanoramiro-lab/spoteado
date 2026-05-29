-- 0005_facets.sql — facetas en jerga (vocabulario controlado) + auto-clasificación

-- 1. Vocabulario controlado. Agregar un valor nuevo = un INSERT, no una migración de enum.
create table public.facet_values (
  category text not null,
  value    text not null,
  label    text not null,
  sort     int  not null default 0,
  primary key (category, value)
);

-- 2. Facetas asignadas a cada foto (por la IA). FK al vocabulario garantiza valores válidos.
create table public.photo_facets (
  photo_id   uuid not null references public.photos (id) on delete cascade,
  category   text not null,
  value      text not null,
  confidence numeric,
  primary key (photo_id, category),
  foreign key (category, value) references public.facet_values (category, value)
);
create index photo_facets_lookup_idx on public.photo_facets (category, value);

-- 3. Seed del vocabulario (coincide con lib/facets FACET_VOCAB).
insert into public.facet_values (category, value, label, sort) values
  ('board_type','longboard','Longboard',1),
  ('board_type','tabla-corta','Tabla corta',2),
  ('board_type','fish','Fish',3),
  ('board_type','evolutiva','Evolutiva',4),
  ('board_type','gun','Gun',5),
  ('board_type','espuma','Tabla de espuma',6),
  ('board_type','sup','SUP',7),
  ('board_type','bodyboard','Bodyboard',8),
  ('board_type','bodysurf','Bodysurf',9),
  ('maneuver','remando','Remando',1),
  ('maneuver','drop','Drop',2),
  ('maneuver','bottom-turn','Bottom turn',3),
  ('maneuver','cutback','Cutback',4),
  ('maneuver','floater','Floater',5),
  ('maneuver','aereo','Aéreo',6),
  ('maneuver','re-entry','Re-entry',7),
  ('maneuver','tubo','Tubo',8),
  ('maneuver','caida','Caída',9),
  ('maneuver','caminando','Caminando',10),
  ('maneuver','maniobra','Maniobra',11),
  ('stance','goofy','Goofy',1),
  ('stance','regular','Regular',2),
  ('sexo','hombre','Hombre',1),
  ('sexo','mujer','Mujer',2),
  ('patas_de_rana','si','Con patas de rana',1),
  ('patas_de_rana','no','Sin patas de rana',2)
on conflict (category, value) do update set label = excluded.label, sort = excluded.sort;

-- 4. RLS
alter table public.facet_values enable row level security;
alter table public.photo_facets enable row level security;

create policy "facet_values visibles" on public.facet_values for select using (true);

-- Lectura pública de facetas de fotos ready; el fotógrafo ve las suyas.
create policy "photo_facets visibles" on public.photo_facets for select
  using (exists (
    select 1 from public.photos p
    where p.id = photo_facets.photo_id
      and (p.status = 'ready' or p.photographer_id = auth.uid())
  ));

-- Escritura solo del dueño de la foto (la auto-clasificación corre con el admin client, que saltea RLS).
create policy "fotografo gestiona facetas de sus fotos" on public.photo_facets for all
  using (exists (
    select 1 from public.photos p
    where p.id = photo_facets.photo_id and p.photographer_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.photos p
    where p.id = photo_facets.photo_id and p.photographer_id = auth.uid()
  ));

-- 5. Eliminar el sistema de tags libres (reemplazado por facetas). Dev temprano: se descartan.
drop table if exists public.photo_tags;
drop table if exists public.tags;
