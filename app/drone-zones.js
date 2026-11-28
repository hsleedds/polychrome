/* Polychrome — 드론 공역 확인 (SPEC 4.7)
 * globalThis.PCDroneZones = { check, countryOf, ... }  (ES 모듈 export 도 같음)
 *
 * check(lat, lon, altM?, opts?) → Promise<{
 *   level: 'prohibited'|'restricted'|'control'|'caution'|'none'|'unknown',
 *   label,                       // 화면 문구 (「비행 가능」이라고 절대 쓰지 않는다)
 *   items: [{ name, kind:'P'|'R'|'CTR'|'altitude'|'park'|'other', id?, distKm?, note?, authority?, approx?, stale?, source? }],
 *   notes: [string], links: [{label, url}], source, coverage, country, checkedAt, disabled? }>
 *   altM = 지표면 기준(AGL) 비행 고도 m (없으면 고도 판정 생략)
 *   opts = { country?, flags?, data?, fetch? }  — country 를 주면 countryOf 대신 사용(도시의 country 권장)
 *
 * 자료: 기본은 data/drone/kr.json(정적, AIP Korea 좌표, 일부 구역만).
 *       스위치 drone_zones_server 가 켜지면 Supabase 함수 drone-zones(VWorld 공역 레이어 프록시)를 먼저 쓰고,
 *       실패하면 정적 자료로 돌아간다. 스위치 drone_zones 가 꺼져 있으면 {level:'unknown', disabled:true}.
 * 판정은 「알려진 자료 기준」일 뿐이다 — 최종 확인은 드론 원스톱.
 */
import { SB_URL, SB_KEY, DEFAULT_FLAGS } from "./config.js";

const R_KM = 6371.0088;
const D2R = Math.PI / 180;
const ALT_LIMIT_M = 150;
export const ONESTOP = "https://drone.onestop.go.kr/";

/* 나라별 공식 안내 (마지막 확인 날짜 checkedAt). 공식 기관 페이지만. */
export const COUNTRY_LINKS = Object.freeze({
  KR: [
    { label: "드론 원스톱 민원서비스 — 비행 승인·공역 지도", url: ONESTOP, checkedAt: "2026-11-28" },
    { label: "드론 원스톱 — 항공촬영 허가 신청(국방부 소관, 비행 승인과 별도)", url: ONESTOP, checkedAt: "2026-11-28" },
  ],
  JP: [{ label: "国土交通省 航空局 — Flight Rules for Unmanned Aircraft", url: "https://www.mlit.go.jp/en/koku/uas.html", checkedAt: "2026-11-28" }],
  NO: [{ label: "Luftfartstilsynet — Visiting Norway (drones)", url: "https://luftfartstilsynet.no/en/drones/flying-in-norway/", checkedAt: "2026-11-28" }],
  IS: [{ label: "Samgöngustofa (Icelandic Transport Authority) — Drones", url: "https://island.is/en/o/transport-authority/drones", checkedAt: "2026-11-28" }],
  FI: [{ label: "Traficom — Where is flying prohibited?", url: "https://traficom.fi/en/where-flying-prohibited", checkedAt: "2026-11-28" }],
  CA: [{ label: "Transport Canada — Where to fly your drone", url: "https://tc.canada.ca/en/aviation/drone-safety/learn-rules-you-fly-your-drone/where-fly-your-drone", checkedAt: "2026-11-28" }],
  US: [{ label: "FAA — B4UFLY", url: "https://www.faa.gov/uas/getting_started/b4ufly", checkedAt: "2026-11-28" }],
});

export const LABELS = Object.freeze({
  prohibited: "비행금지구역",
  restricted: "비행제한구역",
  control: "관제권 — 비행 승인 필요",
  caution: "승인이 필요한 조건",
  none: "알려진 비행금지·제한구역 아님",
  unknown: "확인할 수 없음 — 공식 안내를 확인하세요",
});

const KR_NOTES = Object.freeze([
  "비행 승인과 항공촬영 허가는 별개입니다. 촬영하려면 국방부 항공촬영 허가를 따로 받아야 합니다(드론 원스톱에서 신청).",
  "국립공원·문화재(국가유산) 구역은 공역과 별도로 관리기관 규정이 있습니다.",
  "야간 비행·가시권 밖 비행은 별도 승인(특별비행승인) 대상이며, 사람이 많이 모인 곳 위로는 비행하지 마세요.",
  "임시 비행금지(NOTAM)는 이 판정에 들어 있지 않습니다. 비행 전 드론 원스톱에서 최종 확인하세요.",
]);

