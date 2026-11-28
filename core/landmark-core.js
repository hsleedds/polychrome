/*! Polychrome Landmark Core v0.1.0 · © 2026 HYEOKSANG LEE. All rights reserved. */
/*  랜드마크 모델 라이브러리 → 관측자에서 본 실루엣(방위각·고도) 계산, 해·달 원반 가림 판정.
 *  의존성: SkyCore (bearing, distanceKm, apparentAlt) — 브라우저는 전역 SkyCore, Node는 require("./sky-core.js").
 *  단위: 각도 도(degree), 방위각 북 0° 시계방향, 거리 km(관측) / m(모델), 높이 m.
 *
 *  ── 모델 좌표 ──
 *  랜드마크 원점 = (lat, lon), 지면 = baseM(해발 m). 지역 좌표 x = 동(m), y = 북(m), z = baseM 위 높이(m).
 *  모든 부품(part) 공통 선택 필드:
 *    at: {lat, lon}   부품 원점을 다른 위경도로 (예: 잠실대교·청담대교처럼 떨어진 두 구조물)
 *    azDeg            부품 지역 좌표계를 시계방향으로 회전 — 부품의 +y 축이 방위 azDeg 를 향함 (기본 0 = 북)
 *    dzM              부품 전체를 위아래로 이동(m)
 *  ── 부품 원시형 (primitives) ──
 *    lathe : {profile:[[hM, rM], ...], center?:[x,y], segments=24}   회전체(N서울타워, 돔 드럼). 연속 두 단면마다 원뿔대 1조각.
 *    prism : {poly:[[x,y],...] | rect:[w,d], center?, bottomM, topM, topPoly? | topRect? | topScale?}
 *            각기둥/각뿔대. poly 는 볼록(convex)해야 함 — 오목한 평면은 여러 prism 으로 나눠 적는다.
 *    pylon : {radius | size:[w,d], center?, bottomM, topM, topRadius?}   기둥·안테나·교각 (prism/lathe 축약형)
 *    dome  : {center?:[x,y], radius, springM, riseM, segments=24}   타원체 돔 (springM 에서 시작, 꼭대기 springM+riseM)
 *    roof  : {rect:[w,d], center?, eaveM, ridgeM, ridgeLen, base?:{rect:[w,d], topM}}
 *            우진각(hip) 지붕: 처마 사각형(eaveM) + 용마루(지역 x 축 방향, 길이 ridgeLen, ridgeM). ridgeLen=w 면 맞배(gable).
 *            base 를 주면 석축 prism(0→base.topM)도 함께 만든다.
 *    deck  : {points:[[x,y],...], width, topM, bottomM, segM=50, piers?:{spacingM, size:[along, across], topM?}}
 *            교량 상판(폴리라인을 segM 이하 상자들로 분할), 교각은 0 → bottomM 기둥.
 *    arch  : {from:[x,y], to:[x,y], springM, riseM, thickness, width?, segments=12}   포물선 아치 리브(조각 상자들)
 *
 *  ── 실루엣 방식 ──
 *  각 부품은 볼록 조각(convex piece)들로 나뉜다(원뿔대, 상자, 돔, 지붕, 아치 마디). 조각의 모든 꼭짓점을
 *  관측자 기준 (방위각, 겉보기 고도)로 투영(SkyCore.bearing/distanceKm + apparentAlt: 지구 곡률·지상 굴절 k=0.13)한 뒤
 *  조각마다 2D 볼록 껍질(convex hull)을 만든다. 실루엣 = 이 다각형들의 합집합 (polygons 는 겹칠 수 있음).
 *  아치·상판을 조각으로 나누므로 아치 아래 하늘은 비어 있다. envelope 는 열(column) 샘플링한 윗선(스카이라인).
 *  방위각 연속성: 다각형 방위각은 중심 방위(bearingDeg) ±180° 범위로 펼친 값 — 0/360 근처에서 −2 나 361 같은 값이 나올 수 있다
 *  (그리기·가림 계산이 끊기지 않도록). 표시용 정규화는 norm360(). top/base 의 az 는 0..360.
 *  한계: 관측자가 구조물 안/바로 아래에 있으면(거리 ≈ 0, 뒤쪽 꼭짓점) 투영이 의미 없다. 지형·다른 건물 가림은 고려하지 않음. */
