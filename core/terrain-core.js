/*! Polychrome Terrain Core v0.1.0 · © 2026 HYEOKSANG LEE. All rights reserved. */
/*  지형 수평선(horizon profile) → 해·달이 산 능선 위로 처음/마지막으로 보이는 순간 계산.
 *  의존성 없음 (SkyCore 를 불러오지 않는다). 곡률·굴절 모델은 SkyCore.apparentAlt 와 동일하게 복제:
 *    겉보기 고도 = atan2(Δh − d²/(2R)·(1−k), d),  R = 6371.0088 km, 지상 굴절 k = 0.13.
 *  단위: 각도 도(degree), 방위각 북 0° 시계방향, 거리 km, 높이 m(해발).
 *
 *  ── 고도 소스 인터페이스 ──
 *    { id, attribution, elevations(points:[{lat, lon, resM?}]) → Promise<number[]> }
 *    결과는 points 와 같은 길이. 값이 없으면 null/NaN 허용(그 표본은 무시).
 *    resM(선택) = 그 점에 필요한 지면 해상도 힌트(m). terrariumSource 는 이를 보고 먼 점에 낮은 줌 타일을 쓴다.
 *
 *  ── terrariumSource ──
 *    AWS Terrain Tiles(Mapzen/Tilezen) Terrarium PNG, 256 px Web Mercator 타일.
 *    elevation = R·256 + G + B/256 − 32768 (m). 바다는 음수(수심, ETOPO1) — horizonProfile 이 해수면 0 으로 자른다.
 *    샘플링: 픽셀 중심 기준 쌍선형 보간(bilinear), 타일 경계 넘어가면 이웃 타일 사용. LRU 타일 캐시(maxTiles).
 *    adaptive=true(기본): 점마다 resM 이하 픽셀 크기가 되는 가장 낮은 줌(≤ zoom) 사용 → 40 km 프로파일이 타일 ~20장.
 *    z12 픽셀 ≈ 30 m (위도 37.5°). 원자료 해상도: 한국은 SRTM 1″(~30 m, 레이더 DSM) 기반으로 보이며 숲·도시 높이가
 *    일부 섞인 '표면' 모델 — 수평선은 실제 능선보다 수 m~수십 m 높게 나올 수 있다(가까운 곳에서 영향이 큼).
 *
 *  ── horizonProfile(source, {lat, lon, eyeM=1.6, groundM?, maxKm=40, stepDeg=1, refraction=0.13, clampSea=true}) ──
 *    방위각 N = round(360/stepDeg) 개(0, step, 2·step …), 각 방위로 거리 사다리를 따라 표본을 찍어 최대 겉보기 고도.
 *    거리 사다리: d0 = 30 m, d(i+1) = d(i) + max(30 m, 1.5%·d(i)), 마지막은 maxKm.
 *      maxKm=40 → 방위당 268점 (30 m 간격으로 2 km 까지 66점 + 등비 202점), stepDeg=1 → 360×268 ≈ 9.6만 점 + 관측점 1.
 *      모든 점을 elevations() 한 번에 보낸다. Node 에서 합성 소스 기준 ~50 ms, iPhone Safari 에서도 수백 ms 이내 예상.
 *    groundM 생략 시 관측점 고도를 같은 배치에서 읽는다(없으면 0). 관측 높이 H = groundM + eyeM.
 *    하한: 수평선은 해수면 수평선 내림각(dip)보다 낮아지지 않는다 — dip = acos(R'/(R'+H)), R' = R/(1−k)
 *      (H = max(eyeM, groundM+eyeM)). 1.6 m 눈높이: ≈ √(2H(1−k)/R) = 0.0379° (굴절 없으면 0.0406°).
 *      하한이 적용된 방위의 distKm = 해수면 수평선 거리 √(2HR') (maxKm 보다 클 수 있음).
 *    반환: { az, alt(겉보기 °), distKm (Float32Array, 길이 N), groundM, eyeM, stepDeg(=360/N), maxKm, source(id), attribution, samples }
 *
 *  ── 질의 ──
 *    horizonAt(profile, azDeg)                     방위 보간(0/360 감김)
 *    isBlocked(profile, azDeg, altDeg, radiusDeg=0) 'clear' | 'partial' | 'blocked'
 *      원반(반지름 r)의 각 방위 열에서 아랫/윗 가장자리를 수평선과 비교. r=0 이면 alt ≥ 수평선 → clear, 아니면 blocked.
 *    firstVisible(profile, track) / lastVisible(profile, track)
 *      track = [{t, az, alt, diamDeg?}] 시간순. t 는 숫자(ms) 또는 Date.
 *      → { touch, clear }: touch = 원반 일부가 처음(마지막) 보이는 순간, clear = 원반 전체가 수평선 위인 순간.
 *        각 항목 { t, az, alt, index, atEdge } — 인접 두 점 사이 선형 보간(t 는 입력과 같은 형식). atEdge=true 면
 *        트랙의 첫(마지막) 점에서 이미 그 상태(실제 순간은 트랙 밖). 해당 순간이 없으면 null.
 *  한계: 건물·나무는 소스에 없으면 무시. 관측점 바로 옆(30 m 이내) 지형은 보지 않는다. 고도 소스 해상도보다 좁은 봉우리는 낮게 나온다. */