/* ── 기하 ── */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * D2R, dLon = (lon2 - lon1) * D2R;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
/** 점-다각형 (ray casting). ring = [[lat,lon], ...] (닫힘 여부 무관) */
export function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** rings[0] = 바깥, 나머지 = 구멍 */
export function pointInPolygon(lat, lon, rings) {
  if (!rings?.length || !pointInRing(lat, lon, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (pointInRing(lat, lon, rings[k])) return false;
  return true;
}
/** 폴리라인(경도 순으로 정렬)의 경도 lon 에서의 위도. 범위 밖이면 끝점 위도 (clamp=false 면 null) */
export function lineLatAt(line, lon, clamp = true) {
  const pts = [...line].sort((a, b) => a[1] - b[1]);
  if (lon <= pts[0][1]) return clamp ? pts[0][0] : null;
  if (lon >= pts[pts.length - 1][1]) return clamp ? pts[pts.length - 1][0] : null;
  for (let i = 1; i < pts.length; i++) {
    const [la0, lo0] = pts[i - 1], [la1, lo1] = pts[i];
    if (lon <= lo1) return lo1 === lo0 ? Math.max(la0, la1) : la0 + ((la1 - la0) * (lon - lo0)) / (lo1 - lo0);
  }
  return null;
}
/** 구역 하나에 점이 들어 있는지 → {inside, distKm?} */
export function zoneHit(z, lat, lon) {
  if (z.shape === "circle") {
    const d = distanceKm(lat, lon, z.center[0], z.center[1]);
    let inside = d <= z.radiusKm && !(z.innerRadiusKm && d <= z.innerRadiusKm); // innerRadiusKm: 가운데 빼는 원 (P-73B 는 P-73A 제외)
    if (inside && z.excludeSouthOf) {
      const la = lineLatAt(z.excludeSouthOf, lon, false);
      if (la != null && lat < la) inside = false;
    }
    return { inside, distKm: d };
  }
  if (z.shape === "polygon") return { inside: pointInPolygon(lat, lon, z.rings) };
  if (z.shape === "northOf") {
    const [a, b] = z.lonRange || [-180, 180];
    if (lon < a || lon > b) return { inside: false };
    return { inside: lat > lineLatAt(z.line, lon, true) };
  }
  return { inside: false };
}

/* ── 나라 (대략 상자, 힌트용. 도시의 country 가 있으면 그걸 쓸 것) ── */
const inBox = (lat, lon, [s, n, w, e]) => lat >= s && lat <= n && lon >= w && lon <= e;
export function countryOf(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (inBox(lat, lon, [34.0, 34.75, 129.1, 129.55])) return "JP"; // 쓰시마
  if (inBox(lat, lon, [33.0, 38.65, 124.5, 129.6]) || inBox(lat, lon, [37.2, 37.6, 130.7, 131.95])) return "KR"; // 본토·제주 / 울릉·독도
  if (inBox(lat, lon, [24.0, 45.6, 122.9, 154.0])) return "JP";
  if (inBox(lat, lon, [63.2, 66.6, -24.6, -13.4])) return "IS";
  if (inBox(lat, lon, [59.7, 69.0, 24.0, 31.6]) || inBox(lat, lon, [59.7, 65.0, 20.5, 24.0])) return "FI";
  if (inBox(lat, lon, [57.9, 71.2, 4.5, 31.2])) return "NO"; // 스웨덴과 겹침 — 대략값
  if (inBox(lat, lon, [51.0, 71.5, -170.0, -141.0]) || inBox(lat, lon, [18.9, 22.3, -160.3, -154.8])) return "US"; // 알래스카·하와이
  if (inBox(lat, lon, [49.0, 83.2, -141.0, -52.6])) return "CA";
  if (inBox(lat, lon, [24.5, 49.0, -125.0, -66.9])) return "US";
  return null;
}

/* ── 자료 ── */
let staticData = null, staticP = null;
export function setData(d) { staticData = d; staticP = null; }
async function loadStatic(f) {
  if (staticData) return staticData;
  if (!staticP) {
    const url = typeof document !== "undefined" ? "data/drone/kr.json" : new URL("../data/drone/kr.json", import.meta.url).href;
    staticP = (async () => {
      if (url.startsWith("file:")) { const fs = await import("node:fs"); return JSON.parse(fs.readFileSync(new URL(url), "utf8")); }
      const r = await f(url); if (!r.ok) throw new Error("drone data " + r.status); return r.json();
    })().then((d) => (staticData = d)).catch((e) => { staticP = null; throw e; });
  }
  return staticP;
}
async function getFlags(opts) {
  if (opts.flags) return { ...DEFAULT_FLAGS, ...opts.flags };
  if (typeof window !== "undefined") {
    try { const d = await import("./data.js"); return { drone_zones: d.flag("drone_zones"), drone_zones_server: d.flag("drone_zones_server") }; } catch { /* 기본값 */ }
  }
  return { ...DEFAULT_FLAGS };
}
const serverCache = new Map();
async function loadServer(lat, lon, f) {
  const k = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const c = serverCache.get(k); if (c && Date.now() - c.t < 3600e3) return c.v;
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
  try {
    const r = await f(`${SB_URL}/functions/v1/drone-zones?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, { headers: { apikey: SB_KEY }, signal: ctl?.signal });
    if (!r.ok) throw new Error("drone-zones " + r.status);
    const j = await r.json(); if (!j?.ok || !Array.isArray(j.zones)) throw new Error(j?.error || "drone-zones bad");
    serverCache.set(k, { t: Date.now(), v: j }); return j;
  } finally { if (timer) clearTimeout(timer); }
}

const RANK = { prohibited: 5, restricted: 4, control: 3, caution: 2, none: 1, unknown: 0 };
const LEVEL_OF = { P: "prohibited", R: "restricted", CTR: "control", altitude: "caution", park: "caution", other: "caution" };
const worst = (items, base) => items.reduce((lv, it) => (RANK[LEVEL_OF[it.kind] || "caution"] > RANK[lv] ? LEVEL_OF[it.kind] || "caution" : lv), base);
const r1 = (x) => Math.round(x * 10) / 10;

/** 정적/서버 구역 목록으로 판정 (순수 함수 — 테스트용으로도 export) */
export function evaluate(zones, lat, lon, altM) {
  const items = [];
  for (const z of zones || []) {
    const h = zoneHit(z, lat, lon);
    if (!h.inside) continue;
    const it = { name: z.name_ko || z.name || z.id, kind: z.kind, id: z.id };
    if (h.distKm != null) it.distKm = r1(h.distKm);
    if (z.note) it.note = z.note;
    if (z.authority !== undefined) it.authority = z.authority;
    if (z.approx) it.approx = true;
    if (z.stale) it.stale = true;
    if (z.source?.url) it.source = z.source.url;
    items.push(it);
  }
  if (Number.isFinite(altM) && altM >= ALT_LIMIT_M) {
    items.push({ name: "150 m 이상 비행은 승인 필요", kind: "altitude", note: `요청 고도 ${Math.round(altM)} m (지표면 기준)` });
  }
  items.sort((a, b) => RANK[LEVEL_OF[b.kind]] - RANK[LEVEL_OF[a.kind]]);
  return { level: worst(items, "none"), items };
}

export async function check(lat, lon, altM, opts = {}) {
  const checkedAt = new Date().toISOString();
  const f = opts.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  lat = +lat; lon = +lon;
  const country = opts.country || countryOf(lat, lon);
  const links = (COUNTRY_LINKS[country] || []).map(({ label, url }) => ({ label, url }));
  const base = { items: [], notes: [], links, country: country || null, checkedAt };
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ...base, level: "unknown", label: LABELS.unknown, source: null, coverage: "none", notes: ["좌표가 올바르지 않습니다."] };
  const flags = await getFlags(opts);
  if (!flags.drone_zones) return { ...base, level: "unknown", label: LABELS.unknown, source: null, coverage: "none", disabled: true };

  if (country !== "KR") {
    const notes = country
      ? ["이 나라의 공역은 앱에서 판정하지 않습니다. 공식 안내와 공식 지도에서 확인하세요."]
      : ["이 지역의 드론 규정 자료가 없습니다. 해당 나라 항공 당국의 공식 안내를 확인하세요."];
    const items = Number.isFinite(altM) && altM > 120 && country
      ? [{ name: "고도 제한 확인 필요", kind: "altitude", note: `요청 고도 ${Math.round(altM)} m — 나라별 상한(예: 120 m·400 ft)을 공식 안내에서 확인` }]
      : [];
    return { ...base, level: "unknown", label: LABELS.unknown, items, notes, source: "공식 안내 링크", coverage: "none" };
  }

  let zones = null, source = null, coverage = "partial", srcNote = null;
  if (opts.data) { zones = opts.data.zones; source = "AIP Korea (정적 자료 " + (opts.data.version || "") + ")"; coverage = opts.data.coverage || "partial"; }
  else {
    if (flags.drone_zones_server && f) {
      try {
        const j = await loadServer(lat, lon, f);
        zones = j.zones; source = j.source || "국토교통부 항공정보 (VWorld)"; coverage = "server";
      } catch (e) { srcNote = "공역 서버에 연결하지 못해 정적 자료로 확인했습니다."; }
    }
    if (!zones) {
      try {
        const d = await loadStatic(f);
        zones = d.zones; source = "AIP Korea (정적 자료 " + d.version + ")"; coverage = d.coverage || "partial";
      } catch {
        return { ...base, level: "unknown", label: LABELS.unknown, source: null, coverage: "none", notes: ["공역 자료를 불러오지 못했습니다.", ...KR_NOTES] };
      }
    }
  }
  const { level, items } = evaluate(zones, lat, lon, altM);
  const notes = [];
  if (srcNote) notes.push(srcNote);
  if (coverage === "partial") notes.push("정적 자료는 공항 관제권·P-73·P-518만 담고 있습니다. 원전 주변 비행금지구역, R구역(R-75 등), 군 비행장 관제권은 드론 원스톱 지도에서 확인하세요.");
  if (items.some((i) => i.stale)) notes.push("P-73 형상은 AIP 2022-11-17판 기준이라 바뀌었을 수 있습니다.");
  notes.push(...KR_NOTES);
  return { ...base, level, label: LABELS[level], items, notes, source, coverage };
}

const API = { check, countryOf, evaluate, zoneHit, distanceKm, pointInRing, pointInPolygon, lineLatAt, setData, LABELS, COUNTRY_LINKS, ONESTOP };
globalThis.PCDroneZones = API;
export default API;
