// Polychrome · 드론 공역 (Supabase Edge Function: drone-zones) — 스위치 drone_zones_server  ※ 아직 배포하지 않음
// 배포: Edge Functions → Deploy a new function → Via Editor → 이름 "drone-zones" → 이 파일 붙여넣기 → Verify JWT OFF
// 비밀값: VWORLD_KEY (브이월드 오픈API 인증키 — 클라이언트 코드에 절대 넣지 않는다)
//         VWORLD_DOMAIN (선택, 인증키 발급 때 등록한 서비스 URL. 기본 https://hsleedds.github.io)
// 켜기: SQL Editor 에서  insert into public.app_config(key,value) values('drone_zones_server','true')
//                         on conflict (key) do update set value='true';
// 호출: GET …/functions/v1/drone-zones?lat=37.55&lon=126.80
// 반환: {ok, zones:[{id, kind:'P'|'R'|'CTR', name_ko, shape:'polygon', rings:[[[lat,lon],…],…], layer}], ua:[…같은 형식…],
//        source, fetchedAt, cell}
//   rings[0] = 바깥 경계, 나머지 = 구멍. MultiPolygon 은 다각형마다 zone 하나씩.
//   앱(app/drone-zones.js)은 이 zones 를 정적 자료와 같은 방식(점-다각형)으로 판정한다. ua(초경량비행장치 비행구역)는 참고용.
// 좌표는 0.05° 격자 칸으로 묶어 조회·캐시(개인정보 최소화·캐시 공유). 결과 24시간 캐시(fn_cache).
//
// VWorld 2D 데이터 API (GetFeature):
//   https://api.vworld.kr/req/data?service=data&version=2.0&request=GetFeature&data=<레이어>&geomFilter=BOX(minx,miny,maxx,maxy)
//     &crs=EPSG:4326&format=json&errorformat=json&size=1000&geometry=true&attribute=true&key=<키>&domain=<서비스 URL>
//   레이어: LT_C_AISPRHC 비행금지구역, LT_C_AISRESC 비행제한구역, LT_C_AISCTRC 관제권, LT_C_AISUAC 초경량비행장치공역(UA)
// TODO 확인(브이월드 점검 중이라 2026-11-28 문서 열람 실패):
//   1) 위 요청 형식과 응답 경로 response.result.featureCollection, 상태값 OK/NOT_FOUND
//   2) 레이어별 이름 속성 필드명 (아래 nameOf 가 흔한 후보를 순서대로 시도)
//   3) 인증키 이용약관: 상업 서비스 사용, 결과 저장(캐시) 허용 범위 — 문제 되면 CACHE_H 를 0으로.
import { createClient } from "npm:@supabase/supabase-js@2";

const VWORLD = "https://api.vworld.kr/req/data";
const CACHE_H = 24;
const CELL = 0.05;   // 격자 칸 (도)
const PAD = 0.05;    // 칸 둘레 여유 (도) — 관제권 원(9.3 km)이 칸에 걸치면 함께 받음
const LAYERS: { data: string; kind: "P" | "R" | "CTR" | "UA" }[] = [
  { data: "LT_C_AISPRHC", kind: "P" },
  { data: "LT_C_AISRESC", kind: "R" },
  { data: "LT_C_AISCTRC", kind: "CTR" },
  { data: "LT_C_AISUAC", kind: "UA" },
];

