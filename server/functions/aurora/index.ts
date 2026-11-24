// Polychrome · 오로라 (Supabase Edge Function: aurora) — NOAA SWPC 프록시·캐시 + 오로라 지수 입력값 기록(cron)
// 배포: Edge Functions → Deploy a new function → Via Editor → 이름 "aurora" → 이 파일 붙여넣기 → Verify JWT OFF
// 비밀값: (조회는 없음) ADMIN_TOKEN — job=log(cron)만
// 호출: GET …/functions/v1/aurora?city=tromso         (tromso|reykjavik|rovaniemi|yellowknife|fairbanks)
//       GET …/functions/v1/aurora?lat=69.65&lon=18.96
//       GET …/functions/v1/aurora?lat=…&lon=…&map=1   (+ OVATION 지도 점 [경도(-180~180), 위도, 확률] 5% 이상)
//       POST …/functions/v1/aurora?job=log  (cron, x-cron-token) → aurora_log 에 5개 도시 현재 시각 기록
// 자료: NOAA SWPC (https://services.swpc.noaa.gov/) — 10분 캐시(fn_cache 'aurora:swpc')
//   · OVATION: /json/ovation_aurora_latest.json  coordinates = [경도 0–359, 위도, 확률%]
//   · Kp 예보: /products/noaa-planetary-k-index-forecast.json
//       2026-03-31경 형식 변경(SCN 26-21): 머리줄 배열 → 객체 배열. 둘 다 읽는다.
//   · 태양풍: /json/rtsw/rtsw_wind_1m.json, /json/rtsw/rtsw_mag_1m.json
//       (SCN 26-21: 2026-04-30경 products/solar-wind/*-2-hour.json 폐지 → rtsw 로 대체.
//        필드: proton_speed, proton_density, bz_gsm, bt, active, source, time_tag)
//       TODO 확인: rtsw 파일 이름·필드를 실제 응답으로 한 번 확인(공지문 기준으로 작성).
import { createClient } from "npm:@supabase/supabase-js@2";

const SWPC = "https://services.swpc.noaa.gov";
const URLS = {
  ovation: `${SWPC}/json/ovation_aurora_latest.json`,
  kp: `${SWPC}/products/noaa-planetary-k-index-forecast.json`,
  wind: `${SWPC}/json/rtsw/rtsw_wind_1m.json`,
  mag: `${SWPC}/json/rtsw/rtsw_mag_1m.json`,
};
const TTL_MIN = 10;
// SPEC 4.6 기본 오로라 도시
const CITIES: Record<string, { name: string; lat: number; lon: number; tz: string }> = {
  tromso: { name: "트롬쇠", lat: 69.6492, lon: 18.9553, tz: "Europe/Oslo" },
  reykjavik: { name: "레이캬비크", lat: 64.1466, lon: -21.9426, tz: "Atlantic/Reykjavik" },
  rovaniemi: { name: "로바니에미", lat: 66.5039, lon: 25.7294, tz: "Europe/Helsinki" },
  yellowknife: { name: "옐로나이프", lat: 62.4540, lon: -114.3718, tz: "America/Yellowknife" },
  fairbanks: { name: "페어뱅크스", lat: 64.8378, lon: -147.7164, tz: "America/Anchorage" },
};

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
const json = (o: unknown, st: number, h: Record<string, string>, maxAge = 300) =>
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

