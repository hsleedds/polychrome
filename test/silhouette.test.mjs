// 실루엣 미리보기 순수 계산(app/silhouette-calc.js) 테스트: 투영 축척, 창 고르기, 궤적 표본, 겹침 구간, 달 위상 모양, 렌즈 화각
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  wrap180, unwrapAz, makeView, chooseWindow, samplePath, aboveSpan, envelopeAt, runs, overlapWindows, topBand,
  moonLitPath, phaseRotation, lensFov, hourTicks, pathSegments, worstState, horizonState,
} from "../app/silhouette-calc.js";
const test = globalThis.test ?? (await import("./run.mjs")).test;
const require = createRequire(import.meta.url);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} got ${a}, want ${b} ±${tol}`);

test("silhouette-calc: 방위 펼치기", () => {
  assert.equal(wrap180(190), -170); assert.equal(wrap180(-190), 170); assert.equal(wrap180(360), 0);
  assert.equal(unwrapAz(2, 359), 362); assert.equal(unwrapAz(358, 1), -2); assert.equal(unwrapAz(90, 80), 90);
});

test("silhouette-calc: 등각 투영 (가로·세로 같은 px/도)", () => {
  const v = makeView({ azC: 100, azHalf: 5, altMin: -1, W: 1000, H: 700 });
  assert.equal(v.k, 100);
  near(v.altMax, 6, 1e-9);
  assert.equal(v.x(95), 0); assert.equal(v.x(105), 1000); assert.equal(v.x(100), 500);
  near(v.y(6), 0, 1e-9); near(v.y(-1), 700, 1e-9);
  // 1° 가로 = 1° 세로
  near(v.x(101) - v.x(100), v.y(0) - v.y(1), 1e-9);
  // 0/360 건너기
  const w = makeView({ azC: 359, azHalf: 4, altMin: 0 });
  near(w.x(1), w.x(359) + 2 * w.k, 1e-9);
  assert.ok(w.inside(2, 1)); assert.ok(!w.inside(10, 1));
});

test("silhouette-calc: 창 고르기 — 맞춤은 구조물을 담고, 넓게는 ±60°", () => {
  const sil = { bearingDeg: 250, azRange: [249.8, 250.2], altRange: [-0.2, 4] };
  const f = chooseWindow(sil, { mode: "fit", aspect: 0.7 });
  const v = makeView({ ...f, W: 1000, H: 700 });
  assert.ok(v.altMin < -0.2 && v.altMax > 4, "높이 포함");
  assert.ok(f.azHalf >= 0.25 && f.azHalf < 10);
  // 초점 점(달)이 멀리 있으면 넓어짐
  const f2 = chooseWindow(sil, { mode: "fit", aspect: 0.7, focus: [{ az: 262, alt: 3, r: 0.5 }] });
  assert.ok(f2.azHalf >= 12.5);
  const wide = chooseWindow(sil, { mode: "wide", aspect: 0.7 });
  assert.equal(wide.azHalf, 60); assert.ok(wide.altMin < 0);
});

test("silhouette-calc: 궤적 표본·지평선 위 구간·연속 구간", () => {
  const t0 = Date.UTC(2026, 0, 1);
  const s = samplePath((d) => ({ az: 0, alt: (d.getTime() - t0) / 60e3 - 5 }), t0, t0 + 10 * 60e3, 1);
  assert.equal(s.length, 11);
  assert.equal(s[0].t, t0);
  assert.deepEqual(aboveSpan(s, -2), [t0 + 4 * 60e3, t0 + 10 * 60e3]);
  assert.equal(aboveSpan(s, 100), null);
  const r = runs(s, (x) => x.alt === -5 || x.alt === -4 || x.alt >= 3);
  assert.deepEqual(r.map((w) => [(w.start - t0) / 60e3, (w.end - t0) / 60e3]), [[0, 1], [8, 10]]);
});

test("silhouette-calc: envelope 보간", () => {
  const env = [[10, 1], [11, 3], [12, null], [13, 2]];
  assert.equal(envelopeAt(env, 10.5), 2);
  assert.equal(envelopeAt(env, 9), null);
  assert.equal(envelopeAt(env, 11.5), 3);
});

test("silhouette-calc: 꼭대기 통과 구간 찾기 (합성 궤적)", () => {
  // 구조물: 방위 199.5–200.5, 꼭대기 고도 5°. 달이 1분에 0.25° 씩 고도 5° 를 지나며 방위 199→201 이동
  const sil = { bearingDeg: 200, azRange: [199.5, 200.5], top: { az: 200, alt: 5 }, envelope: [[199.5, 5], [200.5, 5]] };
  const t0 = 0, samples = [];
  for (let i = 0; i <= 40; i++) samples.push({ t: t0 + i * 60e3, az: 199 + i * 0.05, alt: 5, diamDeg: 0.5 });
  const { windows, closest } = overlapWindows(sil, samples);
  assert.equal(windows.length, 1);
  // 방위 199.25(=199.5−r)부터 200.75 까지 → i=5..35
  assert.equal(windows[0].start, 5 * 60e3); assert.equal(windows[0].end, 35 * 60e3);
  assert.equal(closest.t, 20 * 60e3); near(closest.dist, 0, 1e-9);
  // 고도가 멀면 겹침 없음, 가장 가까운 때와 방위 차
  const far = samples.map((s) => ({ ...s, alt: 9, az: s.az + 3 }));
  const r2 = overlapWindows(sil, far);
  assert.equal(r2.windows.length, 0);
  assert.ok(r2.closest && r2.closest.t === 0); near(Math.abs(r2.closest.dAz), 2, 1e-9);
  // 지평선 아래는 무시
  assert.equal(overlapWindows(sil, samples.map((s) => ({ ...s, alt: -3 }))).closest, null);
});

test("silhouette-calc: 실제 달 + 랜드마크 겹침 (N서울타워, 각 계산 일관성)", () => {
  const S = require("../core/sky-core.js");
  const LC = require("../core/landmark-core.js");
  // 2026-11-24(보름 무렵) 하루 달 궤적: 타워 뒤로 달이 지나는 관측점을 역산 — 달이 고도 ≈ 타워 꼭대기일 때의 방위 반대쪽으로 3 km
  const t0 = Date.UTC(2026, 10, 23, 15); // 11-24 00:00 KST
  const lm = LC.findLandmark("n-seoul-tower");
  const pre = samplePath((d) => { const m = S.moonPos(d, lm.lat, lm.lon); return { az: m.az, alt: m.altApparent, diamDeg: m.diamDeg }; }, t0, t0 + 864e5, 10);
  // 지는 달(아침, 서쪽) 중 고도 ≈ 9° 표본
  const pick = pre.find((s) => s.alt > 8 && s.alt < 10.5 && s.az > 180); // 3 km 에서 꼭대기(해발 480 m) 고도 ≈ 9°
  assert.ok(pick, "아침 서쪽 달");
  const obs = S.destination(lm.lat, lm.lon, (pick.az + 180) % 360, 3);
  const sil = LC.silhouette(lm, { lat: obs.lat, lon: obs.lon, groundM: 0, eyeM: 1.6 }, { columns: 120 });
  const samples = samplePath((d) => { const m = S.moonPos(d, obs.lat, obs.lon); return { az: m.az, alt: m.altApparent, diamDeg: m.diamDeg }; }, t0, t0 + 864e5, 1);
  const { closest } = overlapWindows(sil, samples);
  assert.ok(closest && closest.dist < 1, "가장 가까운 각거리 작음: " + (closest && closest.dist));
});

test("silhouette-calc: 달 위상 모양 path", () => {
  assert.equal(moonLitPath(10, 0), "");
  assert.match(moonLitPath(10, 1), /^M-10 0A10 10 0 1 1 10 0A10 10 0 1 1 -10 0Z$/);
  // 반달: 경계 타원 가로 반지름 ≈ 0
  assert.match(moonLitPath(10, 0.5), /^M0 -10A10 10 0 0 1 0 10A0\.001 10 0 0 0 0 -10Z$/);
  // 초승(25%): 경계가 밝은 쪽(오른쪽)으로 부풂 → sweep 0, 가로 반지름 5
  assert.equal(moonLitPath(10, 0.25), "M0 -10A10 10 0 0 1 0 10A5 10 0 0 0 0 -10Z");
  // 볼록(75%): 어두운 쪽으로 → sweep 1
  assert.equal(moonLitPath(10, 0.75), "M0 -10A10 10 0 0 1 0 10A5 10 0 0 1 0 -10Z");
});

test("silhouette-calc: 밝은 가장자리 회전", () => {
  // θ = 270 (서쪽 해, 저녁 초승달) → 오른쪽(0°)
  near(phaseRotation(270, 0), 0, 1e-9);
  // θ = 0 → 위(−90°), θ = 90 → 왼쪽(180°), θ = 180 → 아래(90°)
  near(phaseRotation(0, 0), -90, 1e-9);
  near(Math.abs(phaseRotation(90, 0)), 180, 1e-9);
  near(phaseRotation(180, 0), 90, 1e-9);
  // 시차각을 빼서 천정 기준
  near(phaseRotation(300, 30), 0, 1e-9);
});

test("silhouette-calc: 렌즈 화각 (풀프레임)", () => {
  const f50 = lensFov(50);
  near(f50.h, 39.6, 0.1); near(f50.v, 27.0, 0.1);
  near(lensFov(24).h, 73.7, 0.1);
  near(lensFov(800).h, 2.58, 0.01);
});

test("silhouette-calc: 정시 눈금·화면 구간·가림 합치기", () => {
  const t0 = 0, s = [];
  for (let i = 0; i <= 180; i++) s.push({ t: t0 + i * 60e3, az: 90 + i * 0.5, alt: i < 30 ? -5 : 10 });
  const ticks = hourTicks(s, (t) => (t / 60e3 + 30) % 1440);
  assert.deepEqual(ticks.map((x) => x.hour), [1, 2, 3]); // i=30, 90, 150
  const v = makeView({ azC: 120, azHalf: 30, altMin: -5 });
  const segs = pathSegments(s, v);
  assert.equal(segs.length, 1);
  assert.ok(segs[0].length > 10);
  assert.equal(worstState("clear", "partial"), "partial");
  assert.equal(worstState("behind", "partial", null), "behind");
  assert.equal(horizonState(1, 0.25, 2), "behind");
  assert.equal(horizonState(2.1, 0.25, 2), "partial");
  assert.equal(horizonState(3, 0.25, 2), "clear");
  assert.equal(horizonState(3, 0.25, null), "clear");
});

test("silhouette-calc: 탑 — 비스듬한 옆면을 지날 때는 「꼭대기 통과」가 아님", () => {
  // 탑: 방위 199–201, 윗선은 가운데 200° 에서 10°, 가장자리에서 2° (뾰족)
  const env = []; for (let i = 0; i <= 40; i++) { const az = 199 + i * 0.05; env.push([az, 10 - 8 * Math.abs(az - 200)]); }
  const sil = { bearingDeg: 200, azRange: [199, 201], top: { az: 200, alt: 10 }, envelope: env };
  const band = topBand(sil, 0.5);
  assert.ok(band[0] > 199.9 && band[1] < 200.1, "꼭대기 띠는 좁음 " + band);
  // 고도 6° 로 가로지르는 원반: 옆면(윗선 6°)과 만나지만 꼭대기는 아님
  const low = []; for (let i = 0; i <= 40; i++) low.push({ t: i * 60e3, az: 199 + i * 0.05, alt: 6, diamDeg: 0.5 });
  assert.equal(overlapWindows(sil, low).windows.length, 0);
  // 고도 10.2° 로 첨탑 위를 지남 → 통과
  const top = low.map((s) => ({ ...s, alt: 10.2 }));
  const w = overlapWindows(sil, top).windows;
  assert.equal(w.length, 1); assert.ok(w[0].end - w[0].start <= 15 * 60e3, "짧은 구간");
});
