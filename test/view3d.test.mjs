// 3D 풍경·드론 보기 순수 계산 테스트 (app/view3d-calc.js)
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  curvatureDrop, toLocal, fromLocal, gridLayout, levelMesh, terrainPlan, terrainHeights, terrainColor,
  lensFovDeg, viewHFov, vFovFromH, dirVec, vecDir, aimAt, clampPitch, frameRect, discSize, skyColors,
  nudge, zoneBanner, ONESTOP_URL, EARTH_M,
} from "../app/view3d-calc.js";
globalThis.__v3calc = await import("../app/view3d-calc.js");
const test = globalThis.test ?? (await import("./run.mjs")).test;
const require = createRequire(import.meta.url);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} ${a} vs ${b} (±${tol})`);

test("view3d: 곡률 낙차 — 10 km 에서 ≈ 6.83 m (k=0.13), TerrainCore.apparentAlt 와 일치", () => {
  near(curvatureDrop(10000), 1e8 / (2 * EARTH_M) * 0.87, 1e-9);
  near(curvatureDrop(10000), 6.83, 0.01);
  const TC = require("../core/terrain-core.js");
  // 같은 Δh, d 에서 atan2(Δh − drop, d) == TerrainCore.apparentAlt
  for (const [dh, dKm] of [[300, 12], [-20, 3], [800, 38]]) {
    const ours = Math.atan2(dh - curvatureDrop(dKm * 1000), dKm * 1000) * 180 / Math.PI;
    near(ours, TC.apparentAlt(dh, dKm), 1e-9, "apparentAlt");
  }
});

test("view3d: 지역 좌표 왕복 (toLocal ↔ fromLocal, 40 km 까지 1 mm 이내)", () => {
  const lat0 = 37.5497, lon0 = 127.031;
  for (const [e, n] of [[0, 0], [1000, 0], [0, -2500], [-28000, 31000], [40000, 40000]]) {
    const p = fromLocal(lat0, lon0, e, n), b = toLocal(lat0, lon0, p.lat, p.lon);
    near(b.e, e, 1e-3, "e"); near(b.n, n, 1e-3, "n"); near(b.d, Math.hypot(e, n), 1e-3, "d");
  }
  // 정북 1 km 는 위도 +0.008993°
  near(fromLocal(lat0, lon0, 0, 1000).lat - lat0, 1000 / (EARTH_M * Math.PI / 180), 1e-9);
});

test("view3d: 지역 좌표는 SkyCore 거리·방위와 같다", () => {
  const Sky = require("../core/sky-core.js");
  const o = [37.5497, 127.031], t = [37.5512, 126.9882]; // 응봉산 → N서울타워
  const L = toLocal(o[0], o[1], t[0], t[1]);
  near(L.d / 1000, Sky.distanceKm(o[0], o[1], t[0], t[1]), 1e-6, "dist");
  near((Math.atan2(L.e, L.n) * 180 / Math.PI + 360) % 360, Sky.bearing(o[0], o[1], t[0], t[1]), 1e-6, "bearing");
});

test("view3d: 격자 LOD — 5단계 30 m→480 m, 반폭 1.92→30.7 km, 단계 경계가 맞물림", () => {
  const L = gridLayout();
  assert.equal(L.length, 5);
  assert.deepEqual(L.map((x) => x.cell), [30, 60, 120, 240, 480]);
  near(L[4].half, 30720, 1e-9);
  for (let i = 1; i < L.length; i++) assert.equal(L[i].innerHalf, L[i - 1].half);
  assert.throws(() => gridLayout({ n: 30 }));
});

test("view3d: 단계 메시 — 꼭짓점·삼각형 수, 구멍, 테두리 맞춤 목록", () => {
  const [L0, L1] = gridLayout({ n: 16, levels: 2 });
  const m0 = levelMesh(L0, 16), m1 = levelMesh(L1, 16);
  assert.equal(m0.count, 17 * 17);
  assert.equal(m0.index.length / 3, 16 * 16 * 2);
  assert.equal(m1.count, 17 * 17 - 7 * 7); // 구멍 안 7×7 꼭짓점 없음 (경계는 있음)
  assert.equal(m1.index.length / 3, (16 * 16 - 8 * 8) * 2);
  assert.ok([...m1.index].every((i) => i >= 0 && i < m1.count));
  // 바깥 테두리 홀수 꼭짓점: 변마다 n/2 개
  assert.equal(m0.stitch.length, 4 * 8);
  // 단계 1 의 안쪽 경계 꼭짓점 위치가 단계 0 바깥 테두리의 짝수 꼭짓점과 같다
  const key = (m, v) => `${m.en[2 * v]},${m.en[2 * v + 1]}`;
  const s0 = new Set(Array.from({ length: m0.count }, (_, v) => key(m0, v)));
  let shared = 0;
  for (let v = 0; v < m1.count; v++) if (s0.has(key(m1, v))) shared++;
  assert.equal(shared, 4 * 8); // 안쪽 경계 둘레 꼭짓점 수
  // 삼각형이 위(+y)를 향한다: three 좌표 (e, z, −n)
  const [a, b, c] = m0.index;
  const P = (v) => [m0.en[2 * v], 0, -m0.en[2 * v + 1]];
  const A = P(a), B = P(b), C = P(c), u = B.map((x, i) => x - A[i]), w = C.map((x, i) => x - A[i]);
  assert.ok(u[2] * w[0] - u[0] * w[2] > 0, "normal y > 0");
});

test("view3d: 지형 계획·높이 — 꼭짓점 수, 곡률 낙차, 테두리 평균, 빈 값", () => {
  const plan = terrainPlan(37.5, 127.0, { n: 16, levels: 3 });
  assert.equal(plan.points.length, 1 + 289 + 2 * (289 - 49));
  assert.equal(plan.vertices, plan.points.length - 1);
  // 평지 100 m: z = 100 − drop(d)
  const elev = plan.points.map(() => 100);
  const H = terrainHeights(plan, elev);
  assert.equal(H.groundM, 100);
  assert.equal(H.okFrac, 1);
  const m2 = plan.levels[2].mesh, z2 = H.zs[2];
  for (let v = 0; v < m2.count; v += 7) {
    const d = Math.hypot(m2.en[2 * v], m2.en[2 * v + 1]);
    const isStitch = m2.stitch.some((s) => s[0] === v);
    if (!isStitch) near(z2[v], 100 - curvatureDrop(d), 1e-3);
  }
  // 테두리 홀수 꼭짓점 = 이웃 평균
  for (const [i, a, b] of plan.levels[0].mesh.stitch) near(H.zs[0][i], (H.zs[0][a] + H.zs[0][b]) / 2, 1e-4);
  // 빈 값 → fill, 바다(음수) → 0
  const H2 = terrainHeights(plan, plan.points.map((_, i) => (i === 0 ? null : i % 2 ? -30 : NaN)), { fill: 5 });
  assert.equal(H2.groundM, null);
  assert.ok(H2.okFrac > 0.45 && H2.okFrac < 0.55);
  assert.ok(H2.zs[0].every((z) => z <= 5.0001));
});

test("view3d: 지형 색 — 물·평지·가파름", () => {
  const w = terrainColor(0, 1), flat = terrainColor(50, 1), steep = terrainColor(50, 0.5);
  assert.ok(w[2] > w[0]);
  assert.ok(flat[1] > flat[0]);
  assert.notDeepEqual(flat, steep);
});

test("view3d: 렌즈 화각·보기 화각·세로 화각", () => {
  near(lensFovDeg(50).h, 39.6, 0.1);
  near(lensFovDeg(24).h, 73.7, 0.1);
  assert.equal(viewHFov(0), 60);
  const v = viewHFov(200);
  assert.ok(v > lensFovDeg(200).h && v < lensFovDeg(200).h * 1.5);
  assert.ok(viewHFov(24) <= 110);
  near(vFovFromH(90, 1), 90, 1e-9);
  near(vFovFromH(60, 1000 / 720), 2 * Math.atan(Math.tan(Math.PI / 6) * 0.72) * 180 / Math.PI, 1e-9);
  // 렌즈 틀: 보기 화각이 렌즈 화각의 1.35배(탄젠트) → 틀 너비 = W/1.35
  const r = frameRect(85, viewHFov(85), 1000, 720);
  near(r.w, 1000 / 1.35, 1e-6); near(r.x + r.w / 2, 500, 1e-9); near(r.h / r.w, 24 / 36, 1e-9);
  assert.equal(frameRect(0, 60, 10, 10), null);
});

test("view3d: 방향 벡터 왕복 · 북=−z, 동=+x", () => {
  const n = dirVec(0, 0), e = dirVec(90, 0), up = dirVec(123, 90);
  near(n[2], -1, 1e-12); near(e[0], 1, 1e-12); near(up[1], 1, 1e-12);
  for (const [az, alt] of [[10, 5], [200, -3], [359, 40]]) { const d = vecDir(dirVec(az, alt)); near(d.az, az, 1e-9); near(d.alt, alt, 1e-9); }
});

test("view3d: 처음 시선 — 구조물 방위·가운데 높이, 실루엣과 같은 겉보기 고도", () => {
  const Sky = require("../core/sky-core.js");
  const obs = { lat: 37.5497, lon: 127.031, zM: 81.6 }, lm = { lat: 37.5512, lon: 126.9882, baseM: 243, heightM: 236.7 };
  const a = aimAt(obs, lm);
  near(a.yaw, Sky.bearing(obs.lat, obs.lon, lm.lat, lm.lon), 1e-6);
  const dk = Sky.distanceKm(obs.lat, obs.lon, lm.lat, lm.lon);
  near(a.pitch, Sky.apparentAlt(lm.baseM + lm.heightM / 2 - obs.zM, dk), 1e-6);
  assert.equal(clampPitch(-120, "drone"), -90);
  assert.equal(clampPitch(-120, "ground"), -45);
  assert.equal(clampPitch(100, "ground"), 85);
});

test("view3d: 원반 크기 — 0.5° 를 150 km 에 → 1309 m", () => {
  near(discSize(0.5, 150000), 1309, 1);
});

test("view3d: 하늘 색 — 낮은 밝고 밤은 어둡고 별은 밤만", () => {
  const d = skyColors(40), t = skyColors(-4), n = skyColors(-30);
  const lum = (c) => c[0] + c[1] + c[2];
  assert.ok(lum(d.zenith) > lum(t.zenith) && lum(t.zenith) > lum(n.zenith));
  assert.equal(d.sun, 1); assert.equal(n.sun, 0);
  assert.ok(n.stars && !d.stars && !t.stars);
  assert.ok(t.horizon[0] > t.horizon[2], "황혼 지평선은 붉다");
});

test("view3d: 드론 이동·비행구역 배너 문구", () => {
  assert.deepEqual(nudge({ e: 0, n: 0 }, "N"), { e: 0, n: 50 });
  assert.deepEqual(nudge({ e: 0, n: 50 }, "W"), { e: -50, n: 50 });
  const u = zoneBanner(null);
  assert.equal(u.cls, "unknown"); assert.equal(u.key, "v3.zone.unknown");
  assert.ok(u.links.some((l) => l.url === ONESTOP_URL));
  const p = zoneBanner({ level: "prohibited", items: [{ name: "P-73", kind: "P" }], links: [{ label: "x", url: "javascript:alert(1)" }] });
  assert.equal(p.cls, "prohibited"); assert.equal(p.items[0].name, "P-73");
  assert.ok(p.links.every((l) => l.url.startsWith("https://")));
  assert.equal(zoneBanner({ level: "weird" }).cls, "unknown");
  assert.equal(zoneBanner({ level: "none" }).key, "v3.zone.none");
});

test("view3d: 바깥 고리 — 위를 향하고, 곡률로 내려감; 관측점 옆 지형은 눈높이를 막지 않음", () => {
  const { skirtMesh } = globalThis.__v3calc;
  const s = skirtMesh({ innerM: 29000, rings: 4, segs: 8 });
  assert.equal(s.z.length, 5 * 8);
  assert.ok(s.z[s.z.length - 1] < -2000, "180 km 에서 2 km 이상 아래");
  const P = (v) => [s.en[2 * v], s.z[v], -s.en[2 * v + 1]];
  const [a, b, c] = s.index, A = P(a), B = P(b), C = P(c);
  const u = B.map((x, i) => x - A[i]), w = C.map((x, i) => x - A[i]);
  assert.ok(u[2] * w[0] - u[0] * w[2] > 0, "normal y > 0");
  const plan = terrainPlan(37.5, 127.0, { n: 16, levels: 1 });
  const elev = plan.points.map((_, i) => (i === 0 ? 50 : 80));
  const H = terrainHeights(plan, elev);
  const m = plan.levels[0].mesh;
  for (let v = 0; v < m.count; v++) if (Math.hypot(m.en[2 * v], m.en[2 * v + 1]) <= 45) assert.ok(H.zs[0][v] < 50);
});

test("buildings: 훅 없음 → null, 상자 올리기·실루엣 투영", async () => {
  const B = await import("../app/buildings.js");
  B.setBuildingSource(null);
  assert.equal(await B.buildingsNear(37.5, 127, 3), null);
  const lat0 = 37.5, lon0 = 127.0;
  const fp = [[0, 0], [0, 40], [40, 40], [40, 0]].map(([e, n]) => { const p = fromLocal(lat0, lon0, 1000 + e, n); return [p.lat, p.lon]; });
  const b = { footprint: fp, heightM: 100, baseM: 10 };
  const x = B.extrudeFootprint(b, lat0, lon0);
  assert.equal(x.pos.length, 8 * 3); assert.equal(x.index.length, 4 * 6 + 2 * 3);
  near(x.pos[1], 10 - curvatureDrop(1000), 1e-6); near(x.pos[12 + 1], 110 - curvatureDrop(1000), 1e-6);
  const polys = B.buildingPolygons([b, { footprint: [[1, 2]], heightM: 5 }], { lat: lat0, lon: lon0, zM: 11.6 }, 90);
  assert.equal(polys.length, 1);
  const alts = polys[0].map((p) => p[1]), azs = polys[0].map((p) => p[0]);
  near(Math.max(...alts), Math.atan2(110 - curvatureDrop(1000) - 11.6, 1000) * 180 / Math.PI, 0.01);
  assert.ok(azs.every((a) => a > 87 && a <= 90.01));
  B.setBuildingSource({ id: "t", buildingsNear: async () => [b, { bad: 1 }] });
  assert.equal((await B.buildingsNear(lat0, lon0, 3)).length, 1);
  B.setBuildingSource(null);
});
