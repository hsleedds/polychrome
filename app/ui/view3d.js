/* 해·달 맞추기 화면의 「3D 풍경」·「드론」 보기 (WebGL, three.js — 이 보기를 열 때만 CDN에서 불러옴).
 * Google 3D 타일·지도는 쓰지 않는다. 지형 = AWS Terrain Tiles(Terrarium, TerrainCore.terrariumSource), 구조물 = LandmarkCore.toMesh.
 * three.js: MIT License (© 2010–2024 three.js authors) — https://github.com/mrdoob/three.js/blob/dev/LICENSE
 * 계산(좌표·곡률·격자·화각)은 app/view3d-calc.js (Node 테스트). 여기는 장면 조립·입력·그리기만.
 * 렌더는 요청할 때만(시각·시선·크기 바뀔 때). 화면을 떠나거나 실루엣으로 돌아가면 dispose(). */
import { t } from "../i18n.js";
import { esc } from "./dom.js";
import * as C from "../view3d-calc.js";
import { moonLitPath, phaseRotation } from "../silhouette-calc.js";
import { buildingsNear, extrudeFootprint } from "../buildings.js";

export const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js";
let threeP = null;
/** three.js 모듈 (한 번만 불러옴; 실패하면 다음에 다시 시도). 시험용으로 globalThis.PC_THREE_URL 로 바꿀 수 있다 */
export function loadThree() {
  if (!threeP) threeP = import(/* @vite-ignore */ globalThis.PC_THREE_URL || THREE_URL).catch((e) => { threeP = null; throw e; });
  return threeP;
}

/* 위성 영상 훅 (지금은 끔 — 키 없음). 나중에 한국은 VWorld, 해외는 MapTiler satellite.
 *   { id, attribution, texture({ lat, lon, halfM }) → Promise<HTMLCanvasElement|ImageBitmap|null> }
 *   halfM 반폭의 정사각형(북쪽 위, 관측점 가운데)을 덮는 영상 1장 → 지형 단계 0–2 에 uv 로 입힌다. */
let imagerySource = null;
export function setImagerySource(src) { imagerySource = src || null; }

const BODY_D = 200000; // 해·달을 놓는 거리(m) — 지형(모서리 ≈ 43 km)·바깥 고리 너머, 하늘 구(260 km) 안
const SKY_R = 260000, FAR = 320000;
const DPR_MAX = 2;

/**
 * host: 화면이 넘겨주는 읽기 함수들
 *   obs() → {lat, lon, eye, groundM}   landmark() → LandmarkCore 구조물   lens() → mm|0   body() → "sun"|"moon"
 *   time() → ms   bodyAt(ms) → {az, alt, diamDeg, illum?, brightLimb?, parallactic?}   sunAt(ms) → {az, alt}
 *   samples() → [{t, az, alt}]   hourOf(ms) → 0..23 | null(정시 아님)   terrain() → TerrainCore|null   lc() → LandmarkCore
 *   buildings() → true(주변 건물 켬)|false   onPlayStop?()
 */
