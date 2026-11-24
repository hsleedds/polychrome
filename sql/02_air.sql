-- Polychrome · 에어코리아(미세먼지) 캐시 (2026-11-25)
-- 실행: Supabase(polychrome) → SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 안전)
-- 앱(anon)은 이 표들을 직접 읽지 못함. 서버 함수 air 만 사용(service role).

-- 1) 측정소 목록 (하루 1번 갱신)
create table if not exists public.air_station (
  station_name text primary key,          -- 에어코리아 stationName (실시간 조회 키)
  addr         text,
  sido         text,                       -- 예보 지역명(서울, 경기북부, 영동 …) — 주소로 추정
  lat          double precision,
  lon          double precision,
  raw          jsonb,                      -- 원본 항목(고치지 않음)
  updated_at   timestamptz not null default now()
);
alter table public.air_station enable row level security;
create index if not exists air_station_latlon on public.air_station (lat, lon);

-- 2) 측정소별 실시간 값 (30분)
create table if not exists public.air_cache (
  station_name text primary key,
  body         jsonb not null,
  fetched_at   timestamptz not null default now()
);
alter table public.air_cache enable row level security;

-- 3) 예보통보 (3시간) — k = 조회 날짜(YYYY-MM-DD)
create table if not exists public.air_forecast_cache (
  k          text primary key,
  body       jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.air_forecast_cache enable row level security;

-- 정책 없음 = anon/authenticated 접근 불가 (service role만)
revoke all on public.air_station, public.air_cache, public.air_forecast_cache from anon, authenticated;

-- 4) 오래된 캐시 정리
do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('polychrome-air-cache-clean', '40 18 * * *',
    $c$ delete from public.air_cache where fetched_at < now() - interval '1 day';
        delete from public.air_forecast_cache where fetched_at < now() - interval '3 days' $c$);
exception when others then raise notice 'cron 예약 생략: %', sqlerrm; end $$;
