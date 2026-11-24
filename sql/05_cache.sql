-- Polychrome · 서버 함수 공용 캐시 (aurora · quakes · places · 이후 tides/buildings/radar) (2026-11-25)
-- 실행: Supabase(polychrome) → SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 안전)
-- 앱(anon)은 직접 읽지 못함. 서버 함수만 사용.

create table if not exists public.fn_cache (
  k          text primary key,              -- '<함수>:<키>' 예: 'aurora:ovation', 'quakes:all', 'places:<검색어>…'
  body       jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.fn_cache enable row level security;
revoke all on public.fn_cache from anon, authenticated;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('polychrome-fn-cache-clean', '20 19 * * *',
    $c$ delete from public.fn_cache where fetched_at < now() - interval '7 days' $c$);
exception when others then raise notice 'cron 예약 생략: %', sqlerrm; end $$;
