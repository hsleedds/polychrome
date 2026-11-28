/* 3D 풍경·드론 보기 순수 계산 (DOM·WebGL 없음, Node 테스트 가능).
 * 좌표계: 관측점(원점) 기준 지역 ENU 미터 — e(동), n(북), z(해발 m − 곡률 낙차).
 *   수평 위치는 방위 등거리(azimuthal equidistant): d = 대권 거리, θ = 방위 → e = d·sinθ, n = d·cosθ.
 *   높이는 z = h − d²/(2R)·(1−k), k = 0.13 → 원점에서 본 각도 atan2(z − z0, d) 가
 *   TerrainCore/SkyCore 의 겉보기 고도 atan2(Δh − d²/2R·(1−k), d) 와 똑같다. 그래서 해·달은 겉보기 방위·고도 방향에 그대로 놓으면 된다.
 *   three.js 쪽 좌표: x = e, y = z(위), z = −n.  */

export const EARTH_M = 6371008.8;
export const REFRACTION_K = 0.13;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const M_PER_DEG = EARTH_M * D2R; // LandmarkCore 와 같은 값

/** 곡률 낙차(m): 거리 dM 에서 지면이 접평면 아래로 내려가는 양 (지상 굴절 k 반영) */
export const curvatureDrop = (dM, k = REFRACTION_K) => (dM * dM) / (2 * EARTH_M) * (1 - k);

/** (lat0, lon0) → (lat, lon): {e, n, d} 미터 (방위 등거리) */
export function toLocal(lat0, lon0, lat, lon) {
  const p1 = lat0 * D2R, p2 = lat * D2R, dl = (lon - lon0) * D2R;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const d = 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
  if (d < 1e-6) return { e: 0, n: 0, d: 0 };
  const th = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
  return { e: d * Math.sin(th), n: d * Math.cos(th), d };
}

/** 지역 (e, n) 미터 → {lat, lon} (toLocal 의 역) */
export function fromLocal(lat0, lon0, e, n) {
  const d = Math.hypot(e, n);
  if (d < 1e-9) return { lat: lat0, lon: lon0 };
  const th = Math.atan2(e, n), dr = d / EARTH_M, p1 = lat0 * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(dr) + Math.cos(p1) * Math.sin(dr) * Math.cos(th));
  const l2 = lon0 * D2R + Math.atan2(Math.sin(th) * Math.sin(dr) * Math.cos(p1), Math.cos(dr) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * R2D, lon: ((l2 * R2D + 540) % 360) - 180 };
}

/**
 * 중첩 사각 격자(클립맵 비슷한 LOD) 배치. 단계 i 의 칸 크기 = baseM·2^i, 한 변 n 칸(짝수, 4의 배수).
 * 단계 0 은 꽉 찬 사각형, 단계 i ≥ 1 은 가운데(단계 i−1 이 덮는 부분, 반폭 = 자기 반폭/2)를 비운 고리.
 * 기본 base 30 m · n 128 · 5단계 → 반폭 1.92 / 3.84 / 7.68 / 15.4 / 30.7 km (모서리 ≈ 43 km).
 * 반환 [{ level, cell, half, innerHalf }]
 */
export function gridLayout({ baseM = 30, n = 128, levels = 5 } = {}) {
  if (n % 4 || n < 8) throw new Error("gridLayout: n must be a multiple of 4 (≥ 8)");
  const out = [];
  for (let i = 0; i < levels; i++) {
    const cell = baseM * 2 ** i, half = (n / 2) * cell;
    out.push({ level: i, cell, half, innerHalf: i ? half / 2 : 0 });
  }
  return out;
}

/**
 * 한 단계의 꼭짓점·삼각형. 고리(innerHalf > 0)는 안쪽 구멍 「안」 꼭짓점을 만들지 않는다(경계는 포함).
 * 반환 { en: Float64Array[2·V] (e, n), index: Uint32Array, stitch: [[i, a, b]] (바깥 테두리의 홀수 꼭짓점 i 는 a·b 평균 높이로 → 바깥 단계와 틈 없음), count }
 */
