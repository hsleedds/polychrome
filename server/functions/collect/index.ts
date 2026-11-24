// Polychrome · 예보 스냅샷 수집 (Supabase Edge Function: collect) — cron 전용
// 배포: Edge Functions → Deploy a new function → Via Editor → 이름 "collect" → 이 파일 붙여넣기 → Verify JWT OFF
// 비밀값: KMA_KEY (공공데이터포털 일반 인증키 Decoding), ADMIN_TOKEN (cron 헤더 x-cron-token 과 대조)
// 호출: POST/GET  …/functions/v1/collect?job=kma     (매시 07분 — 기상청 단기·초단기)
//                 …/functions/v1/collect?job=global  (3시간마다 — Open-Meteo 다중 모델 + MET Norway)
//       선택: &force=1 (job=kma 에서 단기예보를 발표 직후가 아니어도 수집), &only=108,159 (지점 제한)
// 저장: public.fc_snapshot (덮어쓰지 않음: on conflict do nothing)
// 지점 목록은 data/asos-stations.json 과 같다(한 파일 배포라 여기에도 넣음 — 바꾸면 둘 다 고칠 것).
import { createClient } from "npm:@supabase/supabase-js@2";

// ───────── 지점 (기상청 관측 지점 정보 https://minwon.kma.go.kr/main/obvStn.do, 2026-11-25 조회) ─────────
const STATIONS: { stn: number; name: string; lat: number; lon: number }[] = [
  { stn: 90, name: "속초", lat: 38.25085, lon: 128.56473 },
  { stn: 95, name: "철원", lat: 38.14787, lon: 127.3042 },
  { stn: 99, name: "파주", lat: 37.88589, lon: 126.76648 },
  { stn: 100, name: "대관령", lat: 37.67713, lon: 128.71834 },
  { stn: 101, name: "춘천", lat: 37.90262, lon: 127.7357 },
  { stn: 102, name: "백령도", lat: 37.97396, lon: 124.71237 },
  { stn: 105, name: "강릉", lat: 37.75147, lon: 128.89099 },
  { stn: 108, name: "서울", lat: 37.57142, lon: 126.9658 },
  { stn: 112, name: "인천", lat: 37.47772, lon: 126.6249 },
  { stn: 114, name: "원주", lat: 37.33749, lon: 127.94659 },
  { stn: 115, name: "울릉도", lat: 37.48129, lon: 130.89864 },
  { stn: 119, name: "수원", lat: 37.25746, lon: 126.983 },
  { stn: 127, name: "충주", lat: 36.97045, lon: 127.9525 },
  { stn: 129, name: "서산", lat: 36.77658, lon: 126.4939 },
  { stn: 131, name: "청주", lat: 36.63924, lon: 127.44066 },
  { stn: 133, name: "대전", lat: 36.37199, lon: 127.3721 },
  { stn: 136, name: "안동", lat: 36.57293, lon: 128.70734 },
  { stn: 138, name: "포항", lat: 36.03201, lon: 129.38002 },
  { stn: 140, name: "군산", lat: 36.0053, lon: 126.76135 },
  { stn: 143, name: "대구", lat: 35.87797, lon: 128.65295 },
  { stn: 146, name: "전주", lat: 35.84092, lon: 127.11718 },
  { stn: 152, name: "울산", lat: 35.58237, lon: 129.33469 },
  { stn: 155, name: "창원", lat: 35.17019, lon: 128.57281 },
  { stn: 156, name: "광주", lat: 35.17294, lon: 126.89156 },
  { stn: 159, name: "부산", lat: 35.10468, lon: 129.03203 },
  { stn: 162, name: "통영", lat: 34.84541, lon: 128.43561 },
  { stn: 165, name: "목포", lat: 34.81732, lon: 126.38151 },
  { stn: 168, name: "여수", lat: 34.73929, lon: 127.74063 },
  { stn: 184, name: "제주", lat: 33.51411, lon: 126.52969 },
  { stn: 189, name: "서귀포", lat: 33.24616, lon: 126.5653 },
  { stn: 192, name: "진주", lat: 35.16378, lon: 128.04004 },
  { stn: 216, name: "태백", lat: 37.17038, lon: 128.98929 },
  { stn: 239, name: "세종", lat: 36.48522, lon: 127.24438 },
];

