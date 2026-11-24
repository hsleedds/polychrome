-- Polychrome · 정확도(수집 → 실측 → 채점 → 가중치) 표 + 기능 스위치 + 정기 실행(cron) (2026-11-25)
-- 실행: Supabase(polychrome) → SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 안전)
-- 선행: 01_polychrome_base.sql, 02_air.sql
-- 비밀값은 이 파일에 없음. cron 토큰은 SETUP.md의 「한 번만 하는 설정」으로 private_config 에 넣는다.

-- ───────────────────────────── 1) 예보 스냅샷 (덮어쓰지 않음) ─────────────────────────────
-- 모든 시각은 timestamptz. target_time = 「그 시각까지 1시간」의 끝 시각(강수량 기준).
create table if not exists public.fc_snapshot (
  source      text not null,               -- 'kma' | 'om' (Open-Meteo) | 'met' (MET Norway)
  model       text not null,               -- kma: 'vilage'|'ultra', om: 모델 id, met: 'locationforecast'
  issued_at   timestamptz not null,         -- 발표 시각 (om: 수집 시각을 정시로 자른 값 — 실제 모델 실행 시각은 모름)
  fetched_at  timestamptz not null default now(),
  stn         int not null,                 -- ASOS 지점 번호
  target_time timestamptz not null,
  lead_h      int not null,                 -- 대상 − 발표 (시간, 내림)
  p_mm        real,                         -- 1시간 강수량 mm
  pp          real,                         -- 강수확률 %
  t           real,                         -- 기온 °C
  wind        real,                         -- 풍속 m/s
  gust        real,                         -- 돌풍 m/s
  cloud       real,                         -- 전운량 %
  cloud_low   real, cloud_mid real, cloud_high real,
  vis         real,                         -- 시정 m
  snow        real,                         -- 신적설 cm
  extra       jsonb,                        -- 기관 고유 값(예: 기상청 SKY/PTY 코드). 대부분 null
  unique (source, model, issued_at, stn, target_time)
);
create index if not exists fc_snapshot_stn_target on public.fc_snapshot (stn, target_time);
create index if not exists fc_snapshot_target on public.fc_snapshot (target_time);
alter table public.fc_snapshot enable row level security;

-- 수집기 상태(같은 모델 실행을 두 번 저장하지 않도록 마지막 값 기억)
create table if not exists public.collect_state (
  k    text primary key,                    -- 'om:<model>:<stn>' 등
  body jsonb not null,
  at   timestamptz not null default now()
);
alter table public.collect_state enable row level security;

-- ───────────────────────────── 2) ASOS 실측 ─────────────────────────────
create table if not exists public.obs_asos (
  stn         int not null,
  obs_time    timestamptz not null,         -- 정시. rn 은 이 시각까지 1시간 강수량
  rn          real,                         -- mm (빈 값 = 무강수 0, 결측이면 null)
  rn_missing  boolean not null default false,
  t           real,                         -- 기온 °C
  ws          real,                         -- 풍속 m/s
  wg          real,                         -- 돌풍 m/s (ASOS 시간자료에는 없음 → null)
  vis         real,                         -- 시정 m (원자료 10m 단위 × 10)
  cloud_total real,                         -- 전운량 0–10 (할)
  sunshine    real,                         -- 일조 시간(hr)
  snow        real,                         -- 적설 cm
  rh          real,                         -- 습도 %
  raw         jsonb,
  primary key (stn, obs_time)
);
alter table public.obs_asos enable row level security;

