// Polychrome · 레이더 초단기(0~5시간) (Supabase Edge Function: radar) — 스위치 radar (기본 꺼짐)
// 배포: Edge Functions → Deploy a new function → Via Editor → 이름 "radar" → 이 파일 붙여넣기 → Verify JWT OFF
// 비밀값: KMA_HUB_KEY
// 지금 상태: 스위치가 꺼져 있으면 {ok:false,error:'disabled'}(403), 켜져 있어도 아직 구현 전이라 {ok:false,error:'not_implemented'}(501).
// TODO: 기상청 API허브(apihub.kma.go.kr)의 레이더 합성·초단기 강수 예측 자료 형식을 확인한 뒤 구현.
//   · 요청: ?lat=&lon= → 0~5시간 10분(또는 1시간) 간격 강수 [{time, mm}] + 발표 시각.
//   · 키: KMA_HUB_KEY (authKey 파라미터). 공공데이터포털 키와 다름.
//   · 수집(collect)에도 'radar' 모델로 넣어 채점할 예정(SPEC 3장).
import { createClient } from "npm:@supabase/supabase-js@2";

const FLAG = "radar";
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
