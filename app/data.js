/* 네트워크·캐시 계층. 실패는 조용히 null (화면이 알아서 줄을 숨김). */
import { SB_URL, SB_KEY, DEFAULT_FLAGS, CACHE_MIN, MODELS_CACHE_MIN } from "./config.js";
import { safeStorage } from "./state.js";
import { W, omUrl, localNow } from "./core.js";
import { nowIndex } from "./format.js";

const LS = safeStorage(typeof localStorage !== "undefined" ? localStorage : null);
const mem = new Map();
const PFX = "pc:c:";

/* ---------- 캐시 (메모리 + localStorage) ---------- */
export function cacheGet(key, maxMin) {
  let e = mem.get(key);
  if (!e) { try { e = JSON.parse(LS.get(PFX + key) || "null"); } catch { e = null; } if (e) mem.set(key, e); }
  if (!e) return null;
  const age = (Date.now() - e.at) / 6e4;
  return { v: e.v, at: e.at, fresh: maxMin == null || age < maxMin };
}
export function cachePut(key, v, persist = true) {
  const e = { at: Date.now(), v };
  mem.set(key, e);
  if (persist && !LS.set(PFX + key, JSON.stringify(e))) {
    // 용량 초과: 오래된 캐시부터 지우고 한 번 더
    const ks = LS.keys().filter((k) => k.startsWith(PFX));
    const ages = ks.map((k) => { try { return [k, JSON.parse(LS.get(k)).at || 0]; } catch { return [k, 0]; } }).sort((a, b) => a[1] - b[1]);
    ages.slice(0, Math.ceil(ages.length / 2)).forEach(([k]) => LS.remove(k));
    LS.set(PFX + key, JSON.stringify(e));
  }
}
const inflight = new Map();
function once(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function tfetch(url, opt = {}, ms = 10000) {
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opt, signal: ac.signal }); } finally { clearTimeout(tm); }
}
const sbHeaders = () => ({ apikey: SB_KEY });
async function sbJson(path, opt = {}, ms = 8000) {
  try {
    const r = await tfetch(SB_URL + path, { ...opt, headers: { ...sbHeaders(), ...(opt.headers || {}) } }, ms);
    if (!r.ok) return { status: r.status, json: null };
    return { status: r.status, json: await r.json() };
  } catch { return { status: 0, json: null }; }
}

/* ---------- 기능 스위치 ---------- */
let flags = { ...DEFAULT_FLAGS };
export const flag = (k) => !!flags[k];
export const allFlags = () => ({ ...flags });
const truthy = (v) => v === true || v === 1 || v === "true" || v === "on" || v === "1" || (v && typeof v === "object" && v.on === true);
export async function loadFlags() {
  const c = cacheGet("flags", 60);
  if (c) flags = { ...DEFAULT_FLAGS, ...c.v };
  if (c?.fresh) return flags;
  const { json } = await sbJson("/rest/v1/app_config?select=key,value");
  if (Array.isArray(json)) {
    const o = {};
    for (const row of json) if (row && typeof row.key === "string") o[row.key] = truthy(row.value);
    flags = { ...DEFAULT_FLAGS, ...o };
    cachePut("flags", o);
  }
  return flags;
}

