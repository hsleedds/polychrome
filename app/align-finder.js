/* 겹치는 날짜 찾기 (순수 계산, DOM 없음 — Node 테스트 가능).
 * 「구조물 위쪽 1/3 부터 꼭대기 위 5° 까지」 해·달이 구조물과 겹치는 시각을 앞으로 N일 동안 찾는다.
 *
 * ── 판정 규칙 (원반 중심 방위 az·겉보기 고도 alt, 반지름 r = diamDeg/2) ──
 *  baseAlt = sil.base.alt (구조물 원점 지면), topAlt = sil.top.alt (LandmarkCore.silhouette, 이 관측점 기준)
 *  세로 띠: lo = baseAlt + 2/3·(topAlt − baseAlt) ≤ alt ≤ hi = topAlt + 5°            (원반 중심 기준)
 *  가로:
 *   · alt ≤ topAlt (「상단부」): 높이 alt 의 수평선이 실루엣 다각형(볼록)들을 자르는 방위 구간들 중 하나라도
 *     [a0 − r, a1 + r] 안에 원반 중심 방위가 있으면 겹침. (원반이 그 높이의 구조물 단면과 옆으로 닿거나 겹침)
 *   · alt > topAlt (「꼭대기 위」): 위쪽 1/3 부분(각 다각형을 alt ≥ lo 로 자른 조각)의 방위 범위들 중 하나를
 *     [a0 − r, a1 + r] 로 넓혀 그 안에 원반 중심 방위가 있으면 겹침. (구조물 「바로 위」 기둥 영역)
 *  지형: horizon(az) 이 주어지면 원반 중심 alt ≥ horizon(az) 일 때만 (언덕 뒤에 숨은 때 제외).
 *        지형이 없으면 alt > minAlt(기본 −1°).
 *
 * ── 탐색 (휴대폰 Safari 에서 빠르게) ──
 *  1) 고도 건너뛰기: 해·달의 고도 변화 속도는 15°/h·cos(위도) 이하(< 0.26°/분)이므로, 띠에서 고도로 d° 떨어져 있으면
 *     d/0.26 분 동안은 띠에 들어올 수 없다 → 그만큼 건너뜀 (밤의 해, 높이 뜬 해 등 대부분의 시간).
 *  2) 거친 걸음(coarseMin, 기본 10분): 띠 근처에서는 10분 간격 두 점을 이은 선분이 [방위 범위 ± (r + 3°)] ×
 *     [lo − r − 1°, hi + r + 1°] 상자에 닿을 때만 그 10분을 1분 간격으로 다시 계산.
 *  3) 1분 표본의 참 구간을 이어 창(window)으로 묶는다. 5분(mergeGapMin) 이하 끊김은 한 창으로 합친다.
 *  createScan() 은 조금씩 돌릴 수 있는 스캐너(step(예산 ms))를 돌려준다 → UI 가 setTimeout 으로 나눠 실행·취소. */
import { unwrapAz } from "./silhouette-calc.js";

const ALT_RATE = 0.26; // °/분 상한
const MIN = 60e3;

/** 판정 기하 준비. sil: LandmarkCore.silhouette 결과 */
export function alignBand(sil, { above = 5 } = {}) {
  const baseAlt = sil.base.alt, topAlt = sil.top.alt, c = sil.bearingDeg;
  const lo = baseAlt + (2 / 3) * (topAlt - baseAlt), hi = topAlt + above;
  const polys = [], upper = [];
  for (const poly of sil.polygons || []) {
    let pMin = Infinity, pMax = -Infinity;
    for (const [, h] of poly) { if (h < pMin) pMin = h; if (h > pMax) pMax = h; }
    if (pMax < lo) continue; // 위쪽 1/3 에 닿지 않는 조각
    const P = poly.map(([a, h]) => [unwrapAz(a, c), h]);
    polys.push({ P, pMin, pMax });
    // alt ≥ lo 로 자른 조각의 방위 범위
    let a0 = Infinity, a1 = -Infinity;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length];
      if (p[1] >= lo) { if (p[0] < a0) a0 = p[0]; if (p[0] > a1) a1 = p[0]; }
      if ((p[1] - lo) * (q[1] - lo) < 0) { const a = p[0] + (q[0] - p[0]) * (lo - p[1]) / (q[1] - p[1]); if (a < a0) a0 = a; if (a > a1) a1 = a; }
    }
    if (a1 >= a0) upper.push([a0, a1]);
  }
  let azLo = Infinity, azHi = -Infinity;
  for (const [a, b] of upper) { if (a < azLo) azLo = a; if (b > azHi) azHi = b; }
  if (!(azHi >= azLo)) { azLo = azHi = unwrapAz(sil.top.az, c); }
  return { c, baseAlt, topAlt, lo, hi, polys, upper, azLo, azHi };
}

