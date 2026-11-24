/* 오로라 (SPEC 4.6): 도시 목록(별도 저장) → 상세(반원 게이지, 세 조건, 시간대별 커튼 막대 + 달 고도) */
import { getOvation, ovationAt, getKp, kpAt, getClouds, getAuroraServer, flag } from "../data.js";
import { sunPos, moonPos, auroraIndex, kpToProb, magLat, twilight, hasSky, moonPhaseName } from "../core.js";
import { dateToLocal, hourKey, monthDay, clockAt, kpToG, ymdOf, hourLabel, pct } from "../format.js";
import { t, cityName, lang } from "../i18n.js";
import { esc, header, toast, actionSheet } from "./dom.js";
import { icon } from "../icons.js";

const H = 36e5;

/** 오늘 밤(또는 지금 이어지는 밤) 시간대별 지수 */
export async function auroraNight(city) {
  const [ov, kps, cl, srv] = await Promise.all([getOvation(), getKp(), getClouds(city), getAuroraServer(city).catch(() => null)]);
  const now = Date.now(), t0 = Math.floor(now / H) * H;
  const mlat = magLat(city.lat, city.lon);
  // 앞뒤 시간의 해 고도로 밤 구간 찾기 (해 < −6°)
  const span = [];
  for (let k = -12; k <= 36; k++) { const d = new Date(t0 + k * H); span.push({ d, k, sun: sunPos(d, city.lat, city.lon).alt }); }
  const blocks = []; let cur = null;
  for (const s of span) { if (s.sun < -6) { if (!cur) { cur = []; blocks.push(cur); } cur.push(s); } else cur = null; }
  const block = blocks.find((b) => b[b.length - 1].k >= 0 && b[0].k <= 0) || blocks.find((b) => b[0].k > 0);
  const ovProb = ov ? ovationAt(ov, city.lat, city.lon) : null;
  const srvProb = srv && typeof srv.prob === "number" ? srv.prob : null;
  const kpNow = kpAt(kps, new Date(now));
  if (!block) return { city, hours: [], best: null, season: seasonStart(city), kpNow, kpMax: kpMaxNext(kps), ovTime: ov?.time || null, darkFull: 0, ok: true };

  const cloudIdx = cl ? new Map(cl.time.map((x, i) => [x, i])) : null;
  const hours = block.map(({ d, sun }) => {
    const ci = cloudIdx?.get(hourKey(dateToLocal(d, city.tz)));
    const cLow = ci != null ? cl.cloud_cover_low?.[ci] : null, cMid = ci != null ? cl.cloud_cover_mid?.[ci] : null, cHigh = ci != null ? cl.cloud_cover_high?.[ci] : null;
    const kp = kpAt(kps, d);
    // 1시간 이내는 OVATION(관측 기반 30~90분 예보), 그 뒤는 Kp 예보 환산
    const near = Math.abs(d.getTime() - now) <= 1.5 * H;
    let prob = near ? (srvProb ?? ovProb) : null;
    if (prob == null && kp != null) prob = kpToProb(kp, mlat);
    const m = moonPos(d, city.lat, city.lon);
    const idx = auroraIndex({ prob: prob ?? 0, kp, cloudLow: cLow ?? 50, cloudMid: cMid ?? 50, cloudHigh: cHigh ?? 50, sunAlt: sun, moonAlt: m.alt, moonIllum: m.illum, moonAz: m.az, lat: city.lat, lon: city.lon });
    return { d, local: dateToLocal(d, city.tz), sun, moonAlt: m.alt, moonIllum: m.illum, phase: m.phase, kp, prob, cloud: { low: cLow, mid: cMid, high: cHigh }, cloudKnown: ci != null, ...idx };
  });
  const future = hours.filter((h) => h.d.getTime() >= t0);
  const best = (future.length ? future : hours).reduce((a, b) => (b.score > a.score ? b : a));
  let darkFull = hours.filter((h) => h.sun < -18).length;
  try { const tw = twilight(ymdOf(dateToLocal(block[0].d, city.tz)), city.lat, city.lon, city.tz); if (tw && typeof tw.darkHours === "number") darkFull = tw.darkHours; } catch { /* */ }
  return { city, hours, best, season: null, kpNow, kpMax: kpMaxNext(kps), ovTime: ov?.time || null, darkFull, ok: true, noKp: !kps, noCloud: !cl };
}
function kpMaxNext(kps) { if (!kps) return null; const n = Date.now(); const f = kps.filter((x) => x.t.getTime() >= n - 3 * H && x.t.getTime() <= n + 72 * H); return f.length ? Math.max(...f.map((x) => x.kp)) : null; }