/* ---------- 관리자 ---------- */
async function sha256(s) {
  try {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("polychrome:" + s));
    return [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, "0")).join("");
  } catch { return "m" + Date.now().toString(36); }
}
/** 성공하면 {mark, at} (토큰 원문은 저장하지 않음) */
export async function verifyAdmin(token) {
  const { json } = await sbJson("/functions/v1/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  if (json && (json.ok === true || json.admin === true)) return { mark: await sha256(token), at: Date.now() };
  return null;
}
/** 적중률 가중치: 배열 | [] (비어 있음) | null (표 없음/실패) */
export async function getWeights() {
  const c = cacheGet("weights", 60);
  if (c?.fresh) return c.v;
  const { status, json } = await sbJson("/rest/v1/weights?select=*");
  if (Array.isArray(json)) { cachePut("weights", json); return json; }
  if (status === 404) return [];
  return c ? c.v : null;
}

/* ---------- 예보 ---------- */
const ck = (c) => `${(+c.lat).toFixed(3)},${(+c.lon).toFixed(3)},${c.tz}`;
function isKR(c) { return c.country === "KR" || (c.lat > 33 && c.lat < 38.7 && c.lon > 124.5 && c.lon < 131 && !c.country); }

function validWx(j) { return j && j.hourly && Array.isArray(j.hourly.time) && j.hourly.time.length > 0 && j.daily && Array.isArray(j.daily.time); }

/**
 * 도시 예보: {wx, src:'om'|'met', kmaBase:'HH:MM'|null, at, stale}
 * 15분 캐시, 실패 시 오래된 캐시라도 사용(stale=true)
 */
export function getWeather(city, { force = false } = {}) {
  const key = "wx:" + ck(city);
  const c = cacheGet(key, CACHE_MIN);
  if (c?.fresh && !force) return Promise.resolve({ ...c.v, at: c.at, stale: false });
  return once(key, async () => {
    const wc = W();
    try {
      if (!wc || typeof wc.omOrMet !== "function") throw new Error("core");
      const url = omUrl({ lat: city.lat, lon: city.lon, tz: city.tz, days: 7 });
      const kmaP = isKR(city) && flag("kma") && typeof wc.kmaWait === "function" ? wc.kmaWait(city.lat, city.lon).catch(() => null) : Promise.resolve(null);
      let wx = await wc.omOrMet(url, [[city.lat, city.lon]], 7, city.tz);
      if (Array.isArray(wx)) wx = wx[0];
      if (!validWx(wx)) throw new Error("shape");
      const src = wx.src === "met" ? "met" : "om";
      let kmaBase = null;
      const k = await kmaP;
      if (k && typeof wc.kmaOverlay === "function") {
        const n = wc.kmaOverlay(wx, k);
        if (n > 0) { const t = k.base?.vilage?.time; kmaBase = t ? `${t.slice(0, 2)}:${t.slice(2, 4)}` : "—"; }
      }
      const v = { wx, src, kmaBase };
      cachePut(key, v);
      return { ...v, at: Date.now(), stale: false };
    } catch (e) {
      const old = cacheGet(key);
      if (old) return { ...old.v, at: old.at, stale: true };
      throw e;
    }
  });
}
export const peekWeather = (city) => { const c = cacheGet("wx:" + ck(city)); return c ? { ...c.v, at: c.at, stale: !cacheGet("wx:" + ck(city), CACHE_MIN)?.fresh } : null; };

/* ---------- 미세먼지 ---------- */
const pick = (o, ...ks) => { for (const k of ks) { const v = k.split(".").reduce((a, x) => (a == null ? a : a[x]), o); if (v != null && v !== "" && v !== "-" && !isNaN(+v)) return +v; } return null; };
/** {pm10, pm25, src:'airkorea'|'cams', estimated, station, at} | null */
export function getAir(city) {
  if (!flag("air")) return Promise.resolve(null);
  const key = "air:" + ck(city);
  const c = cacheGet(key, 30);
  if (c?.fresh) return Promise.resolve(c.v);
  return once(key, async () => {
    let v = null;
    if (isKR(city)) {
      const { json: j } = await sbJson(`/functions/v1/air?lat=${(+city.lat).toFixed(4)}&lon=${(+city.lon).toFixed(4)}`, {}, 7000);
      if (j && j.ok !== false) {
        const pm10 = pick(j, "pm10", "pm10Value", "now.pm10", "current.pm10", "data.pm10");
        const pm25 = pick(j, "pm25", "pm2_5", "pm25Value", "now.pm25", "current.pm25", "data.pm25");
        if (pm10 != null || pm25 != null) v = { pm10, pm25, src: "airkorea", estimated: false, station: j.station || j.stationName || j.now?.station || null, time: j.time || j.dataTime || null };
      }
    } else {
      try {
        const r = await tfetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${city.lat}&longitude=${city.lon}&current=pm10,pm2_5&timezone=${encodeURIComponent(city.tz)}`, {}, 8000);
        if (r.ok) { const j = await r.json(); const pm10 = j.current?.pm10, pm25 = j.current?.pm2_5; if (pm10 != null || pm25 != null) v = { pm10: pm10 ?? null, pm25: pm25 ?? null, src: "cams", estimated: true, station: null, time: j.current?.time || null }; }
      } catch { /* */ }
    }
    if (!v && c?.v) return c.v; // 실패 시 예전 값
    cachePut(key, v); // 없음(null)도 30분 기억 → 미배포 함수 반복 호출 방지
    return v;
  });
}

/* ---------- 기관 비교 ---------- */
/** {dom:[...], glo:[...]} | null  (core.compareModels 사용) */
export function getModels(city, wx) {
  if (!flag("consensus")) return Promise.resolve(null);
  const wc = W();
  if (!wc || typeof wc.compareModels !== "function") return Promise.resolve(null);
  const key = "models:" + ck(city);
  const c = cacheGet(key, MODELS_CACHE_MIN);
  if (c?.fresh) return Promise.resolve(c.v);
  return once(key, async () => {
    try {
      const r = await wc.compareModels(city.lat, city.lon, wx.hourly.time, city.tz);
      if (r && (r.dom || r.glo)) {
        // 시간 축을 함께 저장해 다른 시각에 읽을 때 맞춤
        const v = { dom: r.dom || [], glo: r.glo || [], time0: wx.hourly.time[0] };
        cachePut(key, v);
        return v;
      }
    } catch (e) { console.warn("compareModels", e); }
    return c ? c.v : null;
  });
}
export const peekModels = (city) => cacheGet("models:" + ck(city))?.v || null;

/* ---------- 지역 검색 (Open-Meteo 지오코딩) ---------- */
export async function geocode(q, lang) {
  const u = (l) => `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=${l}&format=json`;
  const get = async (l) => { try { const r = await tfetch(u(l), {}, 8000); return r.ok ? (await r.json()).results || [] : []; } catch { return []; } };
  const [ko, en] = await Promise.all([get("ko"), get("en")]);
  const enById = new Map(en.map((x) => [x.id, x]));
  const base = ko.length ? ko : en;
  return base.filter((x) => x.timezone).map((x) => {
    const e = enById.get(x.id) || x;
    const adm = (o) => [o.admin1, o.country].filter(Boolean).join(", ");
    return {
      id: "g-" + x.id, name_ko: x.name, name_en: e.name, lat: x.latitude, lon: x.longitude, tz: x.timezone,
      country: (x.country_code || "").toUpperCase(), sub_ko: adm(x), sub_en: adm(e),
    };
  });
}

/* ---------- 오로라 ---------- */
/** NOAA SWPC는 CORS(Access-Control-Allow-Origin: *)를 열어 두어 브라우저 직접 요청이 가능. 서버 함수 aurora가 있으면 우선. */
export function getOvation() {
  const c = cacheGet("ovation", 10);
  if (c?.fresh) return Promise.resolve(c.v);
  return once("ovation", async () => {
    try {
      const r = await tfetch("https://services.swpc.noaa.gov/json/ovation_aurora_latest.json", {}, 15000);
      if (r.ok) {
        const j = await r.json();
        // 1°×1° 격자 → 북반구 위도 30~90만 압축 저장 (용량 절약), [lon 0..359][lat]
        const grid = {};
        for (const [lo, la, v] of j.coordinates || []) if (la >= 30 && v > 0) grid[lo + "," + la] = v;
        const v = { grid, south: {}, time: j["Forecast Time"] || j["Observation Time"] || null };
        for (const [lo, la, val] of j.coordinates || []) if (la <= -30 && val > 0) v.south[lo + "," + la] = val;
        cachePut("ovation", v, false);
        return v;
      }
    } catch { /* */ }
    return c ? c.v : null;
  });
}
/** 북쪽(남반구는 남쪽) 지평선까지 보이는 범위를 고려한 위치별 OVATION 값.
 *  관측자에서 극 방향으로 약 8°(≈900km, 고도 100km 오로라가 지평선 위로 보이는 거리)까지,
 *  멀수록 줄여서(1 − d/10) 최대값을 쓴다. */
export function ovationAt(ov, lat, lon) {
  if (!ov) return null;
  const g = lat >= 0 ? ov.grid : ov.south;
  const L = ((Math.round(lon) % 360) + 360) % 360, la0 = Math.round(lat), dir = lat >= 0 ? 1 : -1;
  let best = 0;
  for (let d = 0; d <= 8; d++) for (let dl = -2; dl <= 2; dl++) {
    const v = g[((L + dl + 360) % 360) + "," + (la0 + d * dir)] || 0;
    best = Math.max(best, v * (1 - d / 10));
  }
  return best;
}
/** Kp 예보 [{t:Date(UTC 3시간 구간 시작), kp, observed}] */
export function getKp() {
  const c = cacheGet("kp", 30);
  if (c?.fresh) return Promise.resolve(c.v.map((x) => ({ ...x, t: new Date(x.t) })));
  return once("kp", async () => {
    try {
      const r = await tfetch("https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json", {}, 10000);
      if (r.ok) {
        const j = await r.json();
        let rows = [];
        if (Array.isArray(j) && Array.isArray(j[0])) {
          const hd = j[0].map(String);
          const it = hd.indexOf("time_tag"), ik = hd.indexOf("kp"), io = hd.indexOf("observed");
          rows = j.slice(1).map((a) => ({ t: a[it], kp: +a[ik], observed: a[io] }));
        } else if (Array.isArray(j)) rows = j.map((o) => ({ t: o.time_tag, kp: +(o.kp ?? o.Kp), observed: o.observed }));
        const v = rows.filter((x) => x.t && isFinite(x.kp)).map((x) => ({ t: new Date(String(x.t).replace(" ", "T") + (/Z$/.test(x.t) ? "" : "Z")).getTime(), kp: x.kp, observed: x.observed }));
        if (v.length) { cachePut("kp", v); return v.map((x) => ({ ...x, t: new Date(x.t) })); }
      }
    } catch { /* */ }
    return c ? c.v.map((x) => ({ ...x, t: new Date(x.t) })) : null;
  });
}
export function kpAt(kps, date) {
  if (!kps || !kps.length) return null;
  let v = null;
  for (const x of kps) { if (x.t.getTime() <= date.getTime()) v = x.kp; else break; }
  return v ?? kps[0].kp;
}
/** 서버 aurora 함수 (배포 전이면 null) */
export function getAuroraServer(city) {
  const key = "aurorafn:" + ck(city);
  const c = cacheGet(key, 10);
  if (c) return Promise.resolve(c.v);
  return once(key, async () => {
    const { json } = await sbJson(`/functions/v1/aurora?lat=${(+city.lat).toFixed(3)}&lon=${(+city.lon).toFixed(3)}`, {}, 6000);
    const v = json && json.ok !== false ? json : null;
    cachePut(key, v, false);
    return v;
  });
}
/** 구름 시간별 (오로라용, 3일) */
export function getClouds(city) {
  const key = "cloud:" + ck(city);
  const c = cacheGet(key, 30);
  if (c?.fresh) return Promise.resolve(c.v);
  // 날씨 도시와 같으면 그 예보를 재사용
  const wx = peekWeather(city);
  if (wx && !wx.stale && wx.wx.hourly.cloud_cover_low) return Promise.resolve(wx.wx.hourly);
  return once(key, async () => {
    try {
      const r = await tfetch(`https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high&timezone=${encodeURIComponent(city.tz)}&forecast_days=3`, {}, 10000);
      if (r.ok) { const j = await r.json(); if (j.hourly?.time) { cachePut(key, j.hourly); return j.hourly; } }
    } catch { /* */ }
    return c ? c.v : null;
  });
}

/* ---------- 편의 ---------- */
export function cityNowIdx(city, wx) { return nowIndex(wx.hourly.time, localNow(city.tz)); }
export { isKR };
