# 모듈 간 약속 (인터페이스)

여러 작업이 동시에 진행되므로 아래 이름·모양을 지킨다. 바꾸면 이 문서도 고친다.
모든 시간 문자열은 해당 도시 현지 시각 `"YYYY-MM-DDTHH:MM"` (Open-Meteo `timezone=<IANA>`와 같은 형식).

## weather-core.js 1.1.0 → 1.2.0 (전역 `WeatherCore`, Node `require`)
기존 1.0.2 함수의 입출력은 **그대로**(Roundcast 호환). 시간대 인자를 생략하면 `"Asia/Seoul"`로 동작해 1.0.2와 결과 동일.

- `config({..., tz})` — 기본 시간대(기본 "Asia/Seoul").
- `metAsOM(lat, lon, days=7, tz?)`, `sunTimes(lat, lon, ymd, tz?)`, `compareModels(lat, lon, times, tz?)` — tz 선택 인자 추가.
- `omUrl({lat, lon, tz, days=7, models?})` → Open-Meteo forecast URL(앱이 쓰는 hourly/daily/current 변수 묶음 포함: temperature_2m, apparent_temperature, precipitation_probability, precipitation, rain, showers, snowfall, weather_code, cloud_cover, cloud_cover_low, cloud_cover_mid, cloud_cover_high, visibility, wind_speed_10m, wind_gusts_10m, wind_direction_10m, relative_humidity_2m, dew_point_2m, uv_index, is_day; daily: weather_code, temperature_2m_max/min, apparent_temperature_max/min, precipitation_sum, precipitation_probability_max, wind_speed_10m_max, wind_gusts_10m_max, sunrise, sunset, uv_index_max; wind_speed_unit=ms).
- `rainOutlook(hourly, fromIdx, hours=24)` → `{wet:boolean, start:time|null, end:time|null, totalMm, maxProb, hoursWet}`.
- `consensus(models, weights?)` — models: `[{id, p:[mm…], pp?:[%…], issued?:ISO}]` (같은 시간 축). weights: `{[id]: {rain:w, amount:w, bias:x}}`(없으면 같은 무게, bias 1). 반환 `{prob:[0..100…], mm:[…], mmLo:[…], mmHi:[…], agree:[0..1…], n}` 시간별 배열.
- `consensusWindow(c, fromIdx, hours)` → `{prob, grade:'sure'|'likely'|'low', mm, mmLo, mmHi, start, end, agreeN, n}` (grade: prob≥70 sure, ≥40 likely).
- `airGrade(pm10, pm25)` → `{pm10:'good'|'moderate'|'bad'|'verybad'|null, pm25:…, worst:…}` 환경부 기준 PM10 0–30/31–80/81–150/151+, PM2.5 0–15/16–35/36–75/76+.
- `summary(wx, {now?:time, air?:{pm10,pm25}, prevDay?:{tmax,tmin}})` → 문장 아님, `{kind:'extreme'|'rain'|'air'|'temp'|'calm', key:string, data:{…}}`. 앱이 i18n으로 문장화. key 예: `extreme.cold`, `extreme.hot`, `rain.start`, `rain.now`, `rain.end`, `rain.tomorrow`, `rain.dayOfWeek`, `air.bad`, `temp.warmer`, `temp.colder`, `calm.clear`.
- `iconKey(code, isDay, mm?, windMs?)` → `'clear-day'|'clear-night'|'partly-day'|'partly-night'|'cloudy'|'fog'|'drizzle'|'rain'|'rain-heavy'|'showers-day'|'showers-night'|'snow'|'sleet'|'thunder'|'wind'`.
- `localNow(tz)` → `"YYYY-MM-DDTHH:MM"`.
- (구현 반영) `omOrMet(url, pts, days, tz?)` tz 선택 인자. `consensus` 반환에 기관별 비 여부 `members` 포함. `consensusWindow(c, from, hours, times?)` — times 주면 start/end가 시각 문자열, 항상 `startIdx/endIdx`. summary 키 추가: `air.verybad`, `calm.cloudy`. 극야·백야 때 `sunTimes`는 1.0.2처럼 NaN 문자열 → 화면은 `SkyCore.riseSet`/`twilight` 사용.

### weather-core 1.2.0 추가 (SPEC 12 사용자 선택 예보 출처)
기존 함수 입출력은 1.1.0과 같음. 새 함수 하나:
- `stitchBySource(series, tiers, nowIso, opts?)` — 구간별로 고른 출처의 시간별 예보를 **값 그대로** 이어 붙임(가중·보정 없음).
  - `series`: `{[key]: {hourly:{time,…}, daily?:{time,…}}}` (bare hourly도 허용). 키는 앱이 정함(아래 출처 키).
  - `tiers`: `[{id, toH?, toDay?, sources:[key…]}…]` 순서대로. `toH`: 지금(시 단위 내림)+toH시간 전까지, `toDay`: 오늘+toDay일 0시 전까지, 둘 다 없으면 끝까지. 지난 시간은 첫 구간. 날별 행은 `toH`만 있는 구간(시간 전용)을 건너뛴다.
  - 칸마다 후보 = 그 구간 `sources` → 뒤 구간 → 앞 구간 → 나머지 series. 기온 또는 강수량 값이 있는 첫 출처를 쓰고 그 키를 붙인다.
  - `opts`: `fill`(고른 출처에 없는 보조 값 — 체감·구름 층·시정·일출 등 — 을 채울 출처; 핵심 값 `temperature_2m, precipitation, precipitation_probability, weather_code, wind_speed_10m`과 날별 최고·최저·합계·최대확률·코드·최대풍속은 **채우지 않음**), `own`(채우지 않을 시간별 필드 목록 교체), `axis`(시간 축으로 쓸 출처, 기본 합집합), `minDayHours`(기본 12).
  - 날별: 그 날 구간의 후보 순서로 ① 출처의 daily 값 ② 없으면 그 출처 시간별로 계산(12시간 이상일 때; `derived:true`) ③ 그래도 없으면 다음 후보.
  - 반환 `{hourly:{time, src[], tier[], 필드…}, daily:{time, src[], tier[], derived[], 필드…}, sources:[쓰인 키…], changes:[{i, src}]}`.