/** 백야로 어두워지지 않으면, 언제부터 밤(해 < −6°)이 오는지 */
function seasonStart(city) {
  const base = Date.now();
  for (let d = 1; d <= 200; d++) {
    // 현지 태양 자정 근처(UTC 0시 − 경도/15) 해 고도
    const day = new Date(base + d * 864e5); day.setUTCHours(0, 0, 0, 0);
    const mid = new Date(day.getTime() - (city.lon / 15) * H + (city.lat >= 0 ? 0 : 0));
    let minAlt = 90;
    for (let k = -2; k <= 2; k++) minAlt = Math.min(minAlt, sunPos(new Date(mid.getTime() + k * H), city.lat, city.lon).alt);
    if (minAlt < -6) return { from: ymdOf(dateToLocal(mid, city.tz)) };
  }
  return { from: null };
}

/* ---------- 색 ---------- */
const STOPS = [[0, [200, 245, 214]], [3, [125, 220, 156]], [5, [34, 163, 90]], [7, [15, 122, 67]], [8.5, [184, 50, 63]], [10, [160, 16, 58]]];
export function auroraColor(v) {
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) { const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], f = (v - a) / (b - a); return `rgb(${ca.map((x, k) => Math.round(x + (cb[k] - x) * f)).join(",")})`; }
  }
  return "rgb(160,16,58)";
}

/** 반원 게이지 */
export function gaugeSVG(score, label) {
  const cx = 110, cy = 104, r = 86, segs = [];
  for (let k = 0; k < 10; k++) {
    const a0 = Math.PI * (1 - k / 10) - 0.012, a1 = Math.PI * (1 - (k + 1) / 10) + 0.012;
    const p = (a, rr) => `${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy - rr * Math.sin(a)).toFixed(1)}`;
    const on = k < score;
    segs.push(`<path d="M${p(a0, r)}A${r} ${r} 0 0 1 ${p(a1, r)}" stroke="${on ? auroraColor(k + 0.5) : "currentColor"}" stroke-opacity="${on ? 1 : 0.14}" stroke-width="16" fill="none"/>`);
    // 7~8: 초록 위 붉은빛(바깥 테)
    if (on && k >= 6 && k < 8) segs.push(`<path d="M${p(a0, r + 11)}A${r + 11} ${r + 11} 0 0 1 ${p(a1, r + 11)}" stroke="#d6334a" stroke-width="4" fill="none" stroke-linecap="round"/>`);
  }
  return `<svg class="gauge" viewBox="0 0 220 120" role="img" aria-label="${esc(label)}">${segs.join("")}
    <text x="${cx}" y="${cy - 14}" text-anchor="middle" class="g-num">${score}</text><text x="${cx}" y="${cy + 6}" text-anchor="middle" class="g-of">/ 10</text>
    <text x="16" y="118" class="g-ax">0</text><text x="198" y="118" class="g-ax">10</text></svg>`;
}