async function getJson(u: string, ms = 15000) {
  const r = await fetch(u, { signal: AbortSignal.timeout(ms), headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error(`swpc_${r.status}`);
  return await r.json();
}
const isoUtc = (s: unknown) => { // "2026-11-25 03:00:00" | "2026-11-25T03:00:00" | "…Z" → ISO
  if (s == null) return null; let t = String(s).trim().replace(" ", "T");
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(t)) t += "Z";
  const d = Date.parse(t); return isFinite(d) ? new Date(d).toISOString() : null;
};
const n = (x: unknown) => (x == null || x === "" ? null : (isFinite(+(x as number)) ? +(x as number) : null));
// 머리줄 배열([[이름…],[값…]…]) 또는 객체 배열 → 객체 배열
function rowsOf(j: any): Record<string, unknown>[] {
  if (!Array.isArray(j) || !j.length) return [];
  if (Array.isArray(j[0])) { const hd = j[0] as string[]; return j.slice(1).map((r: unknown[]) => Object.fromEntries(hd.map((k, i) => [k, r[i]]))); }
  return j as Record<string, unknown>[];
}

type Bundle = {
  fetchedAt: string;
  ovation: { observationTime: string | null; forecastTime: string | null; pts: Record<string, number> } | null;
  kp: { time: string; kp: number | null; observed: string | null; scale: string | null }[] | null;
  wind: { time: string | null; speed: number | null; density: number | null; bz: number | null; bt: number | null; source: string | null } | null;
};

async function fetchBundle(): Promise<Bundle> {
  const [ov, kp, wi, mg] = await Promise.allSettled([getJson(URLS.ovation, 25000), getJson(URLS.kp), getJson(URLS.wind), getJson(URLS.mag)]);
  const b: Bundle = { fetchedAt: new Date().toISOString(), ovation: null, kp: null, wind: null };
  if (ov.status === "fulfilled") {
    const pts: Record<string, number> = {};
    for (const c of (ov.value?.coordinates || []) as number[][]) if (c && c[2] > 0) pts[`${c[0]},${c[1]}`] = c[2];
    b.ovation = { observationTime: ov.value?.["Observation Time"] ?? null, forecastTime: ov.value?.["Forecast Time"] ?? null, pts };
  }
  if (kp.status === "fulfilled") {
    b.kp = rowsOf(kp.value).map((r) => ({ time: isoUtc(r.time_tag) || "", kp: n(r.kp), observed: r.observed == null ? null : String(r.observed), scale: r.noaa_scale == null ? null : String(r.noaa_scale) })).filter((r) => r.time);
  }
  const latest = (arr: Record<string, unknown>[], f: string) => {
    const ok = arr.filter((r) => n(r[f]) != null && r.active !== false).sort((a, c) => String(c.time_tag).localeCompare(String(a.time_tag)));
    return ok[0] || null;
  };
  const w = wi.status === "fulfilled" ? latest(rowsOf(wi.value), "proton_speed") : null;
  const m = mg.status === "fulfilled" ? latest(rowsOf(mg.value), "bz_gsm") : null;
  if (w || m) b.wind = { time: isoUtc(w?.time_tag ?? m?.time_tag), speed: n(w?.proton_speed), density: n(w?.proton_density), bz: n(m?.bz_gsm), bt: n(m?.bt), source: w?.source != null ? String(w.source) : null };
  return b;
}
async function bundle(db: ReturnType<typeof sb>): Promise<Bundle> {
  let old: Bundle | null = null;
  try {
    const { data } = await db.from("fn_cache").select("body,fetched_at").eq("k", "aurora:swpc").maybeSingle();
    if (data) { old = data.body as Bundle; if (Date.now() - Date.parse(data.fetched_at) < TTL_MIN * 60e3) return old; }
  } catch { /* ignore */ }
  const b = await fetchBundle();
  // 일부 실패하면 예전 값으로 채움(조용히)
  if (old) { b.ovation = b.ovation || old.ovation; b.kp = b.kp || old.kp; b.wind = b.wind || old.wind; }
  if (b.ovation || b.kp || b.wind) { try { await db.from("fn_cache").upsert({ k: "aurora:swpc", body: b, fetched_at: b.fetchedAt }); } catch { /* ignore */ } }
  return b;
}
function ovationAt(b: Bundle, lat: number, lon: number) {
  if (!b.ovation) return null;
  const lo = ((Math.round(lon) % 360) + 360) % 360, la = Math.round(lat);
  return b.ovation.pts[`${lo},${la}`] ?? 0;
}
function kpAt(b: Bundle, t: number) { // 3시간 구간(time_tag 시작)
  const k = (b.kp || []).filter((r) => r.kp != null && Date.parse(r.time) <= t && t < Date.parse(r.time) + 3 * 3600e3);
  return k.length ? k[k.length - 1].kp : null;
}

// ───────── 해·달 고도(간단식, 약 1° 정확도 — 정식 계산은 앱 sky-core) ─────────
const RAD = Math.PI / 180, E = RAD * 23.4397;
const days = (d: Date) => d.getTime() / 86400000 + 2440587.5 - 2451545;
const raDec = (l: number, b: number) => ({
  ra: Math.atan2(Math.sin(l) * Math.cos(E) - Math.tan(b) * Math.sin(E), Math.cos(l)),
  dec: Math.asin(Math.sin(b) * Math.cos(E) + Math.cos(b) * Math.sin(E) * Math.sin(l)),
});
function altAz(d: number, lat: number, lon: number, ra: number, dec: number) {
  const H = RAD * (280.16 + 360.9856235 * d) + RAD * lon - ra, phi = RAD * lat;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI; // 북=0
  return { alt, az };
}
function sunCoords(d: number) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return raDec(M + C + RAD * 102.9372 + Math.PI, 0);
}
function moonCoords(d: number) {
  const L = RAD * (218.316 + 13.176396 * d), M = RAD * (134.963 + 13.064993 * d), F = RAD * (93.272 + 13.229350 * d);
  const c = raDec(L + RAD * 6.289 * Math.sin(M), RAD * 5.128 * Math.sin(F));
  return { ...c, dist: 385001 - 20905 * Math.cos(M) };
}
function sunMoon(date: Date, lat: number, lon: number) {
  const d = days(date), s = sunCoords(d), m = moonCoords(d);
  const sp = altAz(d, lat, lon, s.ra, s.dec), mp = altAz(d, lat, lon, m.ra, m.dec);
  const mAlt = mp.alt - Math.asin(6378.14 / m.dist) * Math.cos(mp.alt); // 시차(지심→지표) 근사
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(149598000 * Math.sin(phi), m.dist - 149598000 * Math.cos(phi));
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return { sunAlt: r1(sp.alt / RAD), moonAlt: r1(mAlt / RAD), moonAz: r1(mp.az / RAD), moonIllum: Math.round(((1 + Math.cos(inc)) / 2) * 1000) / 1000 };
}

