-- 0003_storage.sql — buckets originals (privado) + public + policies
insert into storage.buckets (id, name, public) values ('originals', 'originals', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('public', 'public', true)
  on conflict (id) do nothing;

-- El fotógrafo sube/lee SUS originales (carpeta = su uid).
create policy "fotografo sube sus originales" on storage.objects for insert
  to authenticated
  with check (bucket_id = 'originals' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "fotografo lee sus originales" on storage.objects for select
  to authenticated
  using (bucket_id = 'originals' and (storage.foldername(name))[1] = auth.uid()::text);

-- Bucket público: lectura para todos, escritura autenticada.
create policy "public lee" on storage.objects for select
  using (bucket_id = 'public');
create policy "public escribe autenticado" on storage.objects for insert
  to authenticated with check (bucket_id = 'public');
