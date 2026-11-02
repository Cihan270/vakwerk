-- Vakwerk: eenmalig uitvoeren in Supabase → SQL Editor → New query → Run.
-- Veilig om nog eens uit te voeren.

-- Elk object uit de app is één rij: store = soort (notebooks, pages, cards...), data = de inhoud.
-- seq loopt bij elke wijziging op, zodat een apparaat alleen ophaalt wat nieuw is.
create sequence if not exists public.vakwerk_seq;

create table if not exists public.vakwerk_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  store text not null,
  id text not null,
  data jsonb,
  file text,
  deleted boolean not null default false,
  changed_at bigint not null,
  seq bigint not null default nextval('public.vakwerk_seq'),
  primary key (user_id, store, id)
);
create index if not exists vakwerk_items_user_seq on public.vakwerk_items (user_id, seq);

create or replace function public.vakwerk_bump_seq() returns trigger
language plpgsql set search_path = public as $$
begin
  new.seq := nextval('public.vakwerk_seq');
  return new;
end $$;

drop trigger if exists vakwerk_items_bump on public.vakwerk_items;
create trigger vakwerk_items_bump before update on public.vakwerk_items
  for each row execute function public.vakwerk_bump_seq();

-- Iedereen ziet en wijzigt alleen zijn eigen rijen
alter table public.vakwerk_items enable row level security;
drop policy if exists "eigen items" on public.vakwerk_items;
create policy "eigen items" on public.vakwerk_items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.vakwerk_items to authenticated;
grant usage, select on sequence public.vakwerk_seq to authenticated;

-- Slides, afbeeldingen en opnames: privé, per gebruiker in een eigen map
insert into storage.buckets (id, name, public)
values ('vakwerk', 'vakwerk', false)
on conflict (id) do nothing;

drop policy if exists "vakwerk eigen bestanden" on storage.objects;
create policy "vakwerk eigen bestanden" on storage.objects
  for all to authenticated
  using (bucket_id = 'vakwerk' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'vakwerk' and (storage.foldername(name))[1] = (select auth.uid())::text);

notify pgrst, 'reload schema';
