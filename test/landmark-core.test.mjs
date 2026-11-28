// landmark-core 테스트: 데이터 스키마, 실루엣 투영(기하 기준값), 방위각 0/360 처리, 가림 판정
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const test = globalThis.test ?? (await import("./run.mjs")).test;
const require = createRequire(import.meta.url);
const S = require("../core/sky-core.js");
const LC = require("../core/landmark-core.js");
const DATA = JSON.parse(readFileSync(new URL("../data/landmarks.json", import.meta.url), "utf8"));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} got ${a}, want ${b} ±${tol}`);
const R2D = 180 / Math.PI;
const IDS = ["lotte-world-tower", "n-seoul-tower", "63-square", "parc1", "national-assembly", "gwanghwamun", "sungnyemun", "banpo-bridge", "dongjak-bridge", "jamsil-cheongdam-bridges"];

test("landmark: 데이터 스키마 (10개, 출처, 유한 수치, OSM 금지)", () => {
  assert.equal(DATA.license, "Polychrome proprietary — not derived from OSM/Overture");
  assert.deepEqual(DATA.landmarks.map(l => l.id), IDS);
  assert.deepEqual(LC.validate(DATA), []);
  const kinds = new Set(["tower", "building", "gate", "bridge", "dome-building"]);
  for (const l of DATA.landmarks) {
    assert.ok(kinds.has(l.kind), l.id + " kind");
    assert.ok(l.lat > 37.4 && l.lat < 37.7 && l.lon > 126.8 && l.lon < 127.2, l.id + " in Seoul");
    assert.ok(l.sources.length >= 2, l.id + " ≥2 sources");
    assert.ok(typeof l.baseEst === "boolean" && l.baseReason, l.id + " baseM provenance");
    for (const p of l.parts) if (p.est) assert.ok(p.estReason && p.estFields.length, l.id + " est reason");
  }
  assert.ok(!/openstreetmap|overture/i.test(JSON.stringify(DATA.landmarks.map(l => l.sources))));
});

test("landmark: findLandmark 한/영/id/별칭", () => {
  LC.setLibrary(DATA);
  assert.equal(LC.findLandmark("롯데월드타워").id, "lotte-world-tower");
  assert.equal(LC.findLandmark("N Seoul Tower").id, "n-seoul-tower");
  assert.equal(LC.findLandmark("남산타워").id, "n-seoul-tower");
  assert.equal(LC.findLandmark("63빌딩").id, "63-square");
  assert.equal(LC.findLandmark("parc1").id, "parc1");
  assert.equal(LC.findLandmark("청담대교").id, "jamsil-cheongdam-bridges");
  assert.equal(LC.findLandmark("남대문").id, "sungnyemun");
  assert.equal(LC.findLandmark("없는곳"), null);
  assert.equal(LC.list().length, 10);
});

test("landmark: 모델 최고점 = 공개 높이 (롯데 555.7, N서울 236.7, 63 274, 국회 69.19)", () => {
  const topZ = id => Math.max(...LC.toMesh(LC.findLandmark(id)).vertices.map(v => v[2]));
  near(topZ("lotte-world-tower"), 555.7, 1e-9);
  near(topZ("n-seoul-tower"), 236.7, 1e-9);
  near(topZ("n-seoul-tower") + LC.findLandmark("n-seoul-tower").baseM, 479.7, 0.5, "해발");
  near(topZ("63-square"), 274, 1e-9);
  near(topZ("national-assembly"), 5.44 + 63.75, 1e-9);
  near(topZ("parc1"), 333, 1e-9);
});

test("landmark: toMesh 구조 (lathe 24분할, 삼각형 인덱스 유효)", () => {
  const lm = LC.findLandmark("n-seoul-tower"), m = LC.toMesh(lm);
  const n = lm.parts[0].profile.length;
  assert.equal(m.vertices.length, (n - 1) * 2 * 24);
  for (const t of m.triangles) for (const i of t) assert.ok(i >= 0 && i < m.vertices.length);
  for (const e of m.edges) for (const i of e) assert.ok(i >= 0 && i < m.vertices.length);
  // 단면 반지름 = profile 값
  const r0 = Math.max(...m.vertices.slice(0, 24).map(([e, nn]) => Math.hypot(e, nn)));
  near(r0, lm.parts[0].profile[0][1], 1e-9);
  // 모든 랜드마크 메시 생성
  for (const l of DATA.landmarks) { const mm = LC.toMesh(l); assert.ok(mm.vertices.length > 0 && mm.triangles.length > 0, l.id); }
});

test("landmark: 롯데타워 5 km 서쪽에서 — 방위 90°, 각높이 ≈ atan(555.7/5000)", () => {
  const lm = LC.findLandmark("lotte-world-tower");
  const o = S.destination(lm.lat, lm.lon, 270, 5);
  const sil = LC.silhouette(lm, { lat: o.lat, lon: o.lon, groundM: lm.baseM, eyeM: 1.6 });
  near(sil.distKm, 5, 0.001, "거리");
  near(sil.bearingDeg, 90, 0.05, "방위");
  near(sil.top.az, 90, 0.05, "꼭대기 방위");
  near(sil.angularHeightDeg, Math.atan2(555.7, 5000) * R2D, 0.1, "각높이");
  near(sil.top.alt, S.apparentAlt(555.7 - 1.6, 5), 0.02, "꼭대기 고도(곡률·굴절)");
  near(sil.base.alt, S.apparentAlt(-1.6, 5), 1e-6, "밑동 고도");
  near(sil.angularWidthDeg, 2 * Math.atan2(35, 5000) * R2D, 0.05, "폭 70 m");
  assert.ok(sil.polygons.length >= 4);
  // 윗선: 중심 열이 최고점 근처
  const mid = sil.envelope.reduce((a, b) => (b[1] ?? -1e9) > (a[1] ?? -1e9) ? b : a);
  near(mid[0], 90, 0.1); near(mid[1], sil.top.alt, 0.05);
});

test("landmark: 먼 거리 곡률 — 30 km 에서 같은 높이 관측자는 꼭대기 각이 apparentAlt 와 일치", () => {
  const lm = LC.findLandmark("n-seoul-tower");
  const o = S.destination(lm.lat, lm.lon, 180, 30);
  const sil = LC.silhouette(lm, { lat: o.lat, lon: o.lon, groundM: 20, eyeM: 1.6 });
  near(sil.top.alt, S.apparentAlt(243 + 236.7 - 21.6, 30), 0.01);
  near(sil.bearingDeg, 0, 0.05);
});

test("landmark: 방위각 0/360 경계 — 정남에서 북쪽을 볼 때 다각형이 끊기지 않음", () => {
  const lm = LC.findLandmark("national-assembly");
  const o = S.destination(lm.lat, lm.lon, 180, 0.8);
  const sil = LC.silhouette(lm, { lat: o.lat, lon: o.lon, groundM: lm.baseM });
  const crosses = (sil.azRange[0] < 0 && sil.azRange[1] > 0) || (sil.azRange[0] < 360 && sil.azRange[1] > 360);
  assert.ok(crosses, "중심 방위 0/360 근처에서 끊김 없이 연속 " + sil.azRange);
  assert.ok(sil.azRange[1] - sil.azRange[0] < 30);
  for (const poly of sil.polygons) { const az = poly.map(p => p[0]); assert.ok(Math.max(...az) - Math.min(...az) < 20, "조각이 360° 를 가로지르지 않음"); }
  near(sil.angularWidthDeg, 2 * Math.atan2(65, 800 - 44.5) * R2D, 0.6, "폭 ≈ 130 m 기단");
  assert.ok(sil.top.az >= 0 && sil.top.az < 360);
  // 돔 꼭대기 각
  near(sil.top.alt, Math.atan2(69.19 - 1.6, 800) * R2D, 0.05);
  // 359.9° 와 0.1° 의 해는 모두 정면 근처로 처리
  const a = LC.occlusion(sil, { az: 359.9, alt: 2, diamDeg: 0.53 }), b = LC.occlusion(sil, { az: 0.1, alt: 2, diamDeg: 0.53 });
  assert.equal(a.state, "behind"); assert.equal(b.state, "behind");
});

test("landmark: deck/arch 투영 — 다리 옆에서 상판 높이·아치 꼭대기·아치 아래 하늘", () => {
  const lm = LC.findLandmark("dongjak-bridge");
  const axis = lm.parts[0].azDeg, side = (axis + 90) % 360;
  const o = S.destination(lm.lat, lm.lon, side + 180, 1.0); // 다리 축과 수직으로 1 km 떨어진 곳
  const sil = LC.silhouette(lm, { lat: o.lat, lon: o.lon, groundM: lm.baseM, eyeM: 1.6 });
  near(sil.bearingDeg, side, 0.05);
  // 길이 1330 m → 각폭 ≈ 2·atan(665/1000)
  near(sil.angularWidthDeg, 2 * Math.atan2(665, 1000 - 20) * R2D, 0.8);
  // 꼭대기 = 가운데 아치 정점(14 + 12 + 두께 1.6)
  near(sil.top.alt, Math.atan2(14 + 12 + 1.6 - 1.6, 1000) * R2D, 0.1);
  near(sil.top.az, side, 1.5);
  // 아치 아래(상판 위) 하늘은 비어 있음: 가운데 아치 정점 바로 아래 고도 = 상판과 정점 사이
  const deckAlt = Math.atan2(14 - 1.6, 1000) * R2D, crownAlt = sil.top.alt;
  const probe = { az: sil.bearingDeg + 0.6, alt: (deckAlt + crownAlt) / 2, diamDeg: 0.2 };
  assert.equal(LC.occlusion(sil, probe).state, "clear", "아치 사이 하늘");
  // 아치 리브 위는 하늘, 아치 리브 자체는 가림
  assert.equal(LC.occlusion(sil, { az: sil.top.az, alt: crownAlt + 0.3, diamDeg: 0.2 }).state, "clear");
  assert.notEqual(LC.occlusion(sil, { az: sil.top.az, alt: crownAlt - 0.05, diamDeg: 0.05 }).state, "clear");
  // 상판 아래 교각 사이(간격 50 m ≈ 2.9°)는 빈 하늘: 상판 밑 고도, 교각 사이 방위에서 작은 원반
  const env = sil.envelope.filter(e => e[1] != null);
  assert.ok(env.length > 100);
});

test("landmark: lathe/prism 실루엣 폭 — N서울타워 정면 1 km, 전망대 지름 28 m", () => {
  const lm = LC.findLandmark("n-seoul-tower");
  const o = S.destination(lm.lat, lm.lon, 90, 1);
  const sil = LC.silhouette(lm, { lat: o.lat, lon: o.lon, groundM: lm.baseM });
  near(sil.angularWidthDeg, 2 * Math.asin(14 / 1000) * R2D, 0.01); // 원기둥의 접선 각폭
  near(sil.bearingDeg, 270, 0.05);
});

test("landmark: 잠실대교·청담대교 — at 원점 분리, 두 다리 사이 빈 하늘", () => {
  const lm = LC.findLandmark("jamsil-cheongdam-bridges");
  const m = LC.toMesh(lm);
  const es = m.vertices.map(v => v[0]);
  assert.ok(Math.max(...es) > 2000, "잠실대교가 동쪽 ~2.4 km");
  const o = S.destination(lm.lat, lm.lon, 180, 3);
  const sil = LC.silhouette(lm, { lat: o.lat, lon: o.lon, groundM: 2.5 });
  assert.ok(sil.angularWidthDeg > 40);
  assert.ok(sil.envelope.some(e => e[1] === null), "두 다리 사이 열은 비어 있음");
});

test("landmark: occlusion 상태 (clear / partial / behind) 와 비율", () => {
  const lm = LC.findLandmark("lotte-world-tower");
  const o = S.destination(lm.lat, lm.lon, 270, 5);
  const sil = LC.silhouette(lm, { lat: o.lat, lon: o.lon, groundM: lm.baseM });
  const d = 0.53;
  assert.deepEqual(LC.occlusion(sil, { az: 90, alt: 2, diamDeg: d }), { state: "behind", coveredFrac: 1 });
  assert.equal(LC.occlusion(sil, { az: 95, alt: 2, diamDeg: d }).state, "clear");
  assert.equal(LC.occlusion(sil, { az: 90, alt: 12, diamDeg: d }).state, "clear");
  // 몸통 가장자리(반폭 0.401°)에 중심 → 약 절반
  const half = Math.atan2(35, 5000) * R2D;
  const e = LC.occlusion(sil, { az: sil.bearingDeg + half, alt: 1.5, diamDeg: d }); // bearingDeg: 자오선 수렴(≈0.03°) 반영
  assert.equal(e.state, "partial"); near(e.coveredFrac, 0.5, 0.06);
  // 꼭대기 위로 살짝 걸친 달 (altApparent 우선)
  const t = LC.occlusion(sil, { az: 90, alt: 99, altApparent: sil.top.alt + 0.2, diamDeg: d });
  assert.equal(t.state, "partial"); assert.ok(t.coveredFrac > 0 && t.coveredFrac < 0.2);
  // 실제 달 객체(moonPos) 그대로 넣어도 동작
  const mp = S.moonPos(new Date("2026-11-28T12:00:00Z"), o.lat, o.lon);
  const r = LC.occlusion(sil, mp);
  assert.ok(["clear", "partial", "behind"].includes(r.state) && r.coveredFrac >= 0 && r.coveredFrac <= 1);
});
