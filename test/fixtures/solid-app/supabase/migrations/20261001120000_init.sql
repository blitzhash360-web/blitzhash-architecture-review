create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id),
  name text not null,
  created_at timestamptz default now()
);
create index projects_owner_id_idx on public.projects (owner_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null
);
create index tasks_project_id_idx on public.tasks (project_id);

create table public.subscriptions (
  user_id uuid primary key references auth.users (id),
  status text not null
);

alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.subscriptions enable row level security;

create policy "owners manage projects" on public.projects for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "owners manage tasks" on public.tasks for all using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
create policy "read own subscription" on public.subscriptions for select using (auth.uid() = user_id);
