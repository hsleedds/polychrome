/* WeatherCore / SkyCore 접근 계층.
 * 계산은 반드시 core/*.js 를 쓴다. 다만 다른 작업이 아직 끝나지 않아 함수가 없을 수 있으므로,
 * 화면이 멈추지 않도록 최소한의 대체(fallback) 구현을 둔다. core에 함수가 생기면 자동으로 그쪽을 쓴다. */
import { localNow as fmtLocalNow, localToDate, dateToLocal, addDays, hourOf } from "./format.js";

const G = typeof globalThis !== "undefined" ? globalThis : {};
export const W = () => G.WeatherCore || null;
export const S = () => G.SkyCore || null;
const wf = (name) => { const w = W(); return w && typeof w[name] === "function" ? w[name].bind(w) : null; };
const sf = (name) => { const s = S(); return s && typeof s[name] === "function" ? s[name].bind(s) : null; };
export const hasSky = () => !!S();
export const coreInfo = () => ({ weather: W()?.VERSION || null, sky: S()?.VERSION || null });

/* ================= 날씨 ================= */
const HOURLY = "temperature_2m,apparent_temperature,precipitation_probability,precipitation,rain,showers,snowfall,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,dew_point_2m,uv_index,is_day";
const DAILY = "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset,uv_index_max";
const CURRENT = "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,precipitation,cloud_cover,is_day";

export function omUrl(o) {
  const f = wf("omUrl");
  if (f) { try { const u = f(o); if (u) return u; } catch (e) { console.warn("omUrl", e); } }
  const days = o.days || 7;
  return `https://api.open-meteo.com/v1/forecast?latitude=${(+o.lat).toFixed(4)}&longitude=${(+o.lon).toFixed(4)}` +
    `&hourly=${HOURLY}&daily=${DAILY}&current=${CURRENT}&timezone=${encodeURIComponent(o.tz || "auto")}` +
    `&forecast_days=${days}&wind_speed_unit=ms` + (o.models ? `&models=${o.models}` : "");
}

export const isWet = (P, R) => { const f = wf("isWet"); return f ? f(P, R) : (P ?? 0) >= 50 || (R ?? 0) >= 0.5; };
export const fogLevel = (km, rh) => { const f = wf("fogLevel"); return f ? f(km, rh) : isNaN(km) ? 0 : km < 1 ? 2 : km < 3 || rh >= 95 ? 1 : 0; };
export const localNow = (tz) => { const f = wf("localNow"); if (f) { try { const v = f(tz); if (v) return v; } catch { /* */ } } return fmtLocalNow(tz); };

export function iconKey(code, isDay, mm, windMs) {
  const f = wf("iconKey");
  if (f) { try { const k = f(code, isDay, mm, windMs); if (k) return k; } catch { /* */ } }
  const d = isDay !== false && isDay !== 0;
  if (code == null) return d ? "partly-day" : "partly-night";
  if (code <= 3 && windMs >= 14) return "wind";
  if (code <= 1) return d ? "clear-day" : "clear-night";
  if (code === 2) return d ? "partly-day" : "partly-night";
  if (code === 3) return "cloudy";
  if (code <= 48) return "fog";
  if (code <= 55) return "drizzle";
  if (code <= 57 || code === 66 || code === 67) return "sleet";
  if (code <= 63) return mm >= 7 ? "rain-heavy" : "rain";
  if (code === 65) return "rain-heavy";
  if (code <= 77) return "snow";
  if (code <= 81) return mm >= 7 ? "rain-heavy" : d ? "showers-day" : "showers-night";
  if (code === 82) return "rain-heavy";
  if (code <= 86) return "snow";
  return "thunder";
}

export function rainOutlook(H, fromIdx, hours = 24) {
  const f = wf("rainOutlook");
  if (f) { try { const r = f(H, fromIdx, hours); if (r) return r; } catch (e) { console.warn("rainOutlook", e); } }
  const T = H.time, P = H.precipitation_probability || [], R = H.precipitation || [];
  const end = Math.min(T.length, fromIdx + hours);
  let start = null, stop = null, total = 0, maxProb = 0, n = 0, inBlock = false;
  for (let i = fromIdx; i < end; i++) {
    const wet = isWet(P[i], R[i]);
    total += R[i] || 0; maxProb = Math.max(maxProb, P[i] || 0);
    if (wet) { n++; if (start == null) { start = T[i]; inBlock = true; } }
    else if (inBlock && stop == null) { stop = T[i]; inBlock = false; }
  }
  return { wet: n > 0, start, end: start ? stop : null, totalMm: Math.round(total * 10) / 10, maxProb, hoursWet: n };
}