export function createView3d(container, host, mode0 = "ground") {
  let mode = mode0;
  container.innerHTML = `
    <div class="v3">
      <div class="v3-zone" role="status" aria-live="polite" hidden></div>
      <div class="v3-stage">
        <canvas class="v3-gl" aria-label="${esc(t("v3.a11y"))}" role="img"></canvas>
        <canvas class="v3-ov" aria-hidden="true"></canvas>
        <div class="v3-msg" role="status" aria-live="polite"><div class="spin" aria-hidden="true"></div><span>${esc(t("v3.loading"))}</span></div>
        <div class="v3-hud" aria-hidden="true"></div>
        <button type="button" class="v3-reset" aria-label="${esc(t("v3.resetA11y"))}">${esc(t("v3.reset"))}</button>
      </div>
      <p class="v3-hint tiny muted">${esc(t("v3.hint"))}</p>
      <div class="v3-drone" hidden>
        <label class="fld v3-alt"><span>${esc(t("v3.alt"))} <output class="v3-alt-v">100 m</output></span>
          <input type="range" min="0" max="${C.DRONE_MAX_AGL}" step="5" value="100" aria-label="${esc(t("v3.alt"))}"></label>
        <p class="tiny muted v3-law">${esc(t("v3.law"))}</p>
        <div class="v3-move-wrap"><span class="v3-move-l">${esc(t("v3.move"))}</span>
          <div class="v3-move" role="group" aria-label="${esc(t("v3.move"))}">
            <button type="button" data-mv="N" aria-label="${esc(t("v3.mvN"))}">↑ ${esc(t("v3.n"))}</button>
            <button type="button" data-mv="W" aria-label="${esc(t("v3.mvW"))}">← ${esc(t("v3.w"))}</button>
            <button type="button" data-mv="home" aria-label="${esc(t("v3.mvHome"))}">◎</button>
            <button type="button" data-mv="E" aria-label="${esc(t("v3.mvE"))}">${esc(t("v3.e"))} →</button>
            <button type="button" data-mv="S" aria-label="${esc(t("v3.mvS"))}">↓ ${esc(t("v3.s"))}</button>
          </div></div>
        <form class="v3-ll"><label class="fld"><span>${esc(t("v3.goto"))}</span><input type="text" inputmode="text" autocomplete="off" placeholder="37.5497, 127.0310"></label>
          <button type="submit" class="btn">${esc(t("v3.gotoBtn"))}</button></form>
        <p class="v3-dpos tiny muted"></p>
      </div>
      <p class="v3-attr tiny muted"></p>
    </div>`;
  const $ = (s) => container.querySelector(s);
  const stage = $(".v3-stage"), glCv = $(".v3-gl"), ov = $(".v3-ov"), msg = $(".v3-msg"), hud = $(".v3-hud"), zoneEl = $(".v3-zone"), droneEl = $(".v3-drone"), attrEl = $(".v3-attr");
  // 드론 조작판은 시각 슬라이더 아래 자리(host.controlsSlot)로 옮긴다 — 슬라이더를 움직일 때 보기가 화면에 남도록
  const slot = host.controlsSlot?.();
  if (slot) { slot.innerHTML = ""; slot.appendChild(droneEl); }
  const q = (sel) => droneEl.querySelector(sel);
  const altIn = q(".v3-alt input"), altOut = q(".v3-alt-v"), dposEl = q(".v3-dpos");

  let T = null, R = null, scene = null, cam = null, dead = false;
  const G = { terrain: [], skirt: null, lm: null, bld: null, sky: null, stars: null, body: null, bodyTex: null, path: null, ticks: null, sunL: null, moonL: null, amb: null };
  let built = null; // { lat, lon, groundM, okFrac, ms, verts, tris, lmId }
  const V = { yaw: 0, pitch: 0, hfov: 60, alt: 100, drone: null /* {lat, lon} */, dpitch: -20, dyaw: null };
  let aim = null, ticksMeta = [], texKey = "", tsrc = null, lastLens = host.lens();

  const say = (key, spin = false, retry = false, toast = false) => {
    msg.hidden = !key; msg.classList.toggle("toast", !!toast);
    if (key) msg.innerHTML = `${spin ? `<div class="spin" aria-hidden="true"></div>` : ""}<span>${esc(t(key))}</span>${retry ? `<button type="button" class="btn ghost v3-retry">${esc(t("v3.retry"))}</button>` : ""}`;
  };

  /* ---------- 준비 ---------- */
  async function init() {
    try { T = await loadThree(); } catch (e) { console.warn("three", e); if (!dead) say("v3.noThree", false, true); return false; }
    if (dead) return false;
    try {
      R = new T.WebGLRenderer({ canvas: glCv, antialias: true, logarithmicDepthBuffer: true, powerPreference: "high-performance" });
    } catch (e) { console.warn("webgl", e); say("v3.noWebgl"); return false; }
    R.setPixelRatio(Math.min(DPR_MAX, globalThis.devicePixelRatio || 1));
    R.outputColorSpace = T.SRGBColorSpace;
    glCv.addEventListener("webglcontextlost", (e) => { e.preventDefault(); say("v3.ctxLost", false, true); built = null; });
    scene = new T.Scene();
    cam = new T.PerspectiveCamera(50, 1000 / 720, 1, FAR);
    cam.rotation.order = "YXZ";
    G.amb = new T.AmbientLight(0xffffff, 1); scene.add(G.amb);
    G.sunL = new T.DirectionalLight(0xfff4e0, 1); scene.add(G.sunL);
    G.moonL = new T.DirectionalLight(0xbfd0ff, 0); scene.add(G.moonL);
    scene.fog = new T.FogExp2(0xbcd0e8, 2.2e-5);
    buildSky();
    resize();
    return true;
  }

  function buildSky() {
    const geo = new T.SphereGeometry(SKY_R, 48, 24);
    const mat = new T.ShaderMaterial({
      uniforms: { zen: { value: new T.Color() }, hor: { value: new T.Color() }, sunDir: { value: new T.Vector3(0, 1, 0) }, glow: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vDir = w.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 zen; uniform vec3 hor; uniform vec3 sunDir; uniform float glow; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float h = d.y;
          vec3 c = mix(hor, zen, pow(clamp(h, 0.0, 1.0), 0.45));
          if (h < 0.0) c = mix(hor, hor * 0.55, clamp(-h * 6.0, 0.0, 1.0));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          c += vec3(1.0, 0.82, 0.55) * glow * (pow(s, 8.0) * 0.16 + pow(s, 600.0) * 0.22); // 둥근 빛무리는 좁고 약하게 — 해 원반이 묻히지 않게
          gl_FragColor = vec4(c, 1.0); }`,
      side: T.BackSide, depthTest: false, depthWrite: false, fog: false,
    });
    G.sky = new T.Mesh(geo, mat); G.sky.renderOrder = -10; G.sky.frustumCulled = false; scene.add(G.sky);
    // 별 (밤에만, 장식 — 실제 별자리 아님)
    const n = 1400, p = new Float32Array(n * 3);
    let s = 12345; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const z = rnd() * 0.98 + 0.02, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      p.set([Math.cos(a) * r * SKY_R * 0.95, z * SKY_R * 0.95, Math.sin(a) * r * SKY_R * 0.95], i * 3);
    }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(p, 3));
    G.stars = new T.Points(g, new T.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0, depthWrite: false }));
    G.stars.renderOrder = -9; G.stars.frustumCulled = false; scene.add(G.stars);
  }

  /* ---------- 지형 ---------- */
  function centre() { const o = host.obs(); return V.drone && mode === "drone" ? V.drone : { lat: o.lat, lon: o.lon }; }
  async function buildTerrain(lat, lon) {
    const t0 = performance.now();
    say("v3.terrainLoading", true);
    for (const m of G.terrain) { m.geometry.dispose(); m.material.dispose(); scene.remove(m); }
    G.terrain = [];
    const plan = C.terrainPlan(lat, lon);
    let elev = null;
    const TC = host.terrain();
    if (TC) {
      try {
        if (!tsrc) tsrc = TC.terrariumSource({ maxTiles: 96 });
        elev = await tsrc.elevations(plan.points);
      } catch (e) { console.warn("v3 terrain", e); }
    }
    if (dead) return;
    const fallbackG = host.obs().groundM || 0;
    let H = C.terrainHeights(plan, elev || plan.points.map(() => null), { fill: 0 });
    const ok = H.okFrac >= 0.5;
    if (!ok) H = C.terrainHeights(plan, plan.points.map(() => null), { fill: 0 }); // 받은 게 반도 안 되면 평지(해수면)로
    const groundM = ok && H.groundM != null ? H.groundM : fallbackG;
    const mat = new T.MeshLambertMaterial({ vertexColors: true });
    const col = new T.Color();
    let verts = 0, tris = 0;
    plan.levels.forEach((L, li) => {
      const { mesh } = L, z = H.zs[li], nV = mesh.count;
      const pos = new Float32Array(nV * 3);
      for (let v = 0; v < nV; v++) { pos[3 * v] = mesh.en[2 * v]; pos[3 * v + 1] = z[v]; pos[3 * v + 2] = -mesh.en[2 * v + 1]; }
      const geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.BufferAttribute(pos, 3));
      geo.setIndex(new T.BufferAttribute(mesh.index, 1));
      geo.computeVertexNormals();
      const nrm = geo.getAttribute("normal").array, cols = new Float32Array(nV * 3);
      for (let v = 0; v < nV; v++) {
        const d = Math.hypot(mesh.en[2 * v], mesh.en[2 * v + 1]);
        const c = C.terrainColor(z[v] + C.curvatureDrop(d), nrm[3 * v + 1]);
        col.setRGB(c[0], c[1], c[2], T.SRGBColorSpace); cols.set([col.r, col.g, col.b], 3 * v);
      }
      geo.setAttribute("color", new T.BufferAttribute(cols, 3));
      if (imagerySource && li <= 2) { /* 훅: uv 를 만들고 material.map 을 붙일 자리 (지금은 끔) */ }
      const m = new T.Mesh(geo, li ? mat.clone() : mat);
      m.matrixAutoUpdate = false;
      scene.add(m); G.terrain.push(m);
      verts += nV; tris += mesh.index.length / 3;
    });
    if (!G.skirt) {
      const s = C.skirtMesh({ innerM: plan.levels[plan.levels.length - 1].half * 0.97 });
      const pos = new Float32Array(s.z.length * 3);
      for (let v = 0; v < s.z.length; v++) { pos[3 * v] = s.en[2 * v]; pos[3 * v + 1] = s.z[v]; pos[3 * v + 2] = -s.en[2 * v + 1]; }
      const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.BufferAttribute(pos, 3)); geo.setIndex(new T.BufferAttribute(s.index, 1)); geo.computeVertexNormals();
      G.skirt = new T.Mesh(geo, new T.MeshLambertMaterial({ color: 0x4b5a52 })); G.skirt.matrixAutoUpdate = false; scene.add(G.skirt);
    }
    built = { src: tsrc, lat, lon, groundM, okFrac: H.okFrac, ms: Math.round(performance.now() - t0), verts, tris, points: plan.points.length, terrainOk: ok, lmId: null };
    globalThis.__pcV3Stats = { verts, tris, points: plan.points.length, ms: built.ms, okFrac: H.okFrac, tiles: built.src?.stats ? { ...built.src.stats } : null };
    attr();
    say(ok ? "" : "v3.flat", false, false, true);
    if (!ok) setTimeout(() => { if (!dead && msg.textContent === t("v3.flat")) say(""); }, 3500);
  }

  function attr() {
    const a = built?.src?.attribution;
    const parts = [];
    if (built?.terrainOk && a) parts.push(typeof a === "string" ? a : String(a.text || a));
    else parts.push(t("v3.flatNote"));
    parts.push(t("v3.threeLic"));
    if (host.buildings()) parts.push(t("v3.bldPending"));
    attrEl.textContent = parts.join(" · ");
  }

  /* ---------- 구조물 (LandmarkCore.toMesh → 지역 좌표, 곡률 낙차) ---------- */
  function buildLandmark() {
    const lm = host.landmark(), LC = host.lc();
    if (G.lm) { G.lm.geometry.dispose(); G.lm.material.dispose(); scene.remove(G.lm); G.lm = null; }
    if (!lm || !LC || !built) return;
    const mesh = LC.toMesh(lm);
    const M_PER_DEG = C.EARTH_M * Math.PI / 180, cosL = Math.cos(lm.lat * Math.PI / 180), base = mesh.baseM || 0;
    const pos = new Float32Array(mesh.vertices.length * 3);
    mesh.vertices.forEach(([e, n, z], i) => {
      const L = C.toLocal(built.lat, built.lon, lm.lat + n / M_PER_DEG, lm.lon + e / (M_PER_DEG * cosL));
      pos.set([L.e, base + z - C.curvatureDrop(L.d), -L.n], 3 * i);
    });
    let geo = new T.BufferGeometry(); geo.setAttribute("position", new T.BufferAttribute(pos, 3));
    geo.setIndex(mesh.triangles.flat());
    geo = geo.toNonIndexed(); geo.computeVertexNormals();
    G.lm = new T.Mesh(geo, new T.MeshLambertMaterial({ color: 0x30343e, side: T.DoubleSide }));
    scene.add(G.lm);
    built.lmId = lm.id;
  }

  /* ---------- 주변 건물 (자료가 생기면) ---------- */
  async function buildBuildings() {
    if (G.bld) { G.bld.geometry.dispose(); G.bld.material.dispose(); scene.remove(G.bld); G.bld = null; }
    if (!built || !host.buildings()) return;
    const list = await buildingsNear(built.lat, built.lon, 3);
    if (!list || !list.length || dead) return;
    const pos = [], idx = [];
    for (const b of list) { const x = extrudeFootprint(b, built.lat, built.lon, built.groundM); const o = pos.length / 3; pos.push(...x.pos); idx.push(...x.index.map((i) => i + o)); }
    let geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
    geo = geo.toNonIndexed(); geo.computeVertexNormals();
    G.bld = new T.Mesh(geo, new T.MeshLambertMaterial({ color: 0x5a5f6a, side: T.DoubleSide })); scene.add(G.bld);
    req();
  }

  /* ---------- 해·달 ---------- */
  function bodyTexture(b) {
    const isMoon = host.body() === "moon";
    const rot = isMoon ? phaseRotation(b.brightLimb, b.parallactic) : 0, il = isMoon ? b.illum : 1;
    const key = isMoon ? `m${Math.round(il * 200)}:${Math.round(rot)}` : "sun";
    if (key === texKey && G.bodyTex) return G.bodyTex;
    texKey = key;
    const S = 256, cv = document.createElement("canvas"); cv.width = cv.height = S;
    const x = cv.getContext("2d"); x.translate(S / 2, S / 2);
    if (isMoon) {
      x.fillStyle = "rgba(120,130,160,0.10)"; x.beginPath(); x.arc(0, 0, 120, 0, Math.PI * 2); x.fill(); // 지구조(아주 옅게)
      const d = moonLitPath(120, il);
      if (d) { x.rotate(rot * Math.PI / 180); x.fillStyle = "#fbf3d2"; x.fill(new Path2D(d)); }
    } else {
      const g = x.createRadialGradient(0, 0, 0, 0, 0, 120); g.addColorStop(0, "#fffbe8"); g.addColorStop(0.8, "#ffe08a"); g.addColorStop(1, "#ffc14a");
      x.fillStyle = g; x.beginPath(); x.arc(0, 0, 120, 0, Math.PI * 2); x.fill();
    }
    if (G.bodyTex) G.bodyTex.dispose();
    G.bodyTex = new T.CanvasTexture(cv); G.bodyTex.colorSpace = T.SRGBColorSpace;
    return G.bodyTex;
  }
  function buildPath() {
    for (const k of ["path", "ticks"]) if (G[k]) { G[k].geometry.dispose(); G[k].material.dispose(); scene.remove(G[k]); G[k] = null; }
    const S = host.samples(), p = [], tk = [];
    ticksMeta = [];
    for (let i = 0; i < S.length; i += 5) {
      const s = S[i]; if (s.alt <= -2) continue;
      const d = C.dirVec(s.az, s.alt); p.push(d[0] * BODY_D * 0.99, d[1] * BODY_D * 0.99, d[2] * BODY_D * 0.99);
      const h = host.hourOf(s.t);
      if (h != null) { tk.push(d[0] * BODY_D * 0.99, d[1] * BODY_D * 0.99, d[2] * BODY_D * 0.99); ticksMeta.push({ h, v: d }); }
    }
    const mk = (arr, size, op) => { const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(arr, 3));
      const m = new T.Points(g, new T.PointsMaterial({ color: 0xfff2c0, size, sizeAttenuation: false, fog: false, transparent: true, opacity: op, depthWrite: false })); m.frustumCulled = false; scene.add(m); return m; };
    if (p.length) G.path = mk(p, 2.5, 0.75);
    if (tk.length) G.ticks = mk(tk, 7, 0.95);
    pathKey = host.body() + ":" + (S[0]?.t || 0);
  }
  let pathKey = "";

  /* ---------- 시각마다 ---------- */
  function updateTime() {
    const ms = host.time(); if (ms == null || !scene) return;
    const sun = host.sunAt(ms), sky = C.skyColors(sun.alt);
    const u = G.sky.material.uniforms;
    u.zen.value.setRGB(...sky.zenith); u.hor.value.setRGB(...sky.horizon);
    u.sunDir.value.set(...C.dirVec(sun.az, sun.alt)); u.glow.value = sun.alt > -8 ? Math.min(1, (sun.alt + 8) / 10) : 0;
    scene.fog.color.setRGB(sky.fog[0], sky.fog[1], sky.fog[2], T.SRGBColorSpace);
    G.stars.material.opacity = sky.stars ? 0.85 * sky.night : 0; G.stars.visible = sky.stars;
    const sd = C.dirVec(sun.az, Math.max(sun.alt, 0.5));
    G.sunL.position.set(sd[0] * 1e4, sd[1] * 1e4, sd[2] * 1e4); G.sunL.intensity = Math.PI * 0.95 * sky.sun;
    G.amb.intensity = Math.PI * sky.amb;
    const b = host.bodyAt(ms);
    if (host.body() === "moon" && b && b.alt > 0 && sun.alt < -4) {
      const md = C.dirVec(b.az, b.alt); G.moonL.position.set(md[0] * 1e4, md[1] * 1e4, md[2] * 1e4); G.moonL.intensity = Math.PI * 0.14 * (b.illum || 0);
    } else G.moonL.intensity = 0;
    if (!G.body) { G.body = new T.Sprite(new T.SpriteMaterial({ fog: false, transparent: true, depthWrite: false })); scene.add(G.body); }
    if (b) {
      const tex = bodyTexture(b);
      if (G.body.material.map !== tex) { G.body.material.map = tex; G.body.material.needsUpdate = true; }
      const d = C.dirVec(b.az, b.alt), sz = C.discSize(b.diamDeg || 0.53, BODY_D) * 256 / 240;
      G.body.position.set(d[0] * BODY_D, d[1] * BODY_D, d[2] * BODY_D);
      G.body.scale.set(sz, sz, 1);
      G.body.visible = b.alt > -3;
    }
    const k = host.body() + ":" + (host.samples()[0]?.t || 0);
    if (k !== pathKey) buildPath();
  }

  /* ---------- 카메라 ---------- */
  function setAim(resetFov = true) {
    const o = host.obs(), lm = host.landmark();
    if (!built) return;
    const zM = (built.groundM ?? o.groundM ?? 0) + (o.eye ?? 1.6);
    if (lm) {
      const top = host.lc()?.toMesh ? Math.max(...host.lc().toMesh(lm).vertices.map((v) => v[2])) : 0;
      aim = C.aimAt({ lat: o.lat, lon: o.lon, zM }, { lat: lm.lat, lon: lm.lon, baseM: lm.baseM || 0, heightM: top });
    } else aim = { yaw: 0, pitch: 0 };
    V.yaw = aim.yaw; V.pitch = C.clampPitch(aim.pitch, "ground");
    V.dyaw = aim.yaw; V.dpitch = -20;
    if (resetFov) V.hfov = C.viewHFov(host.lens());
  }
  function placeCamera() {
    const o = host.obs();
    let x = 0, z = 0, y;
    if (mode === "drone") {
      const p = V.drone || { lat: o.lat, lon: o.lon };
      const L = C.toLocal(built.lat, built.lon, p.lat, p.lon);
      x = L.e; z = -L.n;
      const g = groundAt(x, z);
      y = (g ?? (built.groundM ?? 0)) + V.alt;
      cam.rotation.set(V.dpitch * Math.PI / 180, -V.dyaw * Math.PI / 180, 0, "YXZ");
    } else {
      y = (built.groundM ?? o.groundM ?? 0) + (o.eye ?? 1.6);
      cam.rotation.set(V.pitch * Math.PI / 180, -V.yaw * Math.PI / 180, 0, "YXZ");
    }
    cam.position.set(x, y, z);
    G.sky.position.copy(cam.position);
    G.stars.position.copy(cam.position);
    // 해·달·궤적도 카메라를 따라 (아주 멀리 있는 것처럼)
    for (const k of ["path", "ticks"]) if (G[k]) G[k].position.copy(cam.position);
    if (G.body) G.body.position.add(cam.position);
  }
  const ray = () => new T.Raycaster();
  function groundAt(x, z) {
    const rc = ray(); rc.set(new T.Vector3(x, 20000, z), new T.Vector3(0, -1, 0)); rc.far = 40000;
    const hit = rc.intersectObjects(G.terrain, false)[0];
    return hit ? hit.point.y : null;
  }

  /* ---------- 그리기 ---------- */
  let pending = 0;
  function req() { if (!pending && !dead) pending = requestAnimationFrame(() => { pending = 0; render(); }); }
  function render() {
    if (dead || !R || !built) return;
    if (!container.isConnected) { dispose(); return; }
    const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
    cam.aspect = w / h; cam.fov = C.vFovFromH(V.hfov, w / h); cam.updateProjectionMatrix();
    updateTime();
    placeCamera();
    R.render(scene, cam);
    overlay(w, h);
  }
  function overlay(w, h) {
    const dpr = Math.min(DPR_MAX, globalThis.devicePixelRatio || 1);
    if (ov.width !== Math.round(w * dpr) || ov.height !== Math.round(h * dpr)) { ov.width = Math.round(w * dpr); ov.height = Math.round(h * dpr); }
    const x = ov.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    const proj = (v) => {
      const p = new T.Vector3(v[0] * BODY_D, v[1] * BODY_D, v[2] * BODY_D).add(cam.position);
      const q = p.clone().applyMatrix4(cam.matrixWorldInverse); if (q.z >= 0) return null;
      p.project(cam); return [(p.x + 1) / 2 * w, (1 - p.y) / 2 * h];
    };
    // 정시 라벨
    x.font = "700 13px system-ui, sans-serif"; x.textAlign = "center"; x.lineWidth = 3; x.strokeStyle = "rgba(0,0,0,.6)"; x.fillStyle = "#fff";
    let last = null;
    for (const m of ticksMeta) {
      const p = proj(m.v); if (!p || p[0] < 8 || p[0] > w - 8 || p[1] < 14 || p[1] > h) continue;
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 34) continue;
      x.strokeText(String(m.h), p[0], p[1] - 9); x.fillText(String(m.h), p[0], p[1] - 9); last = p;
    }
    // 작은 원반 표시 고리 (실제 크기가 몇 px 일 때 찾기 쉽게)
    const b = host.bodyAt(host.time());
    if (b && b.alt > -1) {
      const p = proj(C.dirVec(b.az, b.alt));
      const rpx = (b.diamDeg / 2) / V.hfov * w;
      if (p && rpx < 9 && p[0] > -20 && p[0] < w + 20 && p[1] > -20 && p[1] < h + 20) {
        // 밝은 하늘·어두운 땅 어디서나 보이게 검정+흰 두 겹 고리
        x.beginPath(); x.arc(p[0], p[1], rpx + 12, 0, Math.PI * 2);
        x.strokeStyle = "rgba(0,0,0,.55)"; x.lineWidth = 3.5; x.stroke();
        x.strokeStyle = "rgba(255,255,255,.95)"; x.lineWidth = 1.5; x.setLineDash([4, 4]); x.stroke(); x.setLineDash([]);
      }
    }
    // 렌즈 틀 + 바깥 70% 검정 (가운데 고정)
    const fr = C.frameRect(host.lens(), V.hfov, w, h);
    if (fr) {
      x.fillStyle = "rgba(0,0,0,.7)"; x.beginPath(); x.rect(0, 0, w, h); x.rect(fr.x, fr.y, fr.w, fr.h); x.fill("evenodd");
      x.strokeStyle = "rgba(255,255,255,.85)"; x.lineWidth = 1.5; x.setLineDash([9, 5]); x.strokeRect(fr.x, fr.y, fr.w, fr.h); x.setLineDash([]);
      x.font = "700 13px system-ui, sans-serif"; x.textAlign = "left"; x.fillStyle = "#fff";
      x.fillText(`${host.lens()} mm`, Math.max(6, fr.x + 6), Math.max(16, fr.y + 18));
    }
    const yaw = mode === "drone" ? V.dyaw : V.yaw, pit = mode === "drone" ? V.dpitch : V.pitch;
    hud.textContent = `${t("v3.heading")} ${Math.round(((yaw % 360) + 360) % 360)}° · ${t("v3.tilt")} ${pit.toFixed(1)}° · ${t("v3.fov")} ${V.hfov.toFixed(V.hfov < 10 ? 1 : 0)}°` +
      (mode === "drone" ? ` · ${Math.round(V.alt)} m AGL` : "");
  }

  function resize() {
    const w = stage.clientWidth; if (!w || !R) return;
    const h = Math.round(Math.min(w * 0.72, Math.max(260, (globalThis.innerHeight || 800) * 0.62)));
    stage.style.height = h + "px";
    R.setSize(w, h, false);
    req();
  }
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
  ro?.observe(stage);

  /* ---------- 입력: 끌기(시선), 두 손가락·휠(화각) ---------- */
  const ptr = new Map(); let pinch = null, dragging = false;
  glCv.addEventListener("pointerdown", (e) => {
    if (!built) return;
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { glCv.setPointerCapture(e.pointerId); } catch {}
    host.onPlayStop?.();
    if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: V.hfov }; }
    dragging = true;
  });
  glCv.addEventListener("pointermove", (e) => {
    const p = ptr.get(e.pointerId); if (!p) return;
    e.preventDefault();
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (ptr.size >= 2 && pinch) {
      const [a, b] = [...ptr.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 10) V.hfov = Math.max(0.5, Math.min(110, pinch.fov * pinch.d / d));
    } else if (ptr.size === 1) {
      const w = stage.clientWidth || 1, k = V.hfov / w; // 화면 px 당 도
      if (mode === "drone") { V.dyaw -= dx * k; V.dpitch = C.clampPitch(V.dpitch + dy * k, "drone"); }
      else { V.yaw -= dx * k; V.pitch = C.clampPitch(V.pitch + dy * k, "ground"); }
    }
    req();
  });
  const up = (e) => { ptr.delete(e.pointerId); if (ptr.size < 2) pinch = null; if (!ptr.size) dragging = false; };
  glCv.addEventListener("pointerup", up); glCv.addEventListener("pointercancel", up);
  glCv.addEventListener("wheel", (e) => { if (!built) return; e.preventDefault(); V.hfov = Math.max(0.5, Math.min(110, V.hfov * Math.exp(e.deltaY * 0.0015))); req(); }, { passive: false });
  // iOS Safari: 캔버스 위 터치로 화면이 스크롤·확대되지 않게
  glCv.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  glCv.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  glCv.addEventListener("gesturestart", (e) => e.preventDefault());

  const onClick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.classList.contains("v3-reset")) { setAim(true); if (mode === "drone") { V.dyaw = aim.yaw; V.dpitch = -20; } req(); }
    else if (b.classList.contains("v3-retry")) { say("v3.loading", true); start(); }
    else if (b.dataset.mv) {
      const o = host.obs(), cur = V.drone || { lat: o.lat, lon: o.lon };
      if (b.dataset.mv === "home") V.drone = null;
      else { const L = C.toLocal(o.lat, o.lon, cur.lat, cur.lon), n = C.nudge({ e: L.e, n: L.n }, b.dataset.mv); V.drone = C.fromLocal(o.lat, o.lon, n.e, n.n); }
      droneMoved();
    }
  };
  container.addEventListener("click", onClick);
  if (droneEl.parentNode !== container.firstElementChild) droneEl.addEventListener("click", onClick);
  altIn.addEventListener("input", () => { V.alt = +altIn.value; altOut.textContent = `${V.alt} m`; req(); zoneSoon(); });
  q(".v3-ll").addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = q(".v3-ll input"), m = String(inp.value).replace(/[NnEe°]/g, " ").match(/(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)/);
    const lat = m ? +m[1] : NaN, lon = m ? +m[2] : NaN;
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) { inp.setCustomValidity(t("sil.pasteBad")); inp.reportValidity(); return; }
    inp.setCustomValidity(""); V.drone = { lat, lon }; droneMoved();
  });
  async function droneMoved() {
    const p = V.drone || { lat: host.obs().lat, lon: host.obs().lon };
    // 지형 격자 가운데에서 5 km 넘게 벗어나면 그 자리를 가운데로 다시 만든다
    if (built && C.toLocal(built.lat, built.lon, p.lat, p.lon).d > 5000) { await buildTerrain(p.lat, p.lon); buildLandmark(); buildBuildings(); }
    dpos(); req(); zoneSoon();
  }
  function dpos() {
    const o = host.obs(), p = V.drone || { lat: o.lat, lon: o.lon }, L = C.toLocal(o.lat, o.lon, p.lat, p.lon);
    const dir = L.d < 1 ? "" : ` · ${t("v3.fromObs", { m: L.d < 1000 ? Math.round(L.d) + " m" : (L.d / 1000).toFixed(2) + " km", az: Math.round((Math.atan2(L.e, L.n) * 180 / Math.PI + 360) % 360) })}`;
    dposEl.textContent = `${t("v3.dronePos")} ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}${dir}`;
  }

  /* ---------- 비행구역 배너 ---------- */
  let zoneT = 0, zoneGen = 0;
  function zoneSoon() { if (mode !== "drone") return; clearTimeout(zoneT); zoneT = setTimeout(checkZone, 500); }
  async function checkZone() {
    const gen = ++zoneGen, o = host.obs(), p = V.drone || { lat: o.lat, lon: o.lon };
    let res = null;
    const Z = globalThis.PCDroneZones;
    if (Z && typeof Z.check === "function") {
      zoneEl.hidden = false; zoneEl.className = "v3-zone lv-unknown"; zoneEl.innerHTML = `<b>${esc(t("v3.zone.checking"))}</b>`;
      try { res = await Z.check(p.lat, p.lon, V.alt); } catch (e) { console.warn("drone zones", e); res = null; }
    }
    if (gen !== zoneGen || dead) return;
    const B = C.zoneBanner(res);
    zoneEl.hidden = false; zoneEl.className = "v3-zone lv-" + B.cls;
    const items = B.items.map((i) => esc(i.name) + (i.kind ? ` <small>(${esc(i.kind)})</small>` : "")).join(", ");
    const links = B.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.onestop ? t("v3.onestop") : l.label || l.url)}</a>`).join(" · ");
    zoneEl.innerHTML = `<b>${esc(t(B.key))}</b>${items ? `<span class="v3-zone-i">${items}</span>` : ""}${B.notes.map((n) => `<span class="v3-zone-n">${esc(n)}</span>`).join("")}<span class="v3-zone-l">${links}</span>` +
      `<span class="v3-zone-d">${esc(t("v3.zone.disclaimer"))}</span>`;
  }

  /* ---------- 생명주기 ---------- */
  let starting = null;
  async function start() {
    if (starting) return starting;
    starting = (async () => {
      if (!R && !(await init())) return;
      const c = centre();
      await buildTerrain(c.lat, c.lon);
      if (dead) return;
      buildLandmark(); buildBuildings();
      setAim(true);
      applyMode();
      resize(); req();
    })().finally(() => { starting = null; });
    return starting;
  }
  function applyMode() {
    droneEl.hidden = mode !== "drone";
    zoneEl.hidden = mode !== "drone";
    if (mode === "drone") { dpos(); zoneSoon(); }
    stage.classList.toggle("drone", mode === "drone");
  }
  const onHash = () => setTimeout(() => { if (!container.isConnected) dispose(); }, 0);
  addEventListener("hashchange", onHash);

  function dispose() {
    if (dead) return; dead = true;
    removeEventListener("hashchange", onHash);
    if (slot && droneEl.parentNode === slot) slot.removeChild(droneEl);
    cancelAnimationFrame(pending); clearTimeout(zoneT); ro?.disconnect();
    if (scene) scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); });
    G.bodyTex?.dispose?.();
    if (R) { R.dispose(); try { R.forceContextLoss(); } catch {} }
    R = null; scene = null;
  }

  start();
  return {
    /** 시각·렌즈·천체가 바뀜 */
    draw() { if (built && R) { if (host.lens() !== lastLens) { lastLens = host.lens(); V.hfov = C.viewHFov(lastLens); } req(); } },
    /** 위치·구조물·날짜가 바뀜 → 필요한 것만 다시 */
    async refresh() {
      if (!R || !built || dead) return;
      const o = host.obs();
      if (!V.drone && C.toLocal(built.lat, built.lon, o.lat, o.lon).d > 1) { await buildTerrain(o.lat, o.lon); buildLandmark(); buildBuildings(); setAim(false); }
      else if (host.landmark()?.id !== built.lmId) { buildLandmark(); setAim(false); }
      pathKey = ""; req();
    },
    setMode(m) { mode = m; if (built) { if (m !== "drone" && V.drone) { V.drone = null; const o = host.obs(); if (C.toLocal(built.lat, built.lon, o.lat, o.lon).d > 1) { this.refresh(); } } applyMode(); req(); } },
    buildingsChanged() { attr(); buildBuildings(); },
    dispose,
    get mode() { return mode; },
    stats: () => built && { verts: built.verts, tris: built.tris, points: built.points, ms: built.ms, okFrac: built.okFrac },
  };
}
