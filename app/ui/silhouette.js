/* 실루엣 미리보기 (#/shoot/silhouette): 구조물 + 촬영 위치 + 날짜 → 그 자리에서 본 구조물 실루엣·지형 지평선,
 * 해·달의 하루 궤적(실제 각크기), 달 위상·밝은 가장자리 기울기, 시각 슬라이더·재생, 가림 색, 한 줄 요약.
 * 천문 계산이므로 SPEC 11(예보 아님)에 해당하지 않는다. 계산: core/sky-core.js · core/landmark-core.js · (있으면) core/terrain-core.js */
import { t, lang } from "../i18n.js";
import { esc, header } from "./dom.js";
import { S, sunPos, moonPos, moonPhaseName } from "../core.js";
import { dateToLocal, localToDate, addDays } from "../format.js";
import { safeStorage } from "../state.js";
import {
  makeView, chooseWindow, samplePath, aboveSpan, overlapWindows, runs, moonLitPath, phaseRotation,
  lensFov, hourTicks, pathSegments, worstState, horizonState, unwrapAz, wrap180,
} from "../silhouette-calc.js";

/* 서울 랜드마크만 있으므로 시간대는 서울 고정 (다른 나라 구조물이 생기면 landmark.tz 로) */
const TZ = "Asia/Seoul";
const G = globalThis;
const LC = () => G.LandmarkCore || null;
const TC = () => (G.TerrainCore && typeof G.TerrainCore.horizonProfile === "function" ? G.TerrainCore : null);
const LENSES = [24, 35, 50, 85, 135, 200, 400, 800];
const MIN_ALT = -2;
const W = 1000, H = 720;

/* 촬영지 프리셋 — 모두 「대략적인」 위치·지면 고도(elevM, 지형 자료가 없을 때만 씀). 지도에서 확인한 값이 아님 */
const PRESETS = {
  "n-seoul-tower": [
    { ko: "응봉산 팔각정", en: "Eungbongsan pavilion", lat: 37.5497, lon: 127.0310, elevM: 80 },
    { ko: "노들섬", en: "Nodeul Island", lat: 37.5177, lon: 126.9586, elevM: 15 },
    { ko: "낙산공원", en: "Naksan Park", lat: 37.5806, lon: 127.0075, elevM: 110 },
  ],
  "lotte-world-tower": [
    { ko: "석촌호수 서호", en: "Seokchon Lake (west)", lat: 37.5089, lon: 127.0985, elevM: 18 },
    { ko: "올림픽공원 몽촌토성", en: "Olympic Park (Mongchon)", lat: 37.5197, lon: 127.1176, elevM: 40 },
    { ko: "뚝섬한강공원", en: "Ttukseom Hangang Park", lat: 37.5295, lon: 127.0700, elevM: 8 },
    { ko: "남한산성 서문", en: "Namhansanseong West Gate", lat: 37.4793, lon: 127.1747, elevM: 440 },
  ],
  "63-square": [
    { ko: "노들섬", en: "Nodeul Island", lat: 37.5177, lon: 126.9586, elevM: 15 },
    { ko: "선유도공원", en: "Seonyudo Park", lat: 37.5430, lon: 126.8996, elevM: 12 },
    { ko: "이촌한강공원", en: "Ichon Hangang Park", lat: 37.5180, lon: 126.9770, elevM: 8 },
  ],
  "parc1": [
    { ko: "선유도공원", en: "Seonyudo Park", lat: 37.5430, lon: 126.8996, elevM: 12 },
    { ko: "노들섬", en: "Nodeul Island", lat: 37.5177, lon: 126.9586, elevM: 15 },
  ],
  "national-assembly": [
    { ko: "선유도공원", en: "Seonyudo Park", lat: 37.5430, lon: 126.8996, elevM: 12 },
    { ko: "망원한강공원", en: "Mangwon Hangang Park", lat: 37.5547, lon: 126.8964, elevM: 8 },
  ],
  "gwanghwamun": [
    { ko: "광화문광장 세종대왕상", en: "Gwanghwamun Square (King Sejong)", lat: 37.5715, lon: 126.9769, elevM: 34 },
    { ko: "광화문광장 남쪽", en: "Gwanghwamun Square (south)", lat: 37.5695, lon: 126.9768, elevM: 32 },
  ],
  "sungnyemun": [
    { ko: "서울로7017", en: "Seoullo 7017", lat: 37.5575, lon: 126.9715, elevM: 40 },
    { ko: "남대문시장 입구", en: "Namdaemun Market entrance", lat: 37.5592, lon: 126.9772, elevM: 28 },
  ],
  "banpo-bridge": [
    { ko: "서래섬", en: "Seorae Island", lat: 37.5085, lon: 126.9905, elevM: 7 },
    { ko: "이촌한강공원", en: "Ichon Hangang Park", lat: 37.5180, lon: 126.9770, elevM: 8 },
  ],
  "dongjak-bridge": [
    { ko: "이촌한강공원", en: "Ichon Hangang Park", lat: 37.5180, lon: 126.9770, elevM: 8 },
    { ko: "노들섬", en: "Nodeul Island", lat: 37.5177, lon: 126.9586, elevM: 15 },
  ],
  "jamsil-cheongdam-bridges": [
    { ko: "뚝섬한강공원", en: "Ttukseom Hangang Park", lat: 37.5295, lon: 127.0700, elevM: 8 },
    { ko: "잠실한강공원", en: "Jamsil Hangang Park", lat: 37.5185, lon: 127.0830, elevM: 8 },
  ],
};