async function cloudsNow(lat: number, lon: number) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high&timezone=GMT`;
  const r = await fetch(u, { signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error("om_" + r.status);
  const c = (await r.json())?.current || {};
  return { total: n(c.cloud_cover), low: n(c.cloud_cover_low), mid: n(c.cloud_cover_mid), high: n(c.cloud_cover_high) };
}

async function jobLog(db: ReturnType<typeof sb>) {
  const b = await bundle(db);
  const hour = new Date(Math.floor(Date.now() / 3600e3) * 3600e3);
  const rows = await Promise.all(Object.entries(CITIES).map(async ([key, c]) => {
    let cl: Awaited<ReturnType<typeof cloudsNow>> | null = null; try { cl = await cloudsNow(c.lat, c.lon); } catch { /* null */ }
    const sm = sunMoon(new Date(hour.getTime() + 30 * 60e3), c.lat, c.lon); // 그 시간의 가운데
    const prob = ovationAt(b, c.lat, c.lon), kp = kpAt(b, hour.getTime());
    // 지수(score)는 앱 sky-core.auroraIndex 가 정식. 여기서는 입력값만 저장(나중에 같은 식으로 다시 계산 가능).
    return {
      city: key, hour: hour.toISOString(), prob, kp,
      cloud_low: cl?.low ?? null, cloud_mid: cl?.mid ?? null, cloud_high: cl?.high ?? null,
      sun_alt: sm.sunAlt, moon_alt: sm.moonAlt, moon_illum: sm.moonIllum, moon_az: sm.moonAz,
      score: null,
      parts: { cloudTotal: cl?.total ?? null, ovationTime: b.ovation?.forecastTime ?? null, wind: b.wind, impl: "inputs-only/server-v1" },
    };
  }));
  const { error } = await db.from("aurora_log").upsert(rows, { onConflict: "city,hour" });
  if (error) throw new Error("db_" + error.message.slice(0, 80));
  return { hour: hour.toISOString(), rows: rows.length };
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  const url = new URL(req.url), db = sb();
  if (url.searchParams.get("job") === "log") {
    if (!(await cronOk(req))) return json({ ok: false, error: "forbidden" }, 403, h);
    try { return json({ ok: true, job: "log", ...(await jobLog(db)) }, 200, h, 0); }
    catch (e) { return json({ ok: false, error: String((e as Error).message || e) }, 500, h); }
  }
  if (!(await rateOk(req, "aurora", 120, 8000))) return json({ ok: false, error: "rate_limited" }, 429, h);
  const ck = url.searchParams.get("city");
  let lat = +(url.searchParams.get("lat") || NaN), lon = +(url.searchParams.get("lon") || NaN), city: string | null = null;
  if (ck) { const c = CITIES[ck]; if (!c) return json({ ok: false, error: "unknown_city" }, 400, h); lat = c.lat; lon = c.lon; city = ck; }
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ ok: false, error: "bad_location" }, 400, h);
  try {
    const b = await bundle(db), now = Date.now();
    const kpNow = kpAt(b, now);
    const fc = (b.kp || []).filter((r) => Date.parse(r.time) >= now - 24 * 3600e3);
    const out: Record<string, unknown> = {
      ok: true, city, lat, lon,
      ovation: b.ovation ? { prob: ovationAt(b, lat, lon), observationTime: b.ovation.observationTime, forecastTime: b.ovation.forecastTime } : null,
      kp: { now: kpNow, forecast: fc },
      solarWind: b.wind,
      source: "NOAA SWPC", fetchedAt: b.fetchedAt,
    };
    if (url.searchParams.get("map") === "1" && b.ovation) {
      out.map = Object.entries(b.ovation.pts).filter(([, p]) => p >= 5).map(([k, p]) => {
        const [lo, la] = k.split(",").map(Number); return [lo > 180 ? lo - 360 : lo, la, p];
      });
    }
    return json(out, 200, h);
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 502, h);
  }
});
