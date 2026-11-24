// sky-core 테스트: 잘 알려진 기준값(Meeus 예제, 실제 천문 현상)과 비교
import assert from "node:assert/strict";
import { createRequire } from "node:module";
// run.mjs가 실행 중이면 전역 test 사용(순환 import 방지), 직접 실행하면 run.mjs를 불러 등록
const test = globalThis.test ?? (await import("./run.mjs")).test;
const require = createRequire(import.meta.url);
const S = require("../core/sky-core.js");
const I = S._internal;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} got ${a}, want ${b} ±${tol}`);
const angSep = (az1, alt1, az2, alt2) => {
  const r = Math.PI / 180;
  return Math.acos(Math.min(1, Math.sin(alt1 * r) * Math.sin(alt2 * r) + Math.cos(alt1 * r) * Math.cos(alt2 * r) * Math.cos((az1 - az2) * r))) / r;
};
const SEOUL = [37.5665, 126.978], TROMSO = [69.6492, 18.9553];

test("sky: Meeus 47.a 달 (1992-04-12 0h TD)", () => {
  const m = I.moonEcl(2448724.5);
  near(m.lon, 133.162655, 1e-4, "λ");
  near(m.lat, -3.229126, 1e-4, "β");
  near(m.dist, 368409.7, 0.5, "Δ");
  near(m.lonApp, 133.167265, 0.0005, "겉보기 λ");
  const q = I.moonEq(2448724.5);
  near(q.ra, 134.688470, 0.002, "α");
  near(q.dec, 13.768368, 0.002, "δ");
});

test("sky: Meeus 25.a 해 (1992-10-13 0h TD)", () => {
  const s = I.sunEcl(2448908.5);
  near(s.trueLon, 199.90988, 2e-4, "참 경도");
  near(s.lon, 199.90895, 0.002, "겉보기 경도");
  near(s.R, 0.99766, 1e-4, "R");
  const q = I.sunEq(2448908.5);
  near(q.ra, 198.38083, 0.003, "α");
  near(q.dec, -7.78507, 0.003, "δ");
});

test("sky: Meeus 12.a 그리니치 평균 항성시", () => {
  near(I.gmst(2446895.5), 197.693195, 1e-5);
});

test("sky: 2024-04-08 개기일식 최대 지점에서 해·달 겹침(지표면 시차 검증)", () => {
  const t = new Date("2024-04-08T18:17:16Z"), lat = 25.29, lon = -104.14;
  const s = S.sunPos(t, lat, lon), m = S.moonPos(t, lat, lon);
  assert.ok(angSep(s.az, s.alt, m.az, m.alt) < 0.05, "중심 간격 < 0.05°");
  assert.ok(m.diamDeg > s.diamDeg, "개기: 달 지름 > 해 지름");
  assert.ok(m.illum < 0.001);
});

test("sky: 보름 2024-04-23 23:49Z / 신월 2024-04-08 18:21Z", () => {
  const f = S.moonPos(new Date("2024-04-23T23:49:00Z"), ...SEOUL);
  assert.ok(f.illum > 0.995, `illum ${f.illum}`);
  near(f.phase, 0.5, 0.005);
  assert.equal(S.moonPhaseName(f.phase), "moon.full");
  const n = S.moonPos(new Date("2024-04-08T18:21:00Z"), ...SEOUL);
  assert.ok(n.illum < 0.005, `illum ${n.illum}`);
  assert.equal(S.moonPhaseName(n.phase), "moon.new");
  assert.ok(f.diamDeg > 0.48 && f.diamDeg < 0.58);
});

test("sky: 서울 춘분 일출·일몰 (≈06:36 / 18:44 KST, 낮 길이 ≈12h08m)", () => {
  const r = S.riseSet("sun", "2026-03-20", ...SEOUL, "Asia/Seoul");
  const hm = d => { const t = S.localTime(d, "Asia/Seoul"); return +t.slice(11, 13) * 60 + +t.slice(14, 16); };
  near(hm(r.rise), 6 * 60 + 36, 3, "일출");
  near(hm(r.set), 18 * 60 + 44, 3, "일몰");
  near((r.set - r.rise) / 60000, 12 * 60 + 8, 3, "낮 길이");
  near(hm(r.transit), 12 * 60 + 39, 2, "남중");
  assert.ok(!r.alwaysUp && !r.alwaysDown);
  // 일출 시각에 해 고도 ≈ −0.833°
  near(S.sunPos(r.rise, ...SEOUL).alt, -0.833, 0.01);
});

test("sky: 트롬쇠 극야(2026-12-21)·백야(2026-06-21)", () => {
  const w = S.riseSet("sun", "2026-12-21", ...TROMSO, "Europe/Oslo");
  assert.equal(w.rise, null); assert.equal(w.set, null); assert.ok(w.alwaysDown);
  const s = S.riseSet("sun", "2026-06-21", ...TROMSO, "Europe/Oslo");
  assert.equal(s.rise, null); assert.ok(s.alwaysUp);
  const tw = S.twilight("2026-06-21", ...TROMSO, "Europe/Oslo");
  assert.equal(tw.darkHours, 0); assert.equal(tw.whiteNight, "midnightSun"); assert.ok(tw.polarDay);
  const tn = S.twilight("2026-12-21", ...TROMSO, "Europe/Oslo");
  assert.ok(tn.polarNight); assert.ok(tn.darkHours > 10, `darkHours ${tn.darkHours}`);
  assert.ok(tn.civil.dawn, "극야에도 시민 박명은 있음");
});

test("sky: 서울 박명·골든/블루 순서", () => {
  const t = S.twilight("2026-03-20", ...SEOUL, "Asia/Seoul");
  const seq = [t.astro.dawn, t.nautical.dawn, t.civil.dawn, t.blue.am[0], t.blue.am[1], t.golden.am[0], t.golden.am[1]].map(Number);
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] >= seq[i - 1], `순서 ${i}`);
  near(+t.blue.am[0], +t.civil.dawn, 1000, "블루 시작 = 시민 박명");
  near(+t.blue.am[1], +t.golden.am[0], 1000);
  assert.ok(t.golden.pm[0] < t.golden.pm[1] && +t.golden.pm[1] <= +t.blue.pm[0] + 1000);
  assert.ok(t.darkHours > 8 && t.darkHours < 10, `darkHours ${t.darkHours}`);
  assert.equal(t.whiteNight, false);
});

test("sky: 백야(하얀 밤) — 헬싱키 6월은 천문 어둠 없음", () => {
  const t = S.twilight("2026-06-21", 60.17, 24.94, "Europe/Helsinki");
  assert.equal(t.darkHours, 0); assert.equal(t.whiteNight, true); assert.equal(t.dark, null);
});

test("sky: 월출·월몰 — 고도 조건과 없는 날", () => {
  let missing = 0;
  for (let i = 0; i < 30; i++) {
    const ymd = S.localTime(new Date(Date.UTC(2026, 0, 1 + i, 3)), "Asia/Seoul").slice(0, 10);
    const r = S.riseSet("moon", ymd, ...SEOUL, "Asia/Seoul");
    if (!r.rise || !r.set) missing++;
    if (r.rise) near(I.moonGeoAlt(r.rise, ...SEOUL), 0.125, 0.01);
  }
  assert.ok(missing >= 1 && missing <= 3, `한 달에 뜨거나 지지 않는 날 1–2번, got ${missing}`);
});

test("sky: 굴절", () => {
  near(S.refraction(0) * 60, 29, 1.5, "지평선 ≈ 29′(Saemundsson)");
  near(S.refraction(10) * 60, 5.3, 0.3);
  near(S.trueFromApparent(S.apparentFromTrue(5)), 5, 0.01);
});

test("sky: 방위·거리·목적지 왕복", () => {
  const [la, lo] = SEOUL;
  const p = S.destination(la, lo, 63.5, 12.34);
  near(S.distanceKm(la, lo, p.lat, p.lon), 12.34, 1e-6);
  near(S.bearing(la, lo, p.lat, p.lon), 63.5, 1e-6);
  near(S.distanceKm(0, 0, 0, 1), 111.195, 0.01);
  near(S.bearing(0, 0, 1, 0), 0, 1e-9); near(S.bearing(0, 0, 0, 1), 90, 1e-9);
  // 곡률·굴절: 10km에서 낙차 = 100e6/(2·6371009)·0.87 ≈ 6.83m
  near(Math.tan(S.apparentAlt(0, 10) * Math.PI / 180) * 10000, -6.83, 0.02);
  near(S.apparentAlt(100, 1, { refraction: 1 }), Math.atan(0.1) * 180 / Math.PI, 1e-9);
});

test("sky: 촬영 라인 — 꼭대기 걸침 지점", () => {
  const target = { lat: 37.5512, lon: 126.9882, topM: 480, baseM: 243, widthM: 30 }; // 남산타워 근사
  const date = new Date("2026-12-24T08:30:00Z"); // 서울 17:30
  const L = S.shootingLine(target, "moon", date, { maxKm: 20 });
  near(L.lineAz, (L.az + 180) % 360, 1e-9);
  assert.equal(L.points.length, 200);
  if (L.alt > 0) {
    assert.ok(L.bestDistKm != null);
    const p = L.points.reduce((m, q) => Math.abs(q.offsetDeg) < Math.abs(m.offsetDeg) ? q : m);
    assert.ok(p.onTop || Math.abs(p.offsetDeg) < 0.3);
  }
  const r = L.sizeRatioFn(10);
  assert.ok(r > 0);
  near(S.sizeRatio(0.5, 30, 10), 0.5 / (2 * Math.atan(15 / 10000) * 180 / Math.PI), 1e-9);
});

test("sky: findAlignments — 합성 대상(월출 방향)을 찾음 + 12개월 속도", () => {
  const obs = { lat: SEOUL[0], lon: SEOUL[1], elevM: 20, eyeM: 1.5 };
  const rs = S.riseSet("moon", "2026-12-24", obs.lat, obs.lon, "Asia/Seoul");
  assert.ok(rs.rise);
  const t = new Date(+rs.rise + 40 * 60000);
  const m = S.moonPos(t, obs.lat, obs.lon, 21.5);
  assert.ok(m.altApparent > 1);
  const d = 6, tgt = S.destination(obs.lat, obs.lon, m.az, d);
  // apparentAlt(top − 21.5, 6km) = 달 겉보기 고도 가 되도록 높이 설정
  const R = 6371008.8, dm = d * 1000, drop = dm * dm / (2 * R) * 0.87;
  const topM = Math.tan(m.altApparent * Math.PI / 180) * dm + drop + 21.5;
  const target = { lat: tgt.lat, lon: tgt.lon, topM, baseM: 0 };
  const res = S.findAlignments(target, obs, { body: "moon", fromDate: new Date(+t - 86400000), toDate: new Date(+t + 86400000), part: "top" });
  const hit = res.find(r => Math.abs(r.time - t) <= 2 * 60000);
  assert.ok(hit, `찾지 못함: ${JSON.stringify(res.map(r => r.time))}`);
  assert.equal(hit.passDir, "L→R"); // 떠오르는 달은 방위가 커짐(북반구)
  assert.ok(hit.minutes >= 1 && hit.minutes < 30);
  near(hit.alt, m.altApparent, 0.3);
  assert.ok(hit.score >= 0 && hit.score <= 100 && hit.illum > 0);
  // 12개월 스캔 속도
  const t0 = performance.now();
  const year = S.findAlignments(target, obs, { body: "moon", fromDate: new Date("2026-01-01T00:00Z"), toDate: new Date("2027-01-01T00:00Z"), part: "any" });
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, `12개월 달 ${ms.toFixed(0)}ms`);
  assert.ok(year.length >= 1);
  const t1 = performance.now();
  S.findAlignments(target, obs, { body: "sun", fromDate: new Date("2026-01-01T00:00Z"), toDate: new Date("2027-01-01T00:00Z"), part: "any" });
  assert.ok(performance.now() - t1 < 2000);
});

test("sky: 오로라 지수 — SPEC 예시", () => {
  const base = { prob: 90, cloudLow: 0, cloudMid: 0, cloudHigh: 0, sunAlt: -25, moonAlt: -10, moonIllum: 0.5 };
  const a = S.auroraIndex(base);
  assert.equal(a.score, 10); assert.equal(a.grade, "epic"); assert.equal(a.reason, "reason.great");
  const b = S.auroraIndex({ ...base, cloudLow: 90 });
  near(b.score, 1, 0); assert.equal(b.grade, "none"); assert.equal(b.reason, "reason.cloud");
  const c = S.auroraIndex({ ...base, sunAlt: 10 });
  assert.equal(c.score, 0); assert.equal(c.reason, "reason.light");
  // 어둠 선형: −12° → 0.5
  near(S.auroraIndex({ ...base, sunAlt: -12 }).parts.dark, 0.5, 1e-9);
  // 높은 구름은 절반
  near(S.auroraIndex({ ...base, cloudHigh: 100 }).parts.clear, 0.5, 1e-9);
  // 달: 약한 오로라는 최대 90% 깎임, 강한 오로라는 30%
  const weakMoon = S.auroraIndex({ ...base, prob: 0.0001, moonAlt: 40, moonIllum: 1, moonAz: 0 });
  near(weakMoon.parts.moon, 0.1, 0.01);
  const strongMoon = S.auroraIndex({ ...base, moonAlt: 40, moonIllum: 1, moonAz: 0 });
  near(strongMoon.parts.moon, 0.7, 1e-9);
  near(S.auroraIndex({ ...base, moonAlt: 40, moonIllum: 1, moonAz: 180 }).parts.moon, 1 - 0.3 * 0.7, 1e-9);
  near(S.auroraIndex({ ...base, moonAlt: 15, moonIllum: 1, moonAz: 0 }).parts.moon, 0.85, 1e-9);
  assert.equal(S.auroraIndex({ ...base, prob: 0 }).reason, "reason.weak");
  assert.equal(S.auroraIndex({ ...base, prob: 25, moonAlt: 40, moonIllum: 1, moonAz: 0 }).reason, "reason.moon");
  for (let s = 0; s <= 10; s++) assert.ok(["none", "low", "fair", "high", "epic"].includes(S.auroraIndex({ ...base, prob: s * 7 }).grade));
});

test("sky: 지자기 위도·Kp 근사", () => {
  const tr = S.magLat(...TROMSO), se = S.magLat(...SEOUL);
  assert.ok(tr > 64 && tr < 69, `트롬쇠 ${tr}`);
  assert.ok(se > 25 && se < 33, `서울 ${se}`);
  near(S.magLat(80.7, -72.7), 90, 1e-6);
  assert.ok(S.kpToProb(3, tr) > S.kpToProb(1, 50));
  assert.equal(S.kpToProb(5, se), 0);
  assert.ok(S.kpToProb(9, 50) > 0);
});

test("sky: 은하수 창·유성우·무지개", () => {
  // 7월 초 신월 무렵(2026-07-14 신월) 한국 남부: 은하 중심이 어두운 밤에 보임
  const w = S.milkyWayWindow("2026-07-14", 34.8, 127.7, "Asia/Seoul");
  assert.ok(w && w.minutes > 60, JSON.stringify(w));
  assert.ok(w.start < w.end);
  assert.ok(S.galacticCenter(new Date(+w.start + 60000), 34.8, 127.7).alt > 10);
  assert.ok(S.sunPos(new Date(+w.start + 60000), 34.8, 127.7).alt < -18);
  assert.ok(w.moonless && w.moonless.minutes > 30);
  // 12월 서울: 은하 중심이 밤에 안 보임
  assert.equal(S.milkyWayWindow("2026-12-21", ...SEOUL, "Asia/Seoul"), null);
  // 트롬쇠 여름: 어둠 없음
  assert.equal(S.milkyWayWindow("2026-06-21", ...TROMSO, "Europe/Oslo"), null);
  assert.equal(S.METEOR_SHOWERS.length, 8);
  for (const m of S.METEOR_SHOWERS) assert.match(m.peak, /^\d\d-\d\d$/);
  assert.ok(S.rainbowPossible(30)); assert.ok(!S.rainbowPossible(45)); assert.ok(!S.rainbowPossible(-1));
  assert.equal(S.rainbowAz(250), 70);
});