/* ---------- 저장 (store 는 모르는 키를 지우므로 별도 키) ---------- */
const KEY = "pc:silhouette:v1";
const st = safeStorage(typeof localStorage !== "undefined" ? localStorage : null);
function loadPrefs() {
  try { const o = JSON.parse(st.get(KEY) || "null"); return o && typeof o === "object" ? o : {}; } catch { return {}; }
}
function savePrefs(p) {
  const { id, body, lat, lon, eye, zoom, lens, preset } = p;
  st.set(KEY, JSON.stringify({ id, body, lat, lon, eye, zoom, lens, preset }));
}

/* ---------- 자료 ---------- */
let libP = null;
function loadLibrary() {
  if (!libP) {
    libP = fetch("data/landmarks.json").then((r) => { if (!r.ok) throw new Error("landmarks " + r.status); return r.json(); })
      .then((j) => { LC().setLibrary(j); return j; })
      .catch((e) => { libP = null; throw e; });
  }
  return libP;
}
const terrainCache = new Map(); // "lat,lon,eye" → Promise<profile|null>
function loadTerrain(lat, lon, eyeM) {
  const T = TC(); if (!T) return null;
  const k = `${lat.toFixed(4)},${lon.toFixed(4)},${eyeM}`;
  if (!terrainCache.has(k)) {
    const p = (async () => {
      const src = T.terrariumSource();
      // 타일을 못 받으면 고도가 모두 비고(null) 프로파일은 해수면 하한만 남는다 → 받은 비율로 실패 판정
      let okFrac = 0, groundOk = false;
      const probe = { ...src, elevations: async (pts) => {
        const r = await src.elevations(pts);
        okFrac = r.filter((v) => typeof v === "number" && isFinite(v)).length / Math.max(1, r.length);
        groundOk = typeof r[0] === "number" && isFinite(r[0]);
        return r;
      } };
      const prof = await T.horizonProfile(probe, { lat, lon, eyeM, maxKm: 40, stepDeg: 0.25 });
      if (!prof || okFrac < 0.5) return null;
      if (!groundOk) prof.groundM = NaN; // 관측점 고도는 모름 → 프리셋 값/0 m
      return { prof, src };
    })().catch((e) => { console.warn("terrain", e); terrainCache.delete(k); return null; });
    terrainCache.set(k, p);
  }
  return terrainCache.get(k);
}
const horizonAt = (terr, az) => { try { const h = G.TerrainCore.horizonAt(terr.prof, ((az % 360) + 360) % 360); return isFinite(h) ? h : null; } catch { return null; } };

const lmName = (l) => (l ? (lang() === "en" ? l.name.en : l.name.ko) : "");
const pName = (p) => (lang() === "en" ? p.en : p.ko);
const hm = (ms) => dateToLocal(new Date(ms), TZ).slice(11, 16);
const span2 = (w) => (hm(w.start) === hm(w.end) ? hm(w.start) : `${hm(w.start)}–${hm(w.end)}`);
const todayYmd = () => dateToLocal(new Date(), TZ).slice(0, 10);
const fix = (v, n = 1) => (Math.round(v * 10 ** n) / 10 ** n).toFixed(n);
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

/** 해·달 위치 (겉보기 고도). 달은 SkyCore 의 지면 고도 반영 시차·밝은 가장자리 각을 씀 */
function bodyFn(body, lat, lon, elevM) {
  const sk = S();
  if (body === "moon") {
    return (d) => {
      const m = sk?.moonPos ? sk.moonPos(d, lat, lon, elevM) : moonPos(d, lat, lon);
      return { az: m.az, alt: m.altApparent ?? m.alt, diamDeg: m.diamDeg || 0.52, illum: m.illum, phase: m.phase, brightLimb: m.brightLimb, parallactic: m.parallactic };
    };
  }
  return (d) => { const s = sunPos(d, lat, lon); return { az: s.az, alt: s.altApparent ?? s.alt, diamDeg: s.diamDeg || 0.533 }; };
}

