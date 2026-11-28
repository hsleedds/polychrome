/* 주변 건물 훅 — 실루엣·3D 풍경·드론 보기가 함께 쓴다. 지금은 자료가 없다 (flag buildings=false).
 * 나중에 국토교통부 GIS건물통합정보(건물 외곽선 + 높이/층수)를 서버 함수로 잘라 보내면 setBuildingSource() 로 연결한다.
 *
 * buildingSource 인터페이스:
 *   { id, attribution, buildingsNear(lat, lon, radiusKm) → Promise<[{ footprint: [[lat, lon], ...], heightM, baseM? }]> }
 *   footprint 는 닫히지 않은 외곽선(시계·반시계 무관), heightM 은 지면에서 지붕까지, baseM 은 지면 해발(없으면 지형에서).
 * 순수 계산(DOM 없음): footprintLocal · extrudeFootprint · buildingPolygons — Node 테스트 가능. */
import { toLocal, curvatureDrop } from "./view3d-calc.js";

let source = null;
export function setBuildingSource(src) { source = src && typeof src.buildingsNear === "function" ? src : null; }
export const buildingSource = () => source;
/** 자료가 있으면 건물 목록, 없으면 null (자료 준비 중) */
export async function buildingsNear(lat, lon, radiusKm) {
  if (!source) return null;
  try { const a = await source.buildingsNear(lat, lon, radiusKm); return Array.isArray(a) ? a.filter(validBuilding) : []; }
  catch (e) { console.warn("buildings", e); return null; }
}
export const validBuilding = (b) => !!b && Array.isArray(b.footprint) && b.footprint.length >= 3 && isFinite(b.heightM) && b.heightM > 0 &&
  b.footprint.every((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]));

/** 외곽선 → 관측점 기준 지역 [e, n, d] */
export const footprintLocal = (b, lat0, lon0) => b.footprint.map(([la, lo]) => { const L = toLocal(lat0, lon0, la, lo); return [L.e, L.n, L.d]; });

/**
 * 외곽선을 상자로 올림 (three 좌표: x=e, y=높이−곡률 낙차, z=−n). 지붕은 부채꼴 삼각형(볼록 가정 — 오목하면 근사).
 * 반환 { pos: number[] (x,y,z…), index: number[] }
 */
export function extrudeFootprint(b, lat0, lon0, groundM = 0) {
  const P = footprintLocal(b, lat0, lon0), n = P.length, base = isFinite(b.baseM) ? b.baseM : groundM;
  const pos = [], index = [];
  for (const [e, nn, d] of P) { const dr = curvatureDrop(d); pos.push(e, base - dr, -nn); }
  for (const [e, nn, d] of P) { const dr = curvatureDrop(d); pos.push(e, base + b.heightM - dr, -nn); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; index.push(i, j, n + j, i, n + j, n + i); }
  for (let i = 1; i < n - 1; i++) index.push(n, n + i, n + i + 1);
  return { pos, index };
}

/**
 * 실루엣 차트용: 건물마다 모서리(바닥·지붕)를 방위·겉보기 고도로 투영한 볼록 껍질 [[az, alt]] (관측점에서 30 m 이내·뒤쪽 건물 제외).
 * obs = { lat, lon, zM (지면+눈높이) }, azC 중심 방위(펼치기용)
 */
export function buildingPolygons(list, obs, azC = 0) {
  const out = [];
  for (const b of list || []) {
    if (!validBuilding(b)) continue;
    const base = isFinite(b.baseM) ? b.baseM : 0, pts = [];
    for (const [e, n, d] of footprintLocal(b, obs.lat, obs.lon)) {
      if (d < 30) { pts.length = 0; break; }
      let az = Math.atan2(e, n) * 180 / Math.PI; az = azC + ((((az - azC) % 360) + 540) % 360 - 180);
      for (const h of [base, base + b.heightM]) pts.push([az, Math.atan2(h - curvatureDrop(d) - obs.zM, d) * 180 / Math.PI]);
    }
    if (pts.length >= 3) out.push(hull(pts));
  }
  return out;
}
function hull(pts) {
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  lo.pop(); hi.pop(); return lo.concat(hi);
}
