/* 화면용 값 정리 (예보 → 보여 줄 숫자/키). 계산은 core.js(=WeatherCore/SkyCore) 경유 */
import { iconKey, rainOutlook, summary, isWet, localNow, moonPos, consensusFor, airGrade } from "../core.js";
import { nowIndex, ymdOf, localToDate, condKey, relTime, weekdayFull, tempDelta, precip, hourOf } from "../format.js";
import { t, lang } from "../i18n.js";

export function isDayAt(H, D, i) {
  const v = H.is_day?.[i];
  if (v != null) return !!v;
  const tm = H.time[i], d = (D.time || []).indexOf(ymdOf(tm));
  if (d < 0 || !D.sunrise?.[d]) { const h = hourOf(tm); return h >= 6 && h < 18; }
  return tm >= D.sunrise[d].slice(0, 16) && tm < D.sunset[d].slice(0, 16);
}

/** 기관 비교 결과 → consensus 입력 모양 [{id, p, pp}] (시간 축 보정 포함) */
export function modelsForConsensus(models, H) {
  if (!models) return [];
  const list = [...(models.dom || []), ...(models.glo || [])].filter((m) => Array.isArray(m.p));
  // 캐시된 비교 결과의 시간 축이 지금 예보와 다르면 날짜 차이만큼 밀어 맞춤
  let shift = 0;
  if (models.time0 && H.time[0] && models.time0 !== H.time[0]) {
    shift = Math.round((Date.parse(H.time[0] + ":00Z") - Date.parse(models.time0 + ":00Z")) / 36e5);
  }
  return list.map((m, k) => ({ id: m.id || m.name || "m" + k, name: m.name, sub: m.sub, dom: m.dom, p: shift ? m.p.slice(shift) : m.p, pp: m.pp ? (shift ? m.pp.slice(shift) : m.pp) : undefined, issued: m.issued }));
}

/** 기관별 원래 예보를 그대로 세기: 앞으로 hours 시간 안에 한 시간이라도 비(isWet)인 기관 수.
 *  가중치·보정 없음 (SPEC 11: 「N곳 중 M곳 비 예상」 집계만 허용) */
export function agencyCount(cm, from, hours = 24) {
  if (!cm || !cm.length) return null;
  let m = 0, n = 0;
  for (const x of cm) {
    let any = false, wet = false;
    for (let j = from; j < from + hours && j < x.p.length; j++) { if (x.p[j] != null) any = true; if (isWet(x.pp?.[j], x.p[j])) wet = true; }
    if (!any) continue;
    n++; if (wet) m++;
  }
  return n ? { n, m } : null;
}

/** 주 예보(화면 기본 예보)의 출처 키: 기상청 덮어쓰기 → kma, MET 대체 → met, 그 밖 Open-Meteo 최적 모델 → om */
export function primarySrc(res) { return res?.kmaBase ? "kma" : res?.src === "met" ? "met" : "om"; }
/** SPEC 12 출처 키 → 이름. 시간별 키(kma_ultra·kma_vilage·om·met·모델)와 예전 키(kma·om·met) 모두 */
export function srcLabel(k) { return t.has("fsrc.name." + k) ? t("fsrc.name." + k) : t("srcName." + k); }
/** 날별 줄 이름: 기상청 날별 값은 초단기+단기 시간별에서 나오므로 「기상청」 */
export function dailySrcLabel(k) { return k && k.startsWith("kma") ? t("srcName.kma") : k === "om" ? t("srcName.om") : srcLabel(k); }
/** 시간 j의 출처 키 (이어 붙이기 전 예보면 주 예보 출처) */
export function srcAt(vm, j) { return vm.H.src?.[j] || primarySrc(vm.res); }
/** [from, to) 구간의 출처 이름을 바뀌는 순서대로 「A → B」 (이어 붙이기 전 예보면 주 예보 출처 하나) */
export function srcRunsText(vm, from, to) {
  const S = vm.H.src;
  if (!Array.isArray(S)) return srcLabel(primarySrc(vm.res));
  const names = [];
  for (let j = Math.max(0, from); j < to && j < S.length; j++) { const n = S[j] ? srcLabel(S[j]) : null; if (n && names[names.length - 1] !== n) names.push(n); }
  return names.length ? names.join(" → ") : srcLabel(primarySrc(vm.res));
}
/** 구름 층(높은·중간·낮은) 출처 — 기상청 덮어쓰기는 구름 층을 바꾸지 않으므로 바탕 예보 */
export function cloudSrc(res) { return res?.src === "met" ? "met" : "om"; }