const ORIGINS = ["https://hsleedds.github.io"];
function cors(origin: string | null) {
  const ok = origin && (ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (o: unknown, st: number, h: Record<string, string>) =>
  new Response(JSON.stringify(o), { status: st, headers: { ...h, "Content-Type": "application/json", "Cache-Control": st === 200 ? "public, max-age=3600" : "no-store" } });
const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
async function rateOk(req: Request, name: string, perIpHour: number, perDay: number): Promise<boolean> {
  try {
    const db = sb();
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "na";
    const now = new Date(Date.now() + 9 * 3600e3).toISOString();
    const a = await db.rpc("hit_rate", { p_key: `${name}:${ip}:${now.slice(0, 13)}`, p_max: perIpHour });
    if (a.error) return true;
    if (a.data === false) return false;
    const b = await db.rpc("hit_rate", { p_key: `${name}:all:${now.slice(0, 10)}`, p_max: perDay });
    return b.error ? true : b.data !== false;
  } catch { return true; }
}
async function flagOn(db: ReturnType<typeof sb>, key: string) {
  try { const { data } = await db.from("app_config").select("value").eq("key", key).maybeSingle(); return data?.value === true; }
  catch { return false; }
}

type Ring = [number, number][]; // [lat, lon]
type Zone = { id: string; kind: string; name_ko: string; shape: "polygon"; rings: Ring[]; layer: string };

const NAME_KEYS = ["prh_lbl_1", "prh_lbl_2", "prh_name", "res_name", "ctr_name", "uac_name", "name", "nm", "lbl", "label"];
function nameOf(p: Record<string, unknown>, fallback: string): string {
  for (const k of NAME_KEYS) { const v = p?.[k]; if (typeof v === "string" && v.trim()) return v.trim(); }
  // 후보가 없으면 글자가 든 첫 문자열 속성
  for (const v of Object.values(p || {})) if (typeof v === "string" && /[A-Za-z가-힣]/.test(v) && v.length <= 60) return v.trim();
  return fallback;
}
const toRing = (coords: number[][]): Ring => coords.filter((c) => isFinite(c[0]) && isFinite(c[1])).map(([x, y]) => [+y.toFixed(6), +x.toFixed(6)]);
function toZones(features: any[], layer: string, kind: string): Zone[] {
  const out: Zone[] = [];
  for (const [i, f] of (features || []).entries()) {
    const g = f?.geometry; if (!g) continue;
    const polys: number[][][][] = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    const name = nameOf(f.properties || {}, `${kind} ${i + 1}`);
    polys.forEach((poly, j) => {
      const rings = poly.map(toRing).filter((r) => r.length >= 3);
      if (rings.length) out.push({ id: `${layer}:${f.id ?? i}${polys.length > 1 ? "." + j : ""}`, kind, name_ko: name, shape: "polygon", rings, layer });
    });
  }
  return out;
}

async function vworld(layer: string, bbox: number[], key: string, domain: string): Promise<any[]> {
  const q = new URLSearchParams({
    service: "data", version: "2.0", request: "GetFeature", data: layer,
    geomFilter: `BOX(${bbox.join(",")})`, crs: "EPSG:4326", format: "json", errorformat: "json",
    size: "1000", page: "1", geometry: "true", attribute: "true", key, domain,
  });
  const r = await fetch(`${VWORLD}?${q}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`vworld_${layer}_${r.status}`);
  const j: any = await r.json();
  const st = j?.response?.status;
  if (st === "NOT_FOUND") return [];
  if (st !== "OK") throw new Error(`vworld_${layer}_${j?.response?.error?.code || st || "bad"}`);
  return j.response.result?.featureCollection?.features || [];
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  const db = sb();
  if (!(await flagOn(db, "drone_zones_server"))) return json({ ok: false, error: "disabled" }, 403, h);
  if (!(await rateOk(req, "drone-zones", 120, 5000))) return json({ ok: false, error: "rate_limited" }, 429, h);
  const KEY = Deno.env.get("VWORLD_KEY");
  if (!KEY) return json({ ok: false, error: "not_configured" }, 500, h);
  const DOMAIN = Deno.env.get("VWORLD_DOMAIN") || ORIGINS[0];
  const url = new URL(req.url);
  const lat = +(url.searchParams.get("lat") || NaN), lon = +(url.searchParams.get("lon") || NaN);
  // 대한민국 대략 범위만 (그 밖은 앱이 공식 링크로 안내)
  if (!(lat >= 32.5 && lat <= 39 && lon >= 124 && lon <= 132.5)) return json({ ok: false, error: "out_of_range" }, 400, h);
  const cy = Math.floor(lat / CELL) * CELL, cx = Math.floor(lon / CELL) * CELL;
  const cell = `${cy.toFixed(2)},${cx.toFixed(2)}`;
  const bbox = [cx - PAD, cy - PAD, cx + CELL + PAD, cy + CELL + PAD].map((v) => +v.toFixed(4)); // minx,miny,maxx,maxy
  const ck = `drone-zones:${cell}`;
  if (CACHE_H > 0) {
    try {
      const { data } = await db.from("fn_cache").select("body,fetched_at").eq("k", ck).maybeSingle();
      if (data && Date.now() - Date.parse(data.fetched_at) < CACHE_H * 3600e3) return json({ ok: true, cached: true, ...(data.body as object) }, 200, h);
    } catch { /* ignore */ }
  }
  try {
    const res = await Promise.all(LAYERS.map(async (L) => toZones(await vworld(L.data, bbox, KEY, DOMAIN), L.data, L.kind)));
    const all = res.flat();
    const body = {
      zones: all.filter((z) => z.kind !== "UA"),
      ua: all.filter((z) => z.kind === "UA"),
      source: "국토교통부 항공정보 (브이월드 공역 레이어)",
      fetchedAt: new Date().toISOString(), cell,
    };
    if (CACHE_H > 0) { try { await db.from("fn_cache").upsert({ k: ck, body, fetched_at: body.fetchedAt }); } catch { /* ignore */ } }
    return json({ ok: true, ...body }, 200, h);
  } catch (e) {
    // 하나라도 실패하면 부분 결과를 주지 않는다(구역이 빠진 채 「제한구역 아님」이 되는 것을 막음) → 앱은 정적 자료로 돌아감
    return json({ ok: false, error: String((e as Error).message || e) }, 502, h);
  }
});