-- ───────────────────────────── 3) 채점 결과 (하루 × 기관 × 리드 구간 × 칸) ─────────────────────────────
-- win: '1h' | '3h' | 'day'(06–18시). ('window'는 SQL 예약어라 win 으로 씀)
create table if not exists public.score_daily (
  day            date not null,             -- 대상 날짜(KST)
  source         text not null,
  model          text not null,
  lead_bucket    text not null,             -- '0-5h' | '5-24h' | 'prev-evening' | '24-48h' | '48h+' | 'all'(일관성)
  win            text not null,
  hits           int not null default 0,
  misses         int not null default 0,
  false_alarms   int not null default 0,
  correct_neg    int not null default 0,
  brier_sum      double precision, brier_n int not null default 0,
  rel            jsonb,                     -- 신뢰도: {"0":[n,wet], …"9":[n,wet]} (확률 10% 칸)
  abs_err_sum    double precision, fc_sum double precision, obs_sum double precision,
  n_amount       int not null default 0,    -- 강수량: 어느 쪽이든 비가 있었던 칸 수
  mae_mm         real,                      -- abs_err_sum / n_amount
  bias_ratio     real,                      -- fc_sum / obs_sum
  cat_hits       int not null default 0,    -- 구간(<1,1–5,5–10,10–30,30+mm) 적중
  heavy10_hits   int not null default 0, heavy10_misses int not null default 0, heavy10_fa int not null default 0,
  heavy30_hits   int not null default 0, heavy30_misses int not null default 0, heavy30_fa int not null default 0,
  onset_err_sum  double precision, onset_n int not null default 0,   -- 시작 시각 오차(시간) — day 칸
  end_err_sum    double precision, end_n int not null default 0,     -- 그침 시각 오차(시간) — day 칸
  flips          int not null default 0, flips_n int not null default 0, -- 예보 뒤집힘(같은 대상 시각) — lead 'all'
  t_abs_err_sum  double precision, t_n int not null default 0,       -- 2순위: 기온 오차(1h)
  cloud_abs_err_sum double precision, cloud_n int not null default 0, -- 2순위: 전운량 오차(%) (1h)
  updated_at     timestamptz not null default now(),
  primary key (day, source, model, lead_bucket, win)
);
alter table public.score_daily enable row level security;

-- ───────────────────────────── 4) 가중치 (앱이 읽음) ─────────────────────────────
create table if not exists public.weights (
  source      text not null,
  model       text not null,
  lead_bucket text not null,
  w_rain      real not null,                -- 비 여부용
  w_amount    real not null,                -- 강수량용
  bias        real not null default 1,      -- 강수량 치우침(예보/실측 배율). 앱은 mm / bias 로 보정
  csi         real,
  mae_mm      real,
  n           int not null default 0,       -- 최근 30일 1시간 칸 표본 수
  warmup      boolean not null default true,-- true = 기록 부족 → 같은 무게
  updated_at  timestamptz not null default now(),
  primary key (source, model, lead_bucket)
);
alter table public.weights enable row level security;
drop policy if exists weights_read on public.weights;
create policy weights_read on public.weights for select to anon, authenticated using (true);
grant select on public.weights to anon, authenticated;

-- ───────────────────────────── 5) 오로라 기록 · 자력계 ─────────────────────────────
create table if not exists public.aurora_log (
  city       text not null,                 -- 'tromso' | 'reykjavik' | 'rovaniemi' | 'yellowknife' | 'fairbanks'
  hour       timestamptz not null,
  prob       real,                          -- OVATION 확률 %
  kp         real,
  cloud_low  real, cloud_mid real, cloud_high real,
  sun_alt    real, moon_alt real, moon_illum real, moon_az real,
  score      real,                          -- 서버 근사 지수(0–10). 정식 값은 앱 sky-core
  parts      jsonb,
  primary key (city, hour)
);
alter table public.aurora_log enable row level security;

create table if not exists public.mag_obs (      -- 나중: FMI 등 자력계
  station text not null,
  time    timestamptz not null,
  value   jsonb,
  primary key (station, time)
);
alter table public.mag_obs enable row level security;

-- ───────────────────────────── 6) 기능 스위치 (앱이 읽음) ─────────────────────────────
create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config for select to anon, authenticated using (true);
grant select on public.app_config to anon, authenticated;

