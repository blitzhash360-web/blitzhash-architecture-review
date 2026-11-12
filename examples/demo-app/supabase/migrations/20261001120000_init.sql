-- TaskPilot demo schema (fake)
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id),
  name text not null,
  created_at timestamptz default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  done boolean default false
);

create table public.subscriptions (
  email text primary key,
  status text not null
);

create table public.usage (
  id int primary key,
  tasks int default 0
);

alter table public.projects enable row level security;
alter table public.subscriptions enable row level security;

create policy "anyone can do anything" on public.projects
  for all using (true) with check (true);

create policy "users read own subscription" on public.subscriptions
  for select using (auth.jwt() ->> 'email' = email);
