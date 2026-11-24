// weather-core 1.1.0 테스트: 1.0.2 호환(고정 사본 test/fixtures/weather-core-1.0.2.js 와 비교) + 시간대 + 새 함수
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// run.mjs가 실행 중이면 전역 test를 쓰고(순환 import 방지), 이 파일을 직접 실행하면 run.mjs를 불러 등록
const test = globalThis.test ?? (await import("./run.mjs")).test;

const here = dirname(fileURLToPath(import.meta.url));
// package.json의 "type"과 무관하게 IIFE 파일을 CommonJS처럼 불러온다 (모듈마다 별도 설정·캐시)
function load(p) {
  const src = readFileSync(p, "utf8"), module = { exports: {} };
  new Function("module", "exports", src)(module, module.exports);
  return module.exports;
}
const OLD = load(join(here, "fixtures/weather-core-1.0.2.js"));
const NEW = load(join(here, "../core/weather-core.js"));
const fresh = () => load(join(here, "../core/weather-core.js"));

/* ---------- 도구 ---------- */
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const clone = o => JSON.parse(JSON.stringify(o));
async function withClock(iso, fn) {
  const real = Date.now, t = Date.parse(iso);
  Date.now = () => t;
  try { return await fn(); } finally { Date.now = real; }
}
const res = (j, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => clone(j) });
const SYMS = ["clearsky_day", "fair_night", "partlycloudy_day", "cloudy", "fog", "lightrain", "rain", "heavyrain", "lightrainshowers_day",
  "heavysleet", "lightsnow", "snowshowers_polartwilight", "rainandthunder", "heavyrainshowers_night", "sleet", "unknownthing"];
// MET Norway locationforecast/2.0/complete 모양의 합성 응답 (앞 60시간 1시간 간격, 이후 6시간 간격, 끝 몇 개는 next_12_hours만)
function makeMet(startIso, seed = 1) {
  const r = rng(seed), t0 = Date.parse(startIso), ts = [];
  const push = (ms, kind) => {
    const i = ts.length, T = Math.round((8 + 7 * Math.sin(i / 4) + r() * 2) * 10) / 10, W = Math.round(r() * 120) / 10;
    const det = { air_temperature: T, wind_speed: W, relative_humidity: Math.round(60 + r() * 40) };
    if (r() > 0.2) det.wind_speed_of_gust = Math.round((W * (0.8 + r())) * 10) / 10; // 가끔 없음/바람보다 작음
    if (r() > 0.1) det.dew_point_temperature = Math.round((T - r() * 8) * 10) / 10;
    const mk = () => {
      const pa = r() < 0.6 ? 0 : Math.round(r() * 60) / 10, d = { precipitation_amount: pa };
      if (r() > 0.3) d.probability_of_precipitation = Math.round(r() * 100);
      return { summary: { symbol_code: SYMS[Math.floor(r() * SYMS.length)] }, details: d };
    };
    const data = { instant: { details: det } };
    if (kind === 1) { data.next_1_hours = mk(); data.next_6_hours = mk(); }
    else if (kind === 6) data.next_6_hours = mk();
    else data.next_12_hours = mk();
    ts.push({ time: new Date(ms).toISOString().replace(".000Z", "Z"), data });
  };
  let ms = t0;
  for (let i = 0; i < 60; i++, ms += 3600e3) push(ms, 1);
  for (; ms < t0 + 216 * 3600e3; ms += 6 * 3600e3) push(ms, 6);
  for (let k = 0; k < 3; k++, ms += 12 * 3600e3) push(ms, 12);
  return { type: "Feature", properties: { meta: {}, timeseries: ts } };
}
const near = (a, b, tolMin, msg) => {
  const m = s => +s.slice(11, 13) * 60 + +s.slice(14, 16);
  assert.ok(Math.abs(m(a) - m(b)) <= tolMin, `${msg}: ${a} vs ${b}`);
};

/* ================= 1. 1.0.2 호환 (tz 생략 = 결과 동일) ================= */
test("VERSION 1.1.0, 기존 export 전부 유지", () => {
  assert.equal(NEW.VERSION, "1.1.0");
  assert.equal(OLD.VERSION, "1.0.2");
  for (const k of Object.keys(OLD)) assert.ok(k in NEW, "missing " + k);
  for (const k of ["DOMESTIC", "GLOBAL", "SHOW_GLOBAL", "MET_SYM"]) assert.deepEqual(NEW[k], OLD[k]);
  assert.match(readFileSync(join(here, "../core/weather-core.js"), "utf8").split("\n")[0], /Polychrome Weather Core v1\.1\.0/);
});

