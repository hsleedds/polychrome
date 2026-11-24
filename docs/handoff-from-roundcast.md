# 날씨 앱 인수인계 (Roundcast → 날씨 앱)

작성 2026-11-15 · Roundcast v2026.11.15c 기준 · weather-core v1.0.0

## 0. 한 줄 요약
Roundcast의 날씨 알고리즘을 `weather-core.js` 한 파일로 분리했다. **이 파일은 날씨 앱 소유**이며, 날씨 관련 개발(비 정확도 개선 포함)은 앞으로 날씨 앱 쪽에서 한다. Roundcast는 이 파일의 **고정 버전 사본**을 빌드 때 넣어 쓴다.

## 1. 매각 대비 원칙 (HS 결정 사항)
1. **소유**: `weather-core`(알고리즘)는 날씨 앱 소유. 버전을 붙여 날씨 앱 저장소에서 관리한다.
2. **Roundcast는 사본 사용**: 날씨 앱 서버에 실시간 연결하지 않는다. 특정 버전 사본을 받아 넣으므로, 날씨 앱을 매각해도 Roundcast 날씨는 멈추지 않는다. 매각 계약에 「Roundcast의 계속 사용 허락」을 넣는다.
3. **인프라 분리**: 날씨 앱은 별도 GitHub 저장소, 별도 도메인, 별도 Supabase 프로젝트, 별도 API 키(기상청 등)로 시작한다.
4. **회원 분리**: 회원을 Roundcast와 공유하지 않는다. 처음엔 로그인 없이 시작하는 것도 좋다. (공유하면 매각 때 개인정보 이전 절차가 복잡해짐)
5. **브랜드·상표**: Roundcast와 다른 이름을 쓰고 상표를 따로 출원해 함께 넘길 수 있게 한다.
6. **데이터 이용 조건 확인 (중요)**: Open-Meteo 무료 API는 비상업용 조건 → 유료 앱·매각 대상이면 상업 요금제 검토. MET Norway(출처 표시, User-Agent 조건), 기상청 공공데이터(출처 표시) 조건 준수.
7. **기록**: 날씨 앱 저장소 이력·변경 기록을 처음부터 따로 남긴다.

## 2. weather-core.js 사용법
```html
<script src="weather-core.js"></script>
<script>
WeatherCore.config({
  kma: () => true,                       // 기상청 서버 함수를 쓸지
  sbUrl: () => "https://<프로젝트>.supabase.co",
  sbKey: () => "<publishable(공개) 키>",    // 비밀 키 금지
  // fetch: (url,opt,ms)=>...  (선택: 앱 자체 요청 함수. 없으면 내장 재시도 요청 사용)
});
const wx = await WeatherCore.omOrMet(OPEN_METEO_URL, [[lat, lon]], 7); // Open-Meteo 4초 지연 시 노르웨이 기상청 대체
const k = await WeatherCore.kmaWait(lat, lon);                           // 기상청 동네예보(없으면 null)
if (k) WeatherCore.kmaOverlay(wx, k);                                    // 오늘~글피를 기상청 값으로 덮어쓰기
</script>
```
Node에서도 `require("./weather-core.js")`로 쓸 수 있다.

| 이름 | 하는 일 |
|---|---|
| `omOrMet(url, pts, days)` | Open-Meteo 요청, 4초 안에 답 없으면 MET Norway도 요청해 먼저 온 것 사용 (응답 모양 동일) |
| `metAsOM(lat, lon, days)` | MET Norway 예보를 Open-Meteo 모양(hourly/daily/current)으로 변환 |
| `kmaGet / kmaWait(lat, lon, ms)` | Supabase `kma` 함수로 기상청 단기·초단기예보·실황 받기 (15분 캐시) |
| `kmaOverlay(wx, k)` | 시간별 값을 기상청 값으로 덮고, 12시간 이상 덮인 날은 일별 값 재계산 |
| `score(tmax,tmin,pp,wind,psum,gust)` | 라운드 점수 0~100 (강수확률·강수량·기온 반영, 바람 제외) |
| `grade(s)` | 매우좋음(85+)·좋음(70+)·보통(50+)·나쁨 |
| `winGrade(hourly, i)` | 티오프 i부터 5시간 등급 |
| `windWord(w)` | 바람 약함·보통·강함·매우 강함 |
| `tips(hr,T,A,P,R,W,G,D)` | 시간대별 라운드 조언 문장 |
| `isWet(P, R)` | 시간 강수: 확률 50%↑ 또는 0.5mm↑ |
| `fogLevel(km, rh)` | 안개 0·1·2 단계 |
| `compareModels(lat, lon, times)` | 국내(최대 3)·해외(7) 예보 기관별 시간 강수 비교 |
| `WMO(code)`, `metCode(sym)`, `sunTimes(lat,lon,ymd)` | 날씨 코드 한국어, MET 기호 변환, 일출·일몰 |
| `DOMESTIC`, `GLOBAL`, `SHOW_GLOBAL` | 비교 대상 기관 목록 |

**규칙**: 함수의 입력·출력 모양을 바꾸면 `VERSION`을 올리고(예: 1.1.0), 변경 내용을 날씨 앱 CHANGELOG에 적는다. Roundcast에 반영할 때는 새 버전 파일을 Roundcast 작업 창에 전달해 사본을 교체한다.

## 3. 서버 (기상청)
- Supabase Edge Function `kma` (원본: 소스 백업 `server/kma/index.ts`). Verify JWT OFF.
- 하는 일: 위경도 → 기상청 5km 격자 변환, 단기예보(`getVilageFcst`)·초단기예보(`getUltraSrtFcst`)·초단기실황(`getUltraSrtNcst`)을 받아 Open-Meteo 모양으로 변환, 20분 캐시.
- 비밀값 **이름**: `KMA_KEY` (공공데이터포털 「기상청_단기예보 조회서비스」 일반 인증키 Decoding). 값은 Supabase Secrets에만.
- 현재 Roundcast에서는 `SRV.kma=false`(키 미등록). 날씨 앱은 자기 Supabase 프로젝트에 이 함수를 배포하고 자기 키를 쓴다.

