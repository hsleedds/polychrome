// Polychrome · 채점 + 가중치 (Supabase Edge Function: score) — cron 전용
// 배포: Edge Functions → Deploy a new function → Via Editor → 이름 "score" → 이 파일 붙여넣기 → Verify JWT OFF
// 비밀값: ADMIN_TOKEN (헤더 x-cron-token 과 대조). 계산은 DB 함수(sql/04_score.sql)가 한다.
// 호출: …/functions/v1/score?job=daily              → 어제(KST) 채점 → 가중치 다시 계산
//       …/functions/v1/score?job=daily&date=2026-11-20 → 그날 다시 채점
//       …/functions/v1/score?job=daily&days=7          → 어제까지 7일 다시 채점(최대 31)
//       …/functions/v1/score?job=weights               → 가중치만 다시 계산
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = ["https://hsleedds.github.io"];
function cors(origin: string | null) {
  const ok = origin && (ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (o: unknown, st: number, h: Record<string, string>) =>
  new Response(JSON.stringify(o), { status: st, headers: { ...h, "Content-Type": "application/json", "Cache-Control": "no-store" } });
async function safeEq(a: string, b: string) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y); let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}
async function cronOk(req: Request) {
  const want = Deno.env.get("ADMIN_TOKEN"), got = req.headers.get("x-cron-token") || "";
  return !!want && !!got && (await safeEq(got, want));
}
const kstDay = (msAgo: number) => new Date(Date.now() - msAgo + 9 * 3600e3).toISOString().slice(0, 10);

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (!(await cronOk(req))) return json({ ok: false, error: "forbidden" }, 403, h);
  const url = new URL(req.url), job = url.searchParams.get("job") || "daily", t0 = Date.now();
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const scored: unknown[] = [];
    if (job === "daily") {
      const dq = url.searchParams.get("date");
      const days = Math.min(31, Math.max(1, +(url.searchParams.get("days") || 1) || 1));
      const list = dq && /^\d{4}-\d{2}-\d{2}$/.test(dq) ? [dq] : Array.from({ length: days }, (_, i) => kstDay((i + 1) * 86400e3)).reverse();
      for (const d of list) {
        if (Date.now() - t0 > 120_000) break;
        const { data, error } = await db.rpc("pc_score_day", { p_day: d });
        if (error) throw new Error(`score_${d}:${error.message.slice(0, 120)}`);
        scored.push(data);
      }
    } else if (job !== "weights") return json({ ok: false, error: "unknown_job" }, 400, h);
    const w = await db.rpc("pc_update_weights");
    if (w.error) throw new Error("weights:" + w.error.message.slice(0, 120));
    return json({ ok: true, job, scored, weights: w.data, ms: Date.now() - t0 }, 200, h);
  } catch (e) {
    return json({ ok: false, job, error: String((e as Error).message || e) }, 500, h);
  }
});
