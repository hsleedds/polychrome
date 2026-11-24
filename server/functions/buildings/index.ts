// Polychrome · 브이월드 건물·지형 (Supabase Edge Function: buildings) — 스위치 buildings (기본 꺼짐)
// 배포: Edge Functions → Deploy a new function → Via Editor → 이름 "buildings" → 이 파일 붙여넣기 → Verify JWT OFF
// 비밀값: VWORLD_KEY
// 지금 상태: 스위치가 꺼져 있으면 {ok:false,error:'disabled'}(403), 켜져 있어도 아직 구현 전이라 {ok:false,error:'not_implemented'}(501).
// TODO: 브이월드 데이터 API(2D 데이터: 건물 폴리곤·높이, DEM)를 확인한 뒤 구현. SPEC 4.5 공급원 ①(필요할 때 주변만, 캐시).
//   · 요청: ?lat=&lon=&r=500 (m) → 주변 건물 [{id, height, floors, polygon:[[lon,lat]…]}]
//   · 브이월드 키는 발급 시 등록한 도메인에서만 동작할 수 있음 → 서버 호출 시 domain 파라미터 필요 여부 확인.
//   · 캐시: fn_cache 'buildings:<타일>' 30일.
import { createClient } from "npm:@supabase/supabase-js@2";

const FLAG = "buildings";
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
  new Response(JSON.stringify(o), { status: st, headers: { ...h, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
async function flagOn(key: string) {
  try { const { data } = await sb().from("app_config").select("value").eq("key", key).maybeSingle(); return data?.value === true; }
  catch { return false; }
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (!(await flagOn(FLAG))) return json({ ok: false, error: "disabled" }, 403, h);
  // TODO: 구현 후 여기서 호출 횟수 제한(hit_rate) → 캐시(fn_cache) → 원본 호출 순서로.
  return json({ ok: false, error: "not_implemented" }, 501, h);
});