test("호환: score/grade/windWord/extreme/extremeDay/isWet/fogLevel/WMO/metCode 무작위 5000건", () => {
  const r = rng(42), v = (a, b) => Math.round((a + r() * (b - a)) * 10) / 10, mayNull = x => (r() < 0.1 ? null : r() < 0.05 ? undefined : x);
  for (let n = 0; n < 5000; n++) {
    const args = [v(-20, 40), v(-25, 30), mayNull(Math.round(r() * 100)), v(0, 20), v(0, 40), mayNull(v(0, 30)), mayNull(v(-25, 40))];
    assert.equal(NEW.score(...args), OLD.score(...args));
    assert.equal(NEW.score(...args.slice(0, 6)), OLD.score(...args.slice(0, 6)));
    const s = Math.round(r() * 100);
    assert.deepEqual(NEW.grade(s), OLD.grade(s));
    const w = v(0, 15); assert.deepEqual(NEW.windWord(w), OLD.windWord(w));
    const T = mayNull(v(-20, 40)), A = mayNull(v(-25, 45));
    assert.deepEqual(NEW.extreme(T, A), OLD.extreme(T, A));
    assert.deepEqual(NEW.extremeDay(args[0], args[1]), OLD.extremeDay(args[0], args[1]));
    const P = mayNull(Math.round(r() * 100)), R = mayNull(v(0, 2));
    assert.equal(NEW.isWet(P, R), OLD.isWet(P, R));
    const km = r() < 0.05 ? NaN : v(0, 20), rh = v(50, 100);
    assert.equal(NEW.fogLevel(km, rh), OLD.fogLevel(km, rh));
    const c = Math.floor(r() * 100); assert.equal(NEW.WMO(c), OLD.WMO(c));
  }
  for (const s of [...SYMS, null, "", "lightssleetshowersandthunder_day", "heavysnowshowers_night"]) assert.equal(NEW.metCode(s), OLD.metCode(s));
});

test("호환: tips 무작위 3000건", () => {
  const r = rng(7), v = (a, b) => Math.round((a + r() * (b - a)) * 10) / 10;
  for (let n = 0; n < 3000; n++) {
    const a = [Math.floor(r() * 24), v(-20, 40), v(-25, 45), r() < 0.1 ? null : Math.round(r() * 100), v(0, 5), v(0, 15), v(0, 25), v(-25, 30)];
    assert.deepEqual(NEW.tips(...a), OLD.tips(...a));
  }
});

function makeHourly(seed, n = 48, start = "2026-11-25T00:00") {
  const r = rng(seed), t0 = Date.parse(start + ":00Z"), h = { time: [], temperature_2m: [], apparent_temperature: [], precipitation_probability: [], precipitation: [], wind_speed_10m: [], wind_gusts_10m: [], weather_code: [], relative_humidity_2m: [] };
  for (let i = 0; i < n; i++) {
    h.time.push(new Date(t0 + i * 3600e3).toISOString().slice(0, 16));
    h.temperature_2m.push(r() < 0.05 ? null : Math.round((r() * 40 - 10) * 10) / 10);
    h.apparent_temperature.push(r() < 0.2 ? null : Math.round((r() * 45 - 15) * 10) / 10);
    h.precipitation_probability.push(r() < 0.1 ? null : Math.round(r() * 100));
    h.precipitation.push(Math.round(r() * r() * 50) / 10);
    h.wind_speed_10m.push(Math.round(r() * 120) / 10);
    h.wind_gusts_10m.push(r() < 0.3 ? null : Math.round(r() * 200) / 10);
    h.weather_code.push([0, 1, 2, 3, 45, 61, 63, 71, 80, 95][Math.floor(r() * 10)]);
    h.relative_humidity_2m.push(Math.round(40 + r() * 60));
  }
  return h;
}
test("호환: winGrade 전 구간", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const h = makeHourly(seed);
    for (let i = -2; i < 52; i++) assert.deepEqual(NEW.winGrade(h, i), OLD.winGrade(h, i));
  }
  assert.equal(NEW.winGrade({}, 0), OLD.winGrade({}, 0));
});

test("호환: kmaOverlay (같은 입력 → 같은 결과·같은 변형)", () => {
  for (const seed of [11, 12, 13]) {
    const wx = { hourly: makeHourly(seed, 96), daily: { time: ["2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28"], temperature_2m_max: [1, 2, 3, 4], temperature_2m_min: [0, 0, 0, 0], precipitation_probability_max: [0, 0, 0, 0], precipitation_sum: [0, 0, 0, 0], wind_speed_10m_max: [0, 0, 0, 0], weather_code: [0, 0, 0, 0] } };
    const k = { hourly: makeHourly(seed + 100, 30, "2026-11-26T03:00") };
    const a = clone(wx), b = clone(wx);
    assert.equal(NEW.kmaOverlay(a, clone(k)), OLD.kmaOverlay(b, clone(k)));
    assert.deepEqual(a, b);
  }
  assert.equal(NEW.kmaOverlay(null, {}), OLD.kmaOverlay(null, {}));
});

