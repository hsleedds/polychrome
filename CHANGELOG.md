# CHANGELOG

## weather-core (`core/weather-core.js`)

Roundcast는 이 파일의 **고정 버전(pinned) 사본**을 넣어 쓴다. 입력·출력 모양이 바뀌면 `VERSION`을 올리고 여기에 적는다.
1.0.2 고정 사본: `test/fixtures/weather-core-1.0.2.js` (호환 테스트의 기준).

### 1.2.0 — 2026-11-28 (Polychrome, SPEC 12 사용자 선택 예보 출처)

**호환**: 1.1.0의 모든 함수·export 입출력은 그대로(1.0.2 비교 테스트 그대로 통과). 새 export 하나만 추가. `VERSION = "1.2.0"`, 머리말 v1.2.0.

새 함수:
- `stitchBySource(series, tiers, nowIso, opts?)` → `{hourly:{time, src[], tier[], …}, daily:{time, src[], tier[], derived[], …}, sources[], changes[]}` —
  구간(지금~N시간 / 오늘+N일 0시 전까지 / 끝까지)별로 고른 출처의 시간별 값을 그대로 이어 붙이고 칸마다 출처 키를 붙인다.
  빈 칸은 같은 구간의 다음 후보 → 뒤 구간 → 앞 구간 → 나머지 출처 순으로 채우며 **실제 쓴 출처 이름**을 붙인다.
  `opts.fill` 출처로는 보조 값(체감·구름 층·시정·일출 등)만 채우고 핵심 값(기온·강수량·강수확률·날씨 코드·풍속)은 다른 기관 값으로 채우지 않는다.
  날별은 그 날 구간 출처의 날별 값 → 없으면 그 출처 시간별로 계산(12시간 이상, `derived`) → 다음 후보. 순수 함수(네트워크 없음).

Roundcast는 이 함수를 쓰지 않으므로 사본을 바꿀 필요 없음.

### 1.1.0 — 2026-11-25 (Polychrome)

**Roundcast 호환**: 기존 1.0.2 함수의 입력·출력은 그대로다. 새 `tz` 인자를 생략하면(그리고 `config({tz})`를 부르지 않으면) 기본 시간대 `"Asia/Seoul"`로 동작해 **1.0.2와 결과가 완전히 같다**
(`test/weather-core.test.mjs`가 1.0.2 고정 사본과 직접 비교: score·grade·windWord·winGrade·tips·extreme·extremeDay·isWet·fogLevel·WMO·metCode·kmaOverlay·sunTimes·metAsOM·metNorway·compareModels·omOrMet).
Roundcast 사본을 1.1.0으로 바꿔도 코드 수정은 필요 없다. 기존 export는 모두 남아 있고 새 이름만 추가됐다.

머리말: "Roundcast Weather Core v1.0.0" → "Polychrome Weather Core v1.1.0" (저작권 줄 유지). `VERSION = "1.1.0"`.

변경된 시그니처 (모두 뒤에 선택 인자만 추가):
- `config({..., tz})` — 기본 시간대(IANA 이름 또는 그 이름을 돌려주는 함수). 기본 `"Asia/Seoul"`.
- `metAsOM(lat, lon, days=7, tz?)` — 시간 격자·`current.time`·일출/일몰·`timezone` 필드가 tz 현지 시각. 일광절약시간 전환일: 없는 시각(봄)은 앞 값으로 채우고, 두 번 있는 시각(가을)은 나중 값.
- `sunTimes(lat, lon, ymd, tz?)` — 그 순간의 UTC 차이로 현지 "YYYY-MM-DDTHH:MM". 극야·백야는 1.0.2와 같이 `"…TNaN:NaN"`.
- `metNorway(lat, lon, times, tz?)` — MET 시각을 tz 현지 시각 키로.
- `compareModels(lat, lon, times, tz?)` — Open-Meteo `timezone=` 인자와 MET 변환에 tz 사용.
- `omOrMet(url, pts, days, tz?)` — MET 대체 경로(`metAsOM`)에 tz 전달 (CONTRACTS 밖의 편의 인자).
- 내부: 고정 `+9시간` KST 변환을 `Intl` 기반 시간대 차이 계산(순간마다, DST 반영)으로 교체. `Asia/Seoul`은 1988년 이후 DST가 없어 +540분 고정 경로를 그대로 사용.