## 4. 비 정확도 개선 계획 (날씨 앱 담당)
1. 기상청 예보 켜기 (KMA_KEY + kma 함수)
2. AWS 실측(가까운 관측소)·레이더 기반 초단기 강수예측 연결 (기상청 API허브 키)
3. 여러 예보를 시점별 가중치로 합친 「비 합의 예보」 (확실·가능·낮음 등급, 예보 일치도)
4. 매일 예보 vs 실측 비교 → 출처별 적중률 → 가중치 자동 조정, 관리자 적중률 화면
5. 티타임 맞춤 표시 (「라운드 중 비 확률 40% · 1.5mm · 10시쯤 시작」), 당일 레이더 「30분 뒤 비 시작」

## 5. 디자인 (Roundcast와 구분할지는 날씨 앱에서 결정)
Roundcast 토큰 참고: 바탕 `#0c1a14`, 표면 `#142a20`, 글자 `#eef0e8`, 보조 `#9fb1a6`, 브라스 `#c9a86a`, 그린 `#6fbf93`, 비 `#7fb2ea`, 경고 `#e58a68`. 글꼴 Cormorant Garamond·Noto Serif KR·Noto Sans KR. 다크/라이트 자동.

## 6. 두 앱의 연결 (분리 원칙 안에서)
- 날씨 앱 → Roundcast: 링크로만 연결 (예: `https://roundcast.kr/` 골프장 검색). 회원·데이터 공유 없음.
- Roundcast → 날씨 앱: 날씨 앱 완성 후 「날씨 앱에서 자세히 보기」 링크 (그때 결정).

## 7. 새 대화 첫 메시지 (그대로 붙여넣기)
> 나는 Roundcast(roundcast.kr) 골프 날씨·맛집 웹앱을 만든 HS야. 이번 대화에서는 **날씨만 따로 떼어 낸 별도 날씨 앱**을 만들 거야. 첨부한 `날씨앱-인수인계.md`와 `weather-core.js`(날씨 알고리즘, 이 앱 소유)를 먼저 읽고, 1장의 매각 대비 원칙(별도 저장소·도메인·Supabase·키, 회원 분리, 데이터 이용 조건 확인)을 지켜서 진행해 줘. 날씨 계산은 반드시 weather-core.js를 써야 해. 시작 전에 앱 이름·대상(골퍼 전용인지 일반인지)·첫 화면 구성을 나한테 먼저 확인받고, 문구와 계획을 먼저 보여 준 뒤 내가 "만들자" 하면 만들어. 답은 한국어로.

첨부할 파일: `날씨앱-인수인계.md`, `weather-core.js`, (필요하면) 소스 백업 묶음의 `server/kma/index.ts`.


## 변경 이력
- 1.0.1 (2026-11-21, Roundcast v2026.11.21a): `score`에 7번째 인자 `amin`(라운드 중 최저 체감온도) 추가. 최저기온 또는 체감 영하 → 점수 상한 65(보통), 최고기온 영하 또는 체감 −10° 이하 → 상한 45(나쁨). `winGrade`가 시간별 체감온도를 넘김.
- 1.0.2 (2026-11-21, Roundcast v2026.11.21b): `extreme(T,A)`·`extremeDay(tmax,tmin)` 추가(한파: 체감 −10° 이하/기온 −12° 이하, 날짜는 최저 −12° 이하 또는 최고 −5° 이하 · 폭염: 체감 33° 이상/기온 35° 이상, 날짜는 최고 33° 이상). `tips` 첫 줄에 극한 날씨 문구. `score`는 최고 33° 이상이면 상한 45(나쁨).

## 8. 현재 상태 (2026-11-25 새벽, Roundcast 작업 창에서 정리)
- 앱 이름: **Polychrome**(가칭, 웨더캐치도 후보). 상표 POLYCHROME 출원 준비 중. 아이콘: 물방울 속 무지개 이미지(수정 없이 그대로 사용).
- 대상: 일반 야외 활동. 오로라 예보는 다음 판.
- GitHub 저장소: **hsleedds/polychrome** (public, README만 있음). 배포는 GitHub Pages 예정.
- Supabase 프로젝트 **polychrome** (서울): URL `https://wyeailynedvmxzwffuas.supabase.co`, Publishable key `sb_publishable_Ze9Ifm0_a1XYZd3-00CDUQ_YIrsbfv0` (공개용).
- 기상청 「단기예보 조회서비스」 활용 승인 완료(2026-11-25), `KMA_KEY`를 polychrome Secrets에 넣음.
- 아직 할 일: `01_polychrome_base.sql` 실행, `kma` 함수 배포(이 묶음의 `kma_index.ts`, Verify JWT OFF), 함수 응답 확인.
- 위치정보: 「내 위치」(GPS)는 위치기반서비스사업 신고 전까지 관리자 시험용으로만. 첫 판은 지역 검색 기본.
- 데이터 조건: Open-Meteo 무료는 비상업용 → 유료화·매각 시 상업 요금제.
- 첫 화면 제안(HS 확인 전): ①지금 날씨 ②한 줄 요약(비 시작 시각·한파/폭염) ③시간별 24시간 ④7일 ⑤기관별 비 비교(합의 %) ⑥일출·일몰·자외선·습도·미세먼지. 디자인은 Roundcast와 다르게(밝은 남색 바탕 + 무지개 포인트, 다크/라이트 자동).
