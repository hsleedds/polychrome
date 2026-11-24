// Polychrome · 기상청 동네예보 프록시 (Supabase Edge Function: kma)
// 배포: Edge Functions → Deploy a new function → Via Editor → 이름 "kma" → 이 파일 붙여넣기
// 설정: 이 함수의 "Verify JWT" 는 OFF (앱이 로그인 없이 호출)
// 비밀값: KMA_KEY (공공데이터포털 '기상청_단기예보 조회서비스' 일반 인증키 Decoding)
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = ["https://hsleedds.github.io"]; // 도메인이 생기면 여기에 추가
const BASE = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/";
const TTL_MIN = 20;

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
  new Response(JSON.stringify(o), { status: st, headers: { ...h, "Content-Type": "application/json", "Cache-Control": "public, max-age=600" } });

// 위경도 → 기상청 5km 격자 (Lambert Conformal Conic)
export function toGrid(lat: number, lon: number) {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const D = Math.PI / 180, re = RE / GRID, s1 = SLAT1 * D, s2 = SLAT2 * D, olon = OLON * D, olat = OLAT * D;
  let sn = Math.tan(Math.PI * 0.25 + s2 * 0.5) / Math.tan(Math.PI * 0.25 + s1 * 0.5);
  sn = Math.log(Math.cos(s1) / Math.cos(s2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + s1 * 0.5); sf = Math.pow(sf, sn) * Math.cos(s1) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5); ro = re * sf / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * D * 0.5); ra = re * sf / Math.pow(ra, sn);
  let th = lon * D - olon; if (th > Math.PI) th -= 2 * Math.PI; if (th < -Math.PI) th += 2 * Math.PI; th *= sn;
  return { nx: Math.floor(ra * Math.sin(th) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(th) + YO + 0.5) };
}
// "강수없음", "1mm 미만", "2.5mm", "30.0~50.0mm", "50.0mm 이상" → mm
export function mm(v: string | number | undefined): number | null {
  if (v == null) return null; const s = String(v).trim();
  if (/없음/.test(s) || s === "0" || s === "-") return 0;
  if (/미만/.test(s)) return 0.5;
  const r = s.match(/([\d.]+)\s*~\s*([\d.]+)/); if (r) return (parseFloat(r[1]) + parseFloat(r[2])) / 2;
  const n = parseFloat(s); return isFinite(n) ? n : null;
}
// SKY(1 맑음,3 구름많음,4 흐림) + PTY(1 비,2 비/눈,3 눈,4 소나기,5 빗방울,6 빗방울눈날림,7 눈날림) → WMO
export function wmo(sky?: number, pty?: number): number | null {
  if (pty && pty > 0) return pty === 3 || pty === 7 ? 71 : pty === 2 || pty === 6 ? 68 : pty === 4 ? 80 : pty === 5 ? 51 : 61;
  if (sky == null) return null; return sky === 1 ? 0 : sky === 3 ? 2 : 3;
}
// KST 기준 발표 시각 계산
function kst(d = new Date()) { return new Date(d.getTime() + 9 * 3600e3); }
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
function baseVilage(now: Date) {
  const k = kst(new Date(now.getTime() - 15 * 60e3)); // 발표 10분 뒤 제공
  const hrs = [23, 20, 17, 14, 11, 8, 5, 2]; let h = hrs.find((x) => x <= k.getUTCHours());
  if (h == null) { k.setUTCDate(k.getUTCDate() - 1); h = 23; }
  return { date: ymd(k), time: String(h).padStart(2, "0") + "00" };
}
function baseUltra(now: Date) { // 매시 30분 발표, 45분 이후 제공
  const k = kst(new Date(now.getTime() - 45 * 60e3));
  return { date: ymd(k), time: String(k.getUTCHours()).padStart(2, "0") + "30" };
}
function baseNcst(now: Date) { // 매시 정시, 40분 이후 제공
  const k = kst(new Date(now.getTime() - 40 * 60e3));
  return { date: ymd(k), time: String(k.getUTCHours()).padStart(2, "0") + "00" };
}
async function call(op: string, key: string, b: { date: string; time: string }, nx: number, ny: number, rows: number) {
  const u = `${BASE}${op}?serviceKey=${encodeURIComponent(key)}&pageNo=1&numOfRows=${rows}&dataType=JSON&base_date=${b.date}&base_time=${b.time}&nx=${nx}&ny=${ny}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  const t = await r.text();
  let j: any; try { j = JSON.parse(t); } catch { throw new Error("kma_non_json"); }
  const hd = j?.response?.header; if (hd?.resultCode !== "00") throw new Error("kma_" + (hd?.resultCode || "err"));
  return (j.response.body?.items?.item || []) as any[];
}

// 시간별로 합치기: 단기예보(약 3~4일) 위에 초단기예보(6시간)를 덮어씀
export function build(vil: any[], ult: any[], ncs: any[]) {
  const H: Record<string, any> = {};
  const put = (d: string, t: string, k: string, v: any) => {
    const key = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:00`;
    (H[key] = H[key] || {})[k] = v;
  };
  for (const it of vil) put(it.fcstDate, it.fcstTime, "v" + it.category, it.fcstValue);
  for (const it of ult) put(it.fcstDate, it.fcstTime, "u" + it.category, it.fcstValue);
  const time = Object.keys(H).sort();
  const num = (x: any) => (x == null || x === "" ? null : (isFinite(+x) ? +x : null));
  const out = { time, temperature_2m: [] as (number | null)[], precipitation_probability: [] as (number | null)[], precipitation: [] as (number | null)[], wind_speed_10m: [] as (number | null)[], relative_humidity_2m: [] as (number | null)[], weather_code: [] as (number | null)[], src: [] as string[] };
  for (const k of time) {
    const h = H[k], u = h.uT1H != null;
    out.temperature_2m.push(num(u ? h.uT1H : h.vTMP));
    out.precipitation_probability.push(num(h.vPOP) ?? (u && num(h.uPTY) ? 100 : null));
    out.precipitation.push(u ? mm(h.uRN1) : mm(h.vPCP));
    out.wind_speed_10m.push(num(u ? h.uWSD : h.vWSD));
    out.relative_humidity_2m.push(num(u ? h.uREH : h.vREH));
    out.weather_code.push(wmo(num(u ? h.uSKY : h.vSKY) ?? undefined, num(u ? h.uPTY : h.vPTY) ?? undefined));
    out.src.push(u ? "ultra" : "vilage");
  }
  const n: Record<string, any> = {}; for (const it of ncs) n[it.category] = it.obsrValue;
  const now = ncs.length ? { temperature_2m: num(n.T1H), precipitation: mm(n.RN1), wind_speed_10m: num(n.WSD), relative_humidity_2m: num(n.REH), pty: num(n.PTY) } : null;
  return { hourly: out, now };
}

