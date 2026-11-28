// SPEC 11 — own_forecast 스위치: off(기본)면 우리 판정·점수 없이 기관 예보·조건만, on이면 예전 화면
const test = globalThis.test ?? (await import("./run.mjs")).test;
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// 계산 모듈을 전역에 (브라우저와 같게)
if (!globalThis.WeatherCore) require("../core/weather-core.js");
if (!globalThis.SkyCore) globalThis.SkyCore = require("../core/sky-core.js");
// i18n.js는 fetch로 사전을 읽으므로 file: 주소만 디스크에서 읽어 줌
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  const s = String(u);
  if (s.startsWith("file:")) return { ok: true, json: async () => JSON.parse(readFileSync(fileURLToPath(s), "utf8")) };
  return realFetch(u, o);
};

const { DEFAULT_FLAGS } = await import("../app/config.js");
const { setFlags, ownForecast } = await import("../app/data.js");
const { setLang } = await import("../app/i18n.js");
const { buildVM, agencyCount, primarySrc } = await import("../app/ui/vm.js");
const { mainCardHTML, rainCardHTML, lightCardHTML, asPublishedNote } = await import("../app/ui/weather.js");
const { kpGaugeSVG, rawBarsSVG, kpColor, gaugeSVG } = await import("../app/ui/aurora.js");
const { rainbowCond } = await import("../app/ui/shoot.js");
const { localNow } = await import("../app/core.js");

const city = { id: "kr-11110", name_ko: "서울 종로구", name_en: "Jongno", lat: 37.5735, lon: 126.979, tz: "Asia/Seoul", country: "KR" };

/** 오늘 0시부터 72시간 가짜 예보: 지금+3~+6시간 비, 노을 무렵 높은 구름 55 · 중간 45 · 낮은 15 */
function fakeWx() {
  const now = localNow(city.tz), d0 = now.slice(0, 10);
  const base = Date.parse(d0 + "T00:00Z"), hNow = +now.slice(11, 13);
  const T = [], n = 72;
  for (let k = 0; k < n; k++) T.push(new Date(base + k * 36e5).toISOString().slice(0, 16));
  const wet = (k) => k >= hNow + 3 && k <= hNow + 6;
  const f = (fn) => T.map((_, k) => fn(k));
  const H = {
    time: T, temperature_2m: f(() => 5), apparent_temperature: f(() => 3), precipitation_probability: f((k) => (wet(k) ? 70 : 10)),
    precipitation: f((k) => (wet(k) ? 1.2 : 0)), weather_code: f((k) => (wet(k) ? 61 : 2)), cloud_cover: f(() => 60),
    cloud_cover_low: f(() => 15), cloud_cover_mid: f(() => 45), cloud_cover_high: f(() => 55), wind_speed_10m: f(() => 3),
    relative_humidity_2m: f(() => 60), is_day: f((k) => (k % 24 >= 7 && k % 24 < 18 ? 1 : 0)),
  };
  const days = [0, 1, 2].map((d) => T[d * 24].slice(0, 10));
  const D = {
    time: days, temperature_2m_max: [8, 8, 8], temperature_2m_min: [1, 1, 1], precipitation_sum: [4.8, 0, 0], precipitation_probability_max: [70, 10, 10],
    weather_code: [61, 2, 2], sunrise: days.map((x) => x + "T07:20"), sunset: days.map((x) => x + "T17:15"),
  };
  return { hourly: H, daily: D, current: { temperature_2m: 5, weather_code: 2, is_day: 1 } };
}
function fakeModels(wx) {
  const H = wx.hourly, mk = (scale) => H.precipitation.map((v) => v * scale);
  return { dom: [{ id: "kma_seamless", name: "한국 기상청 통합", p: mk(1), dom: 1 }], glo: [{ id: "ecmwf", name: "ECMWF", p: mk(0.5) }, { id: "gfs", name: "GFS", p: mk(0) }], time0: H.time[0] };
}

const VERDICT_KO = ["합의", "확실", "노을 가능성", "오로라 지수", "/ 10", "가능성 높음"];

