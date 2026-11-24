// Polychrome · 에어코리아 미세먼지 (Supabase Edge Function: air)
// 배포: Edge Functions → Deploy a new function → Via Editor → 이름 "air" → 이 파일 붙여넣기 → Verify JWT OFF
// 비밀값: KMA_KEY (공공데이터포털 키 하나로 사용. 아래 두 서비스 활용신청 필요)
//   · 한국환경공단_에어코리아_대기오염정보  (ArpltnInforInqireSvc: getMsrstnAcctoRltmMesureDnsty, getMinuDustFrcstDspth)
//   · 한국환경공단_에어코리아_측정소정보    (MsrstnInfoInqireSvc: getMsrstnList)
// 호출: GET …/functions/v1/air?lat=37.5735&lon=126.979
// 라이선스(공공누리 3유형: 출처표시·변경금지): 값은 받은 그대로(문자열 포함) 돌려주고 고치거나 섞지 않는다.
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = ["https://hsleedds.github.io"];
const AIR = "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/";
const STN = "https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList";
const SOURCE = "한국환경공단 에어코리아";
const NOTE = "실시간 자료는 측정소 사정이나 수신 상태에 따라 빠지거나 바뀔 수 있습니다.";
const RT_TTL_MIN = 30, FC_TTL_MIN = 180, LIST_TTL_H = 24;