export function levelMesh({ cell, half, innerHalf }, n = Math.round((2 * half) / cell)) {
  const N = n + 1, idx = new Int32Array(N * N).fill(-1), en = [];
  const ih = Math.round(innerHalf / cell); // 안쪽 구멍 반폭(칸 수)
  const c = n / 2;
  const inHole = (i, j) => ih > 0 && Math.abs(i - c) < ih && Math.abs(j - c) < ih; // 구멍 「안」(경계 제외)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (inHole(i, j)) continue;
    idx[j * N + i] = en.length / 2;
    en.push((i - c) * cell, (j - c) * cell);
  }
  const tri = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    // 칸 중심이 구멍 안이면 건너뜀
    if (ih > 0 && Math.abs(i + 0.5 - c) < ih && Math.abs(j + 0.5 - c) < ih) continue;
    const a = idx[j * N + i], b = idx[j * N + i + 1], d = idx[(j + 1) * N + i], e = idx[(j + 1) * N + i + 1];
    // 반시계(위에서 볼 때, e 동·n 북) → three 에서 y 가 위, z = −n 이므로 (a, b, e)(a, e, d) 는 위를 향함
    tri.push(a, b, e, a, e, d);
  }
  const stitch = [];
  const edge = (i, j) => idx[j * N + i];
  for (let k = 1; k < n; k += 2) {
    stitch.push([edge(k, 0), edge(k - 1, 0), edge(k + 1, 0)]);
    stitch.push([edge(k, n), edge(k - 1, n), edge(k + 1, n)]);
    stitch.push([edge(0, k), edge(0, k - 1), edge(0, k + 1)]);
    stitch.push([edge(n, k), edge(n, k - 1), edge(n, k + 1)]);
  }
  return { en: Float64Array.from(en), index: Uint32Array.from(tri), stitch, count: en.length / 2 };
}

/**
 * 전체 지형 격자 계획: 단계별 메시 + 고도 질의 점 목록(관측점 [0] 포함).
 * 반환 { levels:[{...layout, mesh}], points:[{lat, lon, resM}], offsets:[각 단계 첫 점의 points 위치], vertices, triangles }
 */
export function terrainPlan(lat0, lon0, opt = {}) {
  const lay = gridLayout(opt);
  const points = [{ lat: lat0, lon: lon0, resM: opt.baseM ?? 30 }];
  const levels = [], offsets = [];
  let tris = 0;
  for (const L of lay) {
    const mesh = levelMesh(L, opt.n ?? 128);
    offsets.push(points.length);
    for (let v = 0; v < mesh.count; v++) {
      const p = fromLocal(lat0, lon0, mesh.en[2 * v], mesh.en[2 * v + 1]);
      points.push({ lat: p.lat, lon: p.lon, resM: L.cell });
    }
    tris += mesh.index.length / 3;
    levels.push({ ...L, mesh });
  }
  return { levels, points, offsets, vertices: points.length - 1, triangles: tris };
}

/**
 * 고도 → 단계별 z (곡률 낙차 적용, 바다·빈 값 처리, 테두리 맞춤). elev: points 와 같은 길이 (null 허용)
 * fill: 빈 값 대신 쓸 고도(기본 0 m). 반환 [Float32Array z(V)] 단계별 + groundM(관측점, 모르면 null) + okFrac
 */
export function terrainHeights(plan, elev, { fill = 0, clampSea = true, k = REFRACTION_K, clearM = 45 } = {}) {
  const fin = (v) => typeof v === "number" && isFinite(v);
  let ok = 0;
  for (const v of elev) if (fin(v)) ok++;
  const val = (v) => (fin(v) ? (clampSea ? Math.max(0, v) : v) : fill);
  const g0 = elev[0];
  const groundM = typeof g0 === "number" && isFinite(g0) ? (clampSea ? Math.max(0, g0) : g0) : null;
  const zs = plan.levels.map((L, li) => {
    const { mesh } = L, off = plan.offsets[li], z = new Float32Array(mesh.count);
    for (let v = 0; v < mesh.count; v++) {
      const e = mesh.en[2 * v], n = mesh.en[2 * v + 1];
      z[v] = val(elev[off + v]) - curvatureDrop(Math.hypot(e, n), k);
    }
    for (const [i, a, b] of mesh.stitch) if (i >= 0 && a >= 0 && b >= 0) z[i] = (z[a] + z[b]) / 2;
    // 관측점 바로 옆(clearM 이내)은 관측점 지면보다 높지 않게 — 30 m 격자 보간 경사가 눈앞을 막지 않도록 (TerrainCore 도 30 m 이내는 안 봄)
    if (groundM != null && clearM > 0) for (let v = 0; v < mesh.count; v++) {
      if (Math.hypot(mesh.en[2 * v], mesh.en[2 * v + 1]) <= clearM) z[v] = Math.min(z[v], groundM - 0.3);
    }
    return z;
  });
  return { zs, groundM, okFrac: ok / Math.max(1, elev.length) };
}

