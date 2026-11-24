/*! Polychrome Sky Core v0.1.0 · © 2026 HYEOKSANG LEE. All rights reserved. */
/*  천문·촬영 계획·오로라 지수 계산 (의존성 없음, 네트워크 없음).
 *  각도 = 도(degree), 방위각 = 북 0° 시계방향, 거리 km, 높이 m, date = JS Date(UTC 순간).
 *  해: Meeus 25장(저정밀, ~0.01°) + 장동(주요 4항) · 달: Meeus 47장(경도·거리 60항, 위도 60항) + 지표면 시차 보정.
 *  시간 문자열 ymd = 그 도시 현지 날짜 "YYYY-MM-DD", tz = IANA 시간대. */
(function (G) {
  "use strict";
  const VERSION = "0.1.0";
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const sin = x => Math.sin(x * D2R), cos = x => Math.cos(x * D2R), tan = x => Math.tan(x * D2R);
  const asin = x => Math.asin(Math.max(-1, Math.min(1, x))) * R2D, atan2 = (y, x) => Math.atan2(y, x) * R2D;
  const norm360 = x => ((x % 360) + 360) % 360;
  const wrap180 = x => { x = norm360(x); return x > 180 ? x - 360 : x; };
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const EARTH_KM = 6371.0088, EQ_KM = 6378.14, MOON_R_KM = 1737.4, AU_KM = 149597870.7;

  /* ===== 시간 ===== */
  const jdOf = d => (+d) / DAY + 2440587.5;
  // ΔT(초): 관측값 표 선형 보간, 범위 밖은 Espenak 장기식. 오차 몇 초 → 달 위치 수 초각 수준.
  const DT_TAB = [[1950, 29.1], [1960, 33.2], [1970, 40.2], [1980, 50.5], [1990, 56.9], [2000, 63.8], [2010, 66.1], [2016, 68.1], [2020, 69.4], [2026, 69.1], [2030, 70], [2050, 80]];
  function deltaT(year) {
    if (year >= DT_TAB[0][0] && year <= DT_TAB[DT_TAB.length - 1][0]) {
      for (let i = 1; i < DT_TAB.length; i++) if (year <= DT_TAB[i][0]) {
        const [y0, v0] = DT_TAB[i - 1], [y1, v1] = DT_TAB[i];
        return v0 + (v1 - v0) * (year - y0) / (y1 - y0);
      }
    }
    const u = (year - 1820) / 100; return -20 + 32 * u * u;
  }
  const jdeOf = d => { const jd = jdOf(d); return jd + deltaT(2000 + (jd - 2451545) / 365.25) / 86400; };

  // 시간대: Intl 로 오프셋(분) 계산. 캐시.
  const FMT = new Map();
  function tzOffsetMin(date, tz) {
    if (!tz || tz === "UTC") return 0;
    let f = FMT.get(tz);
    if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); FMT.set(tz, f); }
    const p = {}; for (const x of f.formatToParts(date)) p[x.type] = x.value;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUTC - Math.floor(+date / 1000) * 1000) / MIN);
  }
  // 현지 ymd 의 hh:mm 에 해당하는 UTC 순간
  function localToDate(ymd, tz, hh = 0, mm = 0) {
    const [y, m, d] = String(ymd).split("-").map(Number);
    const base = Date.UTC(y, m - 1, d, hh, mm);
    let t = base - tzOffsetMin(new Date(base), tz) * MIN;
    t = base - tzOffsetMin(new Date(t), tz) * MIN;
    return new Date(t);
  }
  const pad = n => String(n).padStart(2, "0");
  function localTime(date, tz = "Asia/Seoul") {
    if (!date) return null;
    const t = new Date(+date + tzOffsetMin(date, tz) * MIN);
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
  }
  function addDays(ymd, n) {
    const [y, m, d] = String(ymd).split("-").map(Number), t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }
  // 현지 하루 [00:00, 다음날 00:00)
  const dayWindow = (ymd, tz) => [+localToDate(ymd, tz), +localToDate(addDays(ymd, 1), tz)];

  /* ===== 장동·황도경사·항성시 ===== */
  function nutation(T) { // Meeus 22장 저정밀(0.5″)
    const Om = 125.04452 - 1934.136261 * T, L = 280.4665 + 36000.7698 * T, Lp = 218.3165 + 481267.8813 * T;
    const dpsi = (-17.20 * sin(Om) - 1.32 * sin(2 * L) - 0.23 * sin(2 * Lp) + 0.21 * sin(2 * Om)) / 3600;
    const deps = (9.20 * cos(Om) + 0.57 * cos(2 * L) + 0.10 * cos(2 * Lp) - 0.09 * cos(2 * Om)) / 3600;
    const eps0 = 23 + 26 / 60 + 21.448 / 3600 - (46.8150 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600;
    return { dpsi, deps, eps0, eps: eps0 + deps };
  }
  function gmst(jd) { // Meeus 12.4 (도)
    const T = (jd - 2451545) / 36525;
    return norm360(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T - T * T * T / 38710000);
  }
  // 겉보기 항성시(도) + 장동 (UT 기준 date)
  function siderealApparent(date) {
    const jd = jdOf(date), T = (jdeOf(date) - 2451545) / 36525, n = nutation(T);
    return norm360(gmst(jd) + n.dpsi * cos(n.eps));
  }
  function eclToEq(lam, bet, eps) {
    const ra = norm360(atan2(sin(lam) * cos(eps) - tan(bet) * sin(eps), cos(lam)));
    const dec = asin(sin(bet) * cos(eps) + cos(bet) * sin(eps) * sin(lam));
    return { ra, dec };
  }
  // 시간각 H, 적위 → 고도/방위(북 0° 시계방향)
  function hzOf(H, dec, lat) {
    const alt = asin(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(H));
    const az = norm360(atan2(-cos(dec) * sin(H), sin(dec) * cos(lat) - cos(dec) * sin(lat) * cos(H)));
    return { alt, az };
  }
  // 대기 굴절(Saemundsson, 표준 대기 10°C 1010hPa): 기하 고도 → 겉보기 고도
  function refraction(h) {
    if (h < -1.9) return 0;
    const hh = Math.max(h, -1.9);
    return 1.02 / tan(hh + 10.3 / (hh + 5.11)) / 60;
  }
  const apparentFromTrue = h => h + refraction(h);
  // Bennett: 겉보기 → 기하
  const trueFromApparent = h0 => h0 < -1.7 ? h0 : h0 - 1 / tan(h0 + 7.31 / (h0 + 4.4)) / 60;

  // 관측자 지심 좌표 성분(Meeus 11장)
  function geoc(lat, elevM = 0) {
    const u = Math.atan(0.99664719 * tan(lat)), hr = elevM / 6378140;
    return { rs: 0.99664719 * Math.sin(u) + hr * sin(lat), rc: Math.cos(u) + hr * cos(lat) };
  }

  /* ===== 해 ===== */
  function sunEcl(jde) { // Meeus 25장 → {trueLon, lon(겉보기), R(AU), T}
    const T = (jde - 2451545) / 36525;
    const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
    const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
    const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) + (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M);
    const tl = L0 + C, nu = M + C, R = 1.000001018 * (1 - e * e) / (1 + e * cos(nu));
    const n = nutation(T);
    const lon = tl - 0.005691611 / R + n.dpsi;
    return { trueLon: norm360(tl), lon: norm360(lon), R, T, nut: n };
  }
  function sunEq(jde) { const s = sunEcl(jde); const q = eclToEq(s.lon, 0, s.nut.eps); return { ...q, R: s.R, lon: s.lon }; }
  function sunPos(date, lat, lon) {
    const jde = jdeOf(date), s = sunEq(jde), H = siderealApparent(date) + lon - s.ra, p = hzOf(H, s.dec, lat);
    return { az: p.az, alt: p.alt, altApparent: apparentFromTrue(p.alt), ra: s.ra, dec: s.dec, distAU: s.R, diamDeg: 2 * 959.63 / s.R / 3600, H: wrap180(H) };
  }
  const sunDiamDeg = date => 2 * 959.63 / sunEcl(jdeOf(date)).R / 3600;

  /* ===== 달 (Meeus 47장) ===== */
  // [D, M, M', F, Σl, Σr]
  const LR = [
    [0,0,1,0,6288774,-20905355],[2,0,-1,0,1274027,-3699111],[2,0,0,0,658314,-2955968],[0,0,2,0,213618,-569925],
    [0,1,0,0,-185116,48888],[0,0,0,2,-114332,-3149],[2,0,-2,0,58793,246158],[2,-1,-1,0,57066,-152138],
    [2,0,1,0,53322,-170733],[2,-1,0,0,45758,-204586],[0,1,-1,0,-40923,-129620],[1,0,0,0,-34720,108743],
    [0,1,1,0,-30383,104755],[2,0,0,-2,15327,10321],[0,0,1,2,-12528,0],[0,0,1,-2,10980,79661],
    [4,0,-1,0,10675,-34782],[0,0,3,0,10034,-23210],[4,0,-2,0,8548,-21636],[2,1,-1,0,-7888,24208],
    [2,1,0,0,-6766,30824],[1,0,-1,0,-5163,-8379],[1,1,0,0,4987,-16675],[2,-1,1,0,4036,-12831],
    [2,0,2,0,3994,-10445],[4,0,0,0,3861,-11650],[2,0,-3,0,3665,14403],[0,1,-2,0,-2689,-7003],
    [2,0,-1,2,-2602,0],[2,-1,-2,0,2390,10056],[1,0,1,0,-2348,6322],[2,-2,0,0,2236,-9884],
    [0,1,2,0,-2120,5751],[0,2,0,0,-2069,0],[2,-2,-1,0,2048,-4950],[2,0,1,-2,-1773,4130],
    [2,0,0,2,-1595,0],[4,-1,-1,0,1215,-3958],[0,0,2,2,-1110,0],[3,0,-1,0,-892,3258],
    [2,1,1,0,-810,2616],[4,-1,-2,0,759,-1897],[0,2,-1,0,-713,-2117],[2,2,-1,0,-700,2354],
    [2,1,-2,0,691,0],[2,-1,0,-2,596,0],[4,0,1,0,549,-1423],[0,0,4,0,537,-1117],
    [4,-1,0,0,520,-1571],[1,0,-2,0,-487,-1739],[2,1,0,-2,-399,0],[0,0,2,-2,-381,-4421],
    [1,1,1,0,351,0],[3,0,-2,0,-340,0],[4,0,-3,0,330,0],[2,-1,2,0,327,0],
    [0,2,1,0,-323,1165],[1,1,-1,0,299,0],[2,0,3,0,294,0],[2,0,-1,-2,0,8752]];
  // [D, M, M', F, Σb]
  const B = [
    [0,0,0,1,5128122],[0,0,1,1,280602],[0,0,1,-1,277693],[2,0,0,-1,173237],[2,0,-1,1,55413],[2,0,-1,-1,46271],
    [2,0,0,1,32573],[0,0,2,1,17198],[2,0,1,-1,9266],[0,0,2,-1,8822],[2,-1,0,-1,8216],[2,0,-2,-1,4324],
    [2,0,1,1,4200],[2,1,0,-1,-3359],[2,-1,-1,1,2463],[2,-1,0,1,2211],[2,-1,-1,-1,2065],[0,1,-1,-1,-1870],
    [4,0,-1,-1,1828],[0,1,0,1,-1794],[0,0,0,3,-1749],[0,1,-1,1,-1565],[1,0,0,1,-1491],[0,1,1,1,-1475],
    [0,1,1,-1,-1410],[0,1,0,-1,-1344],[1,0,0,-1,-1335],[0,0,3,1,1107],[4,0,0,-1,1021],[4,0,-1,1,833],
    [0,0,1,-3,777],[4,0,-2,1,671],[2,0,0,-3,607],[2,0,2,-1,596],[2,-1,1,-1,491],[2,0,-2,1,-451],
    [0,0,3,-1,439],[2,0,2,1,422],[2,0,-3,-1,421],[2,1,-1,1,-366],[2,1,0,1,-351],[4,0,0,1,331],
    [2,-1,1,1,315],[2,-2,0,-1,302],[0,0,1,3,-283],[2,1,1,-1,-229],[1,1,0,-1,223],[1,1,0,1,223],
    [0,1,-2,-1,-220],[2,1,-1,-1,-220],[1,0,1,1,-185],[2,-1,-2,-1,181],[0,1,2,1,-177],[4,0,-2,-1,176],
    [4,-1,-1,-1,166],[1,0,1,-1,-164],[4,0,1,-1,132],[1,0,-1,-1,-119],[4,-1,0,-1,115],[2,-2,0,1,107]];
  function moonEcl(jde) { // 지심 → {lon(기하), lat, dist km, lonApp, T, nut}
    const T = (jde - 2451545) / 36525, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
    const Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000);
    const D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000);
    const M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000);
    const Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000);
    const F = norm360(93.2720950 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000);
    const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.290 * T, A3 = 313.45 + 481266.484 * T;
    const E = 1 - 0.002516 * T - 0.0000074 * T2, E2 = E * E;
    let sl = 0, sr = 0, sb = 0;
    for (const [d, m, mp, f, l, r] of LR) {
      const a = (d * D + m * M + mp * Mp + f * F) * D2R, e = m === 0 ? 1 : (m === 1 || m === -1) ? E : E2;
      sl += l * e * Math.sin(a); if (r) sr += r * e * Math.cos(a);
    }
    for (const [d, m, mp, f, b] of B) {
      const e = m === 0 ? 1 : (m === 1 || m === -1) ? E : E2;
      sb += b * e * Math.sin((d * D + m * M + mp * Mp + f * F) * D2R);
    }
    sl += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
    sb += -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F) + 175 * sin(A1 + F) + 127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);
    const n = nutation(T), lon = norm360(Lp + sl / 1e6);
    return { lon, lat: sb / 1e6, dist: 385000.56 + sr / 1000, lonApp: norm360(lon + n.dpsi), T, nut: n };
  }
  function moonEq(jde) { const m = moonEcl(jde); const q = eclToEq(m.lonApp, m.lat, m.nut.eps); return { ...q, dist: m.dist, ecl: m }; }

  // 지심 적도좌표 → 지표면(topocentric) 적도좌표 (직교 좌표 차감, Meeus 40장과 동치)
  function topocentric(ra, dec, distKm, lst, lat, elevM) {
    const g = geoc(lat, elevM);
    const x = distKm * cos(dec) * cos(ra) - EQ_KM * g.rc * cos(lst);
    const y = distKm * cos(dec) * sin(ra) - EQ_KM * g.rc * sin(lst);
    const z = distKm * sin(dec) - EQ_KM * g.rs;
    const r = Math.hypot(x, y, z);
    return { ra: norm360(atan2(y, x)), dec: asin(z / r), dist: r };
  }

  function moonPos(date, lat, lon, elevM = 0) {
    const jde = jdeOf(date), m = moonEq(jde), s = sunEq(jde), lst = norm360(siderealApparent(date) + lon);
    const tp = topocentric(m.ra, m.dec, m.dist, lst, lat, elevM);
    const H = lst - tp.ra, p = hzOf(H, tp.dec, lat);
    // 위상각(지심), 밝은 면 비율
    const elong = Math.acos(Math.max(-1, Math.min(1, cos(m.ecl.lat) * cos(m.ecl.lonApp - s.lon)))) * R2D;
    const Rkm = s.R * AU_KM, i = atan2(Rkm * sin(elong), m.dist - Rkm * cos(elong));
    const illum = (1 + cos(i)) / 2, phase = norm360(m.ecl.lonApp - s.lon) / 360;
    // 밝은 가장자리 위치각(북→동), 시차각(parallactic) → 천정 기준 기울기
    const brightLimb = norm360(atan2(cos(s.dec) * sin(s.ra - m.ra), sin(s.dec) * cos(m.dec) - cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra)));
    const q = atan2(sin(H), tan(lat) * cos(tp.dec) - sin(tp.dec) * cos(H));
    return {
      az: p.az, alt: p.alt, altApparent: apparentFromTrue(p.alt), distKm: tp.dist, geoDistKm: m.dist,
      diamDeg: 2 * asin(MOON_R_KM / tp.dist), illum, phase, brightLimb, parallactic: q,
      brightLimbZenith: norm360(brightLimb - q), ra: tp.ra, dec: tp.dec, H: wrap180(H)
    };
  }
  // 지심 기하 고도(월출몰 h0=0.125° 기준과 짝)
  function moonGeoAlt(date, lat, lon) {
    const m = moonEq(jdeOf(date)); return hzOf(siderealApparent(date) + lon - m.ra, m.dec, lat).alt;
  }
  function moonPhaseName(phase) {
    const p = norm360(phase * 360) / 360, w = 0.034; // ≈ ±1일
    if (p < w || p > 1 - w) return "moon.new";
    if (Math.abs(p - 0.25) < w) return "moon.firstQuarter";
    if (Math.abs(p - 0.5) < w) return "moon.full";
    if (Math.abs(p - 0.75) < w) return "moon.lastQuarter";
    return p < 0.25 ? "moon.waxingCrescent" : p < 0.5 ? "moon.waxingGibbous" : p < 0.75 ? "moon.waningGibbous" : "moon.waningCrescent";
  }

  /* ===== 교차 탐색(표본 → 이분법) ===== */
  function sample(f, t0, t1, step) {
    const ts = [], vs = [];
    for (let t = t0; t < t1; t += step) { ts.push(t); vs.push(f(t)); }
    ts.push(t1); vs.push(f(t1));
    return { ts, vs, f };
  }
  function bisect(g, a, b, ga, tol = 1000) { // g(a), g(b) 부호 반대
    while (b - a > tol) { const m = (a + b) / 2, gm = g(m); if ((gm > 0) === (ga > 0)) { a = m; ga = gm; } else b = m; }
    return (a + b) / 2;
  }
  // 임계값 thr 교차 목록 [{t, up}]
  function crossings(S, thr, tol) {
    const out = [], g = t => S.f(t) - thr;
    for (let i = 1; i < S.ts.length; i++) {
      const a = S.vs[i - 1] - thr, b = S.vs[i] - thr;
      if ((a > 0) !== (b > 0)) out.push({ t: bisect(g, S.ts[i - 1], S.ts[i], a, tol), up: b > 0 });
    }
    return out;
  }
  // lo ≤ f < hi 인 구간 목록 (창 경계에서 잘림)
  function bandIntervals(S, lo, hi) {
    const inside = v => v >= lo && v < hi, ev = [...crossings(S, lo), ...crossings(S, hi)].sort((a, b) => a.t - b.t);
    const out = []; let cur = inside(S.vs[0]) ? S.ts[0] : null;
    for (const e of ev) {
      const state = inside(S.f(e.t + 1000)); // 교차 직후 상태
      if (state && cur == null) cur = e.t;
      else if (!state && cur != null) { if (e.t > cur) out.push([cur, e.t]); cur = null; }
    }
    if (cur != null) out.push([cur, S.ts[S.ts.length - 1]]);
    return out;
  }
  const toD = t => t == null ? null : new Date(Math.round(t / 1000) * 1000);

  /* ===== 뜨고 짐 ===== */
  function riseSet(body, ymd, lat, lon, tz = "Asia/Seoul", opts = {}) {
    const [t0, t1] = dayWindow(ymd, tz);
    let f, h0, hourAngle;
    if (body === "moon") {
      h0 = opts.h0 ?? 0.125; f = t => moonGeoAlt(new Date(t), lat, lon);
      hourAngle = t => { const m = moonEq(jdeOf(new Date(t))); return wrap180(siderealApparent(new Date(t)) + lon - m.ra); };
    } else {
      h0 = opts.h0 ?? -0.833; f = t => sunPos(new Date(t), lat, lon).alt;
      hourAngle = t => sunPos(new Date(t), lat, lon).H;
    }
    const step = 10 * MIN, S = sample(f, t0, t1, step), cr = crossings(S, h0);
    const rise = cr.find(c => c.up), set = cr.find(c => !c.up);
    // 남중: 시간각 −→+ 교차(|H|<90 부근)
    let transit = null, ha = hourAngle(t0);
    for (let t = t0 + step; t <= t1 + 1; t += step) {
      const hb = hourAngle(t);
      if (ha <= 0 && hb > 0 && hb - ha < 90) { transit = bisect(hourAngle, t - step, t, ha, 1000); break; }
      ha = hb;
    }
    const any = cr.length > 0, above = S.vs[0] > h0;
    return {
      rise: toD(rise && rise.t), set: toD(set && set.t), transit: toD(transit),
      alwaysUp: !any && above && S.vs.every(v => v > h0), alwaysDown: !any && !above && S.vs.every(v => v <= h0)
    };
  }

  /* ===== 박명·골든/블루아워·어둠 ===== */
  function twilight(ymd, lat, lon, tz = "Asia/Seoul") {
    const [t0, t1] = dayWindow(ymd, tz), f = t => sunPos(new Date(t), lat, lon).alt;
    const S = sample(f, t0, t1, 5 * MIN);
    const pair = thr => { const c = crossings(S, thr); const up = c.find(x => x.up), dn = c.filter(x => !x.up).pop(); return { dawn: toD(up && up.t), dusk: toD(dn && dn.t) }; };
    // 정오(태양 최고)
    let iMax = 0; S.vs.forEach((v, i) => { if (v > S.vs[iMax]) iMax = i; });
    const noon = S.ts[iMax];
    const amPm = (lo, hi) => {
      const iv = bandIntervals(S, lo, hi);
      const am = iv.filter(([a, b]) => (a + b) / 2 < noon), pm = iv.filter(([a, b]) => (a + b) / 2 >= noon);
      const j = x => x ? [toD(x[0]), toD(x[1])] : null;
      return { am: j(am[0]), pm: j(pm[pm.length - 1]) };
    };
    // 밤(그날 정오 → 다음날 정오)의 천문 어둠
    const n0 = +localToDate(ymd, tz, 12), n1 = +localToDate(addDays(ymd, 1), tz, 12);
    const N = sample(f, n0, n1, 5 * MIN), darkIv = bandIntervals(N, -1000, -18);
    const darkMs = darkIv.reduce((s, [a, b]) => s + (b - a), 0);
    const maxN = Math.max(...N.vs), minN = Math.min(...N.vs);
    const maxD = Math.max(...S.vs), minD = Math.min(...S.vs);
    const longest = darkIv.slice().sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
    return {
      civil: pair(-6), nautical: pair(-12), astro: pair(-18),
      golden: amPm(-4, 6), blue: amPm(-6, -4),
      darkHours: Math.round(darkMs / HOUR * 100) / 100,
      dark: longest ? { start: toD(longest[0]), end: toD(longest[1]) } : null,
      polarDay: minD > -0.833, polarNight: maxD < -0.833,
      whiteNight: minN > -18 && minN <= -0.833 ? true : minN > -0.833 ? "midnightSun" : false,
      sunMaxAlt: maxD, sunMinAlt: minN, noon: toD(noon)
    };
  }

  /* ===== 촬영 기하 ===== */
  function bearing(lat1, lon1, lat2, lon2) {
    const dl = lon2 - lon1;
    return norm360(atan2(sin(dl) * cos(lat2), cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dl)));
  }
  function distanceKm(lat1, lon1, lat2, lon2) {
    const a = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2;
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function destination(lat, lon, brgDeg, distKm) {
    const d = distKm / EARTH_KM * R2D;
    const la2 = asin(sin(lat) * cos(d) + cos(lat) * sin(d) * cos(brgDeg));
    const lo2 = lon + atan2(sin(brgDeg) * sin(d) * cos(lat), cos(d) - sin(lat) * sin(la2));
    return { lat: la2, lon: wrap180(lo2) };
  }
  // 높이차 heightDiffM 인 물체의 겉보기 올려본각(도). 곡률 낙차 d²/2R·(1−k)
  function apparentAlt(heightDiffM, distKm, opt = {}) {
    const k = opt.refraction ?? 0.13, d = Math.max(distKm, 1e-6) * 1000;
    const drop = d * d / (2 * EARTH_KM * 1000) * (1 - k);
    return Math.atan2(heightDiffM - drop, d) * R2D;
  }
  const angularSize = (sizeM, distKm) => 2 * Math.atan2(sizeM / 2, Math.max(distKm, 1e-6) * 1000) * R2D;
  const sizeRatio = (bodyDiamDeg, sizeM, distKm) => sizeM > 0 ? bodyDiamDeg / angularSize(sizeM, distKm) : null;
  function bodyAt(body, date, lat, lon, elevM) {
    if (body === "moon") return moonPos(date, lat, lon, elevM);
    const s = sunPos(date, lat, lon); return s;
  }

  function shootingLine(target, body, date, opt = {}) {
    const maxKm = opt.maxKm ?? 30, step = opt.stepKm ?? 0.1, eye = opt.observerEyeM ?? 1.5, gfn = opt.groundElevFn;
    const b0 = bodyAt(body, date, target.lat, target.lon, target.baseM || 0);
    const lineAz = norm360(b0.az + 180), pts = [];
    for (let i = 1, d = step; d <= maxKm + 1e-9; i++, d = i * step) {
      const p = destination(target.lat, target.lon, lineAz, d), ground = gfn ? (+gfn(p.lat, p.lon) || 0) : 0;
      const b = bodyAt(body, date, p.lat, p.lon, ground + eye);
      const tAlt = apparentAlt(target.topM - ground - eye, d), off = b.altApparent - tAlt;
      pts.push({ distKm: Math.round(d * 1000) / 1000, lat: p.lat, lon: p.lon, groundM: ground, targetTopAlt: tAlt, bodyAlt: b.altApparent, bodyAz: b.az, offsetDeg: off, onTop: Math.abs(off) <= b.diamDeg / 2 });
    }
    let best = null;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1].offsetDeg, c = pts[i].offsetDeg;
      if ((a > 0) !== (c > 0)) { best = pts[i - 1].distKm + (pts[i].distKm - pts[i - 1].distKm) * a / (a - c); break; }
    }
    if (best == null && pts.length) best = pts.reduce((m, p) => Math.abs(p.offsetDeg) < Math.abs(m.offsetDeg) ? p : m).distKm;
    const size = target.widthM || ((target.topM ?? 0) - (target.baseM ?? 0));
    return {
      az: b0.az, alt: b0.altApparent, diamDeg: b0.diamDeg, lineAz, points: pts, bestDistKm: best,
      sizeRatioFn: (distKm, widthM) => sizeRatio(b0.diamDeg, widthM || size, distKm)
    };
  }

  // 해·달이 촬영지→대상 방위를 지나는 시각을 찾고 고도 조건 확인
  function findAlignments(target, observer, opt = {}) {
    const body = opt.body || "moon", from = +(opt.fromDate || new Date()), to = +(opt.toDate || from + 365 * DAY);
    const dist = distanceKm(observer.lat, observer.lon, target.lat, target.lon);
    const brg = bearing(observer.lat, observer.lon, target.lat, target.lon);
    const obsH = (observer.elevM || 0) + (observer.eyeM ?? 1.5);
    const topAlt = apparentAlt(target.topM - obsH, dist), baseAlt = apparentAlt((target.baseM || 0) - obsH, dist);
    const partSpec = opt.part || "top";
    let partName, refAlt;
    if (partSpec === "any") partName = "any";
    else if (typeof partSpec === "object" && partSpec.heightM != null) { partName = "height"; refAlt = apparentAlt((target.baseM || 0) + partSpec.heightM - obsH, dist); }
    else { partName = "top"; refAlt = topAlt; }
    const halfW = target.widthM ? Math.atan2(target.widthM / 2, dist * 1000) * R2D : 0;
    const pos = t => bodyAt(body, new Date(t), observer.lat, observer.lon, obsH);
    const tolOf = p => opt.toleranceDeg ?? p.diamDeg / 2;
    const altOk = (alt, tol) => partName === "any" ? (alt >= baseAlt - tol && alt <= topAlt + tol) : Math.abs(alt - refAlt) <= tol;
    const lo = (partName === "any" ? baseAlt : refAlt) - 4, hi = (partName === "any" ? topAlt : refAlt) + 4;
    const step = 10 * MIN, out = [];
    const g = t => wrap180(pos(t).az - brg);
    let ta = from, pa = pos(ta), fa = wrap180(pa.az - brg);
    for (let tb = from + step; tb <= to; tb += step) {
      const pb = pos(tb), fb = wrap180(pb.az - brg);
      const inBand = !(Math.min(pa.altApparent, pb.altApparent) > hi || Math.max(pa.altApparent, pb.altApparent) < lo);
      if (inBand && (fa > 0) !== (fb > 0) && Math.abs(fa) < 90 && Math.abs(fb) < 90) {
        const tc = Math.round(bisect(g, ta, tb, fa, 20000) / MIN) * MIN, p = pos(tc), tol = tolOf(p);
        if (altOk(p.altApparent, tol)) {
          const ok = t => { const q = pos(t); return Math.abs(wrap180(q.az - brg)) * cos(q.altApparent) <= tol + halfW && altOk(q.altApparent, tol); };
          let s = tc, e = tc;
          while (s - tc > -180 * MIN && ok(s - MIN)) s -= MIN;
          while (e - tc < 180 * MIN && ok(e + MIN)) e += MIN;
          const sun = body === "sun" ? p : sunPos(new Date(tc), observer.lat, observer.lon);
          const close = partName === "any" ? 1 : 1 - Math.min(1, Math.abs(p.altApparent - refAlt) / tol);
          let score;
          if (body === "moon") {
            const sa = sun.alt, tw = sa > 0 ? Math.max(0, 1 - sa / 8) : sa < -8 ? Math.max(0, 1 - (-8 - sa) / 10) : 1;
            score = 100 * (0.55 * p.illum + 0.35 * tw + 0.10 * close);
          } else {
            const as = p.altApparent < 5 ? 1 : Math.max(0, 1 - (p.altApparent - 5) / 15);
            score = 100 * (0.8 * as + 0.2 * close);
          }
          out.push({
            time: new Date(tc), body, alt: p.altApparent, az: p.az, part: partName, partAlt: partName === "any" ? [baseAlt, topAlt] : refAlt,
            offsetDeg: partName === "any" ? 0 : p.altApparent - refAlt, minutes: Math.round((e - s) / MIN) + 1,
            phase: body === "moon" ? p.phase : null, illum: body === "moon" ? p.illum : null, diamDeg: p.diamDeg,
            sunAlt: sun.alt, passDir: fb > fa ? "L→R" : "R→L", score: Math.round(score), distKm: dist, bearing: brg
          });
        }
      }
      ta = tb; pa = pb; fa = fb;
    }
    return out;
  }

  /* ===== 오로라 ===== */
  // 지자기 위도(쌍극자 근사, 북 지자기극 80.7°N 72.7°W)
  function magLat(lat, lon) { return asin(sin(lat) * sin(80.7) + cos(lat) * cos(80.7) * cos(lon - (-72.7))); }
  // Kp → 확률(%) 근사 (OVATION 없는 시간용, 경험적 근사값이며 관측 확률이 아님):
  // 오로라대 적도쪽 경계 ≈ 66° − 2·Kp (지자기 위도). 경계 안쪽 10°까지 최대, 그 너머 8°에 걸쳐 감소,
  // 경계 바깥 6°까지는 북쪽 지평선 가시로 선형 감소. 최대치 = min(90, 15 + 8·Kp).
  function kpToProb(kp, mlat) {
    if (kp == null || mlat == null) return 0;
    const edge = 66 - 2 * kp, d = Math.abs(mlat) - edge;
    const pos = d >= 0 ? (d <= 10 ? 1 : Math.max(0, 1 - (d - 10) / 8)) : Math.max(0, 1 + d / 6);
    return Math.round(Math.min(90, 15 + 8 * kp) * pos);
  }
  // 확률 → 세기 0..1 (70% 이상 = 1, 약한 확률도 카메라로는 보이므로 위로 볼록한 곡선)
  const auroraStrength = prob => clamp01(Math.pow(Math.max(0, prob) / 70, 0.6));
  function auroraIndex(o = {}) {
    let prob = o.prob;
    if (prob == null && o.kp != null) prob = kpToProb(o.kp, o.magLat ?? (o.lat != null && o.lon != null ? magLat(o.lat, o.lon) : 65));
    const strength = auroraStrength(prob || 0);
    const c = x => clamp01((x || 0) / 100);
    const eff = 1 - (1 - c(o.cloudLow)) * (1 - c(o.cloudMid)) * (1 - 0.5 * c(o.cloudHigh)); // 무작위 겹침, 최대 1
    const clear = clamp01(1 - eff);
    const sa = o.sunAlt ?? -90, dark = clamp01((-6 - sa) / 12);
    const ma = o.moonAlt ?? -90, altF = ma <= 0 ? 0 : Math.min(1, ma / 30);
    let dirF = 1;
    if (o.moonAz != null) { const north = o.lat != null && o.lat < 0 ? false : true; const a = norm360(o.moonAz); const inNorth = a >= 270 || a <= 90; dirF = (north ? inNorth : !inNorth) ? 1 : 0.7; }
    const maxCut = 0.9 - 0.6 * strength, moon = clamp01(1 - maxCut * clamp01(o.moonIllum ?? 0) * altF * dirF);
    const parts = { strength, clear, dark, moon };
    const score = Math.max(0, Math.min(10, Math.round(10 * strength * clear * dark * moon)));
    const grade = score <= 2 ? "none" : score <= 4 ? "low" : score <= 6 ? "fair" : score <= 8 ? "high" : "epic";
    const keys = { strength: "reason.weak", clear: "reason.cloud", dark: "reason.light", moon: "reason.moon" };
    let weakest = "strength"; for (const k of ["clear", "dark", "moon"]) if (parts[k] < parts[weakest]) weakest = k;
    const reason = parts[weakest] >= 0.8 ? "reason.great" : keys[weakest];
    return { score, parts, grade, reason, prob: prob ?? null };
  }

  /* ===== 은하수 ===== */
  // 은하 중심 J2000 RA 17h45m40.04s, Dec −29°00′28.1″ → 간이 세차(연간) 적용
  const GC_RA = (17 + 45 / 60 + 40.04 / 3600) * 15, GC_DEC = -(29 + 0 / 60 + 28.1 / 3600);
  function precess(ra, dec, date) {
    const yrs = (jdOf(date) - 2451545) / 365.25;
    const m = 3.07496 / 240, nRa = 1.33621 / 240, nDec = 20.0431 / 3600;
    return { ra: ra + yrs * (m + nRa * sin(ra) * tan(dec)), dec: dec + yrs * nDec * cos(ra) };
  }
  function raDecToHz(ra, dec, date, lat, lon) { const p = hzOf(siderealApparent(date) + lon - ra, dec, lat); return { az: p.az, alt: p.alt, altApparent: apparentFromTrue(p.alt) }; }
  function galacticCenter(date, lat, lon) { const q = precess(GC_RA, GC_DEC, date); return raDecToHz(q.ra, q.dec, date, lat, lon); }
  // 그날 밤(현지 정오 → 다음날 정오): 은하 중심 고도 >10° ∩ 해 < −18° (가장 긴 구간). moonless: 그중 달(지심 0.125° 기준) 진 시간.
  function milkyWayWindow(ymd, lat, lon, tz = "Asia/Seoul", opt = {}) {
    const minAlt = opt.minAlt ?? 10, t0 = +localToDate(ymd, tz, 12), t1 = +localToDate(addDays(ymd, 1), tz, 12), step = 2 * MIN;
    const sunA = t => sunPos(new Date(t), lat, lon).alt, gcA = t => galacticCenter(new Date(t), lat, lon).alt, moonA = t => moonGeoAlt(new Date(t), lat, lon);
    const okBase = t => sunA(t) < -18 && gcA(t) > minAlt, okMoon = t => okBase(t) && moonA(t) < 0.125;
    const longest = ok => {
      let best = null, cur = null, prev = ok(t0);
      if (prev) cur = t0;
      for (let t = t0 + step; t <= t1; t += step) {
        const v = ok(t);
        if (v !== prev) {
          const edge = bisect(x => ok(x) ? 1 : -1, t - step, t, prev ? 1 : -1, 15000);
          if (v) cur = edge; else { if (!best || edge - cur > best[1] - best[0]) best = [cur, edge]; cur = null; }
          prev = v;
        }
      }
      if (cur != null && (!best || t1 - cur > best[1] - best[0])) best = [cur, t1];
      return best;
    };
    const w = longest(okBase);
    if (!w) return null;
    const G0 = sample(gcA, t0, t1, 10 * MIN), cr = crossings(G0, minAlt);
    const r = cr.find(c => c.up), s = cr.find(c => !c.up), mw = longest(okMoon);
    return {
      start: toD(w[0]), end: toD(w[1]), minutes: Math.round((w[1] - w[0]) / MIN),
      coreRise: toD(r && r.t), coreSet: toD(s && s.t), coreMinAlt: minAlt,
      moonless: mw ? { start: toD(mw[0]), end: toD(mw[1]), minutes: Math.round((mw[1] - mw[0]) / MIN) } : null
    };
  }

  /* ===== 유성우 (IMO 표준값 기반 대략치 — 해마다 극대일·ZHR 변동) ===== */
  const METEOR_SHOWERS = [
    { key: "quadrantids", peak: "01-03", active: ["12-28", "01-12"], zhr: 110, radiant: { ra: 230, dec: 49 }, approx: true },
    { key: "lyrids", peak: "04-22", active: ["04-14", "04-30"], zhr: 18, radiant: { ra: 271, dec: 34 }, approx: true },
    { key: "etaAquariids", peak: "05-06", active: ["04-19", "05-28"], zhr: 50, radiant: { ra: 338, dec: -1 }, approx: true },
    { key: "perseids", peak: "08-12", active: ["07-17", "08-24"], zhr: 100, radiant: { ra: 48, dec: 58 }, approx: true },
    { key: "orionids", peak: "10-21", active: ["10-02", "11-07"], zhr: 20, radiant: { ra: 95, dec: 16 }, approx: true },
    { key: "leonids", peak: "11-17", active: ["11-06", "11-30"], zhr: 15, radiant: { ra: 152, dec: 22 }, approx: true },
    { key: "geminids", peak: "12-14", active: ["12-04", "12-20"], zhr: 150, radiant: { ra: 112, dec: 33 }, approx: true },
    { key: "ursids", peak: "12-22", active: ["12-17", "12-26"], zhr: 10, radiant: { ra: 217, dec: 76 }, approx: true }
  ];
  const meteorRadiant = (shower, date, lat, lon) => raDecToHz(shower.radiant.ra, shower.radiant.dec, date, lat, lon);

  /* ===== 무지개 ===== */
  const rainbowPossible = sunAlt => sunAlt > 0 && sunAlt < 42;
  const rainbowAz = sunAz => norm360(sunAz + 180);
  const rainbowTopAlt = sunAlt => 42 - sunAlt;

  const SK = {
    VERSION, sunPos, moonPos, sunDiamDeg, riseSet, twilight, moonPhaseName,
    bearing, distanceKm, destination, apparentAlt, angularSize, sizeRatio, shootingLine, findAlignments,
    auroraIndex, kpToProb, magLat, galacticCenter, milkyWayWindow, METEOR_SHOWERS, meteorRadiant,
    rainbowPossible, rainbowAz, rainbowTopAlt,
    refraction, apparentFromTrue, trueFromApparent, localTime, localToDate, tzOffsetMin, deltaT,
    _internal: { jdOf, jdeOf, gmst, siderealApparent, nutation, sunEcl, sunEq, moonEcl, moonEq, moonGeoAlt, topocentric }
  };
  G.SkyCore = SK; if (typeof module !== "undefined" && module.exports) module.exports = SK;
})(typeof globalThis !== "undefined" ? globalThis : this);
