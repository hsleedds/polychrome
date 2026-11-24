/* Polychrome — 앱 설정 (공개 값만. 비밀 키는 Supabase Secrets에만 둔다) */
export const APP_VERSION = "2026.11.25a";
export const SB_URL = "https://wyeailynedvmxzwffuas.supabase.co";
export const SB_KEY = "sb_publishable_Ze9Ifm0_a1XYZd3-00CDUQ_YIrsbfv0"; // publishable(공개) 키

/* 기능 스위치 기본값. 서버 app_config 표(key,value)가 있으면 그 값이 우선.
   원칙: 핵심 날씨(kma 덮어쓰기·미세먼지 줄·기관 비교)만 켜 두고 나머지는 모두 꺼 둔다. */
export const DEFAULT_FLAGS = Object.freeze({
  kma: true,          // 기상청 동네예보 덮어쓰기 (한국 도시)
  air: true,          // 미세먼지 줄 (air 함수 없으면 조용히 숨김)
  consensus: true,    // 기관 비교·합의 예보
  gps_public: false,  // 「내 위치」 전체 공개 (위치기반서비스 신고 후)
  radar: false,
  aurora_alert: false,
  aurora_seen: false, // 「봤다/못 봤다」 버튼
  places: false,
  tides: false,
  buildings: false,
  maps: false,
  push: false,
  quakes: false,
});

export const MAX_CITIES = 5;
export const CACHE_MIN = 15;            // 예보 캐시 (분)
export const MODELS_CACHE_MIN = 30;     // 기관 비교 캐시 (분)

export const DEFAULT_CITY = Object.freeze({
  id: "kr-11110", name_ko: "서울 종로구", name_en: "Jongno, Seoul",
  lat: 37.5735, lon: 126.979, tz: "Asia/Seoul", country: "KR",
});

/* SPEC 4.6 — 오로라 도시 기본 5곳 (날씨 도시와 별도 저장) */
export const DEFAULT_AURORA_CITIES = Object.freeze([
  { id: "au-tromso", name_ko: "트롬쇠", name_en: "Tromsø", lat: 69.6492, lon: 18.9553, tz: "Europe/Oslo", country: "NO" },
  { id: "au-reykjavik", name_ko: "레이캬비크", name_en: "Reykjavík", lat: 64.1466, lon: -21.9426, tz: "Atlantic/Reykjavik", country: "IS" },
  { id: "au-rovaniemi", name_ko: "로바니에미", name_en: "Rovaniemi", lat: 66.5039, lon: 25.7294, tz: "Europe/Helsinki", country: "FI" },
  { id: "au-yellowknife", name_ko: "옐로나이프", name_en: "Yellowknife", lat: 62.454, lon: -114.3718, tz: "America/Edmonton", country: "CA" },
  { id: "au-fairbanks", name_ko: "페어뱅크스", name_en: "Fairbanks", lat: 64.8378, lon: -147.7164, tz: "America/Anchorage", country: "US" },
]);

export const ATTRIBUTION = Object.freeze([
  { key: "kma", url: "https://www.data.go.kr/" },
  { key: "openmeteo", url: "https://open-meteo.com/" },
  { key: "met", url: "https://api.met.no/" },
  { key: "airkorea", url: "https://www.airkorea.or.kr/" },
  { key: "cams", url: "https://atmosphere.copernicus.eu/" },
  { key: "noaa", url: "https://www.swpc.noaa.gov/" },
  { key: "usgs", url: "https://earthquake.usgs.gov/" },
  { key: "geonames", url: "https://www.geonames.org/" },
  { key: "tabler", url: "https://tabler.io/icons" },
]);
