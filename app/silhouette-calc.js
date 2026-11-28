/* 실루엣 미리보기 순수 계산 (DOM 없음, Node 테스트 가능).
 * 좌표: 방위각 az(도, 북 0° 시계방향) · 겉보기 고도 alt(도). 차트는 az-alt 등각 격자(가로·세로 같은 px/도). */

export const wrap180 = (x) => { x = (((x % 360) + 360) % 360); return x >= 180 ? x - 360 : x; };
/** 중심 방위 c 주변으로 펼친 방위 (c−180 ≤ 값 < c+180) */
export const unwrapAz = (az, c) => c + wrap180(az - c);

/** 등각 화면 투영. W×H px(viewBox) 안에 가로 azC±azHalf, 세로 altMin..(altMin + H/k) */
export function makeView({ azC, azHalf, altMin, W = 1000, H = 700 }) {
  const k = W / (2 * azHalf); // px / 도 (가로·세로 같음)
  const altMax = altMin + H / k;
  return {
    azC, azHalf, altMin, altMax, W, H, k,
    x: (az) => (unwrapAz(az, azC) - (azC - azHalf)) * k,
    y: (alt) => (altMax - alt) * k,
    inside: (az, alt, m = 0) => Math.abs(wrap180(az - azC)) <= azHalf + m && alt >= altMin - m && alt <= altMax + m,
  };
}

/**
 * 창 크기 고르기. mode "fit": 구조물(+가장 가까운 궤적 구간)이 들어가게, "wide": ±60°.
 * sil: {bearingDeg, azRange, altRange} · focus: [{az, alt}] 함께 보여 줄 점들(선택) · aspect = H/W
 */
export function chooseWindow(sil, { mode = "fit", focus = [], aspect = 0.7, horizonAlt = 0, minHalf = 0.8 } = {}) {
  const azC = sil.bearingDeg;
  const [a0, a1] = sil.azRange, [h0, h1] = sil.altRange;
  if (mode === "wide") {
    const azHalf = 60, span = 2 * azHalf * aspect;
    const altMin = Math.min(h0, horizonAlt) - span * 0.08;
    return { azC, azHalf, altMin };
  }
  let lo = Math.min(h0, horizonAlt), hi = h1, halfAz = Math.max(Math.abs(a0 - azC), Math.abs(a1 - azC));
  for (const p of focus) {
    if (!p) continue;
    halfAz = Math.max(halfAz, Math.abs(wrap180(p.az - azC)) + (p.r || 0));
    hi = Math.max(hi, p.alt + (p.r || 0)); lo = Math.min(lo, p.alt - (p.r || 0));
  }
  const hSpan = (hi - lo) * 1.25 + 0.2; // 위아래 여백
  let azHalf = Math.max(minHalf, halfAz * 1.25, hSpan / aspect / 2);
  azHalf = Math.min(60, azHalf);
  const span = 2 * azHalf * aspect;
  // 땅이 아래 10% 정도 보이게, 남는 높이는 위로
  const altMin = lo - Math.max(span * 0.1, (span - (hi - lo)) * 0.3);
  return { azC, azHalf, altMin };
}

/** 시간 구간 표본: fn(Date) → {az, alt, ...}. 반환 [{t(ms), ...}] */
export function samplePath(fn, t0, t1, stepMin = 1) {
  const out = [], step = stepMin * 60e3;
  for (let t = t0; t <= t1 + 1; t += step) out.push({ t, ...fn(new Date(t)) });
  return out;
}

/** 지평선(−2° 기본) 위 구간 [첫 시각, 마지막 시각] (없으면 null) */
export function aboveSpan(samples, minAlt = -2) {
  let a = null, b = null;
  for (const s of samples) if (s.alt > minAlt) { if (a == null) a = s.t; b = s.t; }
  return a == null ? null : [a, b];
}

/** envelope [[az, alt|null]] → 방위 az 에서 구조물 윗선 고도(선형 보간, 밖이면 null) */
export function envelopeAt(env, az) {
  if (!env || !env.length) return null;
  const n = env.length, a0 = env[0][0], a1 = env[n - 1][0];
  if (az < a0 || az > a1) return null;
  const f = a1 > a0 ? (az - a0) / (a1 - a0) * (n - 1) : 0, i = Math.min(n - 2, Math.max(0, Math.floor(f)));
  const p = env[i], q = env[Math.min(n - 1, i + 1)];
  if (p[1] == null && q[1] == null) return null;
  if (p[1] == null) return q[1]; if (q[1] == null) return p[1];
  return p[1] + (q[1] - p[1]) * (f - i);
}

/** 연속된 참 구간 → [{start, end}] (start·end 는 표본 t) */
export function runs(samples, pred) {
  const out = []; let cur = null;
  for (const s of samples) {
    if (pred(s)) { if (!cur) { cur = { start: s.t, end: s.t }; out.push(cur); } else cur.end = s.t; }
    else cur = null;
  }
  return out;
}

/**
 * 꼭대기 띠: envelope 에서 윗선이 top.alt − tol 이상인 방위 범위 [a0, a1] (탑이면 첨탑 근처, 다리면 상판 전체)
 */
export function topBand(sil, tol = 0.5) {
  let a0 = Infinity, a1 = -Infinity;
  for (const [az, alt] of sil.envelope || []) if (alt != null && alt >= sil.top.alt - tol) { if (az < a0) a0 = az; if (az > a1) a1 = az; }
  if (!(a1 >= a0)) { const c = unwrapAz(sil.top.az, sil.bearingDeg); return [c, c]; }
  return [a0, a1];
}

