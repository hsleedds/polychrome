// Polychrome · 관리자 토큰 확인 (Supabase Edge Function: admin)
// 배포: Edge Functions → Deploy a new function → Via Editor → 이름 "admin" → 이 파일 붙여넣기 → Verify JWT OFF
// 비밀값: ADMIN_TOKEN
// 호출: POST …/functions/v1/admin   본문 {"token":"<토큰>"} → {"ok":true} 또는 401 {"ok":false}
// 앱은 ?admin=<토큰> 주소로 열렸을 때만 부르고, 확인되면 기기에 표시한다.
// 무차별 대입 방지: IP당 1시간 10회, 전체 하루 300회.
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = ["https://hsleedds.github.io"];
function cors(origin: string | null) {
  const ok = origin && (ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (o: unknown, st: number, h: Record<string, string>) =>
  new Response(JSON.stringify(o), { status: st, headers: { ...h, "Content-Type": "application/json", "Cache-Control": "no-store" } });

// 이 함수는 표가 없거나 오류면 「막는다」(다른 함수와 반대: 보안 우선)
async function rateOk(req: Request, perIpHour: number, perDay: number): Promise<boolean> {
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "na";
    const now = new Date(Date.now() + 9 * 3600e3).toISOString();
    const a = await db.rpc("hit_rate", { p_key: `admin:${ip}:${now.slice(0, 13)}`, p_max: perIpHour });
    if (a.error || a.data === false) return false;
    const b = await db.rpc("hit_rate", { p_key: `admin:all:${now.slice(0, 10)}`, p_max: perDay });
    return !b.error && b.data !== false;
  } catch { return false; }
}
async function safeEq(a: string, b: string) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y); let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, h);
  if (!(await rateOk(req, 10, 300))) return json({ ok: false, error: "rate_limited" }, 429, h);
  const want = Deno.env.get("ADMIN_TOKEN");
  if (!want || want.length < 16) return json({ ok: false, error: "not_configured" }, 500, h);
  let token = "";
  try { const b = await req.json(); token = typeof b?.token === "string" ? b.token.slice(0, 256) : ""; } catch { /* 빈 토큰 */ }
  const ok = token.length > 0 && (await safeEq(token, want));
  if (!ok) await new Promise((r) => setTimeout(r, 400)); // 실패는 조금 늦게
  return json({ ok }, ok ? 200 : 401, h);
});
