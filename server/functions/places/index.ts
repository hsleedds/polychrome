// Polychrome · 카카오 장소 검색 프록시 (Supabase Edge Function: places) — 스위치 places
// 배포: Edge Functions → Deploy a new function → Via Editor → 이름 "places" → 이 파일 붙여넣기 → Verify JWT OFF
// 비밀값: KAKAO_REST_KEY (카카오 디벨로퍼스 → 내 애플리케이션 → 앱 키 → REST API 키)
// 켜기: SQL Editor 에서  update public.app_config set value='true' where key='places';
// 호출: GET …/functions/v1/places?q=남산타워[&lat=37.55&lon=126.99][&page=1]
//   좌표는 소수 2자리로 반올림해 보냄(개인정보 최소화·캐시 공유). 결과 1일 캐시.
// 카카오 로컬 API: https://dapi.kakao.com/v2/local/search/keyword.json  (헤더 Authorization: KakaoAK <키>)
// TODO 확인: 카카오 로컬 API 이용약관의 결과 저장(캐시) 허용 범위 — 문제 되면 CACHE_H 를 0으로.
import { createClient } from "npm:@supabase/supabase-js@2";

const KAKAO = "https://dapi.kakao.com/v2/local/search/keyword.json";
const CACHE_H = 24;

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

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  const db = sb();
  if (!(await flagOn(db, "places"))) return json({ ok: false, error: "disabled" }, 403, h);
  if (!(await rateOk(req, "places", 60, 3000))) return json({ ok: false, error: "rate_limited" }, 429, h);
  const KEY = Deno.env.get("KAKAO_REST_KEY");
  if (!KEY) return json({ ok: false, error: "not_configured" }, 500, h);
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
  if (!q) return json({ ok: false, error: "no_query" }, 400, h);
  const page = Math.min(45, Math.max(1, +(url.searchParams.get("page") || 1) || 1));
  const lat = +(url.searchParams.get("lat") || NaN), lon = +(url.searchParams.get("lon") || NaN);
  const hasLL = isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const la = hasLL ? lat.toFixed(2) : "", lo = hasLL ? lon.toFixed(2) : "";
  const ck = `places:${q}|${la}|${lo}|${page}`;
  if (CACHE_H > 0) {
    try {
      const { data } = await db.from("fn_cache").select("body,fetched_at").eq("k", ck).maybeSingle();
      if (data && Date.now() - Date.parse(data.fetched_at) < CACHE_H * 3600e3) return json({ ok: true, cached: true, ...(data.body as object) }, 200, h);
    } catch { /* ignore */ }
  }
  try {
    const u = `${KAKAO}?query=${encodeURIComponent(q)}&page=${page}&size=15${hasLL ? `&x=${lo}&y=${la}&sort=accuracy` : ""}`;
    const r = await fetch(u, { headers: { Authorization: `KakaoAK ${KEY}` }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return json({ ok: false, error: "kakao_" + r.status }, 502, h);
    const j: any = await r.json();
    const body = {
      items: (j?.documents || []).map((d: any) => ({
        id: d.id, name: d.place_name, category: d.category_name, address: d.address_name, road: d.road_address_name || null,
        lat: +d.y, lon: +d.x, phone: d.phone || null, url: d.place_url || null,
      })),
      meta: { isEnd: !!j?.meta?.is_end, total: j?.meta?.total_count ?? null },
      source: "카카오",
    };
    if (CACHE_H > 0) { try { await db.from("fn_cache").upsert({ k: ck, body, fetched_at: new Date().toISOString() }); } catch { /* ignore */ } }
    return json({ ok: true, ...body }, 200, h);
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 502, h);
  }
});