/** 시간대별 커튼 막대 + 달 고도 곡선 */
export function barsSVG(night, tz) {
  const hs = night.hours, n = hs.length;
  if (!n) return "";
  const bw = 22, gap = 6, Hh = 120, top = 14, W = n * (bw + gap) + gap, base = top + Hh;
  const defs = `<defs>
    <linearGradient id="au-weak" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bff1cf"/><stop offset="1" stop-color="#7fd9a0"/></linearGradient>
    <linearGradient id="au-fair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fbf74"/><stop offset="1" stop-color="#14864a"/></linearGradient>
    <linearGradient id="au-mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d6334a"/><stop offset=".16" stop-color="#c94a52"/><stop offset=".26" stop-color="#1fa05a"/><stop offset="1" stop-color="#0d6b3a"/></linearGradient>
    <linearGradient id="au-epic" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c2185b"/><stop offset=".2" stop-color="#d6334a"/><stop offset=".3" stop-color="#1fa05a"/><stop offset=".86" stop-color="#0d6b3a"/><stop offset="1" stop-color="#ff7eb6"/></linearGradient></defs>`;
  const bars = hs.map((h, k) => {
    const x = gap + k * (bw + gap), v = Math.max(0.03, h.score / 10), bh = v * Hh;
    // SPEC 4.6: 약함(0–4) 옅은 초록 · 5–6 진한 초록 · 7–8 초록 위 붉은 띠 · 9–10 아래 끝 분홍까지
    const fill = h.score >= 9 ? "url(#au-epic)" : h.score >= 7 ? "url(#au-mid)" : h.score >= 5 ? "url(#au-fair)" : "url(#au-weak)";
    const lbl = k % 2 === 0 ? `<text x="${x + bw / 2}" y="${base + 14}" text-anchor="middle" class="b-ax">${esc(hourLabel(h.local, lang(), true))}</text>` : "";
    return `<rect x="${x}" y="${(base - bh).toFixed(1)}" width="${bw}" height="${bh.toFixed(1)}" rx="5" fill="${fill}"><title>${esc(h.local.slice(11))} · ${h.score}/10</title></rect>${h.score > 0 ? `<text x="${x + bw / 2}" y="${(base - bh - 3).toFixed(1)}" text-anchor="middle" class="b-v">${h.score}</text>` : ""}${lbl}`;
  }).join("");
  // 달 고도 (0~90° → 막대 영역 높이). 지평선 아래는 바닥에 붙임
  const pts = hs.map((h, k) => `${(gap + k * (bw + gap) + bw / 2).toFixed(1)},${(base - Math.max(0, h.moonAlt) / 90 * Hh).toFixed(1)}`).join(" ");
  const mid = hs[Math.floor(n / 2)];
  return `<div class="bars-wrap"><svg class="au-bars" viewBox="0 0 ${W} ${base + 20}" width="${W}" height="${base + 20}" role="img" aria-label="${esc(t("aurora.hourlyA11y"))}">${defs}
    <line x1="0" x2="${W}" y1="${base}" y2="${base}" class="b-base"/>${bars}
    <polyline points="${pts}" class="moon-curve" fill="none"/></svg>
    <div class="moon-key">${icon("moon-phase", { cls: "sm", phase: mid.phase })}<span>${esc(t("aurora.moonCurve"))} · ${esc(t(moonPhaseName(mid.phase)))} ${esc(pct(mid.moonIllum * 100))}</span></div></div>`;
}

/* ---------- 화면 ---------- */
export function renderAuroraList(root, ctx) {
  const list = ctx.store.get().auroraCities;
  root.innerHTML = header(t("shoot.aurora"), { backLabel: t("back"), right: `<a class="icon-btn" href="#/add/aurora" aria-label="${esc(t("aurora.addCity"))}">${icon("plus", { cls: "sm" })}</a>` }) +
    `<div class="pad aurora-list"><p class="muted tiny">${esc(t("aurora.listHint"))}</p><ul class="au-cities">${list.map((c) => `<li data-id="${esc(c.id)}"><a class="au-row" href="#/aurora/${esc(c.id)}">
      <span class="au-dot" aria-hidden="true"></span><span class="au-n"><b>${esc(cityName(c))}</b><small class="muted au-time">${esc(clockAt(new Date(), c.tz))}</small></span>
      <span class="au-v"><span class="spin sm" aria-hidden="true"></span></span>${icon("chevron", { cls: "sm" })}</a>
      <button class="icon-btn au-more" data-id="${esc(c.id)}" aria-label="${esc(t("city.remove"))}: ${esc(cityName(c))}">${icon("trash", { cls: "sm" })}</button></li>`).join("")}</ul>
      ${list.length ? "" : `<p class="muted">${esc(t("aurora.empty"))}</p>`}<p class="au-foot muted tiny"></p></div>`;
  for (const c of list) {
    const li = root.querySelector(`li[data-id="${CSS.escape(c.id)}"]`);
    auroraNight(c).then((n) => {
      const v = li.querySelector(".au-v"), dot = li.querySelector(".au-dot");
      if (n.season) { v.innerHTML = `<small class="muted">${esc(t("aurora.seasonOffShort"))}</small>`; return; }
      const b = n.best;
      dot.style.background = auroraColor(b.score);
      v.innerHTML = `<b>${b.score}</b><small>${esc(t("aurora.grade." + b.grade))} · ${esc(b.local.slice(11))}</small>`;
      if (n.kpMax >= 8) root.querySelector(".au-foot").textContent = t("aurora.koreaRed");
    }).catch(() => { li.querySelector(".au-v").innerHTML = `<small class="muted">${esc(t("error.short"))}</small>`; });
  }
  root.addEventListener("click", async (e) => {
    const b = e.target.closest(".au-more"); if (!b) return;
    const c = ctx.store.city(b.dataset.id);
    const ok = await actionSheet(t("city.removeQ", { city: cityName(c) }), [{ label: t("city.remove"), value: true, danger: true }], t("cancel"));
    if (ok) { ctx.store.removeAurora(c.id); ctx.rerender(); }
  });
}

