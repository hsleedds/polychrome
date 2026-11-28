const test = globalThis.test ?? (await import("./run.mjs")).test;
// terrain-core 테스트: 곡률·굴절 수평선, 능선 가림, 원반 판정, 일출 트랙, Terrarium 디코드·쌍선형·LRU·적응 줌
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("../core/sky-core.js");
const TC = require("../core/terrain-core.js");
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} got ${a}, want ${b} ±${tol}`);
const R2D = 180 / Math.PI;
const O = { lat: 37.5, lon: 127.0 };
// 1000 m 능선: 관측점에서 동쪽(방위 60–120°) 10 km 지점, 폭 160 m 의 호
const ridgeFn = (la, lo) => {
  const d = S.distanceKm(O.lat, O.lon, la, lo), b = S.bearing(O.lat, O.lon, la, lo);
  return d >= 9.92 && d <= 10.08 && b > 60 && b < 120 ? 1000 : 0;
};
let ridgeProfile;
const getRidge = async () => ridgeProfile ??= await TC.horizonProfile(TC.syntheticSource(ridgeFn), { ...O, eyeM: 1.6, groundM: 0 });

test("terrain: 거리 사다리·표본 수 (40 km → 방위당 268, 1° → 9.6만)", async () => {
  const L = TC.distanceLadder(40);
  assert.equal(L[0], 0.03); assert.equal(L.at(-1), 40);
  assert.equal(L.length, 268);
  for (let i = 1; i < L.length - 1; i++) {
    const step = L[i] - L[i - 1];
    assert.ok(step >= 0.03 - 1e-12 && step <= Math.max(0.03, 0.015 * L[i - 1]) + 1e-12);
  }
  const p = await getRidge();
  assert.equal(p.az.length, 360); assert.equal(p.samples, 360 * 268 + 1); assert.equal(p.perAzimuth, 268);
  assert.ok(p.az instanceof Float32Array && p.alt instanceof Float32Array && p.distKm instanceof Float32Array);
});

test("terrain: 평지 → 수평선 = 1.6 m 눈높이 내림각 dip ≈ √(2H(1−k)/R) = −0.0379°", async () => {
  // dip = acos(R'/(R'+H)), R' = R/(1−k), k = 0.13 → −0.03793°; 굴절 없으면 −0.04060°
  const dip = -Math.sqrt(2 * 1.6 * (1 - 0.13) / 6371008.8) * R2D;
  near(TC.horizonDip(1.6), dip, 1e-5, "dip formula");
  near(dip, -0.0379, 1e-4);
  near(TC.horizonDip(1.6, 0), -0.0406, 1e-4, "no refraction");
  const p = await TC.horizonProfile(TC.syntheticSource(() => 0), { ...O, stepDeg: 10 });
  assert.equal(p.groundM, 0); assert.equal(p.az.length, 36);
  for (let i = 0; i < 36; i++) {
    near(p.alt[i], dip, 0.0005, "az " + p.az[i]);
    assert.ok(p.alt[i] >= TC.horizonDip(1.6) - 1e-6, "never below dip");
    near(p.distKm[i], TC.horizonDistKm(1.6), 0.3, "horizon distance ~4.8 km");
  }
  // 산 정상(해발 1000 m)에서 바다 → dip 하한 (≈ −0.95°), distKm 은 해수면 수평선 거리
  const top = await TC.horizonProfile(TC.syntheticSource(() => -200), { ...O, groundM: 1000, stepDeg: 45 });
  near(top.alt[0], TC.horizonDip(1001.6), 1e-6); near(top.alt[0], -0.95, 0.02);
  near(top.distKm[0], TC.horizonDistKm(1001.6), 1e-3);
  // 결측(null)만 있어도 하한
  const none = await TC.horizonProfile(TC.syntheticSource(() => NaN), { ...O, stepDeg: 90 });
  near(none.alt[1], TC.horizonDip(1.6), 1e-6);
});

test("terrain: 동쪽 10 km 1000 m 능선 → az 90 에서 ≈ atan(1000/10000) − 곡률/굴절, az 270 은 dip", async () => {
  const p = await getRidge();
  const want = S.apparentAlt(1000 - 1.6, 10); // 5.7106 − 0.0391 = 5.672°
  // 곡률 낙차 d²/2R·(1−k) = 6.83 m, 눈높이 1.6 m → atan(991.57/10000) = 5.663° (atan(0.1) = 5.711°)
  near(want, Math.atan((1000 - 1.6 - 1e8 / (2 * 6371008.8) * 0.87) / 10000) * R2D, 1e-9);
  near(want, 5.663, 0.001);
  near(p.alt[90], want, 0.05, "az 90");
  near(TC.horizonAt(p, 90), want, 0.05);
  near(p.distKm[90], 10, 0.1);
  near(p.alt[270], TC.horizonDip(1.6), 0.0005, "az 270 clear");
  assert.ok(p.alt[0] < 0 && p.alt[180] < 0);
});

test("terrain: SkyCore.apparentAlt 와 일치", async () => {
  for (const [dh, d] of [[1000, 10], [-50, 3], [300, 40], [5, 0.03]]) near(TC.apparentAlt(dh, d), S.apparentAlt(dh, d), 1e-12);
  near(TC.apparentAlt(100, 20, 0), S.apparentAlt(100, 20, { refraction: 0 }), 1e-12);
  // 프로파일 값 = 반환 거리에서의 SkyCore.apparentAlt (Float32 정밀도)
  const p = await getRidge();
  near(p.alt[90], S.apparentAlt(1000 - p.groundM - p.eyeM, p.distKm[90]), 1e-4);
  // 오목하게 솟는 사면: h = 2.5·d² (d km, 동쪽) → 최대 겉보기 고도는 maxKm 끝(20 km, 1000 m)에서
  const slope = await TC.horizonProfile(TC.syntheticSource((la, lo) => { const d = S.distanceKm(O.lat, O.lon, la, lo); return Math.max(0, 2.5 * d * d * Math.cos((S.bearing(O.lat, O.lon, la, lo) - 90) * Math.PI / 180)); }), { ...O, maxKm: 20, stepDeg: 30 });
  near(slope.distKm[3], 20, 1e-6);
  near(slope.alt[3], S.apparentAlt(1000 - 1.6, 20), 1e-4);
});

test("terrain: horizonAt 보간·0/360 감김", () => {
  const prof = { az: new Float32Array([0, 90, 180, 270]), alt: new Float32Array([0, 4, 2, 8]), stepDeg: 90 };
  near(TC.horizonAt(prof, 45), 2, 1e-9); near(TC.horizonAt(prof, 315), 4, 1e-9);
  near(TC.horizonAt(prof, -45), 4, 1e-9); near(TC.horizonAt(prof, 360), 0, 1e-9); near(TC.horizonAt(prof, 720 + 90), 4, 1e-9);
});

test("terrain: isBlocked clear/partial/blocked", async () => {
  const p = await getRidge(), h = TC.horizonAt(p, 90);
  assert.equal(TC.isBlocked(p, 90, h + 0.1), "clear");
  assert.equal(TC.isBlocked(p, 90, h - 0.1), "blocked");
  assert.equal(TC.isBlocked(p, 90, h + 0.4, 0.265), "clear");
  assert.equal(TC.isBlocked(p, 90, h, 0.265), "partial");
  assert.equal(TC.isBlocked(p, 90, h - 0.4, 0.265), "blocked");
  assert.equal(TC.isBlocked(p, 270, 1, 0.265), "clear");
  assert.equal(TC.isBlocked(p, 270, 0, 0.265), "partial"); // 해수면 수평선(−0.038°)에 걸침
  // 능선 가장자리(방위 ~60°): 원반 왼쪽은 하늘, 오른쪽은 능선 → partial
  const edge = [...p.az].find((a, i) => i > 0 && p.alt[i] > 1 && p.alt[i - 1] < 1);
  assert.equal(TC.isBlocked(p, edge - 0.5, 3, 1), "partial");
});

test("terrain: firstVisible / lastVisible (능선 뒤 일출·일몰)", async () => {
  const p = await getRidge(), h = TC.horizonAt(p, 90), r = 0.53 / 2;
  const t0 = Date.UTC(2026, 11, 1, 22, 0);
  const rise = Array.from({ length: 61 }, (_, i) => ({ t: new Date(t0 + i * 60000), az: 90, alt: -1 + i * 0.2, diamDeg: 0.53 }));
  const f = TC.firstVisible(p, rise);
  assert.ok(f.touch && f.clear);
  near(f.touch.alt, h - r, 0.02, "touch"); near(f.clear.alt, h + r, 0.02, "clear");
  assert.ok(f.touch.t instanceof Date && f.clear.t > f.touch.t);
  near((f.clear.t - f.touch.t) / 60000, 2 * r / 0.2, 0.2, "minutes between");
  assert.equal(f.touch.atEdge, false);
  // 일몰(시간순, 고도 하강) → lastVisible
  const set = rise.map((e, i) => ({ ...e, t: t0 + i * 60000, alt: 10 - i * 0.2 }));
  const l = TC.lastVisible(p, set);
  near(l.clear.alt, h + r, 0.02); near(l.touch.alt, h - r, 0.02);
  assert.ok(typeof l.touch.t === "number" && l.touch.t > l.clear.t);
  // 처음부터 보임 → atEdge, 영영 안 보임 → null
  const up = TC.firstVisible(p, [{ t: 0, az: 90, alt: 20 }, { t: 1, az: 90, alt: 21 }]);
  assert.equal(up.clear.atEdge, true); assert.equal(up.clear.index, 0);
  const hidden = TC.firstVisible(p, [{ t: 0, az: 90, alt: 1 }, { t: 1, az: 90, alt: 2 }]);
  assert.equal(hidden.touch, null); assert.equal(hidden.clear, null);
  // 방위각 359→1 감김 보간
  const w = TC.firstVisible(p, [{ t: 0, az: 359, alt: -1 }, { t: 10, az: 1, alt: 1 }]);
  assert.ok(w.touch.az < 0.5 || w.touch.az > 359.5);
});

// Terrarium 스텁: 줌 z 전역 픽셀 (X,Y) 의 고도 = 100 + 0.5(X−X0) + 0.25(Y−Y0) (B/256 로 정확히 인코딩)
function encode(e) { const v = e + 32768, r = Math.floor(v / 256), g = Math.floor(v - r * 256), b = Math.round((v - r * 256 - g) * 256); return [r, g, b]; }
function stubLoader(X0, Y0, calls) {
  return async (z, x, y) => {
    calls.push([z, x, y]);
    const data = new Uint8ClampedArray(256 * 256 * 4);
    for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
      const [r, g, b] = encode(100 + 0.5 * (x * 256 + px - X0) + 0.25 * (y * 256 + py - Y0));
      const o = (py * 256 + px) * 4; data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    }
    return { width: 256, height: 256, data };
  };
}
const toLatLon = (gx, gy, z) => { const s = 256 * 2 ** z; return { lon: gx / s * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * gy / s))) * R2D }; };

test("terrain: Terrarium 디코드 + 쌍선형 + 타일 경계", async () => {
  assert.equal(TC.decodeTerrarium(128, 0, 0), 0);
  assert.equal(TC.decodeTerrarium(127, 255, 128), -0.5);
  assert.equal(TC.decodeTerrarium(133, 232, 0), 1512); // 백두산 근처 값 예
  const z = 12, tx = 3490, ty = 1587, X0 = tx * 256, Y0 = ty * 256, calls = [];
  const src = TC.terrariumSource({ zoom: z, loadTile: stubLoader(X0, Y0, calls) });
  assert.equal(src.id, "terrarium"); assert.match(src.attribution, /USGS|Geological Survey/); assert.match(src.attribution, /Mapzen|Tilezen/);
  const cases = [[X0 + 10.5, Y0 + 20.5], [X0 + 10.8, Y0 + 20.3], [X0 + 256.1, Y0 + 100.7], [X0 + 255.9, Y0 + 255.9], [X0 + 128, Y0 + 256]];
  const pts = cases.map(([gx, gy]) => toLatLon(gx, gy, z));
  const el = await src.elevations(pts);
  cases.forEach(([gx, gy], i) => near(el[i], 100 + 0.5 * (gx - 0.5 - X0) + 0.25 * (gy - 0.5 - Y0), 1e-6, "case " + i));
  // 경계 점들 때문에 이웃 타일(3491,1587), (3490,1588), (3491,1588) 도 읽었다, 각 1회
  const keys = new Set(calls.map(c => c.join("/")));
  assert.equal(keys.size, calls.length);
  for (const k of ["12/3490/1587", "12/3491/1587", "12/3490/1588", "12/3491/1588"]) assert.ok(keys.has(k), k);
  // 캐시 재사용
  const n = calls.length; await src.elevations(pts); assert.equal(calls.length, n);
  // 실패 타일 → null
  const bad = TC.terrariumSource({ loadTile: async () => { throw new Error("404"); } });
  assert.deepEqual(await bad.elevations([{ lat: 37.5, lon: 127 }, { lat: NaN, lon: 0 }]), [null, null]);
});

test("terrain: LRU maxTiles, 적응 줌(resM)", async () => {
  const calls = [];
  const src = TC.terrariumSource({ zoom: 12, maxTiles: 2, loadTile: stubLoader(0, 0, calls) });
  const at = (tx) => toLatLon(tx * 256 + 128, 1587 * 256 + 128, 12);
  await src.elevations([at(3490)]); await src.elevations([at(3491)]); await src.elevations([at(3492)]);
  assert.equal(src.cacheSize(), 2); assert.equal(calls.length, 3);
  await src.elevations([at(3492)]); assert.equal(calls.length, 3, "hit");
  await src.elevations([at(3490)]); assert.equal(calls.length, 4, "evicted → reload");
  // resM 500 m @ 37.5° → z8 (픽셀 ≈ 485 m), resM 30 → z12 (≈ 30 m), adaptive:false → 항상 z12
  calls.length = 0;
  const src2 = TC.terrariumSource({ zoom: 12, loadTile: stubLoader(0, 0, calls) });
  await src2.elevations([{ lat: 37.5, lon: 127, resM: 500 }, { lat: 37.5, lon: 127, resM: 31 }]);
  assert.deepEqual(calls.map(c => c[0]).sort((a, b) => a - b), [8, 12]);
  calls.length = 0;
  await TC.terrariumSource({ adaptive: false, loadTile: stubLoader(0, 0, calls) }).elevations([{ lat: 37.5, lon: 127, resM: 500 }]);
  assert.equal(calls[0][0], 12);
});

test("terrain: Terrarium 스텁으로 전체 프로파일 (타일 수·시간)", async () => {
  const calls = [], data = new Uint8ClampedArray(256 * 256 * 4), [r, g, b] = encode(50);
  for (let o = 0; o < data.length; o += 4) { data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255; }
  const src = TC.terrariumSource({ loadTile: async (z, x, y) => (calls.push([z, x, y]), { width: 256, height: 256, data }) });
  const t = performance.now();
  const p = await TC.horizonProfile(src, { lat: 37.5665, lon: 126.978 });
  const ms = performance.now() - t;
  near(p.groundM, 50, 1e-9); assert.equal(p.source, "terrarium"); assert.ok(p.attribution.length > 10);
  near(p.alt[0], TC.horizonDip(1.6), 0.0005, "flat 50 m plateau → local dip");
  assert.ok(calls.length <= 40, "tiles " + calls.length);
  assert.ok(ms < 3000, "ms " + ms);
  console.log(`       (terrarium profile: ${p.samples} samples, ${calls.length} tiles, ${ms.toFixed(0)} ms)`);
});
