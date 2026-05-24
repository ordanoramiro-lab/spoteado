-- 0001_profiles.sql — tabla profiles (extiende auth.users) + trigger de signup + RLS

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