export function airGrade(pm10, pm25) {
  const f = wf("airGrade");
  if (f) { try { const g = f(pm10, pm25); if (g) return g; } catch { /* */ } }
  const g10 = pm10 == null ? null : pm10 <= 30 ? "good" : pm10 <= 80 ? "moderate" : pm10 <= 150 ? "bad" : "verybad";
  const g25 = pm25 == null ? null : pm25 <= 15 ? "good" : pm25 <= 35 ? "moderate" : pm25 <= 75 ? "bad" : "verybad";
  const order = ["good", "moderate", "bad", "verybad"];
  const worst = [g10, g25].filter(Boolean).sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] || null;
  return { pm10: g10, pm25: g25, worst };
}

/** 한 줄 요약 → {kind, key, data}. 우선순위: 극한 → 비 → 초미세먼지 → 기온 변화 → 무난 */
export function summary(wx, opt = {}) {
  const f = wf("summary");
  if (f) { try { const s = f(wx, opt); if (s && s.key) return s; } catch (e) { console.warn("summary", e); } }
  const H = wx.hourly, D = wx.daily || {};
  const now = opt.now || H.time[0];
  let i = H.time.indexOf(now.slice(0, 13) + ":00"); if (i < 0) i = 0;
  const T = H.temperature_2m?.[i], A = H.apparent_temperature?.[i];
  const di = Math.max(0, (D.time || []).indexOf(now.slice(0, 10)));
  const tmax = D.temperature_2m_max?.[di], tmin = D.temperature_2m_min?.[di];
  if ((A != null && A <= -10) || (T != null && T <= -12) || tmin <= -12 || tmax <= -5) return { kind: "extreme", key: "extreme.cold", data: { tmin, feels: A } };
  if (tmax >= 33 || (A != null && A >= 33)) return { kind: "extreme", key: "extreme.hot", data: { tmax } };
  const P = H.precipitation_probability || [], R = H.precipitation || [];
  if (isWet(P[i], R[i])) { const r = rainOutlook(H, i, 24); return { kind: "rain", key: r.end ? "rain.end" : "rain.now", data: { end: r.end, mm: r.totalMm } }; }
  const r = rainOutlook(H, i, 24);
  if (r.wet) return { kind: "rain", key: "rain.start", data: { start: r.start, mm: r.totalMm, prob: r.maxProb } };
  const ag = opt.air ? airGrade(opt.air.pm10, opt.air.pm25) : null;
  if (ag && (ag.pm25 === "bad" || ag.pm25 === "verybad")) return { kind: "air", key: "air." + ag.pm25, data: { pm25: opt.air.pm25 } };
  const r2 = rainOutlook(H, i + 24 - (i % 24), 24);
  if (r2.wet) return { kind: "rain", key: "rain.tomorrow", data: { start: r2.start, prob: r2.maxProb } };
  const tm2 = D.temperature_2m_max?.[di + 1];
  if (tmax != null && tm2 != null && Math.abs(tm2 - tmax) >= 5)
    return { kind: "temp", key: tm2 > tmax ? "temp.warmer" : "temp.colder", data: { diff: Math.round(Math.abs(tm2 - tmax)), ref: "tomorrow" } };
  const code = H.weather_code?.[i];
  return { kind: "calm", key: code != null && code >= 3 ? "calm.cloudy" : "calm.clear", data: {} };
}

/** 기관 비교 (네트워크 다수 요청) */

