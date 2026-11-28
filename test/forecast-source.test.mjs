const test = globalThis.test ?? (await import("./run.mjs")).test;
// SPEC 12 — 사용자 선택 예보 출처: stitchBySource(core 1.2.0) · 출처 설정(sources.js) · 상태 저장 · pro_gate · 데이터 계층
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
if (!globalThis.WeatherCore) require("../core/weather-core.js");
// 다른 테스트 파일이 전역 WeatherCore를 새 사본으로 바꿀 수 있으므로 쓸 때마다 전역에서 읽음
const WCg = () => globalThis.WeatherCore;
const stitchBySource = (...a) => WCg().stitchBySource(...a);

// i18n.js는 fetch로 사전을 읽음 → file: 주소는 디스크에서 (다른 테스트와 같은 방식, 이미 감싸져 있으면 그대로)
if (!globalThis.__pcFileFetch) {
  const prev = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    const s = String(u);
    if (s.startsWith("file:")) return { ok: true, json: async () => JSON.parse(readFileSync(fileURLToPath(s), "utf8")) };
    return globalThis.__pcNetMock ? globalThis.__pcNetMock(s, o) : prev(u, o);
  };
  globalThis.__pcFileFetch = true;
}

const S = await import("../app/sources.js");
const { createStore, sanitize } = await import("../app/state.js");
const { DEFAULT_FLAGS } = await import("../app/config.js");
const data = await import("../app/data.js");
const { setLang } = await import("../app/i18n.js");
const { fsrcSectionHTML } = await import("../app/ui/settings.js");

/* ---------- 가짜 시간별 예보 ---------- */
const iso = (ms) => new Date(ms).toISOString().slice(0, 16);
function hours(startYmd, n, f) {
  const t0 = Date.parse(startYmd + "T00:00Z"), time = [], temp = [], pr = [], pp = [], code = [], cc = [];
  for (let k = 0; k < n; k++) {
    const t = iso(t0 + k * 36e5), v = f(t, k);
    time.push(t); temp.push(v?.t ?? null); pr.push(v ? v.p ?? 0 : null); pp.push(v ? v.pp ?? 10 : null); code.push(v ? v.c ?? 2 : null); cc.push(v ? v.cc ?? null : null);
  }
  return { time, temperature_2m: temp, precipitation: pr, precipitation_probability: pp, weather_code: code, cloud_cover: cc };
}
const NOW = "2026-11-28T14:37";
const full = (tv, extra = {}) => hours("2026-11-28", 24 * 7, () => ({ t: tv, ...extra }));
const tiers3 = (a, b, c) => [{ id: "now", toH: 6, sources: a }, { id: "short", toDay: 4, sources: b }, { id: "mid", sources: c }];
const at = (H, t) => H.time.indexOf(t);