function cors(origin: string | null) {
  const ok = origin && (ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (o: unknown, st: number, h: Record<string, string>, maxAge = 600) =>
  new Response(JSON.stringify(o), { status: st, headers: { ...h, "Content-Type": "application/json", "Cache-Control": st === 200 ? `public, max-age=${maxAge}` : "no-store" } });
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

// 공공데이터포털 JSON: response.header.resultCode, response.body.items (배열 또는 {item:[…]})
async function call(u: string) {
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  const t = await r.text();
  let j: any; try { j = JSON.parse(t); } catch { throw new Error("air_non_json"); }
  const hd = j?.response?.header; if (hd?.resultCode !== "00") throw new Error("air_" + (hd?.resultCode || "err"));
  const it = j.response.body?.items; const arr = Array.isArray(it) ? it : it?.item ? (Array.isArray(it.item) ? it.item : [it.item]) : [];
  return { items: arr as any[], total: +(j.response.body?.totalCount || 0) };
}

// 주소 → 예보 지역명(getMinuDustFrcstDspth 의 informGrade 에 쓰이는 이름)
const GG_NORTH = ["고양", "파주", "의정부", "양주", "동두천", "포천", "연천", "가평", "남양주", "구리"];
const GW_EAST = ["강릉", "동해", "속초", "삼척", "고성", "양양"];
function sidoOf(addr: string): string | null {
  const a = (addr || "").trim();
  const pairs: [RegExp, string][] = [[/^서울/, "서울"], [/^부산/, "부산"], [/^대구/, "대구"], [/^인천/, "인천"], [/^광주/, "광주"], [/^대전/, "대전"],
    [/^울산/, "울산"], [/^세종/, "세종"], [/^(충북|충청북)/, "충북"], [/^(충남|충청남)/, "충남"], [/^(전북|전라북)/, "전북"], [/^(전남|전라남)/, "전남"],
    [/^(경북|경상북)/, "경북"], [/^(경남|경상남)/, "경남"], [/^제주/, "제주"]];
  for (const [re, s] of pairs) if (re.test(a)) return s;
  if (/^경기/.test(a)) return GG_NORTH.some((c) => a.includes(c)) ? "경기북부" : "경기남부";
  if (/^강원/.test(a)) return GW_EAST.some((c) => a.includes(c)) ? "영동" : "영서";
  return null;
}
// dmX/dmY 중 어느 쪽이 위도인지 문서로 확정하지 못함 → 값 범위로 판별(한국: 위도 32–40, 경도 123–133)
function latLon(x: unknown, y: unknown): [number, number] | null {
  const a = +String(x ?? ""), b = +String(y ?? "");
  if (!isFinite(a) || !isFinite(b)) return null;
  if (a >= 32 && a <= 40 && b >= 123 && b <= 133) return [a, b];
  if (b >= 32 && b <= 40 && a >= 123 && a <= 133) return [b, a];
  return null;
}
function distKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371, D = Math.PI / 180, dLa = (lat2 - lat1) * D, dLo = (lon2 - lon1) * D;
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(lat1 * D) * Math.cos(lat2 * D) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

type Station = { station_name: string; addr: string | null; sido: string | null; lat: number; lon: number };
let memList: { at: number; list: Station[] } | null = null;

async function stations(db: ReturnType<typeof sb>, key: string): Promise<Station[]> {
  if (memList && Date.now() - memList.at < 3600e3) return memList.list;
  const { data } = await db.from("air_station").select("station_name,addr,sido,lat,lon,updated_at").limit(2000);
  const fresh = (data || []).length > 100 && (data || []).some((r: any) => Date.now() - Date.parse(r.updated_at) < LIST_TTL_H * 3600e3);
  if (fresh) { memList = { at: Date.now(), list: data as Station[] }; return memList.list; }
  try { // 하루 1번 측정소 목록 갱신
    const rows: any[] = []; let page = 1, total = 0;
    do {
      const r = await call(`${STN}?serviceKey=${encodeURIComponent(key)}&returnType=json&numOfRows=1000&pageNo=${page}`);
      total = r.total; rows.push(...r.items); page++;
    } while (rows.length < total && page <= 3);
    const now = new Date().toISOString();
    const up = rows.map((it) => { const ll = latLon(it.dmX, it.dmY); return ll && it.stationName ? { station_name: it.stationName, addr: it.addr ?? null, sido: sidoOf(it.addr), lat: ll[0], lon: ll[1], raw: it, updated_at: now } : null; }).filter(Boolean) as any[];
    if (up.length) { await db.from("air_station").upsert(up, { onConflict: "station_name" }); memList = { at: Date.now(), list: up }; return up; }
  } catch { /* 예전 목록이라도 사용 */ }
  return (data || []) as Station[];
}

const bad = (v: unknown) => v == null || String(v).trim() === "" || String(v).trim() === "-";

async function realtime(db: ReturnType<typeof sb>, key: string, name: string) {
  try {
    const { data: c } = await db.from("air_cache").select("body,fetched_at").eq("station_name", name).maybeSingle();
    if (c && Date.now() - Date.parse(c.fetched_at) < RT_TTL_MIN * 60e3) return c.body as any;
  } catch { /* ignore */ }
  // TODO 확인: ver 값에 따라 추가 항목(pm10Value24 등)이 달라짐. 1.0 = PM2.5 포함 기본 항목.
  const r = await call(`${AIR}getMsrstnAcctoRltmMesureDnsty?serviceKey=${encodeURIComponent(key)}&returnType=json&numOfRows=1&pageNo=1&stationName=${encodeURIComponent(name)}&dataTerm=DAILY&ver=1.0`);
  const body = r.items[0] || null;
  if (body) { try { await db.from("air_cache").upsert({ station_name: name, body, fetched_at: new Date().toISOString() }); } catch { /* ignore */ } }
  return body;
}

// 예보통보: informGrade = "서울 : 보통,제주 : 좋음,…" (지역별 등급, 문자열 그대로 사용)
async function forecast(db: ReturnType<typeof sb>, key: string) {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  try {
    const { data: c } = await db.from("air_forecast_cache").select("body,fetched_at").eq("k", today).maybeSingle();
    if (c && Date.now() - Date.parse(c.fetched_at) < FC_TTL_MIN * 60e3) return c.body as any;
  } catch { /* ignore */ }
  let items: any[] = [];
  for (const d of [today, new Date(Date.now() + 9 * 3600e3 - 86400e3).toISOString().slice(0, 10)]) { // 새벽엔 오늘 발표가 없을 수 있음
    items = (await call(`${AIR}getMinuDustFrcstDspth?serviceKey=${encodeURIComponent(key)}&returnType=json&numOfRows=100&pageNo=1&searchDate=${d}`)).items;
    if (items.length) break;
  }
  // (항목, 대상 날짜)별 가장 최근 발표만
  const best: Record<string, any> = {};
  for (const it of items) {
    const k = `${it.informCode}|${it.informData}`;
    if (!best[k] || String(it.dataTime) > String(best[k].dataTime)) best[k] = it;
  }
  const body = { searchDate: today, items: Object.values(best).map((it) => ({ informCode: it.informCode, informData: it.informData, informGrade: it.informGrade, informOverall: it.informOverall, informCause: it.informCause, dataTime: it.dataTime })) };
  try { await db.from("air_forecast_cache").upsert({ k: today, body, fetched_at: new Date().toISOString() }); } catch { /* ignore */ }
  return body;
}
function gradeFor(fc: any, region: string | null) {
  if (!fc || !region) return null;
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 9 * 3600e3 + 86400e3).toISOString().slice(0, 10);
  const out: Record<string, Record<string, string>> = { today: {}, tomorrow: {} }; let dataTime: string | null = null;
  for (const it of fc.items || []) {
    const slot = it.informData === today ? "today" : it.informData === tomorrow ? "tomorrow" : null; if (!slot) continue;
    for (const part of String(it.informGrade || "").split(",")) {
      const [k, v] = part.split(":").map((s) => s.trim());
      if (k === region && v) { out[slot][it.informCode] = v; if (!dataTime || String(it.dataTime) > dataTime) dataTime = String(it.dataTime); }
    }
  }
  return { region, today: out.today, tomorrow: out.tomorrow, dataTime };
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (!(await rateOk(req, "air", 120, 8000))) return json({ ok: false, error: "rate_limited" }, 429, h);
  const KEY = Deno.env.get("KMA_KEY");
  if (!KEY) return json({ ok: false, error: "not_configured" }, 500, h);
  const url = new URL(req.url), lat = +(url.searchParams.get("lat") || ""), lon = +(url.searchParams.get("lon") || "");
  if (!isFinite(lat) || !isFinite(lon) || lat < 32 || lat > 39.5 || lon < 124 || lon > 132) return json({ ok: false, error: "out_of_korea" }, 400, h);
  const db = sb();
  try {
    const list = await stations(db, KEY);
    if (!list.length) return json({ ok: false, error: "no_stations" }, 502, h);
    const near = list.map((s) => ({ s, d: distKm(lat, lon, s.lat, s.lon) })).sort((a, b) => a.d - b.d).slice(0, 3);
    type Pick = { s: Station; d: number; rt: any };
    let pick: Pick | null = null, partial: Pick | null = null;
    for (const n of near) { // 「-」(점검·통신 장애)이면 다음 측정소
      let rt: any = null; try { rt = await realtime(db, KEY, n.s.station_name); } catch { continue; }
      if (!rt) continue;
      if (!bad(rt.pm10Value) && !bad(rt.pm25Value)) { pick = { ...n, rt }; break; }
      if (!partial && (!bad(rt.pm10Value) || !bad(rt.pm25Value))) partial = { ...n, rt };
    }
    pick = pick || partial;
    let fc: any = null; try { fc = gradeFor(await forecast(db, KEY), (pick?.s ?? near[0].s).sido ?? sidoOf((pick?.s ?? near[0].s).addr || "")); } catch { /* 예보 실패는 조용히 */ }
    return json({
      ok: true,
      station: pick ? { name: pick.s.station_name, addr: pick.s.addr, distKm: Math.round(pick.d * 10) / 10 } : null,
      realtime: pick ? pick.rt : null, // 원본 항목 그대로(dataTime, pm10Value, pm25Value, o3Value, khaiValue, …Grade, …Flag)
      forecast: fc,                    // 등급 문자열 그대로(예: "보통")
      source: SOURCE, note: NOTE,
    }, 200, h);
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 502, h);
  }
});