/** 합의: core가 있으면 core, 없으면 같은 무게의 단순 합의 */
export function consensusFor(models, fromIdx, hours, weights, times) {
  const c1 = wf("consensus"), c2 = wf("consensusWindow");
  if (c1 && c2) {
    try { const c = c1(models, weights); const w = c2(c, fromIdx, hours, times); if (w) return { ...w, core: true }; } catch (e) { console.warn("consensus", e); }
  }
  // 대체: 기관마다 창 안에 isWet 시간이 있으면 「비 예상」
  const ms = models.filter((m) => Array.isArray(m.p));
  if (!ms.length) return null;
  let agreeN = 0; const sums = [];
  let start = null, end = null;
  for (const m of ms) {
    let wet = false, s = 0;
    for (let i = fromIdx; i < fromIdx + hours && i < m.p.length; i++) {
      const v = m.p[i]; s += v || 0;
      if (isWet(m.pp?.[i], v)) wet = true;
    }
    if (wet) agreeN++; sums.push(s);
  }
  sums.sort((a, b) => a - b);
  const prob = Math.round(agreeN / ms.length * 100);
  const mid = sums[Math.floor(sums.length / 2)];
  return { prob, grade: prob >= 70 ? "sure" : prob >= 40 ? "likely" : "low", mm: Math.round(mid * 10) / 10,
    mmLo: Math.round(sums[0] * 10) / 10, mmHi: Math.round(sums[sums.length - 1] * 10) / 10, start, end, agreeN, n: ms.length, core: false };
}

/* ================= 천문 (SkyCore 없을 때 저정밀 대체) ================= */
const rad = Math.PI / 180, e = rad * 23.4397;
const toDays = (d) => d.valueOf() / 864e5 - 0.5 + 2440588 - 2451545;
const raOf = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
const decOf = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
const sidereal = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
function sunCoords(d) {
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  return { dec: decOf(L, 0), ra: raOf(L, 0) };
}
function moonCoords(d) {
  const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.22935 * d);
  const l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F), dist = 385001 - 20905 * Math.cos(M);
  return { ra: raOf(l, b), dec: decOf(l, b), dist };
}
function altAz(H, phi, dec) {
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { alt: alt / rad, az: ((az / rad + 180) % 360 + 360) % 360 };
}
function fbSun(date, lat, lon) {
  const d = toDays(date), c = sunCoords(d);
  const p = altAz(sidereal(d, rad * -lon) - c.ra, rad * lat, c.dec);
  return { ...p, altApparent: p.alt };
}
function fbMoon(date, lat, lon) {
  const d = toDays(date), m = moonCoords(d), s = sunCoords(d);
  const p = altAz(sidereal(d, rad * -lon) - m.ra, rad * lat, m.dec);
  const sd = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sd * Math.sin(phi), m.dist - sd * Math.cos(phi));
  const ang = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  return { ...p, altApparent: p.alt, distKm: m.dist, diamDeg: 2 * Math.atan(1737.4 / m.dist) / rad,
    illum: (1 + Math.cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (ang < 0 ? -1 : 1) / Math.PI };
}
export function sunPos(date, lat, lon) { const f = sf("sunPos"); if (f) { try { return f(date, lat, lon); } catch { /* */ } } return fbSun(date, lat, lon); }
export function moonPos(date, lat, lon) { const f = sf("moonPos"); if (f) { try { return f(date, lat, lon); } catch { /* */ } } return fbMoon(date, lat, lon); }