export async function renderAuroraDetail(root, ctx, id) {
  const c = ctx.store.get().auroraCities.find((x) => x.id === id);
  if (!c) { root.innerHTML = header(t("shoot.aurora"), { backLabel: t("back") }) + `<p class="pad muted">${esc(t("error.noCity"))}</p>`; return; }
  root.innerHTML = header(cityName(c), { backLabel: t("back") }) + `<div class="pad au-detail"><div class="spin" aria-hidden="true"></div></div>`;
  const body = root.querySelector(".au-detail");
  let n;
  try { n = await auroraNight(c); } catch (e) { console.warn(e); body.innerHTML = `<p>${esc(t("error.weather"))}</p>`; return; }
  if (!root.isConnected) return;
  const kpTxt = n.kpNow != null ? `Kp ${n.kpNow.toFixed(1)} · G${kpToG(n.kpNow)}` : t("aurora.kpUnknown");
  const alertBtn = flag("aurora_alert") ? `<button class="btn ghost" data-act="alert">${icon("bell", { cls: "sm" })} ${esc(t("aurora.alert"))}</button>` : "";
  if (n.season) {
    body.innerHTML = `<section class="card center">${gaugeSVG(0, t("aurora.seasonOff"))}<p class="au-verdict">${esc(t("aurora.seasonOff"))}</p>
      <p>${esc(n.season.from ? t("aurora.seasonFrom", { date: monthDay(n.season.from, lang()) }) : t("aurora.seasonNone"))}</p><p class="muted tiny">${esc(kpTxt)}</p></section>`;
    return;
  }
  const b = n.best, p = b.parts || {};
  const effCloud = p.clear != null ? Math.round((1 - p.clear) * 100) : null;
  body.innerHTML = `<section class="card center au-head">
      ${gaugeSVG(b.score, t("aurora.gaugeA11y", { v: b.score, grade: t("aurora.grade." + b.grade) }))}
      <p class="au-verdict" style="--au:${auroraColor(Math.max(b.score, 3))}">${esc(t("aurora.tonight"))} <b>${esc(t("aurora.grade." + b.grade))}</b></p>
      <p class="au-reason">${esc(t("aurora." + (b.reason || "reason.great")))} · ${esc(t("aurora.bestAt", { time: hourLabel(b.local, lang()) }))}</p>
      <p class="muted tiny">${esc(kpTxt)}${n.kpMax != null ? " · " + esc(t("aurora.kpMax", { v: n.kpMax.toFixed(1) })) : ""}</p>
    </section>
    <section class="tiles">
      <div class="tile"><span class="tl-h">${icon("aurora", { cls: "sm" })} ${esc(t("aurora.f.activity"))}</span><b>${p.strength != null ? esc(pct(p.strength * 100)) : "–"}</b><small>${b.prob != null ? esc(t("aurora.prob", { v: Math.round(b.prob) })) : ""}</small></div>
      <div class="tile"><span class="tl-h">${icon("cloud", { cls: "sm" })} ${esc(t("aurora.f.cloud"))}</span><b>${effCloud != null ? esc(pct(effCloud)) : "–"}</b><small>${b.cloudKnown ? esc(t("aurora.cloudLayers", { l: Math.round(b.cloud.low ?? 0), m: Math.round(b.cloud.mid ?? 0), h: Math.round(b.cloud.high ?? 0) })) : esc(t("aurora.cloudUnknown"))}</small></div>
      <div class="tile"><span class="tl-h">${icon("moon", { cls: "sm" })} ${esc(t("aurora.f.dark"))}</span><b>${p.dark != null && p.moon != null ? esc(pct(p.dark * p.moon * 100)) : "–"}</b><small>${esc(t("aurora.moonIllum", { v: Math.round(b.moonIllum * 100) }))}</small></div>
    </section>
    <section class="card"><h3 class="card-h">${esc(t("aurora.hourly"))} <small class="muted">${esc(n.hours[0].local.slice(11))}–${esc(n.hours[n.hours.length - 1].local.slice(11))}</small></h3>
      ${barsSVG(n, c.tz)}
      <p class="au-dark">${esc(t("aurora.darkHours", { n: Math.round(n.darkFull * 10) / 10 }))}</p>
      ${n.noCloud ? `<p class="muted tiny">${esc(t("aurora.cloudUnknown"))}</p>` : ""}${hasSky() ? "" : `<p class="muted tiny">${esc(t("light.approx"))}</p>`}
    </section>
    ${alertBtn}
    <p class="muted tiny">${esc(t("aurora.sources"))}${n.ovTime ? " · OVATION " + esc(String(n.ovTime).replace("T", " ").slice(0, 16)) + " UTC" : ""}</p>`;
  body.querySelector("[data-act=alert]")?.addEventListener("click", () => toast(t("aurora.alertSoon")));
}