/** 높이 h 에서 볼록 다각형 단면의 방위 구간 (없으면 null) */
function sliceAt(P, h) {
  let a0 = Infinity, a1 = -Infinity;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    if ((p[1] - h) * (q[1] - h) <= 0) {
      const a = q[1] === p[1] ? Math.min(p[0], q[0]) : p[0] + (q[0] - p[0]) * (h - p[1]) / (q[1] - p[1]);
      const b = q[1] === p[1] ? Math.max(p[0], q[0]) : a;
      if (a < a0) a0 = a; if (b > a1) a1 = b;
    }
  }
  return a1 >= a0 ? [a0, a1] : null;
}

/** 한 순간 판정 → null | "upper"(상단부) | "above"(꼭대기 위). az 는 0..360 또는 펼친 값, alt 겉보기, r 반지름 */
export function bandHit(B, az, alt, r) {
  if (alt < B.lo || alt > B.hi) return null;
  const a = unwrapAz(az, B.c);
  if (a < B.azLo - r - 1e-9 || a > B.azHi + r + 1e-9) return null;
  if (alt > B.topAlt) {
    for (const [a0, a1] of B.upper) if (a >= a0 - r && a <= a1 + r) return "above";
    return null;
  }
  for (const p of B.polys) {
    if (alt < p.pMin || alt > p.pMax) continue;
    const s = sliceAt(p.P, alt);
    if (s && a >= s[0] - r && a <= s[1] + r) return "upper";
  }
  return null;
}

/**
 * 스캐너. opts:
 *  sil, pos(Date) → {az, alt(겉보기), diamDeg}, t0, t1 (ms), horizon?(az) → alt|null, minAlt=−1, coarseMin=10, above=5, mergeGapMin=5
 * 반환 { step(budgetMs=Infinity) → done, progress(), result() → windows, stats }
 * window: {start, end, mid(ms), minAlt, maxAlt, where:"upper"|"above"|"both", rising}
 */
