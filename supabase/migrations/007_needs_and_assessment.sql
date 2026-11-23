-- ٧: احتياجات الجهات + المطابقة + تقييم قابلية التطبيق والأثر المتوقع

-- احتياجات تسجّلها الجهات بنفسها (تظهر للعموم بعد اعتماد الإدارة)
create table if not exists public.needs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  org_name text not null check (char_length(org_name) between 2 and 150),
  sectors text[] not null default '{}',
  title text not null check (char_length(title) between 5 and 200),
  description text not null check (char_length(description) between 20 and 3000),
  beneficiaries text check (char_length(beneficiaries) <= 300),
  city text check (char_length(city) <= 80),
  status text not null default 'pending' check (status in ('pending','approved','closed','rejected')),
  created_at timestamptz not null default now()
);
alter table public.needs enable row level security;
create policy "needs_insert_pending" on public.needs for insert to anon, authenticated with check (status = 'pending');
create policy "needs_public_read" on public.needs for select to anon, authenticated using (status = 'approved' or public.is_admin());
create policy "needs_admin_update" on public.needs for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "needs_admin_delete" on public.needs for delete to authenticated using (public.is_admin());

-- بيانات التواصل منفصلة: تظهر للمسجّلين فقط
create table if not exists public.need_contacts (
  need_id uuid primary key references public.needs(id) on delete cascade,
  contact_name text not null check (char_length(contact_name) between 2 and 120),
  email text not null check (char_length(email) between 5 and 200 and email like '%@%'),
  phone text check (char_length(phone) <= 30),
  created_at timestamptz not null default now()
);
alter table public.need_contacts enable row level security;
create policy "contacts_insert" on public.need_contacts for insert to anon, authenticated with check (true);
create policy "contacts_read_auth" on public.need_contacts for select to authenticated
  using (public.is_admin() or exists (select 1 from public.needs n where n.id = need_id and n.status = 'approved'));

-- نتائج المطابقة بين البحث والاحتياجات (يكتبها الخادم فقط)
create table if not exists public.need_matches (
  research_id uuid not null references public.research(id) on delete cascade,
  need_id uuid not null references public.needs(id) on delete cascade,
  score int not null check (score between 0 and 100),
  reason text,
  created_at timestamptz not null default now(),
  primary key (research_id, need_id)
);
alter table public.need_matches enable row level security;
create policy "matches_owner_read" on public.need_matches for select to authenticated
  using (exists (select 1 from public.research r where r.id = research_id and r.user_id = auth.uid()));

-- تقييم قابلية التطبيق والأثر المتوقع (يكتبه الخادم فقط)
alter table public.research add column if not exists assessment jsonb;
create or replace function public.protect_assessment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'service_role') then
    if tg_op = 'INSERT' then new.assessment := null;
    else new.assessment := old.assessment; end if;
  end if;
  return new;
end $$;
create or replace trigger research_protect_assessment before insert or update on public.research
  for each row execute function public.protect_assessment();

-- إحصاءات مجمّعة للإدارة
create or replace function public.admin_needs_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'by_status', (select coalesce(jsonb_object_agg(status, c), '{}') from (select status, count(*) c from needs group by status) s),
    'matches', (select count(*) from need_matches),
    'matched_needs', (select count(distinct need_id) from need_matches),
    'assessed', (select count(*) from research where assessment is not null),
    'avg_score', (select round(avg((assessment->>'applicability_score')::numeric), 1) from research where assessment is not null),
    'impact_levels', (select coalesce(jsonb_object_agg(l, c), '{}') from (select assessment->'expected_impact'->>'level' l, count(*) c from research where assessment is not null group by 1) x)
  );
end $$;
grant execute on function public.admin_needs_stats() to authenticated;

-- الزائر غير المسجّل يحتاج تنفيذ is_admin داخل سياسة القراءة (ترجع false له)
grant execute on function public.is_admin() to anon;
