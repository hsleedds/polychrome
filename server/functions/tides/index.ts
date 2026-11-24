// Polychrome · 물때(조석 예보) (Supabase Edge Function: tides) — 스위치 tides (기본 꺼짐)
// 배포: Edge Functions → Deploy a new function → Via Editor → 이름 "tides" → 이 파일 붙여넣기 → Verify JWT OFF
// 비밀값: KMA_KEY
// 지금 상태: 스위치가 꺼져 있으면 {ok:false,error:'disabled'}(403), 켜져 있어도 아직 구현 전이라 {ok:false,error:'not_implemented'}(501).
// TODO: 국립해양조사원 조석 예보 서비스를 공공데이터포털에서 확인(서비스명·오퍼레이션·관측소 코드)한 뒤 구현.
//   · 공공데이터포털 키(KMA_KEY) 하나로 쓸 수 있는지(같은 계정 활용신청) 확인.
//   · 응답: {ok, station:{code,name,lat,lon,distKm}, items:[{time, type:'high'|'low', levelCm}], source:'국립해양조사원'}
//   · 캐시: fn_cache 'tides:<관측소>:<날짜>' 하루.
import { createClient } from "npm:@supabase/supabase-js@2";

const FLAG = "tides";
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