const KMA_BASE = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/";
const OM_BASE = "https://api.open-meteo.com/v1/forecast";
const MET_BASE = "https://api.met.no/weatherapi/locationforecast/2.0/complete";
const MET_UA = "Polychrome/0.1 github.com/hsleedds/polychrome"; // MET Norway 이용약관: 식별 가능한 User-Agent 필수
// Open-Meteo 모델 id — 2026-11 문서 예시 URL 기준. app_config.collect_models 로 바꿀 수 있음.
// 주의: kma_seamless 는 Open-Meteo 문서에 "2026-03-31 중단(KIM 전환 중)"으로 표시됨 → 값이 비면 저장하지 않음.
const DEFAULT_MODELS = ["kma_seamless", "ecmwf_ifs", "ncep_gfs_seamless", "dwd_icon_seamless", "ukmo_seamless", "meteofrance_seamless", "cmc_gem_seamless", "jma_seamless"];
const OM_VARS = ["precipitation", "precipitation_probability", "temperature_2m", "wind_speed_10m", "wind_gusts_10m", "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "visibility", "snowfall"];
const MAX_LEAD_H = 72;
const BUDGET_MS = 130_000; // Edge Function 한도(약 150초) 안에서 끝내기
const CHUNK = 6;            // 동시에 처리할 지점 수

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
const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// 상수 시간 비교 (SHA-256 후 XOR)
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

// ───────── 기상청 (kma 함수와 같은 계산) ─────────
function toGrid(lat: number, lon: number) {
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
// "강수없음", "1mm 미만", "2.5mm", "30.0~50.0mm", "50.0mm 이상" → mm (kma 함수와 동일)
function mm(v: string | number | undefined): number | null {
  if (v == null) return null; const s = String(v).trim();
  if (/없음/.test(s) || s === "0" || s === "-") return 0;
  if (/미만/.test(s)) return 0.5;
  const r = s.match(/([\d.]+)\s*~\s*([\d.]+)/); if (r) return (parseFloat(r[1]) + parseFloat(r[2])) / 2;
  const n = parseFloat(s); return isFinite(n) ? n : null;
}
// 신적설 "적설없음", "0.5cm 미만"/"1cm 미만", "1.0~4.9cm", "5.0cm 이상" → cm
function cm(v: string | number | undefined): number | null {
  if (v == null) return null; const s = String(v).trim();
  if (/없음/.test(s) || s === "0" || s === "-") return 0;
  if (/미만/.test(s)) { const n = parseFloat(s); return isFinite(n) ? n / 2 : 0.5; }
  const r = s.match(/([\d.]+)\s*~\s*([\d.]+)/); if (r) return (parseFloat(r[1]) + parseFloat(r[2])) / 2;
  const n = parseFloat(s); return isFinite(n) ? n : null;
}
const num = (x: unknown) => (x == null || x === "" ? null : (isFinite(+(x as number)) ? +(x as number) : null));
function kst(d = new Date()) { return new Date(d.getTime() + 9 * 3600e3); }
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
function baseVilage(now: Date) {
  const k = kst(new Date(now.getTime() - 15 * 60e3));
  const hrs = [23, 20, 17, 14, 11, 8, 5, 2]; let h = hrs.find((x) => x <= k.getUTCHours());
  if (h == null) { k.setUTCDate(k.getUTCDate() - 1); h = 23; }
  return { date: ymd(k), time: String(h).padStart(2, "0") + "00" };
}
function baseUltra(now: Date) {
  const k = kst(new Date(now.getTime() - 45 * 60e3));
  return { date: ymd(k), time: String(k.getUTCHours()).padStart(2, "0") + "30" };
}
// "20261125","1400" → ISO(KST)
const kstIso = (d: string, t: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4) || "00"}:00+09:00`;
async function kmaCall(op: string, key: string, b: { date: string; time: string }, nx: number, ny: number, rows: number) {
  const u = `${KMA_BASE}${op}?serviceKey=${encodeURIComponent(key)}&pageNo=1&numOfRows=${rows}&dataType=JSON&base_date=${b.date}&base_time=${b.time}&nx=${nx}&ny=${ny}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
  const t = await r.text();
  let j: any; try { j = JSON.parse(t); } catch { throw new Error("kma_non_json"); }
  const hd = j?.response?.header; if (hd?.resultCode !== "00") throw new Error("kma_" + (hd?.resultCode || "err"));
  return (j.response.body?.items?.item || []) as any[];
}