/** 바깥 바다·평지 고리 (지형 끝 ~ farM): 곡률 낙차만 따르는 원판 → 해수면 수평선 내림각이 저절로 생김.
 * 반환 { en: Float64Array, z: Float32Array, index: Uint32Array } */
export function skirtMesh({ innerM, farM = 180000, rings = 18, segs = 96, sinkM = 4, k = REFRACTION_K } = {}) {
  const rs = [];
  for (let i = 0; i <= rings; i++) rs.push(innerM * (farM / innerM) ** (i / rings));
  const en = [], z = [], idx = [];
  for (const r of rs) for (let s = 0; s < segs; s++) {
    const a = (s / segs) * 2 * Math.PI;
    en.push(r * Math.sin(a), r * Math.cos(a)); z.push(-curvatureDrop(r, k) - sinkM);
  }
  for (let i = 0; i < rings; i++) for (let s = 0; s < segs; s++) {
    const a = i * segs + s, b = i * segs + ((s + 1) % segs), c = a + segs, d = b + segs;
    idx.push(a, b, c, b, d, c); // 위(+y)를 향하는 순서
  }
  return { en: Float64Array.from(en), z: Float32Array.from(z), index: Uint32Array.from(idx) };
}

/** 지형 색 (0..1 RGB): 고도·경사(법선 y)로. 낮은 곳 녹색 → 높은 곳 갈색·회색, 가파르면 바위색 */
export function terrainColor(hM, ny) {
  const t = Math.max(0, Math.min(1, hM / 900));
  const low = [0.30, 0.40, 0.25], high = [0.47, 0.42, 0.34], rock = [0.42, 0.40, 0.38], water = [0.18, 0.26, 0.34];
  if (hM <= 0.5) return water;
  const base = low.map((v, i) => v + (high[i] - v) * t);
  const s = Math.max(0, Math.min(1, (0.93 - ny) / 0.35)); // 경사(0 평지 … 1 가파름)
  return base.map((v, i) => v + (rock[i] - v) * s);
}

/* ===== 카메라 ===== */
/** 풀프레임 렌즈 가로·세로 화각(도) */
export function lensFovDeg(mm) {
  return { h: 2 * Math.atan(18 / mm) * R2D, v: 2 * Math.atan(12 / mm) * R2D };
}
/** 보기 가로 화각: 렌즈가 있으면 틀이 화면의 약 75% 가 되게(여유를 두고), 없으면 60° */
export function viewHFov(lensMm, { none = 60, margin = 1.35, min = 1, max = 110 } = {}) {
  if (!lensMm) return none;
  const h = lensFovDeg(lensMm).h;
  const t = Math.tan((h / 2) * D2R) * margin;
  return Math.max(min, Math.min(max, 2 * Math.atan(t) * R2D));
}
/** 가로 화각 → 세로 화각 (three.js PerspectiveCamera.fov 는 세로) */
export const vFovFromH = (hDeg, aspect) => 2 * Math.atan(Math.tan((hDeg / 2) * D2R) / aspect) * R2D;

/** 방위(도, 북 0° 시계) · 고도(도) → three 좌표 단위벡터 [x(동), y(위), z(−북)] */
export function dirVec(azDeg, altDeg) {
  const a = azDeg * D2R, h = altDeg * D2R;
  return [Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h)];
}
/** three 좌표 벡터 → {az, alt} */
export function vecDir([x, y, z]) {
  const r = Math.hypot(x, y, z) || 1;
  return { az: ((Math.atan2(x, -z) * R2D) % 360 + 360) % 360, alt: Math.asin(y / r) * R2D };
}

/**
 * 처음 바라볼 방향: 구조물 방위, 구조물 높이 가운데의 겉보기 고도(곡률 반영).
 * 반환 { yaw, pitch } 도
 */
export function aimAt(obs, target, { k = REFRACTION_K } = {}) {
  const L = toLocal(obs.lat, obs.lon, target.lat, target.lon);
  const yaw = ((Math.atan2(L.e, L.n) * R2D) + 360) % 360;
  const zc = (target.baseM || 0) + (target.heightM || 0) / 2 - curvatureDrop(L.d, k);
  const pitch = Math.atan2(zc - obs.zM, Math.max(1, L.d)) * R2D;
  return { yaw, pitch, distM: L.d };
}

/** 각도 제한: 지상 보기 −45..+85°, 드론 −90..+60° */
export function clampPitch(p, mode = "ground") {
  return mode === "drone" ? Math.max(-90, Math.min(60, p)) : Math.max(-45, Math.min(85, p));
}