/**
 * 구조물 꼭대기 통과 구간 찾기.
 * 조건: 원반 중심 방위가 꼭대기 띠(topBand, ±반지름) 안, 고도가 꼭대기 고도 ± 지름.
 * sil: {bearingDeg, envelope, top} · samples: [{t, az, alt(겉보기), diamDeg}]
 * 반환 {windows:[{start,end}], closest:{t, dAz, dAlt, az, alt, dist} | null}
 */
export function overlapWindows(sil, samples, { minAlt = -2 } = {}) {
  const c = sil.bearingDeg;
  const d0 = samples.find((s) => s.diamDeg)?.diamDeg || 0.5;
  const [b0, b1] = topBand(sil, d0);
  const ok = (s) => {
    if (s.alt <= minAlt) return false;
    const d = s.diamDeg || 0.5, az = unwrapAz(s.az, c);
    return az >= b0 - d / 2 && az <= b1 + d / 2 && Math.abs(s.alt - sil.top.alt) <= d;
  };
  const windows = runs(samples, ok);
  // 가장 가까울 때: 꼭대기 점까지 각거리(방위차는 cos(고도) 보정)
  let closest = null, best = Infinity;
  const topAz = unwrapAz(sil.top.az, c);
  for (const s of samples) {
    if (s.alt <= minAlt) continue;
    const dAz = wrap180(s.az - topAz), dAlt = s.alt - sil.top.alt;
    const d = Math.hypot(dAz * Math.cos(s.alt * Math.PI / 180), dAlt);
    if (d < best) { best = d; closest = { t: s.t, dAz, dAlt, az: s.az, alt: s.alt, dist: d }; }
  }
  return { windows, closest };
}

/**
 * 달 위상 모양 SVG path (중심 0,0, 반지름 r, 밝은 쪽 = +x). illum 0..1.
 * 밝은 반원(위→오른쪽→아래) + 명암 경계 타원(아래→위). 회전은 phaseRotation() 으로.
 */
export function moonLitPath(r, illum) {
  const k = Math.max(0, Math.min(1, illum));
  if (k <= 0.001) return "";
  const f = (v) => +v.toFixed(3);
  if (k >= 0.999) return `M${f(-r)} 0A${f(r)} ${f(r)} 0 1 1 ${f(r)} 0A${f(r)} ${f(r)} 0 1 1 ${f(-r)} 0Z`;
  const a = Math.abs(r * (2 * k - 1)) || 0.001; // 경계 타원 가로 반지름
  const sweep = k > 0.5 ? 1 : 0; // 볼록(차오른 달)이면 왼쪽(어두운 쪽)으로 부풂
  return `M0 ${f(-r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(r)}A${f(a)} ${f(r)} 0 0 ${sweep} 0 ${f(-r)}Z`;
}

/**
 * 밝은 가장자리 회전각(SVG rotate, 도, 화면 시계방향). θ = brightLimb − parallactic (천정 기준, 천정→동쪽(왼쪽) 방향).
 * 화면에서 밝은 쪽 단위벡터 = (−sin θ, −cos θ).
 */
export function phaseRotation(brightLimb, parallactic = 0) {
  const th = ((brightLimb ?? 270) - (parallactic ?? 0)) * Math.PI / 180;
  return Math.atan2(-Math.cos(th), -Math.sin(th)) * 180 / Math.PI;
}

/** 풀프레임(36×24) 가로 화각(도) */
export function lensFov(mm) {
  const r2d = 180 / Math.PI;
  return { h: 2 * Math.atan(18 / mm) * r2d, v: 2 * Math.atan(12 / mm) * r2d };
}

/** 정시 눈금: 표본 중 현지 정시(분 = 0). localMin(t) → 그 시각의 현지 분(0..1439) */
export function hourTicks(samples, localMin, minAlt = -2) {
  return samples.filter((s) => s.alt > minAlt && localMin(s.t) % 60 === 0).map((s) => ({ ...s, hour: Math.floor(localMin(s.t) / 60) }));
}

/** 원반 중심이 화면(창) 안에 있는 연속 구간 [{start, end}] (지평선 minAlt 위만) */
export function viewWindows(samples, view, minAlt = -2) {
  return runs(samples, (s) => s.alt > minAlt && view.inside(s.az, s.alt));
}

/** 궤적을 화면 점들로: 지평선 아래·창 밖·방위 0/360 건너뛰기에서 끊는다. 반환 [[[x,y],...], ...]
 *  strict=true 면 화면 안(view.inside) 표본만 (궤적은 「화면 안」 구간에서만 그림) */
export function pathSegments(samples, view, minAlt = -2, { strict = false } = {}) {
  const segs = []; let cur = null, prevAz = null;
  for (const s of samples) {
    const okAlt = s.alt > minAlt, d = wrap180(s.az - view.azC);
    const inWin = strict ? view.inside(s.az, s.alt) : Math.abs(d) <= view.azHalf + 5;
    const jump = prevAz != null && Math.abs(d - prevAz) > 90;
    prevAz = d;
    if (!okAlt || !inWin || jump) { cur = null; if (!(okAlt && inWin)) continue; }
    if (!cur) { cur = []; segs.push(cur); }
    cur.push([view.x(s.az), view.y(s.alt)]);
  }
  return segs.filter((s) => s.length > 1);
}

/** 가림 상태 합치기: clear < partial < behind */
export function worstState(...st) {
  const o = { clear: 0, partial: 1, behind: 2 };
  return st.filter(Boolean).reduce((a, b) => (o[b] > o[a] ? b : a), "clear");
}

/** 지형 지평선과 원반: 중심 고도 alt, 반지름 r, 그 방위 지평선 h */
export function horizonState(alt, r, h) {
  if (h == null || !isFinite(h)) return "clear";
  if (alt + r <= h) return "behind";
  if (alt - r < h) return "partial";
  return "clear";
}