type Row = {
  source: string; model: string; issued_at: string; stn: number; target_time: string; lead_h: number;
  p_mm?: number | null; pp?: number | null; t?: number | null; wind?: number | null; gust?: number | null;
  cloud?: number | null; cloud_low?: number | null; cloud_mid?: number | null; cloud_high?: number | null;
  vis?: number | null; snow?: number | null; extra?: Record<string, unknown> | null;
};
const leadH = (issued: string, target: string) => Math.floor((Date.parse(target) - Date.parse(issued)) / 3600e3);

// 기상청 항목 → 시간별 행. TODO 확인: 단기예보 PCP 의 fcstTime 이 「그 시각까지 1시간」인지 「그 시각부터 1시간」인지(SPEC: 첫 자료로 확인).
//   지금은 Open-Meteo 처럼 「그 시각까지」로 본다.
function kmaRows(items: any[], model: "vilage" | "ultra", base: { date: string; time: string }, stn: number): Row[] {
  const issued = kstIso(base.date, base.time);
  const H: Record<string, Record<string, string>> = {};
  for (const it of items) { const k = kstIso(it.fcstDate, it.fcstTime); (H[k] = H[k] || {})[it.category] = it.fcstValue; }
  const out: Row[] = [];
  for (const [tt, h] of Object.entries(H)) {
    const lead = leadH(issued, tt); if (lead < 0 || lead > MAX_LEAD_H) continue;
    if (model === "vilage") {
      out.push({ source: "kma", model, issued_at: issued, stn, target_time: tt, lead_h: lead,
        p_mm: mm(h.PCP), pp: num(h.POP), t: num(h.TMP), wind: num(h.WSD), snow: cm(h.SNO),
        extra: { sky: num(h.SKY), pty: num(h.PTY), reh: num(h.REH) } });
    } else {
      out.push({ source: "kma", model, issued_at: issued, stn, target_time: tt, lead_h: lead,
        p_mm: mm(h.RN1), pp: null, t: num(h.T1H), wind: num(h.WSD),
        extra: { sky: num(h.SKY), pty: num(h.PTY), reh: num(h.REH), lgt: num(h.LGT) } });
    }
  }
  return out;
}

// ───────── Open-Meteo (한 요청에 여러 모델) ─────────
// 여러 모델을 한 번에 요청하면 응답 키에 "_<모델id>" 가 붙는다(예: precipitation_ecmwf_ifs).
// 발표 시각: Open-Meteo 응답에는 모델 실행 시각이 없음 → 수집 시각을 정시로 자른 값을 issued_at 으로 쓰고,
// 같은 실행(값이 그대로)을 다시 받으면 저장하지 않는다(collect_state). 그래서 issued_at 은 「처음 본 시각」.
async function omFetch(lat: number, lon: number, models: string[]) {
  const u = `${OM_BASE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=${OM_VARS.join(",")}` +
    `&models=${models.join(",")}&forecast_days=3&timezone=Asia%2FSeoul&wind_speed_unit=ms`;
  const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
  const j: any = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) throw new Error("om_" + r.status + (j?.reason ? ":" + String(j.reason).slice(0, 80) : ""));
  return j;
}
function omRows(j: any, model: string, suffix: boolean, issued: string, stn: number): Row[] {
  const H = j?.hourly; if (!H?.time) return [];
  const g = (v: string): (number | null)[] => (H[suffix ? `${v}_${model}` : v] || []) as (number | null)[];
  const P = g("precipitation"), PP = g("precipitation_probability"), T = g("temperature_2m"), W = g("wind_speed_10m"),
    G = g("wind_gusts_10m"), C = g("cloud_cover"), CL = g("cloud_cover_low"), CM = g("cloud_cover_mid"), CH = g("cloud_cover_high"),
    V = g("visibility"), S = g("snowfall");
  if (!P.some((x) => x != null) && !T.some((x) => x != null)) return []; // 이 모델은 이 지점에 자료 없음
  const out: Row[] = [];
  (H.time as string[]).forEach((tm, i) => {
    const tt = `${tm}:00+09:00`; const lead = leadH(issued, tt);
    if (lead < 1 || lead > MAX_LEAD_H) return; // 이미 시작된 시간(리드 0)은 제외
    if (P[i] == null && T[i] == null) return;
    out.push({ source: "om", model, issued_at: issued, stn, target_time: tt, lead_h: lead,
      p_mm: P[i] ?? null, pp: PP[i] ?? null, t: T[i] ?? null, wind: W[i] ?? null, gust: G[i] ?? null,
      cloud: C[i] ?? null, cloud_low: CL[i] ?? null, cloud_mid: CM[i] ?? null, cloud_high: CH[i] ?? null,
      vis: V[i] ?? null, snow: S[i] ?? null });
  });
  return out;
}
// 같은 실행인지: 겹치는 대상 시각 값(강수·기온·확률)이 모두 같으면 같은 실행으로 본다
type Sig = Record<string, [number | null, number | null, number | null]>;
const sigOf = (rows: Row[]): Sig => Object.fromEntries(rows.map((r) => [r.target_time.slice(0, 13), [r.p_mm ?? null, r.t ?? null, r.pp ?? null]]));
function sameRun(prev: Sig | undefined, now: Sig) {
  if (!prev) return false; let n = 0;
  for (const [k, v] of Object.entries(now)) {
    const p = prev[k]; if (!p) continue; n++;
    if (p[0] !== v[0] || p[1] !== v[1] || p[2] !== v[2]) return false;
  }
  return n >= 12;
}