새 함수:
- `localNow(tz?)` → `"YYYY-MM-DDTHH:MM"`.
- `localIso(instant, tz?)` → 순간(ms 또는 ISO 문자열)의 현지 `"YYYY-MM-DDTHH:MM"`. `tzOffsetMin(tz, ms)` → UTC 차이(분). (보조 export)
- `omUrl({lat, lon, tz?, days=7, models?})` → Open-Meteo forecast URL (hourly/daily/current 묶음, `wind_speed_unit=ms`, `models`는 배열 또는 문자열).
- `rainOutlook(hourly, fromIdx, hours=24)` → `{wet, start, end, totalMm, maxProb, hoursWet}` (`isWet` 기준, start/end는 첫/마지막 비 시간 칸의 시각).
- `consensus(models, weights?)` → `{prob[], mm[], mmLo[], mmHi[], agree[], n, members[]}` — 시간별 가중 비 확률(isWet 기준), 치우침 보정 가중 평균 강수량(`p / bias`), 가중 20/80 분위(계단형), 다수 쪽 기관 비율. 값 없는 기관은 그 시간 제외, 무게 없거나 합이 0이면 같은 무게, bias ≤0/없음 → 1. `members[{id,w,wet[]}]`는 `consensusWindow`용.
- `consensusWindow(c, fromIdx, hours, times?)` → `{prob, grade:'sure'|'likely'|'low', mm, mmLo, mmHi, start, end, startIdx, endIdx, agreeN, n}` — prob = 구간 안 한 시간이라도 비인 기관의 가중 비율, grade 70↑/40↑, mm·범위는 시간별 합, start/end = 시간별 prob≥50 첫/마지막(times 또는 `c.time`이 있으면 시각, 없으면 인덱스).
- `airGrade(pm10, pm25)` → `{pm10, pm25, worst}` (환경부 기준 good/moderate/bad/verybad, 값 없음·숫자 아님 → null).
- `summary(wx, {now?, air?, prevDay?})` → `{kind, key, data}` — 극한 → 비(24시간: `rain.now`/`rain.end`/`rain.start`/`rain.tomorrow`, 그 밖 이번 주 일별 확률 60%↑: `rain.tomorrow`/`rain.dayOfWeek`) → 미세먼지(`air.bad`/`air.verybad`) → 기온(전날 최고 대비 ±3°: `temp.warmer`/`temp.colder`) → 무난(`calm.clear`/`calm.cloudy`).
- `iconKey(code, isDay, mm?, windMs?)` → 선 아이콘 키 (WMO; 66·67·68·69 → sleet, 65 또는 5mm↑ → rain-heavy, 14m/s↑ + 코드 0–3 → wind).

테스트: `node test/run.mjs`.

### 1.0.2 — 2026-11-21 (Roundcast v2026.11.21b)
- `extreme(T, A)`·`extremeDay(tmax, tmin)` 추가 — 한파: 체감 −10° 이하/기온 −12° 이하, 날짜는 최저 −12° 이하 또는 최고 −5° 이하 · 폭염: 체감 33° 이상/기온 35° 이상, 날짜는 최고 33° 이상.
- `tips` 첫 줄에 극한 날씨 문구.
- `score`는 최고 33° 이상이면 상한 45(나쁨).

### 1.0.1 — 2026-11-21 (Roundcast v2026.11.21a)
- `score`에 7번째 인자 `amin`(라운드 중 최저 체감온도) 추가. 최저기온 또는 체감 영하 → 점수 상한 65(보통), 최고기온 영하 또는 체감 −10° 이하 → 상한 45(나쁨).
- `winGrade`가 시간별 체감온도를 넘김.

### 1.0.0 — 2026-11-15 (Roundcast v2026.11.15c)
- Roundcast index.html(2026.11.15b)의 날씨 알고리즘을 `weather-core.js` 한 파일로 분리(계산 결과는 분리 전과 동일). 소유는 날씨 앱(Polychrome), Roundcast는 고정 버전 사본 사용.
