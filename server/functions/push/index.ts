// Polychrome · 오로라 「강해지면 알림」(웹 푸시) (Supabase Edge Function: push) — 스위치 aurora_alert (기본 꺼짐)
// 배포: Edge Functions → Deploy a new function → Via Editor → 이름 "push" → 이 파일 붙여넣기 → Verify JWT OFF
// 비밀값: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (예정)
// 지금 상태: 스위치가 꺼져 있으면 {ok:false,error:'disabled'}(403), 켜져 있어도 아직 구현 전이라 {ok:false,error:'not_implemented'}(501).
// SPEC 4.6: 만들어 두고 꺼 둠(스위치 aurora_alert, 함수 미배포).
// TODO: 구독 저장 표(push_sub: endpoint, keys, 도시, 기준 지수) + aurora job=log 뒤에 기준 넘으면 발송.
//   · 웹 푸시 발송은 VAPID 서명 필요(npm:web-push 등 Deno 호환 확인).
//   · 구독 등록: POST {subscription, city, threshold} / 해지: POST {endpoint, remove:true}
import { createClient } from "npm:@supabase/supabase-js@2";

const FLAG = "aurora_alert";
const ORIGINS = ["https://hsleedds.github.io"];
function cors(origin: string | null) {
  const ok = origin && (ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
