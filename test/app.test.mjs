// 앱 순수 모듈 테스트: 형식·문구·상태·지역·아이콘. 아이콘 파일 재생성: node test/app.test.mjs --write-icons
const test = globalThis.test ?? (await import("./run.mjs")).test;
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as F from "../app/format.js";
import { interp, makeT } from "../app/i18n.js";
import { createStore, sanitize, defaults, safeStorage, langFrom } from "../app/state.js";
import { REGIONS_KR, searchRegions } from "../app/data/regions-kr.js";
import { ICONS, WEATHER_KEYS, icon, svgFile, phaseMoonInner } from "../app/icons.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ko = JSON.parse(readFileSync(join(root, "app/i18n/ko.json"), "utf8"));
const en = JSON.parse(readFileSync(join(root, "app/i18n/en.json"), "utf8"));

if (process.argv.includes("--write-icons")) for (const k of Object.keys(ICONS)) writeFileSync(join(root, "app/icons", k + ".svg"), svgFile(k));

test("app: 시간대 변환 왕복", () => {
  const d = new Date("2026-11-25T03:30:00Z");
  assert.equal(F.dateToLocal(d, "Asia/Seoul"), "2026-11-25T12:30");
  assert.equal(F.localToDate("2026-11-25T12:30", "Asia/Seoul").toISOString(), d.toISOString());
  assert.equal(F.localToDate("2026-07-01T12:00", "Europe/Oslo").toISOString(), "2026-07-01T10:00:00.000Z");
  assert.equal(F.dateToLocal(new Date("2026-11-25T03:30:00Z"), "America/Anchorage"), "2026-11-24T18:30");
});
test("app: 단위·표기", () => {
  assert.equal(F.temp(21.6, "metric"), "22°");
  assert.equal(F.temp(0, "imperial"), "32°");
  assert.equal(F.precip(2.34, "metric"), "2.3mm");
  assert.equal(F.precip(25.4, "imperial"), "1.0in");
  assert.equal(F.wind(5, "imperial"), "11 mph");
  assert.equal(F.hourLabel("2026-11-25T15:00", "ko"), "오후 3시");
  assert.equal(F.hourLabel("2026-11-25T00:00", "en"), "12 AM");
  assert.equal(F.dayLabel("2026-11-26", "2026-11-25", "ko"), "내일");
  assert.equal(F.weekdayName("2026-11-25", "ko"), "수");
  assert.equal(F.relTime("2026-11-26T09:00", "2026-11-25T20:00", "ko"), "내일 오전 9시");
  assert.equal(F.nowIndex(["2026-11-25T00:00", "2026-11-25T01:00", "2026-11-25T02:00"], "2026-11-25T01:42"), 1);
  assert.equal(F.compassKey(350), "N"); assert.equal(F.compassKey(225), "SW");
  assert.equal(F.condKey(63), "rain"); assert.equal(F.kpToG(7.3), 3);
});
test("app: 문구 끼워 넣기", () => {
  assert.equal(interp("{a}부터 비", { a: "오후 3시" }), "오후 3시부터 비");
  assert.equal(interp("{a}부터 비", {}, true), null);
  const t = makeT({ x: "{n}곳", "y_short": "짧게", y: "{v} 길게" }, { z: "보조" });
  assert.equal(t("x", { n: 3 }), "3곳"); assert.equal(t("z"), "보조"); assert.equal(t("없음"), "없음");
  assert.equal(t.strict("y", {}), "짧게"); assert.equal(t.strict("y", { v: 1 }), "1 길게");
});
test("app: 문구 사전 — 코드가 쓰는 키가 ko/en 모두에 있음", () => {
  const files = [...readdirSync(join(root, "app")).filter((f) => f.endsWith(".js")).map((f) => "app/" + f), ...readdirSync(join(root, "app/ui")).map((f) => "app/ui/" + f)];
  const keys = new Set();
  for (const f of files) for (const m of readFileSync(join(root, f), "utf8").matchAll(/\bt(?:\.strict|\.has)?\("([a-zA-Z][\w.]*[\w])"/g)) keys.add(m[1]);
  const skip = /^(en|ko|en-CA)$/;
  const miss = [...keys].filter((k) => !skip.test(k) && !(k in ko)).concat([...keys].filter((k) => !skip.test(k) && !(k in en)).map((k) => "en:" + k));
  assert.deepEqual(miss, []);
  for (const k of Object.keys(ko)) assert.ok(k in en, "en 없음: " + k);
  // 계약의 요약 키
  for (const k of ["extreme.cold", "extreme.hot", "rain.start", "rain.now", "rain.end", "rain.tomorrow", "rain.dayOfWeek", "air.bad", "air.verybad", "temp.warmer", "temp.colder", "calm.clear", "calm.cloudy"]) {
    assert.ok("summary." + k in ko && "summary." + k in en, k);
  }
  for (const r of ["weak", "cloud", "light", "moon", "great"]) assert.ok("aurora.reason." + r in ko);
  for (const p of ["new", "waxingCrescent", "firstQuarter", "waxingGibbous", "full", "waningGibbous", "lastQuarter", "waningCrescent"]) assert.ok("moon." + p in en);
});
test("app: 상태 기본값·검증·조작", () => {
  const d = defaults("ko-KR");
  assert.equal(d.cities.length, 1); assert.equal(d.cities[0].name_ko, "서울 종로구"); assert.equal(d.lang, "ko"); assert.equal(d.layout, "B");
  assert.equal(d.auroraCities.length, 5); assert.equal(langFrom("en-US"), "en"); assert.equal(defaults("en-US").units, "imperial");
  const bad = sanitize({ cities: [{ id: "x", lat: 999, lon: 0 }], layout: "Z", lang: "fr" }, "ko");
  assert.equal(bad.cities[0].id, d.cities[0].id); assert.equal(bad.layout, "B"); assert.equal(bad.lang, "ko");
  const mem = safeStorage(null);
  const s = createStore(mem, "ko-KR");
  const c = (i) => ({ id: "c" + i, name_ko: "도시" + i, lat: 35 + i, lon: 127, tz: "Asia/Seoul", country: "KR" });
  assert.equal(s.addCity(c(1)), "ok"); assert.equal(s.addCity(c(1)), "dup");
  for (let i = 2; i <= 4; i++) s.addCity(c(i));
  assert.equal(s.addCity(c(5)), "full");
  s.setMain("c3"); assert.equal(s.ordered()[0].id, "c3");
  s.removeCity("c3"); assert.notEqual(s.get().mainId, "c3");
  s.moveCity("c1", -1); assert.equal(s.get().cities[0].id, "c1");
  const s2 = createStore(mem, "ko-KR"); assert.equal(s2.get().cities.length, 4); // 저장 확인
});
test("app: 한국 시군구 목록", () => {
  assert.ok(REGIONS_KR.length >= 229, "개수 " + REGIONS_KR.length);
  for (const r of REGIONS_KR) assert.ok(r.lat > 33 && r.lat < 38.7 && r.lon > 124.5 && r.lon < 132, r.name_ko);
  assert.equal(REGIONS_KR.filter((r) => r.prov_ko === "서울").length, 25);
  assert.equal(searchRegions("종로")[0].name_ko, "서울 종로구");
  assert.equal(searchRegions("gangneung")[0].name_ko, "강원 강릉시");
  assert.ok(searchRegions("중구").length >= 6);
});
test("app: 아이콘", () => {
  for (const k of WEATHER_KEYS) { assert.ok(ICONS[k], k); assert.ok(readFileSync(join(root, "app/icons", k + ".svg"), "utf8").includes("<svg"), k + ".svg"); }
  for (const k of ["star", "plus", "settings", "camera", "cloud", "umbrella", "chevron"]) assert.ok(ICONS[k], k);
  assert.match(icon("rain", { label: "비" }), /aria-label="비"/);
  assert.match(phaseMoonInner(0.5), /moon-lit/); assert.doesNotMatch(phaseMoonInner(0), /moon-lit/);
  assert.match(icon("clear-night", { phase: 0.2 }), /moon-rim/);
});
