// Polychrome · 지진 (Supabase Edge Function: quakes) — 기상청 + USGS, 5분 캐시
// 배포: Edge Functions → Deploy a new function → Via Editor → 이름 "quakes" → 이 파일 붙여넣기 → Verify JWT OFF
// 비밀값: KMA_KEY (공공데이터포털 '기상청_지진정보 조회서비스' 활용신청 필요. 없으면 USGS만)
// 호출: GET …/functions/v1/quakes            → 최근 7일 USGS M4.5+ + 기상청 최근 3일 통보
//       GET …/functions/v1/quakes?minmag=5   → 규모 필터
// 반환: {ok, items:[{source, time(ISO), lat, lon, depthKm, mag, place, url, tsunami}], fetchedAt, sources}
// 지진은 예보가 불가능 → 「발생 정보」만. 앱은 출처·발표 시각을 함께 보여 줄 것.
import { createClient } from "npm:@supabase/supabase-js@2";

// USGS GeoJSON 요약 피드(https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php)
const USGS = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson";
// TODO 확인: 기상청 지진정보 조회서비스 오퍼레이션/필드명(공개 문서에서 확인하지 못함 — 널리 쓰이는 이름으로 작성).
//   getEqkMsg?fromTmFc=YYYYMMDD&toTmFc=YYYYMMDD → tmFc, tmEqk(YYYYMMDDHHmmss KST), lat, lon, loc, mt(규모), dep(깊이 km), fcTp, rem, img
//   실패하면 조용히 USGS만 돌려준다.
const KMA_EQK = "https://apis.data.go.kr/1360000/EqkInfoService/getEqkMsg";
const TTL_MIN = 5;

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
  new Response(JSON.stringify(o), { status: st, headers: { ...h, "Content-Type": "application/json", "Cache-Control": st === 200 ? "public, max-age=120" : "no-store" } });
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

type Quake = { source: "usgs" | "kma"; time: string; lat: number | null; lon: number | null; depthKm: number | null; mag: number | null; place: string | null; url: string | null; tsunami: boolean | null; note?: string | null };
const n = (x: unknown) => (x == null || x === "" ? null : (isFinite(+(x as number)) ? +(x as number) : null));

async function usgs(): Promise<Quake[]> {
  const r = await fetch(USGS, { signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error("usgs_" + r.status);
  const j: any = await r.json();
  return (j?.features || []).map((f: any) => ({
    source: "usgs", time: new Date(+f.properties?.time).toISOString(),
    lat: n(f.geometry?.coordinates?.[1]), lon: n(f.geometry?.coordinates?.[0]), depthKm: n(f.geometry?.coordinates?.[2]),
    mag: n(f.properties?.mag), place: f.properties?.place ?? null, url: f.properties?.url ?? null,
    tsunami: f.properties?.tsunami === 1,
  }));
}
async function kma(key: string): Promise<Quake[]> {
  const d = (ms: number) => new Date(Date.now() + 9 * 3600e3 - ms).toISOString().slice(0, 10).replace(/-/g, "");
  const u = `${KMA_EQK}?serviceKey=${encodeURIComponent(key)}&pageNo=1&numOfRows=100&dataType=JSON&fromTmFc=${d(3 * 86400e3)}&toTmFc=${d(0)}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { throw new Error("kma_non_json"); }
  const code = j?.response?.header?.resultCode;
  if (code === "03") return []; // 자료 없음(NODATA)
  if (code !== "00") throw new Error("kma_" + (code || "err"));
  const it = j.response.body?.items?.item; const arr: any[] = Array.isArray(it) ? it : it ? [it] : [];
  const best = new Map<string, any>(); // 같은 지진의 재통보는 최신 발표만
  for (const x of arr) { const k = `${x.tmEqk}|${x.loc}`; if (!best.has(k) || String(x.tmFc) > String(best.get(k).tmFc)) best.set(k, x); }
  return [...best.values()].map((x) => {
    const s = String(x.tmEqk || ""); const iso = s.length >= 12 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14) || "00"}+09:00` : null;
    return {
      source: "kma" as const, time: iso ? new Date(iso).toISOString() : "", lat: n(x.lat), lon: n(x.lon), depthKm: n(x.dep), mag: n(x.mt),
      place: x.loc ?? null, url: x.img ?? null, tsunami: null, note: x.rem ?? null, // 해일 여부는 rem(참고사항) 원문 확인
    };
  }).filter((q) => q.time);
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (!(await rateOk(req, "quakes", 120, 8000))) return json({ ok: false, error: "rate_limited" }, 429, h);
  const url = new URL(req.url), minmag = +(url.searchParams.get("minmag") || 0) || 0;
  const db = sb();
  let body: { items: Quake[]; fetchedAt: string; sources: Record<string, string> } | null = null;
  try {
    const { data } = await db.from("fn_cache").select("body,fetched_at").eq("k", "quakes:all").maybeSingle();
    if (data && Date.now() - Date.parse(data.fetched_at) < TTL_MIN * 60e3) body = data.body as any;
  } catch { /* ignore */ }
  if (!body) {
    const key = Deno.env.get("KMA_KEY");
    const [u, k] = await Promise.allSettled([usgs(), key ? kma(key) : Promise.reject(new Error("no_key"))]);
    const items = [...(u.status === "fulfilled" ? u.value : []), ...(k.status === "fulfilled" ? k.value : [])]
      .sort((a, b) => b.time.localeCompare(a.time));
    body = { items, fetchedAt: new Date().toISOString(), sources: {
      usgs: u.status === "fulfilled" ? "ok" : String((u.reason as Error)?.message || "fail"),
      kma: k.status === "fulfilled" ? "ok" : String((k.reason as Error)?.message || "fail") } };
    if (items.length) { try { await db.from("fn_cache").upsert({ k: "quakes:all", body, fetched_at: body.fetchedAt }); } catch { /* ignore */ } }
  }
  const items = minmag ? body.items.filter((q) => (q.mag ?? 0) >= minmag) : body.items;
  return json({ ok: true, items, fetchedAt: body.fetchedAt, sources: body.sources, attribution: "기상청 · USGS" }, 200, h);
});