test("호환: sunTimes 위도·경도·날짜 격자 (tz 생략 / 'Asia/Seoul' 명시)", () => {
  const dates = []; for (let m = 1; m <= 12; m++) for (const d of [1, 15, 28]) dates.push(`2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  dates.push("2024-02-29", "2027-06-21", "2026-12-21");
  let n = 0;
  for (let lat = -66; lat <= 72; lat += 6) for (let lon = -180; lon <= 180; lon += 30) for (const d of dates) {
    const o = OLD.sunTimes(lat, lon, d);
    assert.deepEqual(NEW.sunTimes(lat, lon, d), o);
    assert.deepEqual(NEW.sunTimes(lat, lon, d, "Asia/Seoul"), o);
    n++;
  }
  assert.ok(n > 5000);
  assert.deepEqual(NEW.sunTimes(37.5735, 126.979, "2026-11-25"), OLD.sunTimes(37.5735, 126.979, "2026-11-25"));
});

test("호환: metAsOM (모의 rawFetch + 고정 시계) 여러 시각·일수", async () => {
  for (const [clock, start, days, seed] of [
    ["2026-07-01T05:30:00Z", "2026-07-01T05:00:00Z", 7, 1],
    ["2026-11-24T16:10:00Z", "2026-11-24T16:00:00Z", 3, 2],   // KST 자정 직후
    ["2026-12-31T14:59:00Z", "2026-12-31T14:00:00Z", 10, 3],  // 연말 경계
    ["2026-03-01T20:00:00Z", "2026-03-01T18:00:00Z", 5, 4],
  ]) {
    const met = makeMet(start, seed), o = fresh(), urlsN = [], urlsO = [];
    const NEWm = fresh(), OLDm = load(join(here, "fixtures/weather-core-1.0.2.js"));
    NEWm.config({ rawFetch: async u => (urlsN.push(u), res(met)) });
    OLDm.config({ rawFetch: async u => (urlsO.push(u), res(met)) });
    o.config({ rawFetch: async () => res(met) });
    await withClock(clock, async () => {
      const a = await NEWm.metAsOM(37.5735, 126.979, days), b = await OLDm.metAsOM(37.5735, 126.979, days);
      assert.deepEqual(a, b);
      assert.deepEqual(await o.metAsOM(37.5735, 126.979, days, "Asia/Seoul"), b);
      assert.equal(a.timezone, "Asia/Seoul");
      assert.ok(a.hourly.time.length === days * 24);
    });
    assert.deepEqual(urlsN, urlsO);
  }
});

test("호환: omOrMet MET 대체 경로 (tz 생략)", async () => {
  const met = makeMet("2026-07-01T05:00:00Z", 9);
  const mk = m => m.config({ rawFetch: async () => res(met), fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  const n = fresh(), o = load(join(here, "fixtures/weather-core-1.0.2.js"));
  mk(n); mk(o);
  // Open-Meteo 실패 → 4초 대기 후 MET. 시계는 Date.now만 고정(타이머는 실제)
  await withClock("2026-07-01T05:30:00Z", async () => {
    const [a, b] = await Promise.all([n.omOrMet("https://api.open-meteo.com/v1/forecast?x", [[35.1, 129.0]], 3), o.omOrMet("https://api.open-meteo.com/v1/forecast?x", [[35.1, 129.0]], 3)]);
    assert.deepEqual(a, b);
  });
});

function modelFetch(met, log) {
  return async (url) => {
    log.push(url);
    if (url.includes("api.met.no")) return res(met);
    const m = (url.match(/models=([^&]+)/) || [])[1];
    if (["kma_kim", "kma_ldps", "ecmwf_ifs", "ukmo_seamless"].includes(m)) return { ok: false, status: 400, json: async () => ({}) };
    if (m === "jma_seamless") throw new Error("net");
    const r = rng(m.length * 31 + m.charCodeAt(0)), p = [];
    for (let i = 0; i < 168; i++) p.push(m === "kim_global" && i < 30 ? null : Math.round(r() * r() * 30) / 10);
    return res({ hourly: { time: [], precipitation: p } });
  };
}
test("호환: compareModels / metNorway (모의 fetch)", async () => {
  const met = makeMet("2026-07-01T05:00:00Z", 5);
  const n = fresh(), o = load(join(here, "fixtures/weather-core-1.0.2.js")), ln = [], lo = [];
  n.config({ fetch: modelFetch(met, ln) }); o.config({ fetch: modelFetch(met, lo) });
  const times = []; for (let i = 0; i < 72; i++) times.push(new Date(Date.parse("2026-07-01T00:00:00Z") + i * 3600e3).toISOString().slice(0, 13) + ":00");
  const a = await n.compareModels(37.5, 127, times), b = await o.compareModels(37.5, 127, times);
  assert.deepEqual(a, b);
  assert.deepEqual([...ln].sort(), [...lo].sort());
  assert.ok(ln.every(u => !u.includes("open-meteo") || u.includes("timezone=Asia%2FSeoul")));
  assert.deepEqual(await n.metNorway(37.5, 127, times), await o.metNorway(37.5, 127, times));
  assert.deepEqual(await n.metNorway(37.5, 127, times, "Asia/Seoul"), await o.metNorway(37.5, 127, times));
  assert.ok(a.glo.some(m => m.name === "노르웨이 기상청"));
});

/* ================= 2. 시간대 ================= */
test("tzOffsetMin: 서울 고정, 오슬로·앵커리지 여름/겨울, DST 전환 순간, 30·45분 시간대", () => {
  const off = (tz, iso) => NEW.tzOffsetMin(tz, Date.parse(iso));
  assert.equal(off("Asia/Seoul", "2026-07-01T00:00:00Z"), 540);
  assert.equal(off(undefined, "2026-01-01T00:00:00Z"), 540);
  assert.equal(off("Europe/Oslo", "2026-07-01T12:00:00Z"), 120);
  assert.equal(off("Europe/Oslo", "2026-01-15T12:00:00Z"), 60);
  assert.equal(off("Europe/Oslo", "2026-03-29T00:59:59Z"), 60);   // 02:59:59 CET
  assert.equal(off("Europe/Oslo", "2026-03-29T01:00:00Z"), 120);  // → 03:00 CEST
  assert.equal(off("Europe/Oslo", "2026-10-25T00:59:00Z"), 120);
  assert.equal(off("Europe/Oslo", "2026-10-25T01:00:00Z"), 60);
  assert.equal(off("America/Anchorage", "2026-07-01T12:00:00Z"), -480);
  assert.equal(off("America/Anchorage", "2026-12-01T12:00:00Z"), -540);
  assert.equal(off("America/Anchorage", "2026-03-08T10:59:00Z"), -540); // 01:59 AKST
  assert.equal(off("America/Anchorage", "2026-03-08T11:00:00Z"), -480); // 03:00 AKDT
  assert.equal(off("Asia/Kathmandu", "2026-07-01T00:00:00Z"), 345);
  assert.equal(off("Australia/Adelaide", "2026-01-10T00:00:00Z"), 630);
  assert.equal(off("Australia/Adelaide", "2026-07-10T00:00:00Z"), 570);
  assert.equal(off("UTC", "2026-07-10T00:00:00Z"), 0);
  assert.equal(off("Atlantic/Reykjavik", "2026-07-10T00:00:00Z"), 0);
  assert.equal(off("Pacific/Kiritimati", "2026-07-10T00:00:00Z"), 840);
  assert.equal(off("America/St_Johns", "2026-07-10T00:00:00Z"), -150);
  assert.equal(NEW.localIso("2026-03-29T01:30:00Z", "Europe/Oslo"), "2026-03-29T03:30");
  assert.equal(NEW.localIso("2026-03-29T00:30:00Z", "Europe/Oslo"), "2026-03-29T01:30");
  assert.equal(NEW.localIso(Date.parse("2026-12-31T23:30:00Z"), "Pacific/Auckland"), "2027-01-01T12:30");
  assert.throws(() => NEW.tzOffsetMin("Not/AZone", 0));
});

test("localNow: 고정 시계, 기본 서울, config({tz})", async () => {
  await withClock("2026-11-25T15:05:00Z", () => {
    assert.equal(NEW.localNow(), "2026-11-26T00:05");
    assert.equal(NEW.localNow("Asia/Seoul"), "2026-11-26T00:05");
    assert.equal(NEW.localNow("Europe/Oslo"), "2026-11-25T16:05");
    assert.equal(NEW.localNow("America/Anchorage"), "2026-11-25T06:05");
    const m = fresh(); m.config({ tz: "Europe/Oslo" });
    assert.equal(m.localNow(), "2026-11-25T16:05");
    m.config({ tz: () => "America/Anchorage" });
    assert.equal(m.localNow(), "2026-11-25T06:05");
  });
});

test("sunTimes: 오슬로·앵커리지·트롬쇠 여름/겨울 (실측 대비 ±4분)", () => {
  const chk = (lat, lon, d, tz, rise, set) => {
    const [a, b] = NEW.sunTimes(lat, lon, d, tz);
    assert.equal(a.slice(0, 10), d); assert.equal(b.slice(0, 10), d);
    near(a, d + "T" + rise, 4, `${tz} ${d} rise`); near(b, d + "T" + set, 4, `${tz} ${d} set`);
  };
  chk(59.9139, 10.7522, "2026-06-21", "Europe/Oslo", "03:54", "22:44");
  chk(59.9139, 10.7522, "2026-12-21", "Europe/Oslo", "09:18", "15:12");
  chk(61.2181, -149.9003, "2026-06-21", "America/Anchorage", "04:20", "23:42");
  chk(61.2181, -149.9003, "2026-12-21", "America/Anchorage", "10:14", "15:41");
  chk(37.5665, 126.978, "2026-06-21", "Asia/Seoul", "05:11", "19:57");
  // DST 직후·직전 같은 위치 하루 차이 → 약 1시간 점프
  const before = NEW.sunTimes(59.9139, 10.7522, "2026-03-28", "Europe/Oslo")[0], after = NEW.sunTimes(59.9139, 10.7522, "2026-03-29", "Europe/Oslo")[0];
  const mins = s => +s.slice(11, 13) * 60 + +s.slice(14, 16);
  assert.ok(mins(after) - mins(before) > 50 && mins(after) - mins(before) < 60);
  // 트롬쇠 극야: 1.0.2와 같은 방식("NaN:NaN")으로 표시
  assert.deepEqual(NEW.sunTimes(69.6492, 18.9553, "2026-12-21", "Europe/Oslo"), ["2026-12-21TNaN:NaN", "2026-12-21TNaN:NaN"]);
  // config({tz})가 기본값을 바꿈
  const m = fresh(); m.config({ tz: "Europe/Oslo" });
  assert.deepEqual(m.sunTimes(59.9139, 10.7522, "2026-06-21"), NEW.sunTimes(59.9139, 10.7522, "2026-06-21", "Europe/Oslo"));
});

test("metAsOM tz=Europe/Oslo: 현지 시각 격자·현재·일출일몰", async () => {
  const met = makeMet("2026-07-01T05:00:00Z", 21), m = fresh();
  m.config({ rawFetch: async () => res(met) });
  await withClock("2026-07-01T05:30:00Z", async () => {
    const a = await m.metAsOM(59.91, 10.75, 3, "Europe/Oslo");
    assert.equal(a.timezone, "Europe/Oslo");
    assert.equal(a.hourly.time[0], "2026-07-01T00:00");
    assert.equal(a.current.time, "2026-07-01T07:00");
    const ts = met.properties.timeseries;
    assert.equal(a.hourly.temperature_2m[7], ts[0].data.instant.details.air_temperature);
    assert.equal(a.hourly.temperature_2m[8], ts[1].data.instant.details.air_temperature);
    assert.equal(a.current.temperature_2m, ts[0].data.instant.details.air_temperature);
    assert.equal(a.hourly.temperature_2m[0], ts[0].data.instant.details.air_temperature); // 지난 시간 = 첫 값
    assert.deepEqual([a.daily.sunrise[0], a.daily.sunset[0]], m.sunTimes(59.91, 10.75, "2026-07-01", "Europe/Oslo"));
    assert.deepEqual(a.daily.time, ["2026-07-01", "2026-07-02", "2026-07-03"]);
    // 같은 응답의 서울 변환과는 9−2=7시간 차이
    const s = await m.metAsOM(59.91, 10.75, 3);
    assert.equal(s.hourly.temperature_2m[14], a.hourly.temperature_2m[7]);
  });
});

test("metAsOM tz=Europe/Oslo DST 종료일(25시간): 02시가 두 번 → 나중 값, 이후 정렬", async () => {
  const met = makeMet("2026-10-24T22:00:00Z", 33), m = fresh();
  m.config({ rawFetch: async () => res(met) });
  await withClock("2026-10-24T22:10:00Z", async () => {
    const a = await m.metAsOM(60.39, 5.32, 2, "Europe/Oslo");
    const ts = met.properties.timeseries, T = i => ts[i].data.instant.details.air_temperature, at = k => a.hourly.temperature_2m[a.hourly.time.indexOf(k)];
    assert.equal(a.current.time, "2026-10-25T00:00");  // 22:10Z = 00:10 CEST
    assert.equal(at("2026-10-25T00:00"), T(0));
    assert.equal(at("2026-10-25T01:00"), T(1));        // 23Z
    assert.equal(at("2026-10-25T02:00"), T(3));        // 00Z(CEST 02) 그리고 01Z(CET 02) → 나중 값
    assert.equal(at("2026-10-25T03:00"), T(4));        // 02Z
    assert.equal(at("2026-10-25T12:00"), T(13));       // 11Z
  });
});

test("metAsOM tz=America/Anchorage 봄 DST(23시간): 02시 없음 → 앞 값으로 채움", async () => {
  const met = makeMet("2026-03-08T08:00:00Z", 44), m = fresh();
  m.config({ rawFetch: async () => res(met) });
  await withClock("2026-03-08T09:15:00Z", async () => {
    const a = await m.metAsOM(61.22, -149.9, 2, "America/Anchorage");
    const ts = met.properties.timeseries, T = i => ts[i].data.instant.details.air_temperature, at = k => a.hourly.temperature_2m[a.hourly.time.indexOf(k)];
    assert.equal(a.current.time, "2026-03-08T00:00");  // 09:15Z = 00:15 AKST
    assert.equal(at("2026-03-08T01:00"), T(2));        // 10Z
    assert.equal(at("2026-03-08T02:00"), T(2));        // 존재하지 않는 시각 → 앞 값
    assert.equal(at("2026-03-08T03:00"), T(3));        // 11Z = 03:00 AKDT
    assert.equal(a.timezone, "America/Anchorage");
  });
});

test("compareModels/metNorway tz: Open-Meteo timezone 인자와 MET 현지 시각 키", async () => {
  const met = makeMet("2026-07-01T05:00:00Z", 5), log = [], m = fresh();
  m.config({ fetch: modelFetch(met, log) });
  const times = []; for (let i = 0; i < 72; i++) times.push(new Date(Date.parse("2026-07-01T00:00:00Z") + i * 3600e3).toISOString().slice(0, 13) + ":00");
  await m.compareModels(59.91, 10.75, times, "Europe/Oslo");
  assert.ok(log.filter(u => u.includes("open-meteo")).every(u => u.includes("timezone=Europe%2FOslo")));
  const o = await m.metNorway(59.91, 10.75, times, "Europe/Oslo"), s = await m.metNorway(59.91, 10.75, times);
  const ts = met.properties.timeseries;
  assert.equal(o.p[7], ts[0].data.next_1_hours.details.precipitation_amount);  // 05Z = 07:00 CEST
  assert.equal(s.p[14], ts[0].data.next_1_hours.details.precipitation_amount); // 05Z = 14:00 KST
  assert.deepEqual(o.p.slice(7, 40), s.p.slice(14, 47));
});

/* ================= 3. 새 함수 ================= */
test("omUrl: 변수 묶음, 시간대, 일수, 모델", () => {
  const u = NEW.omUrl({ lat: 59.91, lon: 10.75, tz: "Europe/Oslo" }), q = new URL(u).searchParams;
  assert.ok(u.startsWith("https://api.open-meteo.com/v1/forecast?"));
  assert.equal(q.get("timezone"), "Europe/Oslo");
  assert.equal(q.get("forecast_days"), "7");
  assert.equal(q.get("wind_speed_unit"), "ms");
  assert.equal(q.get("latitude"), "59.91");
  assert.equal(q.get("models"), null);
  for (const v of "temperature_2m,apparent_temperature,precipitation_probability,precipitation,rain,showers,snowfall,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,dew_point_2m,uv_index,is_day".split(","))
    assert.ok(q.get("hourly").split(",").includes(v), v);
  for (const v of "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset,uv_index_max".split(","))
    assert.ok(q.get("daily").split(",").includes(v), v);
  assert.ok(q.get("current").split(",").includes("is_day"));
  const v = new URL(NEW.omUrl({ lat: 1, lon: 2, days: 3, models: ["kma_ldps", "ecmwf_ifs025"] })).searchParams;
  assert.equal(v.get("timezone"), "Asia/Seoul");
  assert.equal(v.get("forecast_days"), "3");
  assert.equal(v.get("models"), "kma_ldps,ecmwf_ifs025");
  assert.equal(new URL(NEW.omUrl({ lat: 1, lon: 2, models: "icon_d2" })).searchParams.get("models"), "icon_d2");
});

test("rainOutlook", () => {
  const h = { time: ["t0", "t1", "t2", "t3", "t4", "t5"], precipitation_probability: [10, 60, 30, null, 20, 80], precipitation: [0, 0.2, 0.6, 1.1, 0, 0] };
  assert.deepEqual(NEW.rainOutlook(h, 0, 6), { wet: true, start: "t1", end: "t5", totalMm: 1.9, maxProb: 80, hoursWet: 4 });
  assert.deepEqual(NEW.rainOutlook(h, 0, 1), { wet: false, start: null, end: null, totalMm: 0, maxProb: 10, hoursWet: 0 });
  assert.deepEqual(NEW.rainOutlook(h, 2, 2), { wet: true, start: "t2", end: "t3", totalMm: 1.7, maxProb: 30, hoursWet: 2 });
  assert.deepEqual(NEW.rainOutlook(h, 4, 24), { wet: true, start: "t5", end: "t5", totalMm: 0, maxProb: 80, hoursWet: 1 });
  assert.deepEqual(NEW.rainOutlook({}, 0), { wet: false, start: null, end: null, totalMm: 0, maxProb: null, hoursWet: 0 });
});

const MODELS = [
  { id: "A", p: [0, 1, 2], pp: [10, 60, null] },
  { id: "B", p: [0, 0, 4] },
  { id: "C", p: [null, null, null] },
];
test("consensus: 같은 무게 (손 계산)", () => {
  const c = NEW.consensus(MODELS);
  assert.equal(c.n, 3);
  assert.deepEqual(c.prob, [0, 50, 100]);
  assert.deepEqual(c.mm, [0, 0.5, 3]);
  assert.deepEqual(c.mmLo, [0, 0, 2]);
  assert.deepEqual(c.mmHi, [0, 1, 4]);
  assert.deepEqual(c.agree, [1, 0.5, 1]);
  assert.deepEqual(c.members.map(m => m.wet), [[false, true, true], [false, false, true], [null, null, null]]);
});
test("consensus: 가중치와 치우침(bias) 보정 (손 계산)", () => {
  const c = NEW.consensus(MODELS, { A: { rain: 3, amount: 1, bias: 2 }, B: { rain: 1, amount: 3 } });
  assert.deepEqual(c.prob, [0, 75, 100]);
  assert.deepEqual(c.mm, [0, 0.13, 3.25]);    // h1: (0.5·1+0·3)/4 · h2: (1·1+4·3)/4
  assert.deepEqual(c.mmLo, [0, 0, 1]);
  assert.deepEqual(c.mmHi, [0, 0.5, 4]);      // h1: [0(w3),0.5(w1)] 누적 3/4 < 0.8 → 0.5
  assert.deepEqual(c.agree, [1, 0.5, 1]);     // 일치도는 기관 수 기준
  // 무게 0만 있으면 같은 무게로, bias≤0은 1로
  const z = NEW.consensus(MODELS, { A: { rain: 0, amount: 0, bias: 0 }, B: { rain: 0, amount: 0 } });
  assert.deepEqual(z.prob, [0, 50, 100]);
  assert.deepEqual(z.mm, [0, 0.5, 3]);
});
test("consensus: 5개 기관 분위수, 빈 입력", () => {
  const ms = [0, 1, 2, 3, 4].map((v, i) => ({ id: "m" + i, p: [v] }));
  const c = NEW.consensus(ms);
  assert.deepEqual([c.prob[0], c.mm[0], c.mmLo[0], c.mmHi[0], c.agree[0]], [80, 2, 0, 3, 0.8]);  // 0.5mm↑ 인 1·2·3·4 가 비
  const e = NEW.consensus([]);
  assert.deepEqual([e.prob, e.mm, e.n], [[], [], 0]);
  const pOnly = NEW.consensus([{ id: "x", pp: [70, 20] }]);
  assert.deepEqual([pOnly.prob, pOnly.mm], [[100, 0], [null, null]]);
});
test("consensusWindow", () => {
  const c = NEW.consensus(MODELS);
  assert.deepEqual(NEW.consensusWindow(c, 0, 3), { prob: 100, grade: "sure", mm: 3.5, mmLo: 2, mmHi: 5, start: 1, end: 2, startIdx: 1, endIdx: 2, agreeN: 2, n: 2 });
  const w = NEW.consensusWindow(c, 0, 2, ["10:00", "11:00", "12:00"]);
  assert.deepEqual(w, { prob: 50, grade: "likely", mm: 0.5, mmLo: 0, mmHi: 1, start: "11:00", end: "11:00", startIdx: 1, endIdx: 1, agreeN: 1, n: 2 });
  const cw = NEW.consensus(MODELS, { A: { rain: 3 }, B: { rain: 1 } });
  assert.equal(NEW.consensusWindow(cw, 0, 2).prob, 75);
  assert.equal(NEW.consensusWindow(cw, 0, 2).grade, "sure");
  const d = NEW.consensusWindow(c, 0, 1);
  assert.deepEqual([d.prob, d.grade, d.start, d.end, d.agreeN, d.n], [0, "low", null, null, 2, 2]);
  const lo = NEW.consensus([{ id: "a", p: [1] }, { id: "b", p: [0] }, { id: "c", p: [0] }]);
  assert.equal(NEW.consensusWindow(lo, 0, 1).grade, "low"); // 33%
  const li = NEW.consensus([{ id: "a", p: [1] }, { id: "b", p: [1] }, { id: "c", p: [0] }, { id: "d", p: [0] }, { id: "e", p: [0] }]);
  assert.equal(NEW.consensusWindow(li, 0, 1).grade, "likely"); // 40%
  c.time = ["a", "b", "c"];
  assert.equal(NEW.consensusWindow(c, 0, 3).start, "b");
});

test("airGrade 경계값", () => {
  const g = (a, b) => NEW.airGrade(a, b);
  assert.deepEqual(g(30, 15), { pm10: "good", pm25: "good", worst: "good" });
  assert.deepEqual(g(31, 16), { pm10: "moderate", pm25: "moderate", worst: "moderate" });
  assert.deepEqual(g(80, 35), { pm10: "moderate", pm25: "moderate", worst: "moderate" });
  assert.deepEqual(g(81, 36), { pm10: "bad", pm25: "bad", worst: "bad" });
  assert.deepEqual(g(150, 75), { pm10: "bad", pm25: "bad", worst: "bad" });
  assert.deepEqual(g(151, 76), { pm10: "verybad", pm25: "verybad", worst: "verybad" });
  assert.deepEqual(g(20, 40), { pm10: "good", pm25: "bad", worst: "bad" });
  assert.deepEqual(g(null, 10), { pm10: null, pm25: "good", worst: "good" });
  assert.deepEqual(g(null, undefined), { pm10: null, pm25: null, worst: null });
  assert.deepEqual(g("-", "45"), { pm10: null, pm25: "bad", worst: "bad" });
});

test("iconKey 표", () => {
  const T = [
    [[0, 1], "clear-day"], [[0, 0], "clear-night"], [[0, false], "clear-night"], [[1, 1], "partly-day"], [[2, 0], "partly-night"],
    [[3, 1], "cloudy"], [[45, 1], "fog"], [[48, 0], "fog"], [[51, 1], "drizzle"], [[55, 1], "drizzle"], [[57, 1], "drizzle"],
    [[61, 1], "rain"], [[63, 1], "rain"], [[63, 1, 5], "rain-heavy"], [[61, 1, 4.9], "rain"], [[65, 1], "rain-heavy"],
    [[66, 1], "sleet"], [[67, 1], "sleet"], [[68, 1], "sleet"], [[69, 1], "sleet"],
    [[71, 1], "snow"], [[75, 1], "snow"], [[77, 1], "snow"], [[80, 1], "showers-day"], [[81, 0], "showers-night"], [[82, 1], "showers-day"],
    [[85, 1], "snow"], [[86, 0], "snow"], [[95, 1], "thunder"], [[96, 0], "thunder"], [[99, 1], "thunder"],
    [[0, 1, 0, 14], "wind"], [[3, 0, 0, 20], "wind"], [[0, 1, 0, 13.9], "clear-day"], [[61, 1, 0, 20], "rain"],
    [[null, 1], "cloudy"], [[undefined, 0, 0, 20], "cloudy"], [[1, undefined], "partly-day"],
  ];
  for (const [a, want] of T) assert.equal(NEW.iconKey(...a), want, JSON.stringify(a));
});

/* summary: 오늘 00시부터 72시간, 7일 일별 */
function wxFixture({ now = "2026-11-25T09:00", temp = 10, feels = 9, rain = {}, daily = {} } = {}) {
  const t0 = Date.parse("2026-11-25T00:00:00Z"), H = { time: [], temperature_2m: [], apparent_temperature: [], precipitation_probability: [], precipitation: [], weather_code: [] };
  for (let i = 0; i < 72; i++) {
    const t = new Date(t0 + i * 3600e3).toISOString().slice(0, 16);
    H.time.push(t); H.temperature_2m.push(temp); H.apparent_temperature.push(feels);
    H.precipitation_probability.push(rain[t]?.[0] ?? 10); H.precipitation.push(rain[t]?.[1] ?? 0); H.weather_code.push(rain[t] ? 61 : 1);
  }
  const D = { time: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [], precipitation_sum: [], weather_code: [] };
  for (let d = 0; d < 7; d++) {
    D.time.push(new Date(t0 + d * 864e5).toISOString().slice(0, 10));
    D.temperature_2m_max.push(daily.tmax?.[d] ?? 12); D.temperature_2m_min.push(daily.tmin?.[d] ?? 4);
    D.precipitation_probability_max.push(daily.pp?.[d] ?? 20); D.precipitation_sum.push(daily.ps?.[d] ?? 0); D.weather_code.push(daily.code?.[d] ?? 1);
  }
  return { timezone: "Asia/Seoul", current: { time: now, temperature_2m: temp, apparent_temperature: feels }, hourly: H, daily: D };
}
test("summary 우선순위: 극한 → 비 → 미세먼지 → 기온 → 무난", () => {
  const air = { pm10: 40, pm25: 50 }, prevDay = { tmax: 5, tmin: 0 };
  // 극한이 비·미세먼지보다 먼저
  let s = NEW.summary(wxFixture({ temp: -5, feels: -12, rain: { "2026-11-25T09:00": [90, 3] } }), { air, prevDay });
  assert.deepEqual([s.kind, s.key], ["extreme", "extreme.cold"]);
  assert.equal(s.data.feels, -12);
  s = NEW.summary(wxFixture({ temp: 36, feels: 38 }));
  assert.equal(s.key, "extreme.hot");
  s = NEW.summary(wxFixture({ daily: { tmax: [-6], tmin: [-15] } }));  // 지금은 무난, 하루 최저가 한파
  assert.equal(s.key, "extreme.cold");
  // 비: 지금 오고 24시간 안에 그침
  s = NEW.summary(wxFixture({ rain: { "2026-11-25T09:00": [80, 1.2], "2026-11-25T10:00": [70, 0.8], "2026-11-25T11:00": [60, 0.3] } }), { air, prevDay });
  assert.deepEqual([s.kind, s.key, s.data.start, s.data.end, s.data.mm, s.data.prob], ["rain", "rain.end", "2026-11-25T09:00", "2026-11-25T11:00", 2.3, 80]);
  // 지금 오고 24시간 내내
  const allDay = {}; for (let i = 0; i < 30; i++) allDay[new Date(Date.parse("2026-11-25T08:00:00Z") + i * 3600e3).toISOString().slice(0, 16)] = [90, 1];
  s = NEW.summary(wxFixture({ rain: allDay }));
  assert.deepEqual([s.key, s.data.end, s.data.mm], ["rain.now", null, 24]);
  // 오늘 오후 시작 (now 사이 분 단위)
  s = NEW.summary(wxFixture({ now: "2026-11-25T09:40", rain: { "2026-11-25T15:00": [60, 0.4], "2026-11-25T16:00": [40, 2] } }));
  assert.deepEqual([s.key, s.data.start, s.data.end, s.data.mm], ["rain.start", "2026-11-25T15:00", "2026-11-25T16:00", 2.4]);
  // 내일 새벽 시작 (24시간 안)
  s = NEW.summary(wxFixture({ rain: { "2026-11-26T05:00": [70, 1] } }));
  assert.deepEqual([s.key, s.data.start], ["rain.tomorrow", "2026-11-26T05:00"]);
  // 24시간 밖, 일별 확률로 내일 / 요일
  s = NEW.summary(wxFixture({ daily: { pp: [20, 70, 20, 20], ps: [0, 6.5] } }));
  assert.deepEqual([s.key, s.data.date, s.data.prob, s.data.mm], ["rain.tomorrow", "2026-11-26", 70, 6.5]);
  s = NEW.summary(wxFixture({ daily: { pp: [20, 50, 20, 65], ps: [0, 0, 0, 3] } }), { air, prevDay });
  assert.deepEqual([s.key, s.data.date, s.data.dow], ["rain.dayOfWeek", "2026-11-28", 6]);
  // 미세먼지
  s = NEW.summary(wxFixture(), { air, prevDay });
  assert.deepEqual([s.kind, s.key, s.data.grade.pm25], ["air", "air.bad", "bad"]);
  s = NEW.summary(wxFixture(), { air: { pm10: 200 } });
  assert.equal(s.key, "air.verybad");
  // 기온 변화
  s = NEW.summary(wxFixture(), { air: { pm10: 40, pm25: 20 }, prevDay });
  assert.deepEqual([s.kind, s.key, s.data.diff, s.data.tmax, s.data.prevTmax], ["temp", "temp.warmer", 7, 12, 5]);
  s = NEW.summary(wxFixture(), { prevDay: { tmax: 15.5 } });
  assert.deepEqual([s.key, s.data.diff], ["temp.colder", -3.5]);
  s = NEW.summary(wxFixture(), { prevDay: { tmax: 10 } });
  assert.deepEqual([s.kind, s.key], ["calm", "calm.clear"]);
  s = NEW.summary(wxFixture({ daily: { code: [3] } }));
  assert.deepEqual([s.kind, s.key, s.data.code], ["calm", "calm.cloudy", 3]);
});
test("summary: now 생략 시 current.time, 그것도 없으면 localNow(timezone)", async () => {
  const wx = wxFixture({ rain: { "2026-11-25T20:00": [80, 1] } });
  assert.equal(NEW.summary(wx).key, "rain.start");
  delete wx.current;
  await withClock("2026-11-25T11:30:00Z", () => {           // KST 20:30 → 비 오는 중, 21시 그침
    const s = NEW.summary(wx);
    assert.deepEqual([s.key, s.data.end], ["rain.end", "2026-11-25T20:00"]);
  });
});
