-- Apply to the dedicated Jevolution project. Supabase Auth owns users/passwords.
begin;
create table if not exists public.jevolution_runs (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seed bigint not null,
  duration_seconds double precision not null default 0 check (duration_seconds >= 0),
  frames integer not null default 0 check (frames between 0 and 150000),
  config jsonb not null,
  groups jsonb not null,
  populations jsonb not null default '{}'::jsonb,
  estimated_cost double precision,
  primary key (user_id, id)
);
create index if not exists jevolution_runs_recent on public.jevolution_runs(user_id, created_at desc);
alter table public.jevolution_runs enable row level security;
drop policy if exists "Own runs" on public.jevolution_runs;
create policy "Own runs" on public.jevolution_runs for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.jevolution_runs from anon;
grant select, insert, update, delete on public.jevolution_runs to authenticated;

create table if not exists public.jevolution_provider_keys (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('typesafe','anthropic','openai','google')),
  ciphertext text not null check (length(ciphertext) <= 6000),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.jevolution_provider_keys enable row level security;
drop policy if exists "Own encrypted keys" on public.jevolution_provider_keys;
create policy "Own encrypted keys" on public.jevolution_provider_keys for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.jevolution_provider_keys from anon;
grant select, insert, update, delete on public.jevolution_provider_keys to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('jevolution-replays', 'jevolution-replays', false, 4194304, array['application/gzip'])
on conflict (id) do update set public = false, file_size_limit = 4194304,
allowed_mime_types = array['application/gzip'];
drop policy if exists "Read own replay" on storage.objects;
create policy "Read own replay" on storage.objects for select to authenticated
using (bucket_id = 'jevolution-replays' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Insert own replay" on storage.objects;
create policy "Insert own replay" on storage.objects for insert to authenticated
with check (bucket_id = 'jevolution-replays' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Update own replay" on storage.objects;
create policy "Update own replay" on storage.objects for update to authenticated
using (bucket_id = 'jevolution-replays' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'jevolution-replays' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Delete own replay" on storage.objects;
create policy "Delete own replay" on storage.objects for delete to authenticated
using (bucket_id = 'jevolution-replays' and (storage.foldername(name))[1] = (select auth.uid())::text);
commit;
