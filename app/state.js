/* 사용자 상태 (localStorage, 로그인 없음). 저장소 접근은 모두 try/catch. */
import { DEFAULT_CITY, DEFAULT_AURORA_CITIES, MAX_CITIES } from "./config.js";
import { sanitizeFsrc } from "./sources.js";

export const KEY = "pc:state:v1";

/** 안전한 저장소 래퍼 (localStorage가 막혀 있어도 메모리로 동작) */
export function safeStorage(ls) {
  const mem = new Map();
  return {
    get(k) { try { const v = ls?.getItem(k); if (v != null) return v; } catch { /* */ } return mem.has(k) ? mem.get(k) : null; },
    set(k, v) { mem.set(k, v); try { ls?.setItem(k, v); return true; } catch { return false; } },
    remove(k) { mem.delete(k); try { ls?.removeItem(k); } catch { /* */ } },
    keys() { try { return ls ? Object.keys(ls) : [...mem.keys()]; } catch { return [...mem.keys()]; } },
  };
}

export function langFrom(navLang) { return /^ko\b/i.test(navLang || "") ? "ko" : navLang ? "en" : "ko"; }

export function defaults(navLang) {
  const lang = langFrom(navLang);
  return {
    v: 1,
    cities: [{ ...DEFAULT_CITY }],
    mainId: DEFAULT_CITY.id,
    layout: "B",
    lang,
    units: /^en-(US|LR|MM)\b/i.test(navLang || "") ? "imperial" : "metric",
    auroraCities: DEFAULT_AURORA_CITIES.map((c) => ({ ...c })),
    admin: null, // {mark, at} — 토큰 자체는 저장하지 않음
    fsrc: sanitizeFsrc(null), // SPEC 12 예보 출처 {preset, model, tiers:{now, short, mid}}
  };
}

const num = (v) => typeof v === "number" && isFinite(v);
export function validCity(c) {
  return !!c && typeof c === "object" && typeof c.id === "string" && num(c.lat) && num(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180;
}
export function normCity(c) {
  return {
    id: String(c.id), name_ko: String(c.name_ko || c.name_en || ""), name_en: String(c.name_en || c.name_ko || ""),
    lat: Math.round(c.lat * 1e4) / 1e4, lon: Math.round(c.lon * 1e4) / 1e4,
    tz: typeof c.tz === "string" && c.tz ? c.tz : "UTC", country: String(c.country || "").toUpperCase(),
  };
}

/** 저장된 값을 검증해 안전한 상태로 */
export function sanitize(raw, navLang) {
  const d = defaults(navLang);
  if (!raw || typeof raw !== "object") return d;
  const s = { ...d };
  if (Array.isArray(raw.cities)) {
    const seen = new Set();
    s.cities = raw.cities.filter(validCity).map(normCity).filter((c) => !seen.has(c.id) && seen.add(c.id)).slice(0, MAX_CITIES);
    if (!s.cities.length) s.cities = d.cities;
  }
  s.mainId = s.cities.some((c) => c.id === raw.mainId) ? raw.mainId : s.cities[0].id;
  if (raw.layout === "A" || raw.layout === "B") s.layout = raw.layout;
  if (raw.lang === "ko" || raw.lang === "en") s.lang = raw.lang;
  if (raw.units === "metric" || raw.units === "imperial") s.units = raw.units;
  if (Array.isArray(raw.auroraCities)) {
    const seen = new Set();
    s.auroraCities = raw.auroraCities.filter(validCity).map(normCity).filter((c) => !seen.has(c.id) && seen.add(c.id)).slice(0, 10);
  }
  if (raw.admin && typeof raw.admin.mark === "string") s.admin = { mark: raw.admin.mark, at: raw.admin.at || 0 };
  s.fsrc = sanitizeFsrc(raw.fsrc);
  return s;
}

/** 상태 저장소. storage: safeStorage() */
export function createStore(storage, navLang) {
  let raw = null;
  try { raw = JSON.parse(storage.get(KEY) || "null"); } catch { raw = null; }
  let s = sanitize(raw, navLang);
  const subs = new Set();
  const save = () => { storage.set(KEY, JSON.stringify(s)); subs.forEach((f) => { try { f(s); } catch (e) { console.warn(e); } }); };
  const near = (a, b) => Math.abs(a.lat - b.lat) < 0.005 && Math.abs(a.lon - b.lon) < 0.005;

  const api = {
    get: () => s,
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    /** 메인 도시를 맨 앞에 둔 순서 */
    ordered() { const m = s.cities.find((c) => c.id === s.mainId); return m ? [m, ...s.cities.filter((c) => c !== m)] : s.cities.slice(); },
    city(id) { return s.cities.find((c) => c.id === id) || s.auroraCities.find((c) => c.id === id) || null; },
    canAdd: () => s.cities.length < MAX_CITIES,
    /** 반환: 'ok' | 'full' | 'dup' | 'invalid' */
    addCity(c) {
      if (!validCity(c)) return "invalid";
      if (s.cities.some((x) => x.id === c.id || near(x, c))) return "dup";
      if (s.cities.length >= MAX_CITIES) return "full";
      s = { ...s, cities: [...s.cities, normCity(c)] }; save(); return "ok";
    },
    removeCity(id) {
      if (s.cities.length <= 1) return false;
      const cities = s.cities.filter((c) => c.id !== id);
      s = { ...s, cities, mainId: s.mainId === id ? cities[0].id : s.mainId }; save(); return true;
    },
    setMain(id) { if (s.cities.some((c) => c.id === id)) { s = { ...s, mainId: id }; save(); } },
    moveCity(id, dir) {
      const a = s.cities.slice(), i = a.findIndex((c) => c.id === id), j = i + dir;
      if (i < 0 || j < 0 || j >= a.length) return;
      [a[i], a[j]] = [a[j], a[i]]; s = { ...s, cities: a }; save();
    },
    setLayout(v) { if (v === "A" || v === "B") { s = { ...s, layout: v }; save(); } },
    setLang(v) { if (v === "ko" || v === "en") { s = { ...s, lang: v }; save(); } },
    setUnits(v) { if (v === "metric" || v === "imperial") { s = { ...s, units: v }; save(); } },
    addAurora(c) {
      if (!validCity(c)) return "invalid";
      if (s.auroraCities.some((x) => x.id === c.id || near(x, c))) return "dup";
      if (s.auroraCities.length >= 10) return "full";
      s = { ...s, auroraCities: [...s.auroraCities, normCity(c)] }; save(); return "ok";
    },
    removeAurora(id) { s = { ...s, auroraCities: s.auroraCities.filter((c) => c.id !== id) }; save(); },
    setAdmin(a) { s = { ...s, admin: a }; save(); },
    /** SPEC 12 예보 출처. 일부만 줘도 됨: {preset} · {model} · {tiers:{mid}} */
    setForecastSource(o) {
      if (!o || typeof o !== "object") return;
      const cur = s.fsrc || sanitizeFsrc(null);
      s = { ...s, fsrc: sanitizeFsrc({ ...cur, ...o, tiers: { ...cur.tiers, ...(o.tiers || {}) } }) }; save();
    },
  };
  return api;
}