(function (G) {
  "use strict";
  const VERSION = "0.1.0";
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const EARTH_KM = 6371.0088, EARTH_M = EARTH_KM * 1000;
  const DEF_K = 0.13;
  const norm360 = x => ((x % 360) + 360) % 360;
  const fin = v => typeof v === "number" && Number.isFinite(v);

  /* ===== 곡률·굴절 (SkyCore.apparentAlt 와 동일) ===== */
  function apparentAlt(heightDiffM, distKm, k = DEF_K) {
    const d = Math.max(distKm, 1e-6) * 1000;
    return Math.atan2(heightDiffM - d * d / (2 * EARTH_M) * (1 - k), d) * R2D;
  }
  function horizonDip(heightM, k = DEF_K) {
    const Rp = EARTH_M / (1 - k), H = Math.max(0, heightM);
    return -Math.acos(Rp / (Rp + H)) * R2D;
  }
  const horizonDistKm = (heightM, k = DEF_K) => Math.sqrt(2 * Math.max(0, heightM) * EARTH_M / (1 - k)) / 1000;

  function distanceLadder(maxKm) {
    const out = [];
    let d = 0.03;
    while (d < maxKm - 1e-9) { out.push(d); d += Math.max(0.03, 0.015 * d); }
    out.push(maxKm);
    return out;
  }

  /* ===== 소스 ===== */
  function syntheticSource(fn, opt = {}) {
    return {
      id: opt.id || "synthetic", attribution: opt.attribution || "",
      elevations: async pts => pts.map(p => { const v = fn(p.lat, p.lon); return fin(v) ? v : null; })
    };
  }

  const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
  const TERRARIUM_ATTR = "Terrain Tiles (Mapzen/Tilezen, AWS Open Data): SRTM, GMTED2010 & 3DEP courtesy of the U.S. Geological Survey; ETOPO1 courtesy of NOAA NCEI";
  const TERRARIUM_ATTR_URL = "https://github.com/tilezen/joerd/blob/master/docs/attribution.md";
  const decodeTerrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;

  async function browserLoadTile(z, x, y, url) {
    const res = await fetch(url.replace("{z}", z).replace("{x}", x).replace("{y}", y), { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error("TerrainCore: tile " + z + "/" + x + "/" + y + " HTTP " + res.status);
    const blob = await res.blob();
    let img, close = () => {};
    if (typeof createImageBitmap === "function") {
      try { img = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" }); }
      catch (e) { img = await createImageBitmap(blob); }
      close = () => img.close && img.close();
    } else {
      const u = URL.createObjectURL(blob);
      img = await new Promise((ok, no) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = no; im.src = u; });
      close = () => URL.revokeObjectURL(u);
    }
    const w = img.width, h = img.height;
    let cv;
    if (typeof OffscreenCanvas === "function") cv = new OffscreenCanvas(w, h);
    else { cv = document.createElement("canvas"); cv.width = w; cv.height = h; }
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, w, h);
    close();
    return { width: w, height: h, data: id.data };
  }

  function terrariumSource(opt = {}) {
    const zoom = opt.zoom ?? 12, maxTiles = Math.max(1, opt.maxTiles ?? 64), adaptive = opt.adaptive !== false;
    const minZoom = opt.minZoom ?? 0, url = opt.url || TERRARIUM_URL, concurrency = opt.concurrency ?? 6;
    const loadTile = opt.loadTile || ((z, x, y) => browserLoadTile(z, x, y, url));
    const cache = new Map(), pending = new Map();
    const stats = { loads: 0, hits: 0, failures: 0 };

    function touchCache(key, tile) {
      cache.delete(key); cache.set(key, tile);
      while (cache.size > maxTiles) cache.delete(cache.keys().next().value);
    }
    function getTile(z, x, y) {
      const key = z + "/" + x + "/" + y;
      if (cache.has(key)) { stats.hits++; const t = cache.get(key); touchCache(key, t); return Promise.resolve(t); }
      if (pending.has(key)) return pending.get(key);
      stats.loads++;
      const p = Promise.resolve().then(() => loadTile(z, x, y)).then(t => {
        pending.delete(key);
        if (!t || !t.data || !(t.width > 0) || !(t.height > 0)) throw new Error("TerrainCore: bad tile " + key);
        touchCache(key, t); return t;
      }, e => { pending.delete(key); stats.failures++; throw e; });
      pending.set(key, p);
      return p;
    }
    function zoomFor(lat, resM) {
      if (!adaptive || !fin(resM) || resM <= 0) return zoom;
      const c = 156543.03392804097 * Math.cos(lat * D2R);
      for (let z = minZoom; z < zoom; z++) if (c / 2 ** z <= resM) return z;
      return zoom;
    }

    async function elevations(points) {
      const n = points.length, out = new Array(n).fill(null);
      // 점마다: 줌, 4 이웃 픽셀 (전역 픽셀 좌표) 및 가중치
      const plan = new Array(n), need = new Map();
      for (let i = 0; i < n; i++) {
        const p = points[i];
        if (!p || !fin(p.lat) || !fin(p.lon)) continue;
        const z = zoomFor(p.lat, p.resM), size = 256 * 2 ** z;
        const lat = Math.max(-85.05112878, Math.min(85.05112878, p.lat)) * D2R;
        const gx = (norm360(p.lon + 180) / 360) * size;
        const gy = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * size;
        const fx = gx - 0.5, fy = gy - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const cells = [];
        for (const [dx, dy, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
          const X = ((x0 + dx) % size + size) % size, Y = Math.max(0, Math.min(size - 1, y0 + dy));
          const tX = Math.floor(X / 256), tY = Math.floor(Y / 256), key = z + "/" + tX + "/" + tY;
          if (!need.has(key)) need.set(key, [z, tX, tY]);
          cells.push(key, X - tX * 256, Y - tY * 256, w);
        }
        plan[i] = cells;
      }
      const tiles = new Map(), jobs = [...need.entries()];
      let next = 0;
      async function worker() {
        while (next < jobs.length) {
          const [key, [z, x, y]] = jobs[next++];
          try { tiles.set(key, await getTile(z, x, y)); } catch (e) { tiles.set(key, null); }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
      for (let i = 0; i < n; i++) {
        const c = plan[i];
        if (!c) continue;
        let v = 0, ok = true;
        for (let j = 0; j < 16; j += 4) {
          const t = tiles.get(c[j]);
          if (!t) { ok = false; break; }
          // 타일이 256 px 가 아니면 비율로 맞춘다
          const px = t.width === 256 ? c[j + 1] : Math.min(t.width - 1, Math.floor(c[j + 1] * t.width / 256));
          const py = t.height === 256 ? c[j + 2] : Math.min(t.height - 1, Math.floor(c[j + 2] * t.height / 256));
          const o = (py * t.width + px) * 4, d = t.data;
          v += c[j + 3] * decodeTerrarium(d[o], d[o + 1], d[o + 2]);
        }
        out[i] = ok ? v : null;
      }
      return out;
    }
    return { id: "terrarium", attribution: TERRARIUM_ATTR, attributionUrl: TERRARIUM_ATTR_URL, zoom, maxTiles, elevations, stats, cacheSize: () => cache.size };
  }

  /* ===== 수평선 프로파일 ===== */
  async function horizonProfile(source, o = {}) {
    if (!source || typeof source.elevations !== "function") throw new Error("TerrainCore: source.elevations required");
    const lat = +o.lat, lon = +o.lon;
    if (!fin(lat) || !fin(lon)) throw new Error("TerrainCore: lat/lon required");
    const eyeM = o.eyeM ?? 1.6, maxKm = o.maxKm ?? 40, k = o.refraction ?? DEF_K, clampSea = o.clampSea !== false;
    const N = Math.max(4, Math.round(360 / (o.stepDeg ?? 1))), stepDeg = 360 / N;
    const dists = distanceLadder(maxKm), M = dists.length, stepRad = stepDeg * D2R;
    const p1 = lat * D2R, l1 = lon * D2R, sp1 = Math.sin(p1), cp1 = Math.cos(p1);
    const sD = dists.map(d => Math.sin(d / EARTH_KM)), cD = dists.map(d => Math.cos(d / EARTH_KM));
    const resM = dists.map((d, j) => Math.min(((j + 1 < M ? dists[j + 1] : d) - (j ? dists[j - 1] : 0)) / 2, Math.max(d * stepRad, 0.03)) * 1000);
    const pts = new Array(1 + N * M);
    pts[0] = { lat, lon };
    for (let i = 0; i < N; i++) {
      const th = i * stepRad, st = Math.sin(th), ct = Math.cos(th);
      for (let j = 0; j < M; j++) {
        const sl = sp1 * cD[j] + cp1 * sD[j] * ct, p2 = Math.asin(sl);
        const l2 = l1 + Math.atan2(st * sD[j] * cp1, cD[j] - sp1 * sl);
        pts[1 + i * M + j] = { lat: p2 * R2D, lon: norm360(l2 * R2D + 180) - 180, resM: resM[j] };
      }
    }
    const el = await source.elevations(pts);
    let groundM = o.groundM;
    if (!fin(groundM)) { groundM = fin(el[0]) ? el[0] : 0; if (clampSea) groundM = Math.max(0, groundM); }
    const H = groundM + eyeM;
    const floorAlt = horizonDip(Math.max(eyeM, H), k), floorKm = horizonDistKm(Math.max(eyeM, H), k);
    const drop = dists.map(d => d * d * 1e6 / (2 * EARTH_M) * (1 - k));
    const az = new Float32Array(N), alt = new Float32Array(N), distKm = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let best = -Infinity, bestD = floorKm;
      for (let j = 0; j < M; j++) {
        let h = el[1 + i * M + j];
        if (!fin(h)) continue;
        if (clampSea && h < 0) h = 0;
        const t = (h - H - drop[j]) / (dists[j] * 1000); // tan(alt) — 단조, atan 은 마지막에 한 번
        if (t > best) { best = t; bestD = dists[j]; }
      }
      let a = best === -Infinity ? -Infinity : Math.atan(best) * R2D;
      if (!(a >= floorAlt)) { a = floorAlt; bestD = floorKm; }
      az[i] = i * stepDeg; alt[i] = a; distKm[i] = bestD;
    }
    return { az, alt, distKm, groundM, eyeM, stepDeg, maxKm, refraction: k, source: source.id, attribution: source.attribution || "", samples: N * M + 1, perAzimuth: M };
  }

  /* ===== 질의 ===== */
  function horizonAt(profile, azDeg) {
    const N = profile.alt.length, f = norm360(azDeg) / profile.stepDeg, i = Math.floor(f) % N, t = f - Math.floor(f);
    return profile.alt[i] * (1 - t) + profile.alt[(i + 1) % N] * t;
  }
  // 원반 열 샘플: 최소(윗가장자리−수평선), 최대(윗가장자리−수평선), 최소(아랫가장자리−수평선)
  function margins(profile, azDeg, altDeg, r) {
    if (!(r > 0)) { const m = altDeg - horizonAt(profile, azDeg); return { top: m, bottom: m }; }
    const c = Math.max(Math.cos(altDeg * D2R), 1e-3), half = Math.min(180, r / c);
    const S = Math.max(8, Math.ceil(2 * half / Math.min(profile.stepDeg, 0.5)));
    let top = -Infinity, bottom = Infinity;
    for (let s = 0; s <= S; s++) {
      const u = -1 + 2 * s / S, x = u * r, hh = Math.sqrt(Math.max(0, r * r - x * x));
      const h = horizonAt(profile, azDeg + u * half);
      top = Math.max(top, altDeg + hh - h);
      bottom = Math.min(bottom, altDeg - hh - h);
    }
    return { top, bottom };
  }
  function isBlocked(profile, azDeg, altDeg, radiusDeg = 0) {
    const m = margins(profile, azDeg, altDeg, radiusDeg);
    if (m.bottom >= 0) return "clear";
    if (m.top > 0) return "partial";
    return "blocked";
  }

  function crossing(profile, track, which, reverse) {
    const n = track.length;
    if (!n) return null;
    const idx = i => reverse ? n - 1 - i : i;
    const val = e => { const m = margins(profile, e.az, e.alt, (e.diamDeg || 0) / 2); return which === "touch" ? m.top : m.bottom; };
    const ok = v => which === "touch" ? v > 0 : v >= 0;
    let prev = null, prevV = null;
    for (let s = 0; s < n; s++) {
      const i = idx(s), e = track[i], v = val(e);
      if (ok(v)) {
        if (s === 0) return { t: e.t, az: norm360(e.az), alt: e.alt, index: i, atEdge: true };
        const f = prevV / (prevV - v); // prevV 는 not ok, v 는 ok → 0..1
        const ta = +prev.t, tb = +e.t, tt = ta + (tb - ta) * f;
        let da = norm360(e.az - prev.az); if (da > 180) da -= 360;
        return { t: e.t instanceof Date ? new Date(tt) : tt, az: norm360(prev.az + da * f), alt: prev.alt + (e.alt - prev.alt) * f, index: i, atEdge: false };
      }
      prev = e; prevV = v;
    }
    return null;
  }
  const firstVisible = (profile, track) => ({ touch: crossing(profile, track, "touch", false), clear: crossing(profile, track, "clear", false) });
  const lastVisible = (profile, track) => ({ touch: crossing(profile, track, "touch", true), clear: crossing(profile, track, "clear", true) });

  const TC = {
    VERSION, terrariumSource, syntheticSource, horizonProfile, horizonAt, isBlocked, firstVisible, lastVisible,
    apparentAlt, horizonDip, horizonDistKm, distanceLadder, decodeTerrarium, norm360,
    TERRARIUM_URL, TERRARIUM_ATTR, TERRARIUM_ATTR_URL
  };
  G.TerrainCore = TC; if (typeof module !== "undefined" && module.exports) module.exports = TC;
})(typeof globalThis !== "undefined" ? globalThis : this);