/** 현지 하루를 5분 간격으로 훑어 고도 h를 지나는 시각 (대체 구현용) */
function scanDay(ymd, tz, altFn) {
  const t0 = localToDate(ymd + "T00:00", tz).getTime(), t1 = localToDate(addDays(ymd, 1) + "T00:00", tz).getTime();
  const pts = [];
  for (let t = t0; t <= t1; t += 5 * 6e4) pts.push([t, altFn(new Date(t))]);
  return {
    pts,
    cross(h, rising) {
      for (let i = 1; i < pts.length; i++) {
        const [ta, a] = pts[i - 1], [tb, b] = pts[i];
        if (rising ? a < h && b >= h : a >= h && b < h) return new Date(ta + (tb - ta) * (h - a) / (b - a));
      }
      return null;
    },
  };
}
export function riseSet(body, ymd, lat, lon, tz) {
  const f = sf("riseSet");
  if (f) { try { const r = f(body, ymd, lat, lon, tz); if (r) return r; } catch { /* */ } }
  const fn = body === "moon" ? (d) => fbMoon(d, lat, lon).alt : (d) => fbSun(d, lat, lon).alt;
  const h0 = body === "moon" ? 0.133 : -0.833;
  const sc = scanDay(ymd, tz, fn);
  const all = sc.pts.map((p) => p[1]);
  return { rise: sc.cross(h0, true), set: sc.cross(h0, false), transit: null, alwaysUp: all.every((a) => a >= h0), alwaysDown: all.every((a) => a < h0) };
}
export function twilight(ymd, lat, lon, tz) {
  const f = sf("twilight");
  if (f) { try { const r = f(ymd, lat, lon, tz); if (r) return r; } catch { /* */ } }
  const sc = scanDay(ymd, tz, (d) => fbSun(d, lat, lon).alt);
  const c = (h, r) => sc.cross(h, r);
  const dark = sc.pts.filter((p) => p[1] < -18).length * 5 / 60;
  return {
    civil: { dawn: c(-6, true), dusk: c(-6, false) }, nautical: { dawn: c(-12, true), dusk: c(-12, false) }, astro: { dawn: c(-18, true), dusk: c(-18, false) },
    golden: { am: [c(-4, true), c(6, true)], pm: [c(6, false), c(-4, false)] },
    blue: { am: [c(-6, true), c(-4, true)], pm: [c(-4, false), c(-6, false)] },
    darkHours: Math.round(dark * 10) / 10,
  };
}
export function moonPhaseName(phase) {
  const f = sf("moonPhaseName");
  if (f) { try { const k = f(phase); if (k) return k; } catch { /* */ } }
  const p = ((phase % 1) + 1) % 1;
  return "moon." + (p < 0.034 || p > 0.966 ? "new" : Math.abs(p - 0.25) < 0.034 ? "firstQuarter" : Math.abs(p - 0.5) < 0.034 ? "full" : Math.abs(p - 0.75) < 0.034 ? "lastQuarter" : p < 0.25 ? "waxingCrescent" : p < 0.5 ? "waxingGibbous" : p < 0.75 ? "waningGibbous" : "waningCrescent");
}

/* ---- 오로라 ---- */
export function magLat(lat, lon) {
  const f = sf("magLat"); if (f) { try { return f(lat, lon); } catch { /* */ } }
  // 쌍극자 근사: 북 지자기극 약 80.7N, 72.7W (2025)
  const pl = 80.7 * rad, pn = -72.7 * rad, a = lat * rad, b = lon * rad;
  return Math.asin(Math.sin(a) * Math.sin(pl) + Math.cos(a) * Math.cos(pl) * Math.cos(b - pn)) / rad;
}
export function kpToProb(kp, mlat) {
  const f = sf("kpToProb"); if (f) { try { return f(kp, mlat); } catch { /* */ } }
  if (kp == null) return null;
  // 대체 근사: 오로라 띠 적도쪽 경계 ≈ 66.5 − 2·Kp (지자기 위도). 경계에서 50%, 3° 안쪽이면 90%
  const edge = 66.5 - 2 * kp, x = Math.abs(mlat) - edge;
  return Math.max(0, Math.min(95, 50 + x * 14));
}
export function auroraIndex(o) {
  const f = sf("auroraIndex"); if (f) { try { const r = f(o); if (r) return r; } catch (e) { console.warn("auroraIndex", e); } }
  const cl = (v) => Math.max(0, Math.min(1, v));
  const strength = cl((o.prob ?? 0) / 100 * 1.6);
  const eff = 1 - (1 - (o.cloudLow ?? 0) / 100) * (1 - (o.cloudMid ?? 0) / 100) * (1 - (o.cloudHigh ?? 0) / 200);
  const clear = cl(1 - eff);
  const dark = cl((-6 - o.sunAlt) / 12);
  const altF = o.moonAlt <= 0 ? 0 : Math.min(1, o.moonAlt / 30);
  const dirF = o.moonAz != null && o.moonAz > 90 && o.moonAz < 270 ? 0.7 : 1;
  const moon = cl(1 - (0.9 - 0.6 * strength) * (o.moonIllum ?? 0) * altF * dirF);
  const score = Math.round(10 * strength * clear * dark * moon);
  const grade = score <= 2 ? "none" : score <= 4 ? "low" : score <= 6 ? "fair" : score <= 8 ? "high" : "epic";
  const parts = { strength, clear, dark, moon };
  let weakest = "strength"; for (const k of ["clear", "dark", "moon"]) if (parts[k] < parts[weakest]) weakest = k;
  const reason = parts[weakest] >= 0.8 ? "reason.great" : { strength: "reason.weak", clear: "reason.cloud", dark: "reason.light", moon: "reason.moon" }[weakest];
  return { score, parts, grade, reason, fallback: true };
}
export { dateToLocal, hourOf };
