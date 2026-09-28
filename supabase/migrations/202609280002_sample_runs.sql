-- Curated recordings only. Visitors can read, never publish, edit or delete.
create table if not exists public.jevolution_samples (
  id uuid primary key,
  title text not null,
  recorded_at timestamptz not null,
  frames integer not null check (frames > 0 and frames <= 150000),
  interval_ms integer not null check (interval_ms >= 50 and interval_ms <= 2000),
  duration_seconds double precision not null check (duration_seconds >= 0),
  notes text not null default '',
  active boolean not null default false
);
create unique index if not exists one_active_jevolution_sample on public.jevolution_samples(active) where active;
alter table public.jevolution_samples enable row level security;
revoke all on public.jevolution_samples from anon, authenticated;
grant select on public.jevolution_samples to anon, authenticated;
create policy "Published samples are readable" on public.jevolution_samples for select to anon, authenticated using (active);
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('jevolution-samples', 'jevolution-samples', true, 4194304, array['application/gzip', 'application/x-gzip'])
on conflict (id) do nothing;
-- No storage write policies: only the offline administrator publisher can upload.
