// 겹치는 날짜 찾기(app/align-finder.js) 테스트: 띠 판정 규칙, 거친 탐색 = 1분 전수 탐색, 지형 가림, 실제 롯데월드타워 사례, 속도
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { alignBand, bandHit, createScan, findAlignWindows, skyState, groupDays, scanKey } from "../app/align-finder.js";
import { makeView, viewWindows, pathSegments } from "../app/silhouette-calc.js";
const test = globalThis.test ?? (await import("./run.mjs")).test;
const require = createRequire(import.meta.url);
const S = require("../core/sky-core.js");
const LC = require("../core/landmark-core.js");
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} got ${a}, want ${b} ±${tol}`);

// 합성 탑: 몸통 방위 199–201 / 고도 0–6, 첨탑 199.8–200.2 / 6–9. base 0°, top 9° → 띠 6°..14°
const TOWER = {
  bearingDeg: 200, base: { az: 200, alt: 0 }, top: { az: 200, alt: 9 },
  polygons: [[[199, 0], [201, 0], [201, 6], [199, 6]], [[199.8, 6], [200.2, 6], [200, 9]]],
};

test("align-finder: 띠 경계 (위쪽 1/3 ~ 꼭대기 위 5°)", () => {
  const B = alignBand(TOWER);
  near(B.lo, 6, 1e-9); near(B.hi, 14, 1e-9);
  // 위쪽 1/3 (alt ≥ 6) 부분의 방위 범위: 몸통 윗변(199–201) + 첨탑
  assert.deepEqual(B.upper.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)]), [[199, 201], [199.8, 200.2]]);
  const r = 0.25;
  assert.equal(bandHit(B, 200, 5.9, r), null, "띠 아래");
  assert.equal(bandHit(B, 200, 7, r), "upper", "첨탑 단면");
  // 고도 8.5° 에서 첨탑 단면은 아주 좁다(≈199.97–200.03) → 반지름까지만 허용
  assert.equal(bandHit(B, 200.25, 8.5, r), "upper");
  assert.equal(bandHit(B, 200.4, 8.5, r), null, "옆 하늘");
  // 꼭대기 위: 위쪽 1/3 범위(199–201) ± r
  assert.equal(bandHit(B, 201.2, 12, r), "above");
  assert.equal(bandHit(B, 201.3, 12, r), null);
  assert.equal(bandHit(B, 200, 14.1, r), null, "5° 넘음");
  assert.equal(bandHit(B, 560, 12, r), "above", "방위 360 감김");
});

test("align-finder: 합성 궤적 — 창·위치·최저 고도", () => {
  // 해가 방위 200° 로 고도 20° → 0° 수직 하강 (1분에 0.2°)
  const t0 = Date.UTC(2026, 0, 1);
  const pos = (d) => ({ az: 200, alt: 20 - (d.getTime() - t0) / 60e3 * 0.2, diamDeg: 0.5 });
  const { windows } = findAlignWindows({ sil: TOWER, pos, t0, t1: t0 + 120 * 60e3 });
  assert.equal(windows.length, 1);
  const w = windows[0];
  // 14° 이하(30분) ~ 6° 이상(70분)
  assert.equal((w.start - t0) / 60e3, 30); assert.equal((w.end - t0) / 60e3, 70);
  assert.equal(w.where, "both"); near(w.minAlt, 6, 1e-9); assert.equal(w.rising, false);
  assert.equal((w.mid - t0) / 60e3, 50);
  // 방위가 비켜 가면 없음
  const off = (d) => ({ ...pos(d), az: 202 });
  assert.equal(findAlignWindows({ sil: TOWER, pos: off, t0, t1: t0 + 120 * 60e3 }).windows.length, 0);
});

test("align-finder: 지형 지평선에 가리면 제외", () => {
  const t0 = Date.UTC(2026, 0, 1);
  const pos = (d) => ({ az: 200, alt: 20 - (d.getTime() - t0) / 60e3 * 0.2, diamDeg: 0.5 });
  const { windows } = findAlignWindows({ sil: TOWER, pos, t0, t1: t0 + 120 * 60e3, horizon: () => 10 });
  assert.equal(windows.length, 1);
  assert.equal((windows[0].end - t0) / 60e3, 50, "고도 10° 아래는 언덕 뒤");
});

// 1분 전수 탐색 (기준)
function brute(sil, pos, t0, t1) {
  const B = alignBand(sil), out = [];
  for (let t = t0; t <= t1; t += 60e3) { const p = pos(new Date(t)); if (p.alt > -1 && bandHit(B, p.az, p.alt, p.diamDeg / 2)) out.push(t); }
  return out;
}
const sunFn = (lat, lon) => (d) => { const s = S.sunPos(d, lat, lon); return { az: s.az, alt: s.altApparent, diamDeg: s.diamDeg }; };
const moonFn = (lat, lon, el) => (d) => { const m = S.moonPos(d, lat, lon, el); return { az: m.az, alt: m.altApparent, diamDeg: m.diamDeg }; };

test("align-finder: 거친 탐색 결과 = 1분 전수 탐색 (실제 해·달, 60일)", () => {
  const cases = [
    ["n-seoul-tower", 37.5497, 127.0310, 80, "moon", Date.UTC(2026, 10, 27, 15)],
    ["n-seoul-tower", 37.5497, 127.0310, 80, "sun", Date.UTC(2027, 2, 15, 15)],
    ["lotte-world-tower", 37.5197, 127.1176, 40, "sun", Date.UTC(2027, 0, 20, 15)],
    ["banpo-bridge", 37.5085, 126.9905, 7, "moon", Date.UTC(2026, 10, 27, 15)],
  ];
  for (const [id, lat, lon, g, body, t0] of cases) {
    const sil = LC.silhouette(LC.findLandmark(id), { lat, lon, groundM: g, eyeM: 1.6 }, { columns: 160 });
    const pos = body === "sun" ? sunFn(lat, lon) : moonFn(lat, lon, g + 1.6), t1 = t0 + 60 * 864e5;
    const ref = brute(sil, pos, t0, t1);
    const { windows } = findAlignWindows({ sil, pos, t0, t1, mergeGapMin: 1 });
    const got = [];
    const B = alignBand(sil);
    for (const w of windows) for (let t = w.start; t <= w.end; t += 60e3) { const p = pos(new Date(t)); if (bandHit(B, p.az, p.alt, p.diamDeg / 2)) got.push(t); }
    assert.ok(ref.length > 0, `${id} ${body}: 기준에 겹침 있음`);
    assert.deepEqual(got, ref, `${id} ${body}`);
  }
});

test("align-finder: 실제 — 롯데월드타워 / 몽촌토성, 해", () => {
  const lat = 37.5197, lon = 127.1176, g = 40;
  const sil = LC.silhouette(LC.findLandmark("lotte-world-tower"), { lat, lon, groundM: g, eyeM: 1.6 }, { columns: 160 });
  const B = alignBand(sil);
  near(B.lo, 12.5, 0.3); near(B.hi, 24.2, 0.3);
  const t0 = Date.UTC(2026, 10, 27, 15); // 2026-11-28 00:00 KST
  const T = performance.now();
  const { windows, stats } = findAlignWindows({ sil, pos: sunFn(lat, lon), t0, t1: t0 + 365 * 864e5 });
  const ms = performance.now() - T;
  const ymd = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
  const days = windows.map((w) => ymd(w.start));
  // 2026-11-28 16:31–16:55 해는 타워 「뒤」로 지나지만 고도 3–6.6° — 아래쪽(위쪽 1/3 = 12.5° 이상이 아님) → 목록에 없음
  assert.ok(!days.includes("2026-11-28"), "11-28 은 하단부 통과라 규칙 밖");
  const s = S.sunPos(new Date(Date.UTC(2026, 10, 28, 7, 40)), lat, lon);
  assert.equal(LC.occlusion(sil, { az: s.az, alt: s.altApparent, diamDeg: s.diamDeg }).state, "behind");
  assert.ok(s.altApparent < B.lo - 5);
  // 같은 방위(≈238°)에서 해가 12.5–24° 높이에 오는 2월 초·11월 초 오후에 겹침
  assert.ok(days.includes("2027-02-06") && days.some((d) => d.startsWith("2027-11-0")), days.join(","));
  for (const w of windows) assert.ok(w.end - w.start <= 30 * 60e3);
  console.log(`      (롯데월드타워 해 12개월: ${ms.toFixed(0)} ms, 계산 ${stats.evals}회, 창 ${windows.length}개)`);
});

test("align-finder: 속도 — 12개월 해+달 (Node)", () => {
  const lat = 37.5497, lon = 127.0310, g = 80;
  const sil = LC.silhouette(LC.findLandmark("n-seoul-tower"), { lat, lon, groundM: g, eyeM: 1.6 }, { columns: 160 });
  const t0 = Date.UTC(2026, 10, 27, 15), t1 = t0 + 365 * 864e5;
  const T = performance.now();
  const sc = createScan({ sil, pos: moonFn(lat, lon, g + 1.6), t0, t1 });
  let chunks = 0; while (!sc.step(8)) chunks++; // UI 처럼 8 ms 조각
  const ms = performance.now() - T;
  assert.equal(sc.progress(), 1);
  assert.ok(ms < 1500, "달 12개월 " + ms);
  console.log(`      (N서울타워 달 12개월: ${ms.toFixed(0)} ms, 조각 ${chunks + 1}개, 계산 ${sc.stats.evals}회)`);
});

test("align-finder: 하늘 상태·연속 날짜 묶기·캐시 키", () => {
  assert.equal(skyState(5), "day"); assert.equal(skyState(-5), "twilight"); assert.equal(skyState(-20), "night");
  const add = (ymd, n) => new Date(Date.parse(ymd + "T00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const g = groupDays([
    { ymd: "2027-02-03", body: "sun" }, { ymd: "2027-02-04", body: "sun" }, { ymd: "2027-02-06", body: "sun" },
    { ymd: "2027-02-07", body: "moon" }, { ymd: "2027-02-07", body: "moon" },
  ], add);
  assert.deepEqual(g.map((x) => x.length), [2, 1, 2]);
  assert.notEqual(scanKey({ id: "a", lat: 1, lon: 2, eye: 1.6, body: "sun", from: "x" }), scanKey({ id: "a", lat: 1, lon: 2, eye: 1.6, body: "moon", from: "x" }));
});

test("silhouette-calc: 화면 안 구간·궤적은 화면 안에서만", () => {
  const v = makeView({ azC: 100, azHalf: 5, altMin: 0 }); // 방위 95–105, 고도 0–7
  const s = []; for (let i = 0; i <= 60; i++) s.push({ t: i * 60e3, az: 90 + i * 0.5, alt: 3 });
  const w = viewWindows(s, v);
  assert.deepEqual(w.map((x) => [x.start / 60e3, x.end / 60e3]), [[10, 30]]);
  const segs = pathSegments(s, v, -2, { strict: true });
  assert.equal(segs.length, 1); assert.equal(segs[0].length, 21);
  assert.ok(pathSegments(s, v).flat().length > 21, "느슨한 기본값은 창 밖 5° 까지");
  assert.equal(viewWindows(s.map((x) => ({ ...x, alt: 9 })), v).length, 0);
});