/* 보안(M3): 호출 횟수 제한 — IP별 1시간 + 전체 하루 상한. SQL 12의 hit_rate 사용. 표가 없으면 제한 없이 통과 */
async function rateOk(req: Request, name: string, perIpHour: number, perDay: number): Promise<boolean> {
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "na";
    const now = new Date(Date.now() + 9 * 3600e3).toISOString();
    const a = await db.rpc("hit_rate", { p_key: `${name}:${ip}:${now.slice(0, 13)}`, p_max: perIpHour });
    if (a.error) return true;
    if (a.data === false) return false;
    const b = await db.rpc("hit_rate", { p_key: `${name}:all:${now.slice(0, 10)}`, p_max: perDay });
    return b.error ? true : b.data !== false;
  } catch { return true; }
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (!(await rateOk(req, "kma", 120, 8000))) return json({ ok: false, error: "rate_limited" }, 429, h);
  const KEY = Deno.env.get("KMA_KEY");
  if (!KEY) return json({ ok: false, error: "not_configured" }, 500, h);
  const url = new URL(req.url), lat = +(url.searchParams.get("lat") || ""), lon = +(url.searchParams.get("lon") || "");
  if (!isFinite(lat) || !isFinite(lon) || lat < 32 || lat > 39.5 || lon < 124 || lon > 132) return json({ ok: false, error: "out_of_korea" }, 400, h);
  const { nx, ny } = toGrid(lat, lon), ck = `${nx}_${ny}`;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const { data: c } = await db.from("kma_cache").select("body,fetched_at").eq("k", ck).maybeSingle();
    if (c && Date.now() - new Date(c.fetched_at).getTime() < TTL_MIN * 60e3) return json({ ok: true, cached: true, ...c.body }, 200, h);
  } catch { /* 캐시 실패는 무시 */ }
  try {
    const now = new Date(), bv = baseVilage(now), bu = baseUltra(now), bn = baseNcst(now);
    const [vil, ult, ncs] = await Promise.all([
      call("getVilageFcst", KEY, bv, nx, ny, 1500),
      call("getUltraSrtFcst", KEY, bu, nx, ny, 100).catch(() => []),
      call("getUltraSrtNcst", KEY, bn, nx, ny, 20).catch(() => []),
    ]);
    const body = { nx, ny, base: { vilage: bv, ultra: bu }, ...build(vil, ult, ncs), source: "기상청 동네예보" };
    try { await db.from("kma_cache").upsert({ k: ck, body, fetched_at: new Date().toISOString() }); } catch { /* ignore */ }
    return json({ ok: true, ...body }, 200, h);
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 502, h);
  }
});