export function createScan(o) {
  const B = alignBand(o.sil, { above: o.above ?? 5 });
  const pos = o.pos, hz = o.horizon || null, minAlt = o.minAlt ?? -1, cm = (o.coarseMin ?? 10);
  const t0 = Math.floor(o.t0 / MIN) * MIN, t1 = o.t1;
  const stats = { evals: 0, refined: 0, ms: 0 };
  const hits = []; // [{t, alt, where}]
  const P = (t) => { stats.evals++; const p = pos(new Date(t)); return { t, az: unwrapAz(p.az, B.c), alt: p.alt, r: (p.diamDeg || 0.53) / 2 }; };
  const test = (s) => {
    const w = bandHit(B, s.az, s.alt, s.r);
    if (!w) return null;
    if (hz) { const h = hz(((s.az % 360) + 360) % 360); if (h != null && isFinite(h) && s.alt < h) return null; }
    else if (s.alt <= minAlt) return null;
    return w;
  };
  let t = t0, p = null, done = false;
  const lastHit = { t: -Infinity };
  function refine(a, b) { // a..b (ms, 양끝 포함) 1분 간격
    for (let u = a; u <= b; u += MIN) {
      if (u <= lastHit.t) continue;
      const s = P(u), w = test(s); stats.refined++;
      if (w) hits.push({ t: u, alt: s.alt, where: w });
      lastHit.t = u;
    }
  }
  function step(budgetMs = Infinity) {
    if (done) return true;
    const start = Date.now();
    let n = 0;
    while (t < t1) {
      if (!p) p = P(t);
      const r = p.r;
      const dAlt = p.alt < B.lo - r ? B.lo - r - p.alt : p.alt > B.hi + r ? p.alt - B.hi - r : 0;
      if (dAlt > 1) { // 고도 건너뛰기
        const skip = Math.max(1, Math.floor((dAlt - 0.5) / ALT_RATE));
        t = Math.min(t1, t + skip * MIN); p = null;
      } else {
        const tq = Math.min(t1, t + cm * MIN), q = P(tq);
        const aMin = Math.min(p.az, q.az), aMax = Math.max(p.az, q.az), hMin = Math.min(p.alt, q.alt), hMax = Math.max(p.alt, q.alt);
        const m = Math.max(p.r, q.r);
        if (aMax >= B.azLo - m - 3 && aMin <= B.azHi + m + 3 && hMax >= B.lo - m - 1 && hMin <= B.hi + m + 1) refine(t, tq);
        t = tq; p = q;
        if (tq >= t1) break;
      }
      if ((++n & 31) === 0 && Date.now() - start >= budgetMs) break;
    }
    stats.ms += Date.now() - start;
    if (t >= t1) done = true;
    return done;
  }
  const gap = (o.mergeGapMin ?? 5) * MIN; // 짧은 끊김(다리 상판 틈 등)은 한 창으로
  function result() {
    const out = []; let cur = null;
    for (const h of hits) {
      if (cur && h.t - cur.end <= gap) {
        cur.end = h.t; cur.minAlt = Math.min(cur.minAlt, h.alt); cur.maxAlt = Math.max(cur.maxAlt, h.alt);
        if (cur.where !== h.where) cur.where = "both";
        cur.lastAlt = h.alt;
      } else { cur = { start: h.t, end: h.t, minAlt: h.alt, maxAlt: h.alt, where: h.where, firstAlt: h.alt, lastAlt: h.alt }; out.push(cur); }
    }
    for (const w of out) { w.mid = Math.round((w.start + w.end) / 2 / MIN) * MIN; w.rising = w.lastAlt > w.firstAlt; delete w.firstAlt; delete w.lastAlt; }
    return out;
  }
  return { step, done: () => done, progress: () => Math.min(1, (t - t0) / Math.max(1, t1 - t0)), result, stats, band: B };
}

/** 한 번에 끝까지 (Node 테스트·간단 사용) */
export function findAlignWindows(o) { const s = createScan(o); s.step(Infinity); return { windows: s.result(), stats: s.stats, band: s.band }; }

/** 해 고도로 하늘 상태: day(> −0.833°) · twilight(−12° 까지, 시민+항해 박명) · night */
export const skyState = (sunAlt) => (sunAlt > -0.833 ? "day" : sunAlt >= -12 ? "twilight" : "night");

/** 연속된 날짜(같은 천체)끼리 묶기. rows: [{ymd, body, ...}] (시간순) → [[row, ...], ...] */
export function groupDays(rows, addDays) {
  const out = []; let g = null;
  for (const r of rows) {
    const prev = g && g[g.length - 1];
    if (prev && prev.body === r.body && (prev.ymd === r.ymd || addDays(prev.ymd, 1) === r.ymd)) g.push(r);
    else { g = [r]; out.push(g); }
  }
  return out;
}

/** 캐시 키 */
export const scanKey = (o) => [o.id, (+o.lat).toFixed(5), (+o.lon).toFixed(5), o.eye, Math.round(o.groundM ?? 0), o.terrain ? 1 : 0, o.body, o.from].join("|");
