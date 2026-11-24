-- Polychrome · 기상청 예보 캐시 + 호출 횟수 제한 (2026-11-25)
-- 실행: Supabase(polychrome 프로젝트!) → SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 안전)
-- 비밀값은 이 파일에 없음. KMA_KEY는 Edge Functions → Secrets에만.

-- 1) 기상청 응답 캐시 (격자별 20분) — 앱에서는 직접 접근 불가, 서버 함수만 사용
create table if not exists public.kma_cache (
  k          text primary key,
  body       jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.kma_cache enable row level security;

-- 2) 로그인 없이 부르는 함수 호출 횟수 제한
create table if not exists public.fn_rate (k text primary key, n int not null default 0, at timestamptz not null default now());
alter table public.fn_rate enable row level security;
create or replace function public.hit_rate(p_key text, p_max int) returns boolean
language sql security definer set search_path = '' as $$
  insert into public.fn_rate(k, n) values (p_key, 1)
  on conflict (k) do update set n = public.fn_rate.n + 1
  returning n <= p_max
$$;
revoke all on function public.hit_rate(text,int) from public, anon, authenticated;

-- 3) 오래된 기록 정리 (pg_cron이 있으면)
do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('polychrome-kma-cache-clean', '30 18 * * *', $c$ delete from public.kma_cache where fetched_at < now() - interval '1 day' $c$);
  perform cron.schedule('polychrome-rate-clean', '15 * * * *', $c$ delete from public.fn_rate where at < now() - interval '2 hours' $c$);
exception when others then raise notice 'cron 예약 생략: %', sqlerrm; end $$;