(function (G) {
  "use strict";
  const VERSION = "0.1.0";
  const Sky = G.SkyCore || (typeof require === "function" ? require("./sky-core.js") : null);
  if (!Sky) throw new Error("LandmarkCore: SkyCore required");
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const EARTH_M = 6371008.8, M_PER_DEG = EARTH_M * D2R;
  const norm360 = x => ((x % 360) + 360) % 360;
  const wrap180 = x => { x = norm360(x); return x >= 180 ? x - 360 : x; };

  /* ===== 라이브러리 ===== */
  let LIB = null;
  function setLibrary(data) { LIB = data && data.landmarks ? data : { landmarks: Array.isArray(data) ? data : [] }; return LIB; }
  function library() {
    if (!LIB && typeof require === "function") { try { setLibrary(require("../data/landmarks.json")); } catch (e) { /* 브라우저: setLibrary 로 주입 */ } }
    return LIB || { landmarks: [] };
  }
  const normName = s => String(s || "").toLowerCase().normalize("NFC").replace(/[\s·.,_\-()'’"]/g, "");
  function findLandmark(query, lib) {
    const L = (lib || library()).landmarks || [];
    if (query && typeof query === "object") return query;
    const q = normName(query); if (!q) return null;
    const keys = l => [l.id, l.name && l.name.ko, l.name && l.name.en, ...(l.aliases || [])].map(normName);
    return L.find(l => keys(l).includes(q)) || L.find(l => keys(l).some(k => k && (k.startsWith(q) || (q.length >= 2 && k.includes(q))))) || null;
  }
  const list = lib => ((lib || library()).landmarks || []).map(l => ({ id: l.id, name: l.name, kind: l.kind, lat: l.lat, lon: l.lon }));

  /* ===== 부품 → 볼록 조각 (지역 ENU m, z 는 baseM 기준) =====
   * 조각 = {rings:[[ [e,n,z], ...], ...]} — 같은 길이의 고리들을 아래→위로. 1점 고리는 꼭짓점(apex). */
  const rectPoly = (w, d) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  function frame(part, lm) {
    const az = (part.azDeg || 0) * D2R, c = Math.cos(az), s = Math.sin(az);
    let oe = 0, on = 0;
    if (part.at && lm) { // 부품 원점 → 랜드마크 원점 기준 동·북 m (짧은 거리 평면 근사)
      on = (part.at.lat - lm.lat) * M_PER_DEG;
      oe = (part.at.lon - lm.lon) * M_PER_DEG * Math.cos(lm.lat * D2R);
    }
    const dz = part.dzM || 0;
    // 지역 (x, y) → (e, n): +y 가 az 를 향하고 +x 는 그 오른쪽
    return (x, y, z) => [oe + x * c + y * s, on - x * s + y * c, z + dz];
  }
  const circle = (r, n, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => { const a = 2 * Math.PI * i / n; return [cx + r * Math.sin(a), cy + r * Math.cos(a)]; });
  const scalePoly = (poly, k) => { const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cy = poly.reduce((a, p) => a + p[1], 0) / poly.length; return poly.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]); };
  const shift = (poly, c) => c ? poly.map(([x, y]) => [x + c[0], y + c[1]]) : poly;
  const ring = (T, poly, z) => poly.map(([x, y]) => T(x, y, z));

  function boxPiece(T, a, b, halfW, z0, z1) { // a→b 선분을 축으로 폭 2·halfW, 높이 z0..z1 상자
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, px = -dy / L * halfW, py = dx / L * halfW;
    const q = [[a[0] + px, a[1] + py], [b[0] + px, b[1] + py], [b[0] - px, b[1] - py], [a[0] - px, a[1] - py]];
    return { rings: [ring(T, q, z0), ring(T, q, z1)] };
  }

  function partPieces(part, lm) {
    const T = frame(part, lm), seg = part.segments || 24, c = part.center;
    switch (part.type) {
      case "lathe": {
        const pr = part.profile || [], out = [];
        for (let i = 1; i < pr.length; i++) {
          const [h0, r0] = pr[i - 1], [h1, r1] = pr[i];
          out.push({ rings: [ring(T, shift(circle(r0, seg), c), h0), r1 > 0 ? ring(T, shift(circle(r1, seg), c), h1) : [T(c ? c[0] : 0, c ? c[1] : 0, h1)]] });
        }
        return out;
      }
      case "prism": case "pylon": {
        let base, top;
        if (part.poly) base = shift(part.poly, c);
        else if (part.rect) base = shift(rectPoly(part.rect[0], part.rect[1]), c);
        else if (part.size) base = shift(rectPoly(part.size[0], part.size[1]), c);
        else base = shift(circle(part.radius || 0.5, part.type === "pylon" ? 12 : seg), c);
        if (part.topPoly) top = shift(part.topPoly, c);
        else if (part.topRect) top = shift(rectPoly(part.topRect[0], part.topRect[1]), c);
        else if (part.topRadius != null) top = shift(circle(part.topRadius, base.length), c);
        else if (part.topScale != null) top = scalePoly(base, part.topScale);
        else top = base;
        if (top.length !== base.length) throw new Error("prism: top/bottom vertex count differs");
        return [{ rings: [ring(T, base, part.bottomM || 0), ring(T, top, part.topM)] }];
      }
      case "dome": {
        const r = part.radius, h0 = part.springM, rise = part.riseM, n = 6, rings = [];
        for (let k = 0; k < n; k++) { const t = k / n * Math.PI / 2; rings.push(ring(T, shift(circle(r * Math.cos(t), seg), c), h0 + rise * Math.sin(t))); }
        rings.push([T(c ? c[0] : 0, c ? c[1] : 0, h0 + rise)]);
        return [{ rings }];
      }
      case "roof": {
        const [w, d] = part.rect, L = Math.min(part.ridgeLen ?? 0, w), out = [];
        if (part.base) out.push({ rings: [ring(T, shift(rectPoly(part.base.rect[0], part.base.rect[1]), c), 0), ring(T, shift(rectPoly(part.base.rect[0], part.base.rect[1]), c), part.base.topM)] });
        const eave = shift(rectPoly(w, d), c), r0 = [-L / 2, 0], r1 = [L / 2, 0];
        out.push({ rings: [ring(T, eave, part.eaveM), ring(T, shift([r0, r1, r1, r0], c), part.ridgeM)] });
        return out;
      }
      case "deck": {
        const pts = part.points, sMax = part.segM || 50, hw = part.width / 2, out = [];
        const dense = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / sMax));
          for (let k = 1; k <= n; k++) dense.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
        }
        for (let i = 1; i < dense.length; i++) out.push(boxPiece(T, dense[i - 1], dense[i], hw, part.bottomM, part.topM));
        const P = part.piers;
        if (P && P.spacingM > 0) {
          const [along, across] = P.size || [2, part.width * 0.6], pTop = P.topM ?? part.bottomM;
          let acc = 0, next = P.spacingM;
          for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
            while (next <= acc + L - 1e-6) {
              const t = next - acc, m = [a[0] + ux * t, a[1] + uy * t];
              out.push(boxPiece(T, [m[0] - ux * along / 2, m[1] - uy * along / 2], [m[0] + ux * along / 2, m[1] + uy * along / 2], across / 2, 0, pTop));
              next += P.spacingM;
            }
            acc += L;
          }
        }
        return out;
      }
      case "arch": {
        const a = part.from, b = part.to, n = part.segments || 12, th = part.thickness || 1, hw = (part.width || th) / 2, out = [];
        const P = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, part.springM + 4 * part.riseM * t * (1 - t)];
        for (let k = 0; k < n; k++) {
          const p = P(k / n), q = P((k + 1) / n);
          const z0 = Math.min(p[2], q[2]), z1 = Math.max(p[2], q[2]) + th; // 마디 = 리브 두께를 포함한 상자
          out.push(boxPiece(T, [p[0], p[1]], [q[0], q[1]], hw, z0, z1));
        }
        return out;
      }
      default: throw new Error("LandmarkCore: unknown part type " + part.type);
    }
  }
  function pieces(lm) {
    const out = [];
    (lm.parts || []).forEach((p, i) => partPieces(p, lm).forEach(pc => { pc.part = i; pc.type = p.type; out.push(pc); }));
    return out;
  }

  /* ===== 메시 ===== */
  function toMesh(lm) {
    const vertices = [], triangles = [], edges = [], parts = [];
    for (const pc of pieces(lm)) {
      const start = vertices.length, idx = [];
      for (const r of pc.rings) { idx.push(r.map(v => vertices.push(v) - 1)); }
      for (let k = 0; k < idx.length; k++) {
        const R = idx[k];
        if (R.length > 1) for (let i = 0; i < R.length; i++) edges.push([R[i], R[(i + 1) % R.length]]);
        if (k === 0 || k === idx.length - 1) if (R.length > 2) for (let i = 1; i < R.length - 1; i++) triangles.push(k === 0 ? [R[0], R[i + 1], R[i]] : [R[0], R[i], R[i + 1]]);
        if (k === 0) continue;
        const A = idx[k - 1];
        if (R.length === 1) { for (let i = 0; i < A.length; i++) { triangles.push([A[i], A[(i + 1) % A.length], R[0]]); edges.push([A[i], R[0]]); } continue; }
        for (let i = 0; i < A.length; i++) {
          const j = (i + 1) % A.length;
          triangles.push([A[i], A[j], R[j]], [A[i], R[j], R[i]]);
          edges.push([A[i], R[i]]);
        }
      }
      parts.push({ part: pc.part, type: pc.type, start, count: vertices.length - start });
    }
    return { vertices, triangles, edges, parts, baseM: lm.baseM || 0, origin: { lat: lm.lat, lon: lm.lon } };
  }

  /* ===== 투영·실루엣 ===== */
  function hull(pts) { // Andrew monotone chain, [[x,y]] → 반시계 볼록 다각형
    const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (P.length < 3) return P;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    lo.pop(); hi.pop(); return lo.concat(hi);
  }

  function projector(lm, obs) {
    const eye = obs.eyeM ?? 1.6, oz = (obs.groundM ?? obs.elevM ?? 0) + eye, base = lm.baseM || 0;
    const b0 = Sky.bearing(obs.lat, obs.lon, lm.lat, lm.lon), cosLat = Math.cos(lm.lat * D2R);
    const opt = obs.refraction != null ? { refraction: obs.refraction } : undefined;
    return {
      b0,
      proj([e, n, z]) {
        const lat = lm.lat + n / M_PER_DEG, lon = lm.lon + e / (M_PER_DEG * cosLat);
        const dk = Sky.distanceKm(obs.lat, obs.lon, lat, lon);
        const az = b0 + wrap180(Sky.bearing(obs.lat, obs.lon, lat, lon) - b0);
        return [az, Sky.apparentAlt(base + z - oz, dk, opt), dk];
      }
    };
  }

  function silhouette(lm, observer, opt = {}) {
    lm = findLandmark(lm);
    if (!lm) throw new Error("LandmarkCore.silhouette: unknown landmark");
    const P = projector(lm, observer), polygons = [];
    let top = null, minAlt = Infinity, minAz = Infinity, maxAz = -Infinity;
    for (const pc of pieces(lm)) {
      const pts = [];
      for (const r of pc.rings) for (const v of r) {
        const [az, alt] = P.proj(v); pts.push([az, alt]);
        if (!top || alt > top.alt) top = { az, alt };
        if (alt < minAlt) minAlt = alt;
        if (az < minAz) minAz = az; if (az > maxAz) maxAz = az;
      }
      const h = hull(pts); if (h.length >= 3) polygons.push(h);
    }
    const [bAz, bAlt] = P.proj([0, 0, 0]);
    const sil = {
      id: lm.id, polygons,
      top: { az: norm360(top.az), alt: top.alt }, base: { az: norm360(bAz), alt: bAlt },
      distKm: Sky.distanceKm(observer.lat, observer.lon, lm.lat, lm.lon), bearingDeg: P.b0,
      angularWidthDeg: maxAz - minAz, angularHeightDeg: top.alt - minAlt,
      azRange: [minAz, maxAz], altRange: [minAlt, top.alt]
    };
    sil.envelope = envelope(sil, opt.columns ?? 120);
    return sil;
  }

  // 열 샘플링 윗선: [[az, altTop|null]] — 각 방위 열에서 다각형들의 최고 고도
  function envelope(sil, columns = 120) {
    const [a0, a1] = sil.azRange, n = Math.max(2, columns), out = [];
    for (let i = 0; i < n; i++) {
      const az = a0 + (a1 - a0) * i / (n - 1);
      let best = null;
      for (const poly of sil.polygons) {
        for (let k = 0; k < poly.length; k++) {
          const p = poly[k], q = poly[(k + 1) % poly.length];
          const lo = Math.min(p[0], q[0]), hi = Math.max(p[0], q[0]);
          if (az < lo || az > hi) continue;
          const alt = hi - lo < 1e-12 ? Math.max(p[1], q[1]) : p[1] + (q[1] - p[1]) * (az - p[0]) / (q[0] - p[0]);
          if (best === null || alt > best) best = alt;
        }
      }
      out.push([az, best]);
    }
    return out;
  }

  /* ===== 해·달 원반 가림 ===== */
  function inPoly(poly, x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const GOLD = Math.PI * (3 - Math.sqrt(5));
  // body: {az, alt | altApparent, diamDeg}. 실루엣 고도는 겉보기 고도이므로 해·달도 겉보기 고도(altApparent)를 쓴다.
  function occlusion(sil, body, opt = {}) {
    const N = opt.samples ?? 400, r = (body.diamDeg ?? 0.53) / 2;
    const bAlt = body.altApparent ?? body.alt, bAz = sil.bearingDeg + wrap180(body.az - sil.bearingDeg);
    const k = Math.cos(bAlt * D2R);
    // 원반 중심 기준 접평면 좌표 (u = 방위차·cos alt, v = 고도차)
    const polys = sil.polygons.map(poly => {
      const q = poly.map(([a, h]) => [(a - bAz) * k, h - bAlt]);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of q) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      return { q, x0, x1, y0, y1 };
    }).filter(p => p.x1 >= -r && p.x0 <= r && p.y1 >= -r && p.y0 <= r);
    if (!polys.length) return { state: "clear", coveredFrac: 0 };
    const hit = (x, y) => polys.some(p => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1 && inPoly(p.q, x, y));
    let n = 0;
    for (let i = 0; i < N; i++) { const rr = r * Math.sqrt((i + 0.5) / N), t = i * GOLD; if (hit(rr * Math.cos(t), rr * Math.sin(t))) n++; }
    // 가장자리 64점: 내부 표본이 놓친 얇은 겹침/빈틈 보정
    let edgeHit = 0; const E = 64;
    for (let i = 0; i < E; i++) { const t = 2 * Math.PI * i / E; if (hit(r * Math.cos(t), r * Math.sin(t))) edgeHit++; }
    const vertexIn = polys.some(p => p.q.some(([x, y]) => x * x + y * y < r * r));
    let frac = n / N;
    if (n === 0 && (edgeHit || vertexIn)) frac = 0.5 / N;
    if (n === N && edgeHit < E) frac = 1 - 0.5 / N;
    const state = frac <= 0 ? "clear" : frac >= 1 ? "behind" : "partial";
    return { state, coveredFrac: frac };
  }

  /* ===== 데이터 검사 ===== */
  function validate(lib) {
    const errs = [], L = (lib || library()).landmarks || [];
    const walk = (v, path) => {
      if (typeof v === "number" && !Number.isFinite(v)) errs.push(path + " not finite");
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path + "." + k);
    };
    for (const l of L) {
      const p = l.id || "?";
      if (!l.id || !l.name || !l.name.ko || !l.name.en) errs.push(p + ": id/name");
      if (!Number.isFinite(l.lat) || !Number.isFinite(l.lon) || !Number.isFinite(l.baseM)) errs.push(p + ": lat/lon/baseM");
      if (!Array.isArray(l.sources) || !l.sources.length || l.sources.some(s => !/^https:\/\//.test(s.url) || !Array.isArray(s.fields) || !s.fields.length)) errs.push(p + ": sources");
      if (l.sources && l.sources.some(s => /openstreetmap|overturemaps/i.test(s.url))) errs.push(p + ": OSM/Overture source not allowed");
      if (!Array.isArray(l.parts) || !l.parts.length) errs.push(p + ": parts");
      (l.parts || []).forEach((pt, i) => { if (pt.est && !pt.estReason) errs.push(`${p}.parts[${i}]: est without estReason`); try { partPieces(pt, l); } catch (e) { errs.push(`${p}.parts[${i}]: ${e.message}`); } });
      walk(l, p);
    }
    return errs;
  }

  const LC = { VERSION, setLibrary, library, list, findLandmark, toMesh, silhouette, envelope, occlusion, validate, norm360, _internal: { pieces, partPieces, hull, inPoly } };
  G.LandmarkCore = LC; if (typeof module !== "undefined" && module.exports) module.exports = LC;
})(typeof globalThis !== "undefined" ? globalThis : this);