/** 도시 하나의 화면 값 */
export function buildVM(city, res, air, models) {
  const wx = res.wx, H = wx.hourly, D = wx.daily || {};
  const now = localNow(city.tz);
  const i = nowIndex(H.time, now);
  const today = ymdOf(now);
  let di = (D.time || []).indexOf(today); if (di < 0) di = 0;
  const C = wx.current || {};
  const curT = C.temperature_2m ?? H.temperature_2m?.[i];
  const curA = C.apparent_temperature ?? H.apparent_temperature?.[i];
  const code = C.weather_code ?? H.weather_code?.[i];
  const day = C.is_day != null ? !!C.is_day : isDayAt(H, D, i);
  const mm = H.precipitation?.[i] ?? C.precipitation ?? 0;
  const windMs = C.wind_speed_10m ?? H.wind_speed_10m?.[i];
  let moon = null;
  try { moon = moonPos(new Date(), city.lat, city.lon); } catch { /* */ }
  const ik = iconKey(code, day, mm, windMs);
  const r24 = rainOutlook(H, i, 24);
  const r48 = rainOutlook(H, i, 48);
  const cm = modelsForConsensus(models, H);
  const cons = cm.length >= 2 ? consensusFor(cm, i, 24, undefined, H.time) : null;
  const agency = agencyCount(cm, i, 24);
  let sum = null;
  try { sum = summary(wx, { now, air: air ? { pm10: air.pm10, pm25: air.pm25 } : undefined }); } catch (e) { console.warn(e); }
  const strip = [];
  for (let k = 0; k < 8; k++) {
    const j = i + k * 3; if (j >= H.time.length) break;
    strip.push({ time: H.time[j], src: H.src?.[j] ?? null, temp: H.temperature_2m?.[j], icon: iconKey(H.weather_code?.[j], isDayAt(H, D, j), H.precipitation?.[j], H.wind_speed_10m?.[j]), wet: isWet(H.precipitation_probability?.[j], H.precipitation?.[j]) });
  }
  return {
    city, res, wx, H, D, now, i, today, di, curT, curA, code, day, ik, moon, r24, r48, cons, agency, consModels: cm, sum, strip, air,
    airG: air ? airGrade(air.pm10, air.pm25) : null,
    tmax: D.temperature_2m_max?.[di], tmin: D.temperature_2m_min?.[di],
    windMs, hum: C.relative_humidity_2m ?? H.relative_humidity_2m?.[i],
    srcNow: H.src?.[i] ?? null,
  };
}

const TIME_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d/;
const YMD_RE = /^\d{4}-\d\d-\d\d$/;
/** 요약 객체 → 문장 */
export function summaryText(sum, vm, units) {
  if (!sum) return "";
  const L = lang();
  const data = {};
  for (const [k, v] of Object.entries(sum.data || {})) {
    if (typeof v === "string" && TIME_RE.test(v)) data[k] = relTime(v, vm.now, L);
    else if (typeof v === "string" && YMD_RE.test(v)) data[k] = weekdayFull(v, L);
    else if (typeof v === "number" && /diff|delta/i.test(k)) data[k] = Math.abs(tempDelta(v, units));
    else if (typeof v === "number" && /^mm|Mm$/.test(k)) data[k] = precip(v, units);
    else if (typeof v === "number" && /^(t|tmax|tmin|temp|feels|prevTmax)$/.test(k)) data[k] = Math.round(units === "imperial" ? v * 9 / 5 + 32 : v) + "°";
    else if (typeof v === "number") data[k] = Math.round(v);
    else data[k] = v;
  }
  let key = "summary." + sum.key;
  const ref = sum.data?.ref || sum.data?.vs;
  if (ref === "tomorrow" && t.has(key + "_tomorrow")) key += "_tomorrow";
  return t.strict(key, data) ?? t.strict("summary." + sum.kind, data) ?? t("summary.calm.clear");
}

export const condText = (code) => t("cond." + condKey(code));

/** 노을 가능성 (간단 규칙, 문서화):
 *  일몰 시각 앞뒤 1시간의 구름 평균으로 판단.
 *  - 높음: 높은 구름 또는 중간 구름이 30–80% 이고, 낮은 구름 < 40% (빛을 받을 캔버스가 있고 지평선이 열림)
 *  - 보통: 높은/중간 구름 10–95% 이고 낮은 구름 < 60%
 *  - 낮음: 그 밖 (구름이 없거나, 낮은 구름이 지평선을 막거나, 비)
 *  비(isWet)가 있으면 낮음. 구름 층 자료가 없으면 null. */
export function sunsetGlow(H, sunsetStr) {
  if (!sunsetStr || !H.cloud_cover_high) return null;
  const k = sunsetStr.slice(0, 13) + ":00";
  const j = H.time.indexOf(k);
  if (j < 0) return null;
  const idx = [j - 1, j, j + 1].filter((x) => x >= 0 && x < H.time.length);
  const avg = (f) => { const v = idx.map((x) => H[f]?.[x]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const hi = avg("cloud_cover_high"), mid = avg("cloud_cover_mid"), low = avg("cloud_cover_low");
  if (hi == null || mid == null || low == null) return null;
  if (idx.some((x) => isWet(H.precipitation_probability?.[x], H.precipitation?.[x]))) return { level: "low", hi, mid, low };
  const inR = (v, a, b) => v >= a && v <= b;
  if ((inR(hi, 30, 80) || inR(mid, 30, 80)) && low < 40) return { level: "high", hi, mid, low };
  if ((inR(hi, 10, 95) || inR(mid, 10, 95)) && low < 60) return { level: "medium", hi, mid, low };
  return { level: "low", hi, mid, low };
}

/** 밤 구름(21시~다음날 2시 평균 전운량) */
export function nightCloud(H, ymd) {
  const ks = [21, 22, 23].map((h) => `${ymd}T${h}:00`);
  const idx = ks.map((k) => H.time.indexOf(k)).filter((x) => x >= 0);
  const j = idx[idx.length - 1];
  if (j != null) for (let x = 1; x <= 3; x++) if (j + x < H.time.length) idx.push(j + x);
  const v = idx.map((x) => H.cloud_cover?.[x]).filter((x) => x != null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}
export { localToDate };