/* ================= 화면 ================= */
export async function renderSilhouette(root, ctx) {
  root.innerHTML = header(t("shoot.silhouette"), { backLabel: t("back") }) + `<div class="pad sil"><div class="spin" aria-hidden="true"></div></div>`;
  const body = root.querySelector(".sil");
  if (!LC() || !S()) { body.innerHTML = `<p class="muted">${esc(t("sil.noCore"))}</p>`; return; }
  let lib;
  try { lib = await loadLibrary(); } catch (e) { console.warn(e); body.innerHTML = `<p class="muted">${esc(t("sil.loadFail"))}</p>`; return; }
  if (!root.isConnected) return;
  const L = LC().list(lib);

  /* ---- 상태 ---- */
  const saved = loadPrefs();
  const P = {
    id: L.some((l) => l.id === saved.id) ? saved.id : "n-seoul-tower",
    date: todayYmd(),
    body: saved.body === "sun" ? "sun" : "moon",
    lat: num(saved.lat), lon: num(saved.lon), eye: num(saved.eye) ?? 1.6,
    zoom: saved.zoom === "wide" ? "wide" : "fit",
    lens: LENSES.includes(saved.lens) ? saved.lens : 0,
    preset: Number.isInteger(saved.preset) ? saved.preset : 0,
  };
  if (P.lat == null || P.lon == null) { const p = (PRESETS[P.id] || [])[0]; if (p) { P.lat = p.lat; P.lon = p.lon; P.preset = 0; } }
  let M = null; // 계산 결과
  let tMs = null; // 슬라이더 시각
  let playing = false, raf = 0, lastTs = 0;
  let terr = null, terrState = "none"; // none | loading | ok | fail
  let terrKey = "";

  /* ---- 골격 ---- */
  const presetBtns = () => (PRESETS[P.id] || []).map((p, i) => `<button type="button" class="chip-btn${P.preset === i && near(p) ? " on" : ""}" data-preset="${i}" aria-pressed="${P.preset === i && near(p)}">${esc(pName(p))}</button>`).join("");
  const near = (p) => P.lat != null && Math.abs(p.lat - P.lat) < 1e-4 && Math.abs(p.lon - P.lon) < 1e-4;
  body.innerHTML = `
    <section class="card sil-ctl">
      <div class="sil-row2">
        <label class="fld"><span>${esc(t("sil.landmark"))}</span>
          <select id="sil-lm">${L.map((l) => `<option value="${esc(l.id)}"${l.id === P.id ? " selected" : ""}>${esc(lmName(l))}</option>`).join("")}</select></label>
        <label class="fld"><span>${esc(t("sil.date"))}</span><input id="sil-date" type="date" value="${esc(P.date)}" required></label>
      </div>
      <div class="fld"><span id="sil-body-l">${esc(t("sil.body"))}</span>
        <div class="seg" role="group" aria-labelledby="sil-body-l">
          <button type="button" data-body="sun" aria-pressed="${P.body === "sun"}" class="${P.body === "sun" ? "on" : ""}">☀︎ ${esc(t("sil.sun"))}</button>
          <button type="button" data-body="moon" aria-pressed="${P.body === "moon"}" class="${P.body === "moon" ? "on" : ""}">☾ ${esc(t("sil.moon"))}</button>
        </div></div>
      <fieldset class="fld sil-pos"><legend>${esc(t("sil.position"))}</legend>
        <div class="sil-presets" role="group" aria-label="${esc(t("sil.presets"))}">${presetBtns()}</div>
        <div class="sil-row3">
          <label class="fld"><span>${esc(t("sil.lat"))}</span><input id="sil-lat" type="number" inputmode="decimal" step="0.0001" min="-90" max="90" value="${P.lat ?? ""}"></label>
          <label class="fld"><span>${esc(t("sil.lon"))}</span><input id="sil-lon" type="number" inputmode="decimal" step="0.0001" min="-180" max="180" value="${P.lon ?? ""}"></label>
          <label class="fld"><span>${esc(t("sil.eye"))}</span><input id="sil-eye" type="number" inputmode="decimal" step="0.1" min="0" max="500" value="${P.eye}"></label>
        </div>
        <p class="muted tiny">${esc(t("sil.presetNote"))}</p>
      </fieldset>
    </section>
    <section class="card sil-card">
      <p class="sil-sum" aria-live="polite"></p>
      <div class="sil-chart"></div>
      <div class="sil-time">
        <button type="button" class="icon-btn sil-play" aria-label="${esc(t("sil.play"))}"><span aria-hidden="true">▶</span></button>
        <input id="sil-t" type="range" min="0" max="1440" step="1" value="0" aria-label="${esc(t("sil.timeA11y"))}">
        <output class="sil-clock" for="sil-t">--:--</output>
        <button type="button" class="btn ghost sil-now">${esc(t("sil.now"))}</button>
      </div>
      <dl class="sil-read"></dl>
      <div class="sil-opts">
        <div class="seg" role="group" aria-label="${esc(t("sil.zoom"))}">
          <button type="button" data-zoom="fit" aria-pressed="${P.zoom === "fit"}" class="${P.zoom === "fit" ? "on" : ""}">${esc(t("sil.zoomFit"))}</button>
          <button type="button" data-zoom="wide" aria-pressed="${P.zoom === "wide"}" class="${P.zoom === "wide" ? "on" : ""}">${esc(t("sil.zoomWide"))}</button>
        </div>
        <label class="fld"><span>${esc(t("sil.lens"))}</span><select id="sil-lens"><option value="0">${esc(t("sil.lensNone"))}</option>${LENSES.map((f) => `<option value="${f}"${f === P.lens ? " selected" : ""}>${f} mm</option>`).join("")}</select></label>
      </div>
      <div class="sil-notes muted tiny"></div>
    </section>`;

  const $ = (s) => body.querySelector(s);
  const chart = $(".sil-chart"), sumEl = $(".sil-sum"), range = $("#sil-t"), clock = $(".sil-clock"), readEl = $(".sil-read"), notesEl = $(".sil-notes"), playBtn = $(".sil-play"), nowBtn = $(".sil-now");

  /* ---- 계산 ---- */
  function compute() {
    const lm = LC().findLandmark(P.id);
    if (P.lat == null || P.lon == null || Math.abs(P.lat) > 90 || Math.abs(P.lon) > 180) return { err: "sil.badPos" };
    const dKm = S().distanceKm(P.lat, P.lon, lm.lat, lm.lon);
    if (dKm < 0.1) return { err: "sil.tooClose" };
    const pre = (PRESETS[P.id] || []).find(near);
    const groundM = terr?.prof && isFinite(terr.prof.groundM) ? terr.prof.groundM : pre ? pre.elevM : 0;
    const groundSrc = terr?.prof && isFinite(terr.prof.groundM) ? "terrain" : pre ? "preset" : "none";
    const sil = LC().silhouette(lm, { lat: P.lat, lon: P.lon, groundM, eyeM: P.eye }, { columns: 160 });
    const t0 = localToDate(P.date + "T00:00", TZ).getTime(), t1 = localToDate(addDays(P.date, 1) + "T00:00", TZ).getTime();
    const samples = samplePath(bodyFn(P.body, P.lat, P.lon, groundM + P.eye), t0, t1 - 60e3, 1); // 00:00–23:59
    const span = aboveSpan(samples, MIN_ALT);
    const ov = overlapWindows(sil, samples, { minAlt: MIN_ALT });
    // 구조물 뒤로 지나는 구간 (방위 범위 근처만 가림 계산)
    const [a0, a1] = sil.azRange;
    const occ = new Map();
    for (const s of samples) {
      if (s.alt <= MIN_ALT) continue;
      const az = unwrapAz(s.az, sil.bearingDeg), r = s.diamDeg / 2;
      if (az < a0 - r || az > a1 + r || s.alt - r > sil.altRange[1]) continue;
      occ.set(s.t, LC().occlusion(sil, { az: s.az, alt: s.alt, diamDeg: s.diamDeg }).state);
    }
    const behind = runs(samples, (s) => occ.get(s.t) && occ.get(s.t) !== "clear");
    return { lm, sil, samples, span, ov, occ, behind, t0, t1, groundM, groundSrc, dKm };
  }

  const idxOf = (ms) => Math.max(0, Math.min(M.samples.length - 1, Math.round((ms - M.t0) / 60e3)));
  const sampleAt = (ms) => M.samples[idxOf(ms)];

  function windowFor() {
    const { sil, ov } = M;
    const hz = terr ? horizonAt(terr, sil.bearingDeg) : null;
    const focus = [];
    const c = ov.closest;
    // 「구조물 맞춤」: 가까이 지날 때만 궤적까지 담는다 (멀면 구조물이 너무 작아짐 → 「넓게」로)
    if (c && Math.abs(c.dAz) <= Math.max(4, 3 * sil.angularWidthDeg)) focus.push({ az: c.az, alt: c.alt, r: 0.6 });
    for (const w of ov.windows.slice(0, 1)) { const s = sampleAt(w.start), e = sampleAt(w.end); focus.push({ az: s.az, alt: s.alt, r: s.diamDeg }, { az: e.az, alt: e.alt, r: e.diamDeg }); }
    return chooseWindow(sil, { mode: P.zoom, focus, aspect: H / W, horizonAlt: hz != null ? Math.min(hz, 0) : 0 });
  }

  /* ---- 정적 그림 ---- */
  let V = null;
  function drawStatic() {
    const { sil, samples, lm } = M;
    V = makeView({ ...windowFor(), W, H });
    const k = V.k;
    const parts = [];
    const night = P.body === "moon";
    parts.push(`<defs><linearGradient id="sil-sky" x1="0" y1="0" x2="0" y2="1">${night
      ? `<stop offset="0" stop-color="#0b1430"/><stop offset=".75" stop-color="#1f3264"/><stop offset="1" stop-color="#3b4f86"/>`
      : `<stop offset="0" stop-color="#4f86d9"/><stop offset=".7" stop-color="#9cc3f0"/><stop offset="1" stop-color="#f3d6b4"/>`}</linearGradient>
      <radialGradient id="sil-sun"><stop offset="0" stop-color="#fff6d8"/><stop offset=".7" stop-color="#ffd36a"/><stop offset="1" stop-color="#f5a524"/></radialGradient>
      <clipPath id="sil-clip"><rect width="${W}" height="${H}"/></clipPath></defs>`);
    parts.push(`<g clip-path="url(#sil-clip)"><rect width="${W}" height="${H}" fill="url(#sil-sky)"/>`);
    // 격자: 방위·고도 눈금 간격
    const stepDeg = niceStep((2 * V.azHalf) / 5);
    const g = [];
    for (let a = Math.ceil((V.azC - V.azHalf) / stepDeg) * stepDeg; a <= V.azC + V.azHalf; a += stepDeg) {
      const x = V.x(a); g.push(`<line x1="${f1(x)}" x2="${f1(x)}" y1="0" y2="${H}" class="sil-grid"/>`);
      if (x > 40 && x < W - 40) g.push(`<text x="${f1(x)}" y="${H - 12}" text-anchor="middle" class="sil-ax">${fmtDeg(((a % 360) + 360) % 360, stepDeg)}°</text>`);
    }
    for (let h = Math.ceil(V.altMin / stepDeg) * stepDeg; h <= V.altMax; h += stepDeg) {
      if (Math.abs(h) < 1e-9) continue;
      const y = V.y(h); g.push(`<line x1="0" x2="${W}" y1="${f1(y)}" y2="${f1(y)}" class="sil-grid"/><text x="10" y="${f1(y - 8)}" class="sil-ax">${fmtDeg(h, stepDeg)}°</text>`);
    }
    parts.push(g.join(""));
    parts.push(`<g class="sil-body"></g>`);
    // 땅(0° 아래) 또는 지형 지평선
    // 지형 자료가 없으면 해수면 수평선(내림각 dip, 지상 굴절 k=0.13)을 땅 경계로
    const Hm = Math.max(0, M.groundM + P.eye), Rp = 6371008.8 / (1 - 0.13);
    const dip = -Math.acos(Rp / (Rp + Hm)) * 180 / Math.PI;
    M.dip = dip;
    const y0 = V.y(terr ? 0 : dip);
    if (terr) {
      const n = 240, pts = [];
      for (let i = 0; i <= n; i++) { const az = V.azC - V.azHalf + (2 * V.azHalf) * i / n; const h = horizonAt(terr, az); pts.push(`${f1(V.x(az))},${f1(V.y(h ?? 0))}`); }
      parts.push(`<polygon points="0,${H} ${pts.join(" ")} ${W},${H}" class="sil-terrain ${night ? "night" : "day"}"/>`);
      parts.push(`<polyline points="${pts.join(" ")}" class="sil-ridge ${night ? "night" : "day"}"/>`); // 능선이 하늘과 구분되게
    } else parts.push(`<rect x="0" y="${f1(y0)}" width="${W}" height="${f1(Math.max(0, H - y0))}" class="sil-ground"/>`);
    parts.push(`<line x1="0" x2="${W}" y1="${f1(y0)}" y2="${f1(y0)}" class="sil-hz"/>`);
    // 구조물
    const d = sil.polygons.map((poly) => "M" + poly.map(([az, alt]) => `${f1(V.x(az))} ${f1(V.y(alt))}`).join("L") + "Z").join("");
    parts.push(`<path d="${d}" class="sil-lm"/>`);
    // 궤적 (점선) + 정시 눈금
    const segs = pathSegments(samples, V, MIN_ALT);
    parts.push(segs.map((s) => `<polyline points="${s.map((p) => p.map(f1).join(",")).join(" ")}" class="sil-path ${P.body}"/>`).join(""));
    const lmin = (ms) => { const s = dateToLocal(new Date(ms), TZ); return +s.slice(11, 13) * 60 + +s.slice(14, 16); };
    let lastX = -1e9, lastY = -1e9;
    for (const tk of hourTicks(samples, lmin, MIN_ALT)) {
      if (!V.inside(tk.az, tk.alt)) continue;
      const x = V.x(tk.az), y = V.y(tk.alt);
      parts.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="7" class="sil-tick ${P.body}"/>`);
      if (Math.hypot(x - lastX, y - lastY) > 70) {
        const lx = Math.min(W - 30, Math.max(30, x)), ly = y - 18 < 34 ? y + 44 : y - 18;
        parts.push(`<text x="${f1(lx)}" y="${f1(ly)}" text-anchor="middle" class="sil-hl">${tk.hour}</text>`);
        lastX = x; lastY = y;
      }
    }
    // 렌즈 화각 틀 (구조물 가운데)
    if (P.lens) {
      const fov = lensFov(P.lens), cAlt = (sil.altRange[0] + sil.altRange[1]) / 2;
      const w = fov.h * k, h = fov.v * k, cx = V.x(sil.bearingDeg), cy = V.y(cAlt);
      parts.push(`<rect x="${f1(cx - w / 2)}" y="${f1(cy - h / 2)}" width="${f1(w)}" height="${f1(h)}" class="sil-lens"/>`);
      const ty = Math.max(40, cy - h / 2 + 36), tx = Math.max(16, cx - w / 2 + 12);
      parts.push(`<text x="${f1(Math.min(tx, W - 160))}" y="${f1(Math.min(ty, H - 50))}" class="sil-lens-t">${P.lens} mm</text>`);
    }
    parts.push(`<g class="sil-dyn"></g></g>`);
    const title = t("sil.chartA11y", { lm: lmName(lm), body: t("sil." + P.body), date: P.date });
    chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="sil-svg-t" preserveAspectRatio="xMidYMid meet"><title id="sil-svg-t">${esc(title)}</title>${parts.join("")}</svg>`;
  }

  /* ---- 시각마다 바뀌는 부분 ---- */
  function drawDynamic() {
    const s = sampleAt(tMs);
    const dyn = chart.querySelector(".sil-dyn");
    range.value = String(Math.round((tMs - M.t0) / 60e3));
    const tm = hm(s.t);
    clock.textContent = tm; range.setAttribute("aria-valuetext", tm);
    const up = s.alt > MIN_ALT;
    const r = s.diamDeg / 2;
    let state = "clear";
    if (up) {
      const occL = M.occ.get(s.t) || "clear";
      const hz = horizonState(s.alt, r, terr ? horizonAt(terr, s.az) : M.dip);
      state = worstState(occL, hz);
    }
    // 원반은 땅·지형·구조물 「뒤」(.sil-body), 가림 색 테두리는 맨 위(.sil-dyn)
    const bodyG = chart.querySelector(".sil-body");
    if (dyn && bodyG) {
      let back = "", front = "";
      if (up && V.inside(s.az, s.alt, r * 2)) {
        const x = V.x(s.az), y = V.y(s.alt), R = Math.max(r * V.k, 1.5), sw = Math.max(2.5, Math.min(6, R * 0.12));
        const tr = `transform="translate(${f1(x)} ${f1(y)})"`;
        if (P.body === "moon") {
          const rot = phaseRotation(s.brightLimb, s.parallactic);
          back = `<g ${tr}><circle r="${f1(R)}" class="sil-moon-dark"/><path d="${moonLitPath(R, s.illum)}" transform="rotate(${f1(rot)})" class="sil-moon-lit"/></g>`;
        } else back = `<g ${tr}><circle r="${f1(R)}" fill="url(#sil-sun)" class="sil-sun"/></g>`;
        front = `<g ${tr}><circle r="${f1(R + sw / 2)}" class="sil-ring ${state}" stroke-width="${f1(sw)}"/>${R < 14 ? `<circle r="${f1(R + 18)}" class="sil-ring ${state} far"/>` : ""}</g>`;
      } else if (up) {
        // 창 밖: 가장자리에 방향 표시(작은 원 + 화살촉)
        const x = V.x(s.az), y = V.y(s.alt), cx = Math.min(W - 34, Math.max(34, x)), cy = Math.min(H - 34, Math.max(34, y));
        const ang = Math.atan2(y - cy, x - cx) * 180 / Math.PI;
        front = `<g transform="translate(${f1(cx)} ${f1(cy)})"><circle r="16" class="sil-off ${P.body}"/><circle r="16" class="sil-ring ${state}" stroke-width="3"/>
          <path d="M22 -9L34 0L22 9Z" transform="rotate(${f1(ang)})" class="sil-off-arr"/></g>`;
      }
      bodyG.innerHTML = back; dyn.innerHTML = front;
    }
    // 읽기 값
    const { sil } = M;
    const rows = [
      [t("sil.az"), up ? `${fix(((s.az % 360) + 360) % 360)}°` : "–"],
      [t("sil.alt"), up ? `${fix(s.alt)}°` : t("sil.below")],
    ];
    if (P.body === "moon") rows.push([t("sil.phase"), `${t(moonPhaseName(s.phase))} · ${t("sil.illum", { v: Math.round(s.illum * 100) })}`]);
    rows.push([t("sil.state"), up ? `<span class="sil-st ${state}">${esc(t("sil.state." + state))}</span>` : "–"]);
    rows.push([t("sil.dist"), M.dKm < 1 ? `${Math.round(M.dKm * 1000)} m` : `${fix(M.dKm, 2)} km`]);
    rows.push([t("sil.lmHeight"), `${fix(sil.angularHeightDeg, 2)}°`]);
    const ratio = sil.angularHeightDeg > 0 ? s.diamDeg / sil.angularHeightDeg : null;
    rows.push([t("sil.ratio"), ratio != null ? `${t("sil." + P.body)} ${t("sil.ratioV", { v: ratio < 0.1 ? ratio.toFixed(3) : ratio.toFixed(2) })}` : "–"]);
    readEl.innerHTML = rows.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${b.startsWith("<span") ? b : esc(b)}</dd></div>`).join("");
  }

  function summaryText() {
    const { ov, span, behind } = M;
    if (!span) return t("sil.sumDown." + P.body);
    if (ov.windows.length) {
      const w = ov.windows[0];
      return t("sil.sumPass." + P.body, { when: span2(w) }) + (ov.windows.length > 1 ? t("sil.sumMore", { n: ov.windows.length - 1 }) : "");
    }
    if (behind.length) {
      const w = behind[0];
      return t("sil.sumBehind." + P.body, { when: span2(w) }) + (behind.length > 1 ? t("sil.sumMore", { n: behind.length - 1 }) : "");
    }
    const c = ov.closest;
    return t("sil.sumNone", { time: c ? hm(c.t) : "–", d: c ? fix(Math.abs(c.dAz)) : "–" });
  }

  function notes() {
    const n = [];
    n.push(M.groundSrc === "none" ? t("sil.groundNone") : t("sil.ground", { m: Math.round(M.groundM), src: t(M.groundSrc === "terrain" ? "sil.groundTerrain" : "sil.groundPreset") }));
    if (terrState === "loading") n.push(t("sil.terrainLoading"));
    else if (terr) n.push(t("sil.terrainNote"));
    else n.push(t("sil.terrainNone"));
    n.push(t("sil.legendPath"));
    n.push(t("sil.note"));
    let html = n.map((x) => `<p>${esc(x)}</p>`).join("");
    const attr = terr?.src?.attribution;
    if (attr) html += `<p class="sil-attr">${typeof attr === "string" ? esc(attr) : esc(String(attr.text || attr))}</p>`;
    notesEl.innerHTML = html;
  }

  /* ---- 전체 다시 계산 ---- */
  function refresh({ keepTime = false } = {}) {
    stop();
    savePrefs(P);
    let res;
    try { res = compute(); } catch (e) { console.warn(e); res = { err: "error.render" }; }
    if (res.err) { M = null; chart.innerHTML = ""; readEl.innerHTML = ""; sumEl.textContent = t(res.err); notesEl.innerHTML = ""; return; }
    M = res;
    // 슬라이더 범위: 지평선 −2° 위 구간 (없으면 하루 전체)
    const [a, b] = M.span || [M.t0, M.t1];
    range.min = String(Math.round((a - M.t0) / 60e3)); range.max = String(Math.round((b - M.t0) / 60e3));
    range.disabled = !M.span; playBtn.disabled = !M.span;
    const isToday = P.date === todayYmd();
    nowBtn.hidden = !isToday;
    if (!keepTime || tMs == null || tMs < a || tMs > b) {
      // 처음 시각: 겹치는 순간 → (오늘이면) 지금 → 가장 가까운 때
      const now = Date.now(), mid = (w) => Math.round((w.start + w.end) / 2 / 60e3) * 60e3;
      if (M.ov.windows.length) tMs = mid(M.ov.windows[0]);
      else if (M.behind.length) tMs = mid(M.behind[0]);
      else if (isToday && now >= a && now <= b) tMs = Math.floor(now / 60e3) * 60e3;
      else if (M.ov.closest) tMs = M.ov.closest.t;
      else tMs = a;
    }
    tMs = M.t0 + idxOf(tMs) * 60e3;
    drawStatic(); drawDynamic();
    sumEl.textContent = summaryText();
    notes();
    maybeTerrain();
  }

  function maybeTerrain() {
    if (!TC() || P.lat == null || P.lon == null) { terrState = "none"; return; }
    const key = `${P.lat},${P.lon},${P.eye}`;
    if (key === terrKey) return;
    terrKey = key; terr = null; terrState = "loading"; notes();
    const p = loadTerrain(P.lat, P.lon, P.eye);
    if (!p) { terrState = "none"; return; }
    p.then((r) => {
      if (!root.isConnected || key !== terrKey) return;
      terr = r; terrState = r ? "ok" : "fail";
      refresh({ keepTime: true });
    });
  }

  /* ---- 재생 ---- */
  function stop() {
    playing = false; cancelAnimationFrame(raf);
    playBtn.innerHTML = `<span aria-hidden="true">▶</span>`; playBtn.setAttribute("aria-label", t("sil.play"));
  }
  function play() {
    if (!M?.span) return;
    const [a, b] = M.span;
    if (tMs >= b) tMs = a;
    playing = true; lastTs = 0;
    playBtn.innerHTML = `<span aria-hidden="true">❚❚</span>`; playBtn.setAttribute("aria-label", t("sil.pause"));
    const speed = Math.max(20 / 3, (b - a) / 60e3 / 42); // 분/초 — 전체를 약 42초에 (HS 요청: 3배 느리게)
    let acc = 0;
    const step = (ts) => {
      if (!playing || !root.isConnected) return;
      if (lastTs) acc += (ts - lastTs) / 1000 * speed;
      lastTs = ts;
      const n = Math.floor(acc);
      if (n > 0) { acc -= n; tMs = Math.min(b, tMs + n * 60e3); drawDynamic(); }
      if (tMs >= b) { stop(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  /* ---- 이벤트 ---- */
  $("#sil-lm").addEventListener("change", (e) => {
    P.id = e.target.value; P.preset = 0;
    const p = (PRESETS[P.id] || [])[0];
    if (p) { P.lat = p.lat; P.lon = p.lon; $("#sil-lat").value = p.lat; $("#sil-lon").value = p.lon; }
    $(".sil-presets").innerHTML = presetBtns();
    refresh();
  });
  $("#sil-date").addEventListener("change", (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { P.date = e.target.value; refresh(); } });
  body.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.body) { P.body = b.dataset.body; segOn(b, "body"); refresh(); }
    else if (b.dataset.zoom) { P.zoom = b.dataset.zoom; segOn(b, "zoom"); refresh({ keepTime: true }); }
    else if (b.dataset.preset != null) {
      const p = PRESETS[P.id][+b.dataset.preset]; if (!p) return;
      P.preset = +b.dataset.preset; P.lat = p.lat; P.lon = p.lon; $("#sil-lat").value = p.lat; $("#sil-lon").value = p.lon;
      $(".sil-presets").innerHTML = presetBtns(); refresh({ keepTime: true });
    } else if (b === playBtn) { playing ? stop() : play(); }
    else if (b === nowBtn) { stop(); const now = Math.floor(Date.now() / 60e3) * 60e3; if (M && now >= M.t0 && now < M.t1) { tMs = now; drawDynamic(); } }
  });
  const segOn = (b, k) => b.parentElement.querySelectorAll(`[data-${k}]`).forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); });
  const onPos = () => {
    const la = parseFloat($("#sil-lat").value), lo = parseFloat($("#sil-lon").value), ey = parseFloat($("#sil-eye").value);
    P.lat = isFinite(la) ? la : null; P.lon = isFinite(lo) ? lo : null; P.eye = isFinite(ey) && ey >= 0 && ey <= 500 ? ey : 1.6;
    $(".sil-presets").innerHTML = presetBtns();
    refresh({ keepTime: true });
  };
  for (const id of ["#sil-lat", "#sil-lon", "#sil-eye"]) $(id).addEventListener("change", onPos);
  $("#sil-lens").addEventListener("change", (e) => { P.lens = +e.target.value || 0; savePrefs(P); if (M) { drawStatic(); drawDynamic(); } });
  range.addEventListener("input", () => { if (!M) return; stop(); tMs = M.t0 + (+range.value) * 60e3; drawDynamic(); });

  refresh();
}

/* ---------- 작은 도우미 ---------- */
const f1 = (v) => (Math.round(v * 10) / 10).toString();
function niceStep(raw) {
  const c = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 20, 30];
  return c.find((x) => x >= raw) || 30;
}
const fmtDeg = (v, step) => (step < 1 ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v)));
export const _test = { PRESETS, wrap180 };