### 앱 출처 키 (`app/sources.js`, SPEC 12)
- 구간 `TIERS`: `now {toH:6}` · `short {toDay:4}`(내일·모레·글피까지) · `mid`(4~10일).
- 키: `kma_ultra`(기상청 초단기, kma 응답 `hourly.src[i]==='ultra'`), `kma_vilage`(단기, `'vilage'`), `kma_mid`(중기 — 준비 중, 선택 불가), `om`(Open-Meteo 자동/best match; MET 대체 시 `met`), 모델 `ecmwf gfs icon jma ukmo meteofrance gem` → Open-Meteo `models=` 후보 `MODELS[key]`(collect 함수 id 먼저, compareModels id 대체).
- 설정(localStorage `pc:state:v1`의 `fsrc`): `{preset:'kma-first'|'one-model'|'custom', model, tiers:{now, short, mid}}`. 기본 `kma-first`.
- `resolveTiers(fsrc, {kr, gate, base})` → stitch 구간. 한국: 초단기→단기→om, 해외: 모두 om(현지 기관 우선). 해외 도시의 기상청 선택·준비 중 출처는 om으로. `gate`(스위치 `pro_gate`)가 켜지면 `one-model`·`custom`은 `kma-first`로.
- 앱 예보(`getWeather`) 결과: `wx.hourly.src[]`·`wx.daily.src[]`·`wx.daily.derived[]`, `res.kmaBase`(단기 발표)·`res.kmaUltraBase`(초단기 발표)·`res.sig`. `wx.current`는 지금 시간의 출처 값으로 맞춤. `hourly.kma[]`(기상청 칸 1)는 호환용으로 유지.

(sky-core 구현 반영) `twilight` 추가 필드 `dark{start,end}`, `polarDay`, `polarNight`, `whiteNight`; `milkyWayWindow`에 `moonless`; `findAlignments` 결과에 `illum, partAlt, offsetDeg, distKm, bearing`, 옵션 `widthM`; 보조 `sizeRatio, angularSize, refraction, localTime, localToDate`.

## sky-core.js (전역 `SkyCore`, Node `require`)
각도는 도(degree), 방위각은 북=0 시계방향, 거리 km, 높이 m. `date`는 JS Date(UTC 기준 순간).
- `sunPos(date, lat, lon)` → `{az, alt}` (alt는 굴절 미포함 기하 고도; `altApparent`도 함께).
- `moonPos(date, lat, lon)` → `{az, alt, altApparent, distKm, diamDeg, illum:0..1, phase:0..1(0 신월, 0.5 보름), brightLimb}`.
- `sunDiamDeg(date)`.
- `riseSet(body:'sun'|'moon', ymd, lat, lon, tz, {h0?})` → `{rise:Date|null, set:Date|null, transit:Date|null, alwaysUp, alwaysDown}`.
- `twilight(ymd, lat, lon, tz)` → `{civil:{dawn,dusk}, nautical:{…}, astro:{…}, golden:{am:[s,e], pm:[s,e]}, blue:{am:[s,e], pm:[s,e]}, darkHours}` (golden: 해 고도 −4°~6°, blue: −6°~−4°).
- `moonPhaseName(phase)` → key.
- 촬영 기하: `bearing(lat1,lon1,lat2,lon2)`, `distanceKm(...)`, `destination(lat,lon,brgDeg,distKm)`, `apparentAlt(heightDiffM, distKm, {refraction=0.13})` (지구 곡률·굴절 보정).
- `shootingLine({lat,lon,topM,baseM}, body, date, {maxKm=30, stepKm=0.1, observerEyeM=1.5, groundElevFn?})` → `{az:bodyAz, alt:bodyAlt, lineAz, points:[{distKm,lat,lon,targetTopAlt, bodyAlt, offsetDeg, onTop:boolean}], bestDistKm, sizeRatioFn(distKm)}` — `points`는 대상에서 해·달 반대 방향.
- `findAlignments(target{lat,lon,topM,baseM}, observer{lat,lon,elevM,eyeM}, {body, fromDate, toDate, part:'top'|'any'|{heightM}, toleranceDeg?})` → `[{time:Date, body, alt, az, part, minutes, phase, sunAlt, passDir:'L→R'|'R→L', score}]`.
- 오로라: `auroraIndex({prob:0..100, kp?, cloudLow, cloudMid, cloudHigh, sunAlt, moonAlt, moonIllum, moonAz?})` → `{score:0..10(정수), parts:{strength, clear, dark, moon}, grade:'none'|'low'|'fair'|'high'|'epic', reason:key}`.
- `kpToProb(kp, magLat)` (OVATION 없는 시간의 근사), `magLat(lat, lon)` (쌍극자 근사).
- 은하수: `galacticCenter(date, lat, lon)` → `{az, alt}`; `milkyWayWindow(ymd, lat, lon, tz)` → `{start, end, coreRise, coreSet}|null`.
- `METEOR_SHOWERS` 배열 `{key, peak:'MM-DD', zhr, radiant:{ra,dec}}`.
- 무지개: `rainbowPossible(sunAlt)` (42° 미만), `rainbowAz(sunAz)`.