test("stitch: 구간 경계 (지금~6시간 / 글피까지 / 4일째부터) 와 출처 표시", () => {
  const st = stitchBySource({ A: { hourly: full(1) }, B: { hourly: full(2) }, C: { hourly: full(3) } }, tiers3(["A"], ["B"], ["C"]), NOW);
  const H = st.hourly, src = (t) => H.src[at(H, t)];
  assert.equal(src("2026-11-28T00:00"), "A", "지난 시간은 첫 구간");
  assert.equal(src("2026-11-28T14:00"), "A");
  assert.equal(src("2026-11-28T19:00"), "A", "지금(14시)+5시간까지");
  assert.equal(src("2026-11-28T20:00"), "B", "+6시간부터 단기");
  assert.equal(src("2026-12-01T23:00"), "B", "글피 23시까지");
  assert.equal(src("2026-12-02T00:00"), "C", "4일째 0시부터");
  assert.equal(H.temperature_2m[at(H, "2026-12-02T00:00")], 3);
  assert.deepEqual(st.changes.map((c) => [H.time[c.i], c.src]), [["2026-11-28T20:00", "B"], ["2026-12-02T00:00", "C"]]);
  assert.deepEqual(st.sources, ["A", "B", "C"]);
  assert.equal(H.tier[at(H, "2026-11-29T00:00")], "short");
  // 날별: 시간 전용 구간(now)은 건너뜀 → 오늘~글피 B, 그 뒤 C (날별 값이 없으니 시간별로 계산)
  const D = st.daily;
  assert.deepEqual(D.time.slice(0, 5), ["2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
  assert.deepEqual(D.src, ["B", "B", "B", "B", "C", "C", "C"]);
  assert.equal(D.temperature_2m_max[0], 2); assert.equal(D.temperature_2m_max[4], 3);
  assert.ok(D.derived.every(Boolean));
});

test("stitch: 빈 시간은 다음 출처로, 실제 출처 이름으로 표시", () => {
  // A(초단기 같은)는 14~16시만, kma_vilage는 17시~ 글피, om은 전부
  const A = hours("2026-11-28", 24 * 7, (t) => (t >= "2026-11-28T14:00" && t <= "2026-11-28T16:00" ? { t: 1 } : null));
  const V = hours("2026-11-28", 24 * 7, (t) => (t >= "2026-11-28T17:00" && t < "2026-12-01T12:00" ? { t: 2 } : null));
  const tiers = S.resolveTiers({ preset: "kma-first" }, { kr: true });
  const st = stitchBySource({ om: { hourly: full(9) }, kma_ultra: { hourly: A }, kma_vilage: { hourly: V } }, tiers, NOW, { fill: "om", axis: "om" });
  const H = st.hourly, src = (t) => H.src[at(H, t)];
  assert.equal(src("2026-11-28T13:00"), "om", "지난 시간: 기상청 없음 → om");
  assert.equal(src("2026-11-28T15:00"), "kma_ultra");
  assert.equal(src("2026-11-28T18:00"), "kma_vilage", "초단기 빈 시간 → 단기 (이름도 단기)");
  assert.equal(H.temperature_2m[at(H, "2026-11-28T18:00")], 2);
  assert.equal(src("2026-12-01T12:00"), "om", "단기 끝 → om");
  assert.equal(src("2026-12-03T00:00"), "om");
  // 핵심 값은 채우지 않음, 보조 값(구름)은 fill에서
  const om2 = full(9, { cc: 77 });
  const st2 = stitchBySource({ om: { hourly: om2 }, kma_ultra: { hourly: A } }, tiers, NOW, { fill: "om", axis: "om" });
  const j = at(st2.hourly, "2026-11-28T15:00");
  assert.equal(st2.hourly.src[j], "kma_ultra");
  assert.equal(st2.hourly.cloud_cover[j], 77, "구름 층은 바탕(om)에서");
  assert.equal(st2.hourly.precipitation_probability[j], 10);
  const A2 = { ...A, precipitation_probability: A.precipitation_probability.map(() => null) };
  const st3 = stitchBySource({ om: { hourly: full(9, { pp: 80 }) }, kma_ultra: { hourly: A2 } }, tiers, NOW, { fill: "om", axis: "om" });
  assert.equal(st3.hourly.precipitation_probability[at(st3.hourly, "2026-11-28T15:00")], null, "강수확률은 다른 기관 값으로 채우지 않음");
});

test("stitch: 날별은 출처의 날별 값 → 없으면 시간별 계산 → 그래도 없으면 다음 출처", () => {
  const omD = { time: ["2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"], temperature_2m_max: [9, 9, 9, 9, 9, 9, 9], temperature_2m_min: [0, 0, 0, 0, 0, 0, 0], precipitation_sum: [0, 0, 0, 0, 0, 0, 0], sunrise: Array(7).fill("x") };
  // B는 29일만 하루 전체, 30일은 5시간뿐, 날별 값 없음
  const B = hours("2026-11-28", 24 * 7, (t) => (t.startsWith("2026-11-29") ? { t: t.endsWith("T12:00") ? 15 : 5, p: 1 } : t >= "2026-11-30T00:00" && t < "2026-11-30T05:00" ? { t: 4 } : null));
  const st = stitchBySource({ om: { hourly: full(9), daily: omD }, B: { hourly: B } }, tiers3(["B"], ["B"], ["om"]), NOW, { fill: "om", axis: "om" });
  const D = st.daily, d = (ymd) => D.time.indexOf(ymd);
  assert.equal(D.src[d("2026-11-29")], "B"); assert.equal(D.derived[d("2026-11-29")], true);
  assert.equal(D.temperature_2m_max[d("2026-11-29")], 15); assert.equal(D.temperature_2m_min[d("2026-11-29")], 5);
  assert.equal(D.precipitation_sum[d("2026-11-29")], 24);
  assert.equal(D.sunrise[d("2026-11-29")], "x", "보조 값(일출)은 바탕에서");
  assert.equal(D.src[d("2026-11-30")], "om", "5시간뿐(12시간 미만) → 다음 출처의 날별");
  assert.equal(D.derived[d("2026-11-30")], false);
  assert.equal(D.temperature_2m_max[d("2026-11-30")], 9);
  assert.equal(D.src[d("2026-12-03")], "om");
});

test("stitch: 빈 입력·구간 없음도 멈추지 않음", () => {
  const st = stitchBySource({}, [], NOW);
  assert.deepEqual(st.hourly.time, []); assert.deepEqual(st.sources, []);
  const st2 = stitchBySource({ om: full(3) }, null, NOW);
  assert.ok(st2.hourly.src.every((x) => x === "om"));
});

test("출처 설정: 한국은 기상청 우선(초단기→단기→Open-Meteo), 해외는 현지 기관 우선(Open-Meteo 자동)", () => {
  const kr = S.resolveTiers(null, { kr: true });
  assert.deepEqual(kr.map((t) => t.choice), ["kma_ultra", "kma_vilage", "om"]);
  assert.deepEqual(kr[0].sources, ["kma_ultra", "kma_vilage", "om"]);
  assert.deepEqual(kr[1].sources, ["kma_vilage", "kma_ultra", "om"]);
  const ab = S.resolveTiers(null, { kr: false });
  assert.deepEqual(ab.map((t) => t.choice), ["om", "om", "om"]);
  assert.deepEqual(S.resolveTiers(null, { kr: false, base: "met" }).map((t) => t.choice), ["met", "met", "met"]);
  // 해외 도시에서 직접 설정의 기상청 선택 → om
  const c = S.resolveTiers({ preset: "custom", tiers: { now: "kma_ultra", short: "ecmwf", mid: "gfs" } }, { kr: false });
  assert.deepEqual(c.map((t) => t.choice), ["om", "ecmwf", "gfs"]);
  assert.deepEqual(c[1].sources, ["ecmwf", "om"]);
  const one = S.resolveTiers({ preset: "one-model", model: "jma" }, { kr: true });
  assert.deepEqual(one.map((t) => t.choice), ["jma", "jma", "jma"]);
  assert.deepEqual(S.neededSources(one), { kma: false, models: ["jma"] });
  assert.deepEqual(S.neededSources(kr), { kma: true, models: [] });
  // 기상청 중기는 준비 중 → 저장 안 됨
  assert.equal(S.sanitizeFsrc({ preset: "custom", tiers: { mid: "kma_mid" } }).tiers.mid, "om");
  assert.equal(S.sanitizeFsrc({ preset: "nope", model: "zzz" }).preset, "kma-first");
  // 모델 id는 collect 함수(2026-11 확인) 값 먼저, compareModels 값 대체
  assert.deepEqual(S.MODELS.gfs, ["ncep_gfs_seamless", "gfs_seamless"]);
  for (const ids of Object.values(S.MODELS)) for (const id of ids) assert.match(id, /^[a-z0-9_]+$/);
});

test("kmaSeries: hourly.src로 초단기/단기를 나눔, 날별은 12시간 이상인 날만", () => {
  const time = [], src = [], tmp = [];
  for (let h = 3; h < 48; h++) { time.push(iso(Date.parse("2026-11-28T00:00Z") + h * 36e5)); src.push(h < 9 ? "ultra" : "vilage"); tmp.push(h < 9 ? 1 : 2); }
  const k = { ok: true, hourly: { time, src, temperature_2m: tmp, precipitation: time.map(() => 0), precipitation_probability: time.map((_, i) => (src[i] === "ultra" ? null : 20)) } };
  const s = S.kmaSeries(k);
  assert.ok(s.kma_ultra && s.kma_vilage);
  assert.equal(s.kma_ultra.hourly.temperature_2m.filter((v) => v != null).length, 6);
  assert.equal(s.kma_vilage.hourly.temperature_2m[0], null);
  assert.deepEqual(s.kma_vilage.daily.time, ["2026-11-28", "2026-11-29"]);
  assert.equal(s.kma_vilage.daily.temperature_2m_min[0], 1, "날별은 기상청 전체(초단기 포함)");
  assert.deepEqual(S.kmaSeries(null), {});
});

test("상태: 예보 출처 저장·복원·검증", () => {
  const mem = new Map(), st = { get: (k) => mem.get(k) ?? null, set: (k, v) => { mem.set(k, v); return true; }, remove: (k) => mem.delete(k), keys: () => [...mem.keys()] };
  const a = createStore(st, "ko-KR");
  assert.deepEqual(a.get().fsrc, { preset: "kma-first", model: "ecmwf", tiers: { now: "kma_ultra", short: "kma_vilage", mid: "om" } });
  a.setForecastSource({ preset: "custom" });
  a.setForecastSource({ tiers: { mid: "gfs" } });
  a.setForecastSource({ tiers: { now: "icon" } });
  a.setForecastSource({ model: "ukmo" });
  const b = createStore(st, "ko-KR");
  assert.deepEqual(b.get().fsrc, { preset: "custom", model: "ukmo", tiers: { now: "icon", short: "kma_vilage", mid: "gfs" } });
  b.setForecastSource({ tiers: { short: "bogus" } });
  assert.equal(b.get().fsrc.tiers.short, "kma_vilage");
  assert.deepEqual(sanitize({ fsrc: { preset: "one-model", model: 5 } }).fsrc.model, "ecmwf");
  assert.equal(sanitize({}).fsrc.preset, "kma-first");
});

test("pro_gate: 기본 off, 켜면 Pro 간편 선택은 잠기고 기상청 우선으로", async () => {
  assert.equal(DEFAULT_FLAGS.pro_gate, false);
  const f = { preset: "custom", tiers: { now: "ecmwf", short: "gfs", mid: "jma" } };
  assert.deepEqual(S.resolveTiers(f, { kr: true, gate: false }).map((t) => t.choice), ["ecmwf", "gfs", "jma"]);
  assert.deepEqual(S.resolveTiers(f, { kr: true, gate: true }).map((t) => t.choice), ["kma_ultra", "kma_vilage", "om"]);
  assert.deepEqual(S.resolveTiers({ preset: "one-model", model: "gem" }, { kr: false, gate: true }).map((t) => t.choice), ["om", "om", "om"]);
  assert.equal(S.isLocked("kma-first", true), false); assert.equal(S.isLocked("custom", true), true); assert.equal(S.isLocked("custom", false), false);
  await setLang("ko");
  const open = fsrcSectionHTML(f, false);
  assert.doesNotMatch(open, /pro-badge/);
  assert.match(open, /value="custom" checked/);
  assert.match(open, /지금~6시간/); assert.match(open, /6시간~3일/); assert.match(open, /4~10일/);
  assert.match(open, /<option value="kma_mid" disabled>기상청 중기 \(준비 중\)<\/option>/);
  assert.match(open, /기상청 초단기 \(한국만\)/);
  assert.match(open, /ECMWF · 유럽중기예보센터/);
  const locked = fsrcSectionHTML(f, true);
  assert.equal((locked.match(/pro-badge/g) || []).length, 2, "해외 모델 하나로·직접 설정 두 곳");
  assert.match(locked, /value="kma-first" checked/);
  assert.match(locked, /value="custom" disabled/);
  assert.match(locked, /value="one-model" disabled/);
  assert.doesNotMatch(locked, /<select/, "잠기면 선택 상자 없음");
  assert.match(locked, /직접 설정: Pro 기능이라 지금은 「기상청 우선」으로 보여 드려요/);
  await setLang("en");
  assert.match(fsrcSectionHTML(f, true), /Custom is a Pro feature/);
  await setLang("ko");
});

/* ---------- 데이터 계층: 가짜 네트워크로 getWeather ---------- */
function omMock(tz, temp) {
  const now = WCg().localNow(tz), d0 = now.slice(0, 10), t0 = Date.parse(d0 + "T00:00Z");
  const T = [...Array(24 * 7).keys()].map((k) => iso(t0 + k * 36e5));
  const H = { time: T, temperature_2m: T.map(() => temp), apparent_temperature: T.map(() => temp - 1), precipitation: T.map(() => 0), precipitation_probability: T.map(() => 5), weather_code: T.map(() => 2), cloud_cover_high: T.map(() => 33), is_day: T.map(() => 1), wind_speed_10m: T.map(() => 2) };
  const days = [...Array(7).keys()].map((d) => T[d * 24].slice(0, 10));
  const D = { time: days, temperature_2m_max: days.map(() => temp + 5), temperature_2m_min: days.map(() => temp - 5), precipitation_sum: days.map(() => 0), precipitation_probability_max: days.map(() => 5), weather_code: days.map(() => 2), sunrise: days.map((x) => x + "T07:00"), sunset: days.map((x) => x + "T17:00") };
  return { timezone: tz, current: { time: now.slice(0, 13) + ":00", temperature_2m: temp, weather_code: 2, is_day: 1 }, hourly: H, daily: D };
}
function kmaMock(tz) {
  const now = WCg().localNow(tz).slice(0, 13) + ":00", t0 = Date.parse(now + "Z");
  const time = [], src = [];
  for (let k = 0; k < 60; k++) { time.push(iso(t0 + k * 36e5)); src.push(k < 6 ? "ultra" : "vilage"); }
  return { ok: true, base: { vilage: { date: "20261128", time: "1100" }, ultra: { date: "20261128", time: "1430" } },
    hourly: { time, src, temperature_2m: src.map((s) => (s === "ultra" ? 1 : 2)), precipitation: time.map(() => 0), precipitation_probability: src.map((s) => (s === "ultra" ? null : 20)), weather_code: time.map(() => 1), wind_speed_10m: time.map(() => 1), relative_humidity_2m: time.map(() => 50) } };
}
const calls = [];
globalThis.__pcNetMock = async (u) => {
  calls.push(u);
  const url = new URL(u), q = url.searchParams;
  const ok = (j) => ({ ok: true, status: 200, json: async () => j });
  if (url.host === "api.open-meteo.com") {
    const m = q.get("models"), tz = q.get("timezone");
    if (!m) return ok(omMock(tz, 10));
    if (m === "ecmwf_ifs") return { ok: false, status: 400, json: async () => ({ error: true }) }; // 첫 id 실패 → 대체 id
    const temp = { ecmwf_ifs025: 20, ncep_gfs_seamless: 30, jma_seamless: 40 }[m];
    return temp != null ? ok(omMock(tz, temp)) : { ok: false, status: 400, json: async () => ({}) };
  }
  if (url.pathname.endsWith("/functions/v1/kma")) return ok(kmaMock("Asia/Seoul"));
  return { ok: false, status: 404, json: async () => null };
};

test("getWeather: 기상청 우선(한국) — 초단기 → 단기 → Open-Meteo, 지금 값과 배지 출처", async () => {
  WCg().config({ kma: () => true, sbUrl: () => "https://x.supabase.co", sbKey: () => "k" });
  try {
    data.setFlags({ kma: true, pro_gate: false });
    data.setSourcePref(null);
    const city = { id: "t-kr", lat: 37.11, lon: 127.11, tz: "Asia/Seoul", country: "KR" };
    const res = await data.getWeather(city, { force: true });
    const H = res.wx.hourly, i = H.time.indexOf(WCg().localNow("Asia/Seoul").slice(0, 13) + ":00");
    assert.ok(i >= 0);
    assert.equal(H.src[i], "kma_ultra"); assert.equal(H.temperature_2m[i], 1);
    assert.equal(H.src[i + 6], "kma_vilage"); assert.equal(H.temperature_2m[i + 6], 2);
    assert.equal(H.src[H.time.length - 1], "om");
    assert.equal(H.cloud_cover_high[i], 33, "구름 층은 Open-Meteo에서 채움");
    assert.equal(res.wx.current.temperature_2m, 1, "지금 값 = 지금 시간 출처(기상청 초단기)");
    assert.equal(res.kmaBase, "11:00"); assert.equal(res.kmaUltraBase, "14:30");
    assert.equal(res.wx.daily.src.at(-1), "om");
    const { sourceBadge, dailyHTML } = await import("../app/ui/weather.js");
    const { buildVM } = await import("../app/ui/vm.js");
    await setLang("ko");
    assert.match(sourceBadge(res), /기상청 초단기 14:30 발표/);
    const vm = buildVM(city, res, null, null);
    const dh = dailyHTML(vm, "metric", city.id);
    assert.match(dh, /class="dr-src"[^>]*>기상청</);
    assert.match(dh, /class="dr-src"[^>]*>Open-Meteo</);
  } finally { WCg().config({ kma: () => false }); }
});

test("getWeather: 직접 설정 — 필요한 모델만 요청, 모델 id 대체, 구분선 문구", async () => {
  WCg().config({ kma: () => true, sbUrl: () => "https://x.supabase.co", sbKey: () => "k" });
  try {
    data.setFlags({ kma: true, pro_gate: false });
    data.setSourcePref({ preset: "custom", tiers: { now: "ecmwf", short: "kma_vilage", mid: "gfs" } });
    calls.length = 0;
    const city = { id: "t-kr2", lat: 37.22, lon: 127.22, tz: "Asia/Seoul", country: "KR" };
    const res = await data.getWeather(city, { force: true });
    const models = calls.filter((u) => u.includes("open-meteo") && u.includes("models=")).map((u) => new URL(u).searchParams.get("models"));
    assert.deepEqual(models.sort(), ["ecmwf_ifs", "ecmwf_ifs025", "ncep_gfs_seamless"]);
    const H = res.wx.hourly, i = H.time.indexOf(WCg().localNow("Asia/Seoul").slice(0, 13) + ":00");
    assert.equal(H.src[i], "ecmwf"); assert.equal(H.temperature_2m[i], 20);
    assert.equal(H.src[i + 6], "kma_vilage", "단기 구간: 기상청 단기");
    assert.equal(H.src[H.time.length - 1], "gfs"); assert.equal(H.temperature_2m.at(-1), 30);
    // 화면: 시간별 구분선
    await setLang("ko");
    const { buildVM } = await import("../app/ui/vm.js");
    const { mainCardHTML, sourceBadge } = await import("../app/ui/weather.js");
    const vm = buildVM(city, res, null, null);
    assert.match(sourceBadge(res), />ECMWF</);
    assert.match(mainCardHTML(vm, "metric"), /출처: ECMWF → 기상청 단기/);
    assert.match(mainCardHTML(vm, "metric"), /src-chg/);
    // pro_gate 켜면 같은 설정이어도 기상청 우선
    data.setFlags({ pro_gate: true });
    assert.deepEqual(data.tiersFor(city).map((t) => t.choice), ["kma_ultra", "kma_vilage", "om"]);
    // 해외 도시: 기상청 요청 없음
    data.setFlags({ pro_gate: false });
    data.setSourcePref(null);
    calls.length = 0;
    const tok = { id: "t-jp", lat: 35.68, lon: 139.76, tz: "Asia/Tokyo", country: "JP" };
    const r2 = await data.getWeather(tok, { force: true });
    assert.ok(!calls.some((u) => u.includes("/kma")), "해외 도시는 기상청 요청 안 함");
    assert.ok(r2.wx.hourly.src.every((x) => x === "om"));
  } finally { data.setFlags({ pro_gate: false }); data.setSourcePref(null); WCg().config({ kma: () => false }); }
});

test("상세 시간별·비 카드: 출처가 바뀌는 곳에 「여기부터 …」 구분선과 출처", async () => {
  await setLang("ko");
  const { buildVM } = await import("../app/ui/vm.js");
  const city = { id: "t-x", lat: 37, lon: 127, tz: "Asia/Seoul", country: "KR" };
  const wx = omMock("Asia/Seoul", 10);
  const i = wx.hourly.time.indexOf(WCg().localNow("Asia/Seoul").slice(0, 13) + ":00");
  wx.hourly.src = wx.hourly.time.map((_, k) => (k < i + 3 ? "kma_ultra" : "ecmwf"));
  const vm = buildVM(city, { wx, src: "om", tz: "Asia/Seoul", at: Date.now() }, null, null);
  const { hourCols } = await import("../app/ui/detail.js");
  const hc = hourCols(vm, i, i + 24, "metric");
  assert.equal((hc.match(/class="src-div"/g) || []).length, 1);
  assert.match(hc, /role="separator" aria-label="여기부터 ECMWF"/);
  assert.ok(hc.indexOf("src-div") > hc.indexOf('data-src="kma_ultra"'), "구분선은 바뀌는 시간 앞");
  assert.match(hc, /출처: 기상청 초단기 → ECMWF/);
  const { rainCardHTML } = await import("../app/ui/weather.js");
  vm.r48 = { start: wx.hourly.time[i + 1], end: null, totalMm: 0, maxProb: 50, wet: true };
  assert.match(rainCardHTML(vm, "metric"), /기상청 초단기 → ECMWF 예보 기준/);
  assert.match(rainCardHTML(vm, "metric"), / chg"/);
  await setLang("en");
  assert.match(rainCardHTML(vm, "metric"), /KMA nowcast → ECMWF/);
  assert.match(hourCols(vm, i, i + 24, "metric"), /From here: ECMWF/);
  await setLang("ko");
});
