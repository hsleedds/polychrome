-- Polychrome · 채점(score_daily) + 가중치(weights) 계산 함수 + 점수표 보기(view) (2026-11-25)
-- 실행: Supabase(polychrome) → SQL Editor → New query → 전체 붙여넣기 → Run (여러 번 실행해도 안전)
-- 선행: 03_verify.sql
-- 서버 함수 score 가 매일 pc_score_day(어제) → pc_update_weights() 순서로 부른다.
--
-- 기준(SPEC 3장)
--   · 시간 라벨 = 「그 시각까지 1시간」의 끝 시각(KST). 하루 D = 라벨 00–23시.
--   · 예보 비: isWet = 강수확률 ≥ 50% 또는 1시간 강수량 ≥ 0.5mm (화면과 같은 기준)
--   · 실측 비: 1시간 ≥ 0.1mm. 3시간·낮 칸은 합계 ≥ 0.1mm
--   · 3시간 칸: 라벨 {0,1,2},{3,4,5},…,{21,22,23}. 낮 칸(06–18시): 라벨 7–18 (12시간). 칸이 다 차야 채점
--   · 칸 예보 비: 최대 확률 ≥ 50% 또는 합계 ≥ 0.5mm. 칸 Brier는 최대 확률 사용(근사)
--   · 리드 구간: 0-5h / 5-24h / 24-48h / 48h+ (칸은 첫 시간의 리드), 그리고 겹치는 'prev-evening'
--     (전날 17:00–21:59 KST 발표 중 가장 늦은 것 → 대상 날짜)
--   · 강수량 지표: 어느 쪽이든 비(예보 isWet 또는 실측 비)였던 칸만

create or replace function public.pc_lead_bucket(p_lead_h double precision) returns text
language sql immutable set search_path = '' as $$
  select case when p_lead_h <= 5 then '0-5h' when p_lead_h <= 24 then '5-24h'
              when p_lead_h <= 48 then '24-48h' else '48h+' end
$$;

create or replace function public.pc_mm_cat(p double precision) returns int
language sql immutable set search_path = '' as $$
  select case when p is null then null when p < 1 then 0 when p < 5 then 1
              when p < 10 then 2 when p < 30 then 3 else 4 end
$$;