-- 이미 있는 값은 건드리지 않음(재실행해도 켜 둔 스위치가 꺼지지 않음)
insert into public.app_config(key, value) values
  ('radar', 'false'), ('buildings', 'false'), ('places', 'false'), ('tides', 'false'),
  ('aurora_alert', 'false'), ('gps_public', 'false'), ('aurora_feedback', 'false'), ('drone_zones', 'false'),
  -- 운영 값
  ('fc_retention_days', '14'),                -- 예보 스냅샷 보관 일수(무료 용량 500MB 고려)
  ('collect_models', '["kma_seamless","ecmwf_ifs","ncep_gfs_seamless","dwd_icon_seamless","ukmo_seamless","meteofrance_seamless","cmc_gem_seamless","jma_seamless"]'),
  ('weights_min_days', '14'), ('weights_min_wet_hours', '200')
on conflict (key) do nothing;

-- ───────────────────────────── 7) 비공개 설정 (cron 토큰) ─────────────────────────────
-- 앱(anon)이 절대 읽을 수 없음: RLS 켜고 정책 없음 + 권한 회수.
create table if not exists public.private_config (
  key   text primary key,
  value text not null
);
alter table public.private_config enable row level security;
revoke all on public.private_config from anon, authenticated;
revoke all on public.collect_state, public.fc_snapshot, public.obs_asos, public.score_daily, public.aurora_log, public.mag_obs from anon, authenticated;

-- 서버 함수 호출(pg_net). 토큰이 없으면 아무것도 안 함.
do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'pg_net 설치 생략: % (Database → Extensions 에서 pg_net 켜기)', sqlerrm; end $$;

create or replace function public.pc_invoke(p_fn text, p_qs text default '') returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_tok text; v_base text; v_id bigint;
begin
  select value into v_tok from public.private_config where key = 'cron_token';
  if v_tok is null or v_tok = '' then raise notice 'private_config.cron_token 없음 — 호출 생략'; return null; end if;
  select coalesce((select value from public.private_config where key = 'functions_url'),
                  'https://wyeailynedvmxzwffuas.supabase.co/functions/v1') into v_base;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
    into v_id
    using v_base || '/' || p_fn || coalesce(p_qs, ''), '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-cron-token', v_tok), 150000;
  return v_id;
end $$;
revoke all on function public.pc_invoke(text, text) from public, anon, authenticated;

-- ───────────────────────────── 8) 정기 실행 (pg_cron, UTC 기준 — KST = UTC+9) ─────────────────────────────
do $$ begin
  create extension if not exists pg_cron;
  -- 기상청 단기·초단기: 매시 07분
  perform cron.schedule('polychrome-collect-kma',    '7 * * * *',  $c$ select public.pc_invoke('collect', '?job=kma') $c$);
  -- Open-Meteo 다중 모델 + MET Norway: 3시간마다 12분
  perform cron.schedule('polychrome-collect-global', '12 */3 * * *', $c$ select public.pc_invoke('collect', '?job=global') $c$);
  -- ASOS 실측(어제): 매일 10:20 KST = 01:20 UTC
  perform cron.schedule('polychrome-observe',        '20 1 * * *', $c$ select public.pc_invoke('observe', '?job=daily') $c$);
  -- 채점 + 가중치: 매일 11:00 KST = 02:00 UTC
  perform cron.schedule('polychrome-score',          '0 2 * * *',  $c$ select public.pc_invoke('score', '?job=daily') $c$);
  -- 오로라 지수 기록: 매시 05분
  perform cron.schedule('polychrome-aurora-log',     '5 * * * *',  $c$ select public.pc_invoke('aurora', '?job=log') $c$);
  -- 정리: 예보 스냅샷 보관 기간, pg_net 응답 기록
  perform cron.schedule('polychrome-verify-clean',   '50 18 * * *', $c$
    delete from public.fc_snapshot where target_time < now() - make_interval(days =>
      coalesce((select (value #>> '{}')::int from public.app_config where key = 'fc_retention_days'), 14));
    delete from public.collect_state where at < now() - interval '7 days';
  $c$);
exception when others then raise notice 'cron 예약 생략: %', sqlerrm; end $$;
