// Polychrome · ASOS 시간 실측 수집 (Supabase Edge Function: observe) — cron 전용
// 배포: Edge Functions → Deploy a new function → Via Editor → 이름 "observe" → 이 파일 붙여넣기 → Verify JWT OFF
// 비밀값: KMA_KEY (공공데이터포털 '기상청_지상(종관, ASOS) 시간자료 조회서비스' 활용신청 필요), ADMIN_TOKEN
// 호출: …/functions/v1/observe?job=daily            → 어제(KST) 00–23시
//       …/functions/v1/observe?job=daily&date=20261120   → 그날
//       …/functions/v1/observe?job=daily&days=7         → 어제까지 7일(최대 10일, 빠진 날 채우기)
// 자료 제공 범위: 전날(D-1)까지. 「tm」 시각의 rn 은 그 시각까지 1시간 강수량.
// 저장: public.obs_asos (같은 지점·시각은 최신 값으로 덮어씀 — 실측은 정정될 수 있으므로)
import { createClient } from "npm:@supabase/supabase-js@2";

// 지점 — data/asos-stations.json 과 같음(한 파일 배포라 여기에도 넣음)
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

const ASOS = "https://apis.data.go.kr/1360000/AsosHourlyInfoService/getWthrDataList";
const BUDGET_MS = 130_000, CHUNK = 6;

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

const num = (x: unknown) => (x == null || String(x).trim() === "" ? null : (isFinite(+(x as number)) ? +(x as number) : null));
const kstDate = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3);
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

// 응답 항목 → obs_asos 행
// 필드(공공데이터포털 15057210 문서): tm, stnId, ta, rn, ws, wd, hm, vs(시정), dc10Tca(전운량), ss(일조), dsnw(적설), hr3Fhsc(3시간 신적설)
// 품질 플래그: 문서 표기는 rnQcflag/taQcflag…, 일부 응답은 rnQcflg 로 알려져 있어 둘 다 읽음.
// TODO 확인: 품질 플래그 값 의미(0 정상, 1 오류, 9 결측으로 알려짐). 비가 없는 시간에도 빈 값 + 9 로 오는지 첫 자료로 확인할 것
//   (응답의 rnFlags 에 플래그별 개수를 돌려줌). 지금 규칙: 1(오류) → 결측. 9 는 강수량·기온이 모두 비었을 때만 결측(관측 장애),
//   강수량만 비어 있으면 무강수 0 으로 본다.
// TODO 확인: vs 단위(10m 로 알려짐, 예시값 2300 → 23km). 저장은 m(×10).
// 돌풍: ASOS 시간자료에 없음 → wg = null.
const empty = (x: unknown) => x == null || String(x).trim() === "";
function toRow(it: any) {
  const m = String(it.tm || "").match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2})/); if (!m) return null;
  const stn = +it.stnId; if (!stn) return null;
  const flag = String(it.rnQcflg ?? it.rnQcflag ?? "").trim();
  const missing = flag === "1" || (flag === "9" && empty(it.rn) && empty(it.ta));
  const rn = missing ? null : (num(it.rn) ?? 0); // 빈 값 = 무강수
  const vs = num(it.vs);
  return {
    stn, obs_time: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:00:00+09:00`,
    rn, rn_missing: missing, t: num(it.ta), ws: num(it.ws), wg: null,
    vis: vs == null ? null : vs * 10, cloud_total: num(it.dc10Tca), sunshine: num(it.ss),
    snow: num(it.dsnw), rh: num(it.hm), raw: it,
  };
}

async function fetchStn(key: string, stn: number, from: string, to: string, rows: number) {
  const u = `${ASOS}?serviceKey=${encodeURIComponent(key)}&pageNo=1&numOfRows=${rows}&dataType=JSON&dataCd=ASOS&dateCd=HR` +
    `&startDt=${from}&startHh=00&endDt=${to}&endHh=23&stnIds=${stn}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  const t = await r.text();
  let j: any; try { j = JSON.parse(t); } catch { throw new Error("asos_non_json"); }
  const hd = j?.response?.header; if (hd?.resultCode !== "00") throw new Error("asos_" + (hd?.resultCode || "err"));
  const items = j.response.body?.items?.item; return (Array.isArray(items) ? items : items ? [items] : []) as any[];
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (!(await cronOk(req))) return json({ ok: false, error: "forbidden" }, 403, h);
  const KEY = Deno.env.get("KMA_KEY"); if (!KEY) return json({ ok: false, error: "not_configured" }, 500, h);
  const url = new URL(req.url), t0 = Date.now();
  const yest = kstDate(new Date(Date.now() - 86400e3));
  let to = ymd(yest), from = to;
  const dateQ = url.searchParams.get("date"), days = Math.min(10, Math.max(1, +(url.searchParams.get("days") || 1) || 1));
  if (dateQ && /^\d{8}$/.test(dateQ)) { if (dateQ > to) return json({ ok: false, error: "not_available_yet" }, 400, h); from = to = dateQ; }
  else if (days > 1) from = ymd(kstDate(new Date(Date.now() - days * 86400e3)));
  const nDays = Math.round((Date.parse(`${to.slice(0, 4)}-${to.slice(4, 6)}-${to.slice(6)}`) - Date.parse(`${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6)}`)) / 86400e3) + 1;
  const db = sb(); let rows = 0, missing = 0, done = 0; const errors: string[] = []; const rnFlags: Record<string, number> = {};
  for (let i = 0; i < STATIONS.length; i += CHUNK) {
    if (Date.now() - t0 > BUDGET_MS) break;
    await Promise.all(STATIONS.slice(i, i + CHUNK).map(async (s) => {
      try {
        const items = await fetchStn(KEY, s.stn, from, to, nDays * 24 + 5);
        for (const it of items) { const f = `${empty(it.rn) ? "빈값" : "값"}:${String(it.rnQcflg ?? it.rnQcflag ?? "")}`; rnFlags[f] = (rnFlags[f] || 0) + 1; }
        const out = items.map(toRow).filter((r) => r != null);
        missing += out.filter((r) => r!.rn_missing).length;
        if (out.length) {
          const { error } = await db.from("obs_asos").upsert(out, { onConflict: "stn,obs_time" });
          if (error) throw new Error("db_" + error.message.slice(0, 80));
        }
        rows += out.length;
      } catch (e) { errors.push(`${s.stn}:${(e as Error).message}`); }
    }));
    done = Math.min(STATIONS.length, i + CHUNK);
  }
  return json({ ok: true, from, to, stations: done, of: STATIONS.length, rows, rnMissing: missing, rnFlags, errors: errors.slice(0, 10), ms: Date.now() - t0 }, 200, h);
});