create or replace function public.pc_score_day(p_day date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d  date := coalesce(p_day, (now() at time zone 'Asia/Seoul')::date - 1);
  t0 timestamptz := (d::timestamp at time zone 'Asia/Seoul');
  t1 timestamptz := ((d + 1)::timestamp at time zone 'Asia/Seoul');
  n_pairs int; n_rows int;
begin
  drop table if exists _p, _pe, _u;

  -- 1) 시간별 짝(예보 × 실측)
  create temp table _p on commit drop as
  select f.source, f.model, f.issued_at, f.stn, f.target_time,
         extract(hour from f.target_time at time zone 'Asia/Seoul')::int as hh,
         extract(epoch from (f.target_time - f.issued_at)) / 3600.0 as lead_h,
         f.p_mm::double precision as p_mm, f.pp::double precision as pp,
         f.t::double precision as ft, f.cloud::double precision as fcloud,
         case when f.pp is null and f.p_mm is null then null
              else (coalesce(f.pp, 0) >= 50 or coalesce(f.p_mm, 0) >= 0.5) end as fw,
         case when o.rn_missing or o.rn is null then null else o.rn::double precision end as rn,
         case when o.rn_missing or o.rn is null then null else o.rn >= 0.1 end as ow,
         o.t::double precision as ot,
         (o.cloud_total * 10)::double precision as ocloud
  from public.fc_snapshot f
  join public.obs_asos o on o.stn = f.stn and o.obs_time = f.target_time
  where f.target_time >= t0 and f.target_time < t1 and f.target_time > f.issued_at;
  get diagnostics n_pairs = row_count;

  -- 2) 전날 저녁 발표(17–21시 KST) 중 가장 늦은 것
  create temp table _pe on commit drop as
  select distinct on (source, model, stn) source, model, stn, issued_at
  from (select distinct source, model, stn, issued_at from _p) i
  where (issued_at at time zone 'Asia/Seoul')::date = d - 1
    and extract(hour from issued_at at time zone 'Asia/Seoul') between 17 and 21
  order by source, model, stn, issued_at desc;

  -- 3) 채점 단위로 펼치기: 1h + 3h + day, 리드 구간 + prev-evening
  create temp table _u on commit drop as
  with h as (
    select source, model, issued_at, stn, '1h'::text as win, lead_h, fw, ow, pp, p_mm, rn,
           ft, ot, fcloud, ocloud, null::int as f_on, null::int as o_on, null::int as f_end, null::int as o_end
    from _p
  ), w as (
    select source, model, issued_at, stn, win,
           min(lead_h) as lead_h,
           case when count(pp) = 0 and count(p_mm) = 0 then null
                else (coalesce(max(pp), 0) >= 50 or coalesce(sum(p_mm), 0) >= 0.5) end as fw,
           sum(rn) >= 0.1 as ow,
           max(pp) as pp, sum(p_mm) as p_mm, sum(rn) as rn,
           null::double precision as ft, null::double precision as ot,
           null::double precision as fcloud, null::double precision as ocloud,
           min(hh) filter (where fw) as f_on, min(hh) filter (where ow) as o_on,
           max(hh) filter (where fw) as f_end, max(hh) filter (where ow) as o_end,
           count(*) as n, count(rn) as n_obs, count(fw) as n_fw, max(need) as need
    from (
      select p.*, '3h'::text as win, p.hh / 3 as k, 3 as need from _p p
      union all
      select p.*, 'day'::text, 0, 12 from _p p where p.hh between 7 and 18
    ) x
    group by source, model, issued_at, stn, win, k
  ), wc as (
    select source, model, issued_at, stn, win, lead_h, fw, ow, pp, p_mm, rn, ft, ot, fcloud, ocloud,
           f_on, o_on, f_end, o_end
    from w where n = need and n_obs = need and n_fw = need
  ), allrows as (
    select * from h union all select * from wc
  )
  select a.*, public.pc_lead_bucket(a.lead_h) as bucket from allrows a
  union all
  select a.*, 'prev-evening' from allrows a join _pe e using (source, model, stn, issued_at);

  -- 4) 저장 (그날 것을 지우고 다시 씀)
  delete from public.score_daily where day = d;

  insert into public.score_daily (day, source, model, lead_bucket, win,
    hits, misses, false_alarms, correct_neg, brier_sum, brier_n,
    abs_err_sum, fc_sum, obs_sum, n_amount, mae_mm, bias_ratio, cat_hits,
    heavy10_hits, heavy10_misses, heavy10_fa, heavy30_hits, heavy30_misses, heavy30_fa,
    onset_err_sum, onset_n, end_err_sum, end_n, t_abs_err_sum, t_n, cloud_abs_err_sum, cloud_n, updated_at)
  select d, source, model, bucket, win,
    count(*) filter (where fw and ow),
    count(*) filter (where not fw and ow),
    count(*) filter (where fw and not ow),
    count(*) filter (where not fw and not ow),
    sum(power(least(pp, 100) / 100.0 - (case when ow then 1 else 0 end), 2)) filter (where pp is not null),
    count(*) filter (where pp is not null),
    sum(abs(p_mm - rn)) filter (where am),
    sum(p_mm) filter (where am),
    sum(rn) filter (where am),
    count(*) filter (where am),
    (sum(abs(p_mm - rn)) filter (where am) / nullif(count(*) filter (where am), 0))::real,
    (sum(p_mm) filter (where am) / nullif(sum(rn) filter (where am), 0))::real,
    count(*) filter (where am and public.pc_mm_cat(p_mm) = public.pc_mm_cat(rn)),
    count(*) filter (where p_mm >= 10 and rn >= 10),
    count(*) filter (where p_mm < 10 and rn >= 10),
    count(*) filter (where p_mm >= 10 and rn < 10),
    count(*) filter (where p_mm >= 30 and rn >= 30),
    count(*) filter (where p_mm < 30 and rn >= 30),
    count(*) filter (where p_mm >= 30 and rn < 30),
    sum(abs(f_on - o_on)) filter (where f_on is not null and o_on is not null),
    count(*) filter (where f_on is not null and o_on is not null),
    sum(abs(f_end - o_end)) filter (where f_end is not null and o_end is not null),
    count(*) filter (where f_end is not null and o_end is not null),
    sum(abs(ft - ot)) filter (where ft is not null and ot is not null),
    count(*) filter (where ft is not null and ot is not null),
    sum(abs(fcloud - ocloud)) filter (where fcloud is not null and ocloud is not null),
    count(*) filter (where fcloud is not null and ocloud is not null),
    now()
  from (select u.*, ((fw or ow) and p_mm is not null and rn is not null) as am
        from _u u where fw is not null and ow is not null) z
  group by source, model, bucket, win;
  get diagnostics n_rows = row_count;

  -- 신뢰도(확률 10% 칸별 [표본, 실제 비])
  update public.score_daily s set rel = r.rel
  from (
    select source, model, bucket, win, jsonb_object_agg(b::text, jsonb_build_array(n, w)) as rel
    from (select source, model, bucket, win, least(floor(pp / 10)::int, 9) as b,
                 count(*) as n, count(*) filter (where ow) as w
          from _u where pp is not null and ow is not null
          group by 1, 2, 3, 4, 5) z
    group by 1, 2, 3, 4
  ) r
  where s.day = d and s.source = r.source and s.model = r.model and s.lead_bucket = r.bucket and s.win = r.win;

  -- 예보 일관성: 같은 대상 시각에서 isWet 이 바뀐 횟수(실측 불필요)
  insert into public.score_daily (day, source, model, lead_bucket, win, flips, flips_n, updated_at)
  select d, source, model, 'all', '1h', sum(ch)::int, count(*)::int, now()
  from (
    select source, model, stn, target_time,
           sum(case when prev is not null and fw is distinct from prev then 1 else 0 end) as ch
    from (
      select source, model, stn, target_time, fw,
             lag(fw) over (partition by source, model, stn, target_time order by issued_at) as prev
      from (
        select source, model, stn, target_time, issued_at,
               (coalesce(pp, 0) >= 50 or coalesce(p_mm, 0) >= 0.5) as fw
        from public.fc_snapshot
        where target_time >= t0 and target_time < t1 and target_time > issued_at
          and (pp is not null or p_mm is not null)
      ) a
    ) b
    group by source, model, stn, target_time
    having count(*) >= 2
  ) c
  group by source, model
  on conflict (day, source, model, lead_bucket, win)
  do update set flips = excluded.flips, flips_n = excluded.flips_n, updated_at = now();

  return jsonb_build_object('day', d, 'pairs', n_pairs, 'rows', n_rows);