test("own_forecast: 기본값 false", () => {
  assert.equal(DEFAULT_FLAGS.own_forecast, false);
  assert.equal(ownForecast(), false);
});

test("own_forecast off: 비·노을은 기관 예보와 조건만", async () => {
  await setLang("ko");
  setFlags({ own_forecast: false });
  const wx = fakeWx(), res = { wx, src: "om", kmaBase: "05:00", at: Date.now() };
  const vm = buildVM(city, res, null, fakeModels(wx));
  assert.equal(primarySrc(res), "kma");
  assert.deepEqual(agencyCount(vm.consModels, vm.i, 24), { n: 3, m: 2 });
  const main = mainCardHTML(vm, "metric"), rain = rainCardHTML(vm, "metric"), light = lightCardHTML(vm, "metric");
  assert.match(main, /24시간 최고 강수확률 70% \(기상청\)/);
  assert.match(main, /3곳 중 2곳 비 예상/);
  assert.match(rain, /기상청 예보 기준/);
  assert.match(rain, /3곳 중 2곳 비 예상/);
  assert.doesNotMatch(rain, /\d(mm)?–\d/, "강수량 범위 없음");
  assert.match(light, /노을 조건/);
  assert.match(light, /높은 구름 55% · 중간 45% · 낮은 15%/);
  assert.match(light, /\(Open-Meteo\)/);
  for (const w of VERDICT_KO) for (const h of [main, rain, light]) assert.ok(!h.includes(w), "판정 문구: " + w);
  assert.match(asPublishedNote(), /기관 예보를 그대로 정리해 보여 드려요/);
  // MET 대체일 때 출처
  const vm2 = buildVM(city, { wx, src: "met", kmaBase: null, at: Date.now() }, null, null);
  assert.match(mainCardHTML(vm2, "metric"), /\(MET Norway\)/);
});

test("own_forecast on: 예전 판정 화면 유지", async () => {
  await setLang("ko");
  setFlags({ own_forecast: true });
  try {
    const wx = fakeWx(), res = { wx, src: "om", kmaBase: null, at: Date.now() };
    const vm = buildVM(city, res, null, fakeModels(wx));
    assert.match(lightCardHTML(vm, "metric"), /노을 가능성/);
    assert.match(mainCardHTML(vm, "metric"), /24시간 비 \d+%/);
    assert.match(rainCardHTML(vm, "metric"), /기관 일치도/);
    assert.equal(asPublishedNote(), "");
    assert.match(gaugeSVG(7, "x"), /\/ 10/);
  } finally { setFlags({ own_forecast: false }); }
});

test("오로라·무지개: Kp 게이지와 조건만", async () => {
  await setLang("ko");
  const g = kpGaugeSVG(5.3, "NOAA Kp 5.3");
  assert.match(g, /NOAA Kp/); assert.match(g, />5\.3</); assert.doesNotMatch(g, /\/ 10/);
  assert.match(kpGaugeSVG(null, "x"), />–</);
  assert.notEqual(kpColor(1), kpColor(8.5));
  const d0 = Date.UTC(2026, 10, 28, 15);
  const hours = [0, 1, 2, 3].map((k) => ({ d: new Date(d0 + k * 36e5), local: `2026-11-28T${String(18 + k).padStart(2, "0")}:00`, sun: -8 - k * 5, moonAlt: 10 * k, moonIllum: 0.4, phase: 0.3, cloud: { low: 10, mid: 20, high: 30, total: 40 + k }, cloudKnown: true, score: 9, grade: "epic" }));
  const svg = rawBarsSVG({ hours, city: { lat: 69 }, cloudSrc: "om" });
  assert.match(svg, /구름 % \(Open-Meteo\)/); assert.match(svg, /sky-dk3/); assert.match(svg, /moon-curve/);
  assert.doesNotMatch(svg, /놓치면|\/10|score/);
  assert.match(rainbowCond(30), /해 고도 30° · 42° 미만 조건 충족/);
  assert.match(rainbowCond(50), /42° 이상/);
  assert.equal(rainbowCond(-3), "해가 지평선 아래");
});
