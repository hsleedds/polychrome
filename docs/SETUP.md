# Polychrome 서버 설치·운영 절차 (SETUP)

작성 2026-11-25 · 대상: Supabase 프로젝트 **polychrome** (`https://wyeailynedvmxzwffuas.supabase.co`)
순서대로 한 번씩 하면 됩니다. 모든 SQL 파일은 **여러 번 실행해도 안전**합니다(이미 있으면 건너뜀, 켜 둔 스위치는 그대로).

> 반드시 왼쪽 위 프로젝트 이름이 **polychrome** 인지 확인하고 시작하세요. (Roundcast 프로젝트에 실행하면 안 됩니다.)

---

## 00. 앱 공개 주소 켜기 (GitHub Pages, 한 번)
1. https://github.com/hsleedds/polychrome → **Settings** → 왼쪽 **Pages**
2. Source: **Deploy from a branch** → Branch: **main**, 폴더 **/ (root)** → **Save**
3. 1~2분 뒤 `https://hsleedds.github.io/polychrome/` 에서 앱이 열립니다. (기상청 `kma` 함수는 이 주소에서만 응답하도록 되어 있어, 이 주소로 열어야 기상청 덮어쓰기가 보입니다.)

## 0. 미리 준비할 것

### 0-1. 공공데이터포털 활용신청 (키 `KMA_KEY` 하나로 모두 사용)
[공공데이터포털](https://www.data.go.kr) 로그인 → 아래 서비스를 검색해 각각 **활용신청**(보통 자동 승인, 반영까지 1~2시간).

| 서비스 이름 | 쓰는 함수 | 상태 |
|---|---|---|
| 기상청_단기예보 ((구)_동네예보) 조회서비스 | kma, collect | 이미 신청됨 |
| 기상청_지상(종관, ASOS) 시간자료 조회서비스 | observe | 신청 필요 |
| 한국환경공단_에어코리아_대기오염정보 | air | 신청 필요 |
| 한국환경공단_에어코리아_측정소정보 | air | 신청 필요 |
| 기상청_지진정보 조회서비스 | quakes | 신청 필요(없어도 USGS만으로 동작) |

> 에어코리아는 개발계정 하루 호출 한도가 작습니다(서비스별 약 500회). 사용자가 늘면 공공데이터포털에서 **운영계정 신청**을 하세요.

### 0-2. 관리자 토큰 `ADMIN_TOKEN` 만들기 (16자 이상)
SQL Editor → New query → 아래를 붙여넣고 Run → 나온 긴 글자를 복사해 메모장에 잠시 보관.
```sql
select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') as admin_token;
```
이 값은 ① 관리자 모드 주소(`?admin=<토큰>`) ② 정기 실행(cron) 비밀 헤더 두 곳에 씁니다. **남에게 보이지 않게** 하세요.

---

## 1. 확장 기능 켜기 (한 번)
Database → **Extensions** → 검색해서 켜기: **pg_cron**, **pg_net** (둘 다 ON).
(SQL 파일도 켜려고 시도하지만, 권한 때문에 안 될 수 있어 화면에서 켜는 것이 확실합니다.)

## 2. SQL 실행 (순서대로)
SQL Editor → New query → 파일 내용 **전체** 붙여넣기 → Run. 파일마다 새 쿼리로.

1. `sql/01_polychrome_base.sql` — (이미 실행했다면 건너뛰어도 됨)
2. `sql/02_air.sql` — 미세먼지 캐시
3. `sql/03_verify.sql` — 정확도 수집 표, 기능 스위치(`app_config`), 정기 실행 예약
4. `sql/04_score.sql` — 채점·가중치 계산, 점수표 보기
5. `sql/05_cache.sql` — 오로라·지진·장소 검색 캐시

「cron 예약 생략」 알림이 보이면 1단계(pg_cron)를 켠 뒤 그 파일을 다시 실행하세요.

## 3. 비밀값(Secrets) 넣기
Edge Functions → **Secrets** → Add new secret.

| 이름 | 값 | 쓰는 함수 |
|---|---|---|
| `KMA_KEY` | 공공데이터포털 일반 인증키 **(Decoding)** | kma, collect, observe, air, quakes |
| `ADMIN_TOKEN` | 0-2에서 만든 토큰 | admin, collect, observe, score, aurora(기록) |
| `KAKAO_REST_KEY` | 카카오 REST API 키 (나중에) | places |
| `VWORLD_KEY` | 브이월드 키 (나중에) | buildings |
| `KMA_HUB_KEY` | 기상청 API허브 키 (나중에) | radar |

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 는 자동으로 들어 있으니 넣지 않습니다.

## 4. ★ 한 번만 하는 설정: 정기 실행용 토큰
정기 실행(cron)이 서버 함수를 부를 때 쓸 토큰을 **앱이 읽을 수 없는 비공개 표**에 넣습니다.
SQL Editor에서 `<토큰>` 자리에 0-2의 값을 넣고 Run:
```sql
insert into public.private_config(key, value) values ('cron_token', '<토큰>')
on conflict (key) do update set value = excluded.value;
```
- ADMIN_TOKEN 을 바꾸면 이 줄도 같은 값으로 다시 실행하세요(둘이 다르면 정기 실행이 403으로 거절됨).
- 이 표는 RLS가 켜져 있고 정책이 없어서 앱(anon)에서는 보이지 않습니다.

## 5. 서버 함수 배포
Edge Functions → **Deploy a new function** → **Via Editor** → 이름 입력 → 파일 내용 전체 붙여넣기 → Deploy.
배포 후 함수 화면 → Details(설정) → **Verify JWT** 를 **OFF**. (모든 함수 공통)

| 이름 | 붙여넣을 파일 | 지금 배포 |
|---|---|---|
| `air` | `server/functions/air/index.ts` | 예 |
| `collect` | `server/functions/collect/index.ts` | 예 |
| `observe` | `server/functions/observe/index.ts` | 예 |
| `score` | `server/functions/score/index.ts` | 예 |
| `aurora` | `server/functions/aurora/index.ts` | 예 |
| `admin` | `server/functions/admin/index.ts` | 예 |
| `quakes` | `server/functions/quakes/index.ts` | 예 |
| `places` | `server/functions/places/index.ts` | 예(스위치 꺼짐 상태로 둠) |
| `tides`, `buildings`, `radar` | 각 폴더의 `index.ts` | 선택(지금은 「disabled」만 돌려줌) |
| `push` | `server/functions/push/index.ts` | **아니요**(SPEC: 미배포) |

함수 이름은 위와 **똑같이**(소문자) 써야 정기 실행 주소와 맞습니다.

## 6. 동작 확인

### 6-1. 브라우저 주소창에 붙여넣어 보기 (누구나 부를 수 있는 함수)
| 함수 | 주소 | 정상 응답 |
|---|---|---|
| air | `https://wyeailynedvmxzwffuas.supabase.co/functions/v1/air?lat=37.5735&lon=126.979` | `"ok":true`, `"station":{"name":"종로구"…}`, `"source":"한국환경공단 에어코리아"` |
| aurora | `https://wyeailynedvmxzwffuas.supabase.co/functions/v1/aurora?city=tromso` | `"ok":true`, `ovation.prob`, `kp.forecast`, `solarWind` |
| quakes | `https://wyeailynedvmxzwffuas.supabase.co/functions/v1/quakes` | `"ok":true`, `items:[…]`, `sources.usgs:"ok"` |
| places | `https://wyeailynedvmxzwffuas.supabase.co/functions/v1/places?q=남산타워` | 스위치 꺼짐이면 `{"ok":false,"error":"disabled"}` (정상) |
| admin | (브라우저 주소로는 안 됨 — POST 전용) | 앱의 `?admin=<토큰>` 으로 확인 |

자주 보는 오류: `not_configured` = Secrets 빠짐 / `air_30`·`kma_30` 등 = 활용신청 미승인 또는 키 오류(승인 후 1~2시간 대기) / `out_of_korea` = 좌표가 한국 밖.

### 6-2. 정기 실행 함수(cron 전용) 손으로 한 번 돌려 보기
collect·observe·score 는 토큰이 있어야 해서 브라우저로는 403이 정상입니다. SQL Editor 에서:
```sql
select public.pc_invoke('collect', '?job=kma&force=1');   -- 기상청
select public.pc_invoke('collect', '?job=global');         -- Open-Meteo + MET Norway
select public.pc_invoke('observe', '?job=daily');          -- 어제 ASOS 실측
select public.pc_invoke('aurora',  '?job=log');            -- 오로라 기록
```
30초~2분 뒤 결과 확인:
```sql
select id, status_code, left(content::text, 300) from net._http_response order by id desc limit 5;
select source, model, count(*), max(issued_at) from public.fc_snapshot group by 1, 2 order by 1, 2;
select count(*), min(obs_time), max(obs_time) from public.obs_asos;
```
- collect 응답의 `emptyModels` 에 `kma_seamless` 가 있으면: Open-Meteo 가 KMA 모델 제공을 중단한 상태(2026-03-31 공지)라 정상입니다.
- observe 응답의 `rnFlags` 를 한 번 봐 두세요(아래 「첫 자료로 확인할 것」).

정기 실행 목록 보기: `select jobname, schedule, active from cron.job order by 1;`
최근 실행 기록: `select jobid, status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;`

### 6-3. 정기 실행 시각 (자동)
| 작업 | 시각(KST) |
|---|---|
| 기상청 예보 수집 | 매시 07분 (단기예보는 3시간마다 발표 1시간 뒤에만) |
| Open-Meteo 여러 모델 + MET Norway 수집 | 3시간마다 12분 (09:12, 12:12 …) |
| ASOS 실측(어제) | 매일 10:20 |
| 채점 + 가중치 | 매일 11:00 |
| 오로라 지수 입력값 기록 | 매시 05분 |
| 오래된 자료 정리 | 매일 새벽 |

### 6-4. 지난 자료 채우기 / 다시 채점 (필요할 때)
```sql
select public.pc_invoke('observe', '?job=daily&days=7');   -- 어제까지 7일 실측
select public.pc_invoke('score',   '?job=daily&days=7');   -- 7일 다시 채점 + 가중치
```
score 가 시간 초과로 실패하면 SQL 로 직접: `select public.pc_score_day('2026-11-24'); select public.pc_update_weights();`

## 7. 기능 스위치 켜고 끄기
앱은 `app_config` 표를 읽어 기능을 보이거나 숨깁니다. 기본은 모두 꺼짐(`false`).
```sql
update public.app_config set value = 'true',  updated_at = now() where key = 'radar';   -- 켜기
update public.app_config set value = 'false', updated_at = now() where key = 'radar';   -- 끄기
select key, value from public.app_config order by key;                                 -- 지금 상태
```
스위치: `radar`, `buildings`, `places`, `tides`, `aurora_alert`, `gps_public`, `aurora_feedback`, `drone_zones`.
값은 따옴표 없이 `'true'` / `'false'` 로 쓰세요(`'"true"'` 는 꺼진 것으로 처리됨).
- `places` 를 켜기 전에 Secrets 에 `KAKAO_REST_KEY` 를 먼저 넣으세요.
- `radar`·`buildings`·`tides` 는 아직 서버 기능이 없어서, 켜도 `not_implemented` 를 돌려줍니다(앱이 조용히 넘어감).

운영 값(같은 표):
| key | 기본 | 뜻 |
|---|---|---|
| `fc_retention_days` | 14 | 예보 스냅샷 보관 일수. 무료 요금제(DB 500MB)에서는 14 이하 권장. Pro 로 바꾸면 60~90 가능 |
| `collect_models` | 8개 모델 목록 | Open-Meteo 모델 id. 바꾸려면 `update … set value='["ecmwf_ifs","jma_seamless"]' where key='collect_models'` |
| `weights_min_days` / `weights_min_wet_hours` | 14 / 200 | 이보다 기록이 적으면 가중치는 「같은 무게」(앱에 warmup=true) |

## 8. 앱이 읽을 수 있는 것 / 없는 것
- 읽을 수 있음(익명): `weights`(가중치), `app_config`(스위치), `score_summary_30d`·`score_summary_daily`(점수표 요약).
- 읽을 수 없음: 예보 스냅샷, 실측, 캐시, `private_config` 등 나머지 전부(서버 함수만 사용).

## 9. 첫 자료로 확인할 것 (개발 메모)
코드에 `TODO 확인` 으로 표시된 부분. 첫 수집 후 한 번 확인하고 고치면 됩니다.
1. **ASOS 강수 품질 플래그**: observe 응답 `rnFlags` 에 `"빈값:9"` 가 대부분이면 → 비 없는 시간도 9로 오는 것(지금 규칙이 맞음). `"빈값:"`(플래그 없음)만 있으면 역시 정상.
2. **ASOS 시정 단위**: `select vis, raw->>'vs' from obs_asos limit 5;` — 맑은 날 vs 가 2000 근처면 10m 단위(지금 ×10 저장이 맞음).
3. **기상청 단기예보 강수(PCP) 시간 기준**(그 시각까지 1시간인지): 비 온 날 실측과 1시간 어긋나는지 비교.
4. **에어코리아 dmX/dmY**: `select station_name, lat, lon from air_station limit 5;` — 위도 37.x, 경도 126.x 처럼 나오면 정상(코드는 값 범위로 자동 판별).
5. **기상청 지진정보**: quakes 응답 `sources.kma` 가 `"ok"` 인지. 아니면 오퍼레이션 이름 확인 필요(USGS 는 계속 동작).
6. **NOAA 태양풍(rtsw)**: aurora 응답 `solarWind` 가 null 이면 파일 이름 확인 필요.

## 10. 지점 목록
수집·채점 지점(ASOS 33곳)은 `data/asos-stations.json` 과 `collect`·`observe` 함수 안에 같은 목록이 들어 있습니다(한 파일 배포라서). 바꿀 때는 **세 곳 모두** 고치세요.
좌표 출처: 기상청 「관측 지점 정보」 https://minwon.kma.go.kr/main/obvStn.do (2026-11-25 조회, 노장 해발고도).

## 11. 출처 표시 (앱 화면에)
기상청 · Open-Meteo(CC BY 4.0) · MET Norway · 한국환경공단 에어코리아(값 변경 금지) · NOAA SWPC · USGS · 카카오.