end $$;
revoke all on function public.pc_score_day(date) from public, anon, authenticated;
grant execute on function public.pc_score_day(date) to service_role;

-- 가중치: 최근 30일, 1시간 칸, 리드 구간별
--   w_rain ∝ max(CSI, 0.05), w_amount ∝ 1/(평균오차 + 0.2) — 구간 안에서 합 1로 정규화
--   bias = Σ예보 / Σ실측 (비 있었던 칸) → [0.3, 3]
--   기록 부족(일수 < weights_min_days 또는 최근 30일 실측 비 시간 < weights_min_wet_hours) → 같은 무게, bias 1, warmup=true
create or replace function public.pc_update_weights() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d30 date := (now() at time zone 'Asia/Seoul')::date - 30;
  min_days int := coalesce((select (value #>> '{}')::int from public.app_config where key = 'weights_min_days'), 14);
  min_wet  int := coalesce((select (value #>> '{}')::int from public.app_config where key = 'weights_min_wet_hours'), 200);
  n_days int; n_wet int; warm boolean; n_rows int;
begin
  select count(distinct day) into n_days from public.score_daily where day >= d30 and win = '1h' and lead_bucket <> 'all';
  select count(*) into n_wet from public.obs_asos where obs_time >= now() - interval '30 days' and rn >= 0.1 and not rn_missing;
  warm := n_days < min_days or n_wet < min_wet;

  with a as (
    select source, model, lead_bucket,
           sum(hits) as h, sum(misses) as m, sum(false_alarms) as fa, sum(correct_neg) as cn,
           sum(abs_err_sum) as ae, sum(n_amount) as na, sum(fc_sum) as fs, sum(obs_sum) as os
    from public.score_daily
    where day >= d30 and win = '1h' and lead_bucket <> 'all'
    group by 1, 2, 3
  ), b as (
    select *, h::double precision / nullif(h + m + fa, 0) as csi, ae / nullif(na, 0) as mae from a
  ), c as (
    select *,
           greatest(coalesce(csi, 0), 0.05) as wr,
           1.0 / (coalesce(mae, max(mae) over (partition by lead_bucket), 1.0) + 0.2) as wa,
           count(*) over (partition by lead_bucket) as k
    from b
  ), e as (
    select source, model, lead_bucket,
           case when warm then 1.0 / k else wr / sum(wr) over (partition by lead_bucket) end as w_rain,
           case when warm then 1.0 / k else wa / sum(wa) over (partition by lead_bucket) end as w_amount,
           case when warm then 1.0 else least(greatest(coalesce(fs / nullif(os, 0), 1.0), 0.3), 3.0) end as bias,
           csi, mae, (h + m + fa + cn) as n
    from c
  )
  insert into public.weights (source, model, lead_bucket, w_rain, w_amount, bias, csi, mae_mm, n, warmup, updated_at)
  select source, model, lead_bucket, w_rain, w_amount, bias, csi, mae, n, warm, now() from e
  on conflict (source, model, lead_bucket) do update set
    w_rain = excluded.w_rain, w_amount = excluded.w_amount, bias = excluded.bias, csi = excluded.csi,
    mae_mm = excluded.mae_mm, n = excluded.n, warmup = excluded.warmup, updated_at = excluded.updated_at;
  get diagnostics n_rows = row_count;

  -- 더 이상 수집하지 않는 모델 정리
  delete from public.weights where updated_at < now() - interval '3 days';

  return jsonb_build_object('rows', n_rows, 'warmup', warm, 'days', n_days, 'wet_hours', n_wet,
                            'min_days', min_days, 'min_wet_hours', min_wet);
end $$;
revoke all on function public.pc_update_weights() from public, anon, authenticated;
grant execute on function public.pc_update_weights() to service_role;

-- 점수표 보기(익명 읽기 허용): 최근 30일 요약. 보기는 만든 사람 권한으로 실행되어 원본 표(RLS)를 직접 열지 않아도 됨
create or replace view public.score_summary_30d as
select source, model, lead_bucket, win,
       count(distinct day)                                       as days,
       sum(hits) as hits, sum(misses) as misses, sum(false_alarms) as false_alarms, sum(correct_neg) as correct_neg,
       round((sum(hits)::numeric / nullif(sum(hits) + sum(misses), 0)), 3)                 as pod,   -- 적중률
       round((sum(false_alarms)::numeric / nullif(sum(hits) + sum(false_alarms), 0)), 3)   as far,   -- 헛예보율
       round((sum(hits)::numeric / nullif(sum(hits) + sum(misses) + sum(false_alarms), 0)), 3) as csi,
       round((sum(brier_sum) / nullif(sum(brier_n), 0))::numeric, 4)                       as brier,
       round((sum(abs_err_sum) / nullif(sum(n_amount), 0))::numeric, 2)                    as mae_mm,
       round((sum(fc_sum) / nullif(sum(obs_sum), 0))::numeric, 2)                          as bias_ratio,
       round((sum(cat_hits)::numeric / nullif(sum(n_amount), 0)), 3)                       as cat_hit_rate,
       round((sum(onset_err_sum) / nullif(sum(onset_n), 0))::numeric, 2)                   as onset_err_h,
       round((sum(end_err_sum) / nullif(sum(end_n), 0))::numeric, 2)                       as end_err_h,
       round((sum(flips)::numeric / nullif(sum(flips_n), 0)), 3)                           as flips_per_target,
       round((sum(t_abs_err_sum) / nullif(sum(t_n), 0))::numeric, 2)                       as t_mae,
       round((sum(cloud_abs_err_sum) / nullif(sum(cloud_n), 0))::numeric, 1)               as cloud_mae,
       sum(heavy10_hits) as heavy10_hits, sum(heavy10_misses) as heavy10_misses, sum(heavy10_fa) as heavy10_fa,
       sum(n_amount) as n_amount, sum(brier_n) as brier_n,
       max(updated_at) as updated_at
from public.score_daily
where day >= (now() at time zone 'Asia/Seoul')::date - 30
group by source, model, lead_bucket, win;

-- 날짜별(최근 60일) — 관리자 적중률 화면의 추이 그래프용
create or replace view public.score_summary_daily as
select day, source, model, lead_bucket, win, hits, misses, false_alarms, correct_neg,
       round((hits::numeric / nullif(hits + misses + false_alarms, 0)), 3) as csi,
       round((brier_sum / nullif(brier_n, 0))::numeric, 4) as brier,
       mae_mm, bias_ratio, n_amount, flips, flips_n, rel
from public.score_daily
where day >= (now() at time zone 'Asia/Seoul')::date - 60;

grant select on public.score_summary_30d, public.score_summary_daily to anon, authenticated;