/** 화각 비율로 렌즈 틀 (직선 원근: 화면 가로 W 가 viewH 화각) → {x, y, w, h} px, 가운데 */
export function frameRect(lensMm, viewHDeg, W, H) {
  if (!lensMm) return null;
  const f = lensFovDeg(lensMm), tv = Math.tan((viewHDeg / 2) * D2R);
  const w = (W * Math.tan((f.h / 2) * D2R)) / tv, h = (W * Math.tan((f.v / 2) * D2R)) / tv;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/** 각지름 δ(도) 의 원반을 거리 D 에 놓을 때의 크기(지름 m) */
export const discSize = (diamDeg, D) => 2 * D * Math.tan((diamDeg / 2) * D2R);

/* ===== 하늘 색 (해 고도 기준) ===== */
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.max(0, Math.min(1, t)));
/** 해 고도(도) → { zenith, horizon, fog, sun (직사광 세기 0..1), amb (주변광 0..1), night (0..1), stars } */
export function skyColors(sunAlt) {
  const day = { z: [0.23, 0.45, 0.80], h: [0.70, 0.82, 0.93] };
  const gold = { z: [0.25, 0.38, 0.66], h: [0.98, 0.72, 0.45] };
  const civil = { z: [0.10, 0.16, 0.36], h: [0.80, 0.52, 0.42] };
  const naut = { z: [0.03, 0.06, 0.16], h: [0.16, 0.20, 0.36] };
  const night = { z: [0.01, 0.02, 0.05], h: [0.05, 0.07, 0.13] };
  let z, h;
  if (sunAlt >= 10) { z = day.z; h = day.h; }
  else if (sunAlt >= 0) { const t = sunAlt / 10; z = mix(gold.z, day.z, t); h = mix(gold.h, day.h, t); }
  else if (sunAlt >= -6) { const t = (sunAlt + 6) / 6; z = mix(civil.z, gold.z, t); h = mix(civil.h, gold.h, t); }
  else if (sunAlt >= -12) { const t = (sunAlt + 12) / 6; z = mix(naut.z, civil.z, t); h = mix(naut.h, civil.h, t); }
  else if (sunAlt >= -18) { const t = (sunAlt + 18) / 6; z = mix(night.z, naut.z, t); h = mix(night.h, naut.h, t); }
  else { z = night.z; h = night.h; }
  const sun = Math.max(0, Math.min(1, (sunAlt + 1) / 8));
  const amb = 0.08 + 0.42 * Math.max(0, Math.min(1, (sunAlt + 12) / 22));
  const nightF = Math.max(0, Math.min(1, (-sunAlt - 6) / 8));
  return { zenith: z, horizon: h, fog: h, sun, amb, night: nightF, stars: sunAlt < -10 };
}

/* ===== 드론 ===== */
export const DRONE_MAX_AGL = 150; // 한국 항공안전법: 지표 150 m 미만 (그 이상은 승인 필요)
/** 50 m 단위 이동: dir N|S|E|W → 새 (dE, dN) */
export function nudge(off, dir, step = 50) {
  const d = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] }[dir] || [0, 0];
  return { e: off.e + d[0] * step, n: off.n + d[1] * step };
}
/**
 * 비행구역 확인 결과 → 배너 { cls, key, items, links }. cls: prohibited(빨강)·restricted(주황)·control(노랑)·caution(노랑)·none(회색)·unknown(회색)
 * key 는 i18n 키. 「비행 가능」이라고는 절대 말하지 않는다 — none 이어도 「알려진 금지·제한구역 아님 (승인·허가는 별도)」.
 */
export const ONESTOP_URL = "https://drone.onestop.go.kr/";
export function zoneBanner(res) {
  const lv = res && typeof res.level === "string" ? res.level : "unknown";
  const known = ["prohibited", "restricted", "control", "caution", "none"].includes(lv) ? lv : "unknown";
  const links = Array.isArray(res?.links) ? res.links.filter((l) => l && /^https:\/\//.test(l.url)).slice(0, 4) : [];
  if (known === "unknown" || !links.some((l) => l.url.startsWith(ONESTOP_URL))) links.push({ label: "drone.onestop.go.kr", url: ONESTOP_URL, onestop: true });
  return {
    cls: known, key: "v3.zone." + known,
    items: Array.isArray(res?.items) ? res.items.filter((x) => x && x.name).slice(0, 4) : [],
    notes: Array.isArray(res?.notes) ? res.notes.filter((x) => typeof x === "string").slice(0, 3) : [],
    links,
  };
}