// ───────── MET Norway locationforecast (complete) ─────────
// next_1_hours 는 time 부터 1시간 → 「그 시각까지」 기준으로 target = time + 1h. 순간값(기온·구름·바람)은 target 시각의 값.
async function metRows(lat: number, lon: number, stn: number): Promise<Row[]> {
  const u = `${MET_BASE}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  const r = await fetch(u, { headers: { "User-Agent": MET_UA, "Accept": "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("met_" + r.status);
  const j: any = await r.json();
  const issuedRaw: string | undefined = j?.properties?.meta?.updated_at; if (!issuedRaw) throw new Error("met_no_meta");
  const issued = new Date(issuedRaw).toISOString();
  const ts: any[] = j?.properties?.timeseries || [];
  const byT = new Map<number, any>(); for (const e of ts) byT.set(Date.parse(e.time), e?.data);
  const out: Row[] = [];
  for (const e of ts) {
    const n1 = e?.data?.next_1_hours?.details; if (!n1) continue;
    const target = new Date(Date.parse(e.time) + 3600e3).toISOString();
    const lead = leadH(issued, target); if (lead < 1 || lead > MAX_LEAD_H) continue;
    const inst = byT.get(Date.parse(target))?.instant?.details || {};
    out.push({ source: "met", model: "locationforecast", issued_at: issued, stn, target_time: target, lead_h: lead,
      p_mm: num(n1.precipitation_amount), pp: num(n1.probability_of_precipitation),
      t: num(inst.air_temperature), wind: num(inst.wind_speed), gust: num(inst.wind_speed_of_gust),
      cloud: num(inst.cloud_area_fraction), cloud_low: num(inst.cloud_area_fraction_low),
      cloud_mid: num(inst.cloud_area_fraction_medium), cloud_high: num(inst.cloud_area_fraction_high),
      extra: inst.fog_area_fraction != null ? { fog: num(inst.fog_area_fraction) } : null });
  }
  return out;
}

async function save(db: ReturnType<typeof sb>, rows: Row[]) {
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500);
    const { error } = await db.from("fc_snapshot").upsert(part, { onConflict: "source,model,issued_at,stn,target_time", ignoreDuplicates: true });
    if (error) throw new Error("db_" + error.message.slice(0, 80)); n += part.length;
  }
  return n;
}

async function inChunks<T>(items: T[], t0: number, fn: (x: T) => Promise<void>) {
  let done = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    if (Date.now() - t0 > BUDGET_MS) break;
    await Promise.all(items.slice(i, i + CHUNK).map((x) => fn(x).catch(() => {})));
    done = Math.min(items.length, i + CHUNK);
  }
  return done;
}

async function jobKma(db: ReturnType<typeof sb>, list: typeof STATIONS, force: boolean, t0: number) {
  const KEY = Deno.env.get("KMA_KEY"); if (!KEY) throw new Error("not_configured");
  const now = new Date(), bv = baseVilage(now), bu = baseUltra(now);
  // 단기예보는 3시간마다 발표(02,05,…시 + 10분 후 제공) → KST 시가 3의 배수일 때(발표 1시간 뒤)만 받는다
  const vilageDue = force || kst(now).getUTCHours() % 3 === 0;
  let rows = 0; const errors: string[] = [];
  const done = await inChunks(list, t0, async (s) => {
    const { nx, ny } = toGrid(s.lat, s.lon); const out: Row[] = [];
    try { out.push(...kmaRows(await kmaCall("getUltraSrtFcst", KEY, bu, nx, ny, 100), "ultra", bu, s.stn)); } catch (e) { errors.push(`${s.stn}:ultra:${(e as Error).message}`); }
    if (vilageDue) {
      try { out.push(...kmaRows(await kmaCall("getVilageFcst", KEY, bv, nx, ny, 1500), "vilage", bv, s.stn)); } catch (e) { errors.push(`${s.stn}:vilage:${(e as Error).message}`); }
    }
    try { rows += await save(db, out); } catch (e) { errors.push(`${s.stn}:${(e as Error).message}`); }
  });
  return { base: { vilage: vilageDue ? bv : null, ultra: bu }, stations: done, of: list.length, rows, errors: errors.slice(0, 10) };
}

async function jobGlobal(db: ReturnType<typeof sb>, list: typeof STATIONS, t0: number) {
  let models = DEFAULT_MODELS;
  try {
    const { data } = await db.from("app_config").select("value").eq("key", "collect_models").maybeSingle();
    if (Array.isArray(data?.value) && data!.value.length) models = (data!.value as unknown[]).map(String).filter((m) => /^[a-z0-9_]+$/.test(m));
  } catch { /* 기본값 */ }
  const issued = new Date(Math.floor(Date.now() / 3600e3) * 3600e3).toISOString();
  // 지난 상태(같은 실행 판별용)
  const state = new Map<string, Sig>();
  try {
    const { data } = await db.from("collect_state").select("k,body").like("k", "om:%").limit(2000);
    for (const r of data || []) state.set(r.k, r.body as Sig);
  } catch { /* 없으면 모두 저장 */ }
  let rows = 0, skipped = 0; const errors: string[] = []; const empty = new Set<string>(models);
  const done = await inChunks(list, t0, async (s) => {
    const out: Row[] = []; const newState: { k: string; body: Sig; at: string }[] = [];
    // 1) Open-Meteo: 한 번에, 실패하면 모델별로(잘못된 id 하나가 전체를 막지 않도록)
    const perModel: Record<string, Row[]> = {};
    try {
      const j = await omFetch(s.lat, s.lon, models);
      for (const m of models) perModel[m] = omRows(j, m, models.length > 1, issued, s.stn);
    } catch (e) {
      errors.push(`${s.stn}:om:${(e as Error).message}`);
      await Promise.all(models.map(async (m) => {
        try { perModel[m] = omRows(await omFetch(s.lat, s.lon, [m]), m, false, issued, s.stn); }
        catch (e2) { errors.push(`${s.stn}:om:${m}:${(e2 as Error).message}`); }
      }));
    }
    for (const [m, rs] of Object.entries(perModel)) {
      if (!rs.length) continue; empty.delete(m);
      const k = `om:${m}:${s.stn}`, sig = sigOf(rs);
      if (sameRun(state.get(k), sig)) { skipped++; continue; }
      out.push(...rs); newState.push({ k, body: sig, at: new Date().toISOString() });
    }
    // 2) MET Norway (issued_at = meta.updated_at, 같은 발표는 on conflict 로 걸러짐)
    try { out.push(...(await metRows(s.lat, s.lon, s.stn))); } catch (e) { errors.push(`${s.stn}:met:${(e as Error).message}`); }
    try {
      rows += await save(db, out);
      if (newState.length) await db.from("collect_state").upsert(newState, { onConflict: "k" });
    } catch (e) { errors.push(`${s.stn}:${(e as Error).message}`); }
  });
  return { issued, models, emptyModels: [...empty], stations: done, of: list.length, rows, skippedSameRun: skipped, errors: errors.slice(0, 15) };
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (!(await cronOk(req))) return json({ ok: false, error: "forbidden" }, 403, h);
  const url = new URL(req.url), job = url.searchParams.get("job") || "";
  const only = (url.searchParams.get("only") || "").split(",").map((x) => +x).filter((x) => x > 0);
  const list = only.length ? STATIONS.filter((s) => only.includes(s.stn)) : STATIONS;
  const t0 = Date.now(), db = sb();
  try {
    if (job === "kma") return json({ ok: true, job, ...(await jobKma(db, list, url.searchParams.get("force") === "1", t0)), ms: Date.now() - t0 }, 200, h);
    if (job === "global") return json({ ok: true, job, ...(await jobGlobal(db, list, t0)), ms: Date.now() - t0 }, 200, h);
    return json({ ok: false, error: "unknown_job" }, 400, h);
  } catch (e) {
    return json({ ok: false, job, error: String((e as Error).message || e) }, 500, h);
  }
});
