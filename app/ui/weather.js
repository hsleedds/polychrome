/* 날씨 탭: 기본 화면(B, 좌우 넘김) · 보조 화면(A, 메인 + 2×2) */
import { getWeather, peekWeather, getAir, getModels, peekModels, flag, ownForecast } from "../data.js";
import { icon } from "../icons.js";
import { t, cityName, lang } from "../i18n.js";
import { esc, actionSheet, onLongPress, toast } from "./dom.js";
import { buildVM, summaryText, condText, sunsetGlow, nightCloud, isDayAt, primarySrc, cloudSrc, srcLabel, dailySrcLabel, srcRunsText } from "./vm.js";
import { temp, precip, hourLabel, dayLabel, relTime, clockAt, dateToLocal, addDays, ymdOf, pct, nowIndex } from "../format.js";
import { iconKey, isWet, riseSet, twilight, moonPos, moonPhaseName, hasSky, localNow } from "../core.js";
import { MAX_CITIES } from "../config.js";

/* ================= 조각들 ================= */
/** 지금 시간의 출처 키 (SPEC 12 이어 붙인 예보면 hourly.src, 아니면 null) */
export function srcNowOf(res) {
  const H = res?.wx?.hourly;
  if (!H || !Array.isArray(H.src)) return null;
  const tz = res.tz || res.wx.timezone || "UTC";
  return H.src[nowIndex(H.time, localNow(tz))] || null;
}
/** 머리줄 출처 배지: 지금 시간 값의 출처 */
export function sourceBadge(res) {
  if (!res) return "";
  const k = srcNowOf(res);
  let txt, kma;
  if (k) {
    kma = k.startsWith("kma");
    txt = k === "kma_ultra" ? t("src.kmaUltra", { time: res.kmaUltraBase || res.kmaBase || "—" })
      : k === "kma_vilage" ? t("src.kmaVilage", { time: res.kmaBase || "—" })
      : k === "om" ? t("src.om") : k === "met" ? t("src.met") : srcLabel(k);
  } else {
    kma = !!res.kmaBase;
    txt = res.kmaBase ? t("src.kma", { time: res.kmaBase }) : res.src === "met" ? t("src.met") : t("src.om");
  }
  const age = Math.round((Date.now() - res.at) / 6e4);
  const stale = res.stale ? ` <span class="stale">${esc(t("src.stale", { min: age }))}</span>` : "";
  return `<span class="badge${kma ? " kma" : ""}" title="${esc(t("fsrc.badgeTitle"))}">${esc(txt)}</span>${stale}`;
}

export function airLine(vm) {
  const a = vm.air;
  if (!a || !vm.airG) return "";
  const parts = [];
  if (vm.airG.pm10) parts.push(`${t("air.pm10")} <b class="air-${vm.airG.pm10}">${esc(t("air.grade." + vm.airG.pm10))}</b>`);
  if (vm.airG.pm25) parts.push(`${t("air.pm25")} <b class="air-${vm.airG.pm25}">${esc(t("air.grade." + vm.airG.pm25))}</b>`);
  if (!parts.length) return "";
  return `<div class="mc-line">${parts.join(" · ")}${a.estimated ? ` <span class="muted">(${esc(t("air.estimated"))})</span>` : ""}</div>`;
}

/** 출처 이름 (기상청 / Open-Meteo / MET Norway) */
export const srcName = (k) => t("srcName." + k);
/** SPEC 11 각주 — 기관 예보를 그대로 정리했다는 안내 (own_forecast off 일 때만) */
export function asPublishedNote() { return ownForecast() ? "" : `<p class="as-published muted tiny">${esc(t("note.asPublished"))}</p>`; }

/** own_forecast off: 주 예보 값 그대로 + 출처, 기관 집계 「N곳 중 M곳」 */
function rainLineRaw(vm, units) {
  const r = vm.r24, a = vm.agency, src = srcRunsText(vm, vm.i, vm.i + 24);
  const cnt = a && a.n >= 2 ? ` · ${esc(t("models.agree", { n: a.n, m: a.m }))}` : "";
  const ic = icon("umbrella", { cls: "sm" });
  if (!r) return cnt ? `<div class="mc-line rain">${ic}<span class="mc-txt">${cnt.slice(3)}</span></div>` : "";
  if (!r.wet && (r.maxProb ?? 0) < 20) return `<div class="mc-line rain">${ic}<span class="mc-txt">${esc(t("rain.line.noneSrc", { src }))}${cnt}</span></div>`;
  return `<div class="mc-line rain${r.wet ? " wet" : ""}">${ic}<span class="mc-txt">${esc(t("rain.line.probSrc", { prob: Math.round(r.maxProb ?? 0), src }))}${r.totalMm > 0 ? " · " + esc(precip(r.totalMm, units)) : ""}${cnt}</span></div>`;
}

export function rainLine(vm, units) {
  if (!ownForecast()) return rainLineRaw(vm, units);
  const c = vm.cons, r = vm.r24;
  if (c && c.n >= 2 && c.prob != null) {
    const wetN = Math.round(c.prob / 100 * c.n);
    return `<div class="mc-line rain${c.prob >= 40 ? " wet" : ""}">${icon("umbrella", { cls: "sm" })} ${esc(t("rain.line.cons", { prob: c.prob, m: Math.max(0, wetN), n: c.n }))}</div>`;
  }
  if (!r) return "";
  if (!r.wet && (r.maxProb ?? 0) < 20) return `<div class="mc-line rain">${icon("umbrella", { cls: "sm" })} ${esc(t("rain.line.none"))}</div>`;
  return `<div class="mc-line rain${r.wet ? " wet" : ""}">${icon("umbrella", { cls: "sm" })} ${esc(t("rain.line.prob", { prob: Math.round(r.maxProb ?? 0) }))}${r.totalMm > 0 ? " · " + esc(precip(r.totalMm, units)) : ""}</div>`;
}

function mainIcon(vm, cls = "xl") {
  const phase = vm.moon?.phase;
  return icon(vm.ik, { cls, label: condText(vm.code), phase: vm.ik === "clear-night" ? phase : undefined, south: vm.city.lat < 0 });
}

/** 메인 카드 (위 1/3) */
export function mainCardHTML(vm, units, { tappable = true } = {}) {
  const strip = vm.strip.map((s, k) => `<li class="${s.wet ? "wet" : ""}${k > 0 && s.src && s.src !== vm.strip[k - 1].src ? " src-chg" : ""}"${s.src ? ` title="${esc(srcLabel(s.src))}"` : ""}><span class="st-t">${k === 0 ? esc(t("now")) : esc(hourLabel(s.time, lang(), true))}</span>${icon(s.icon, { cls: "sm" })}<span class="st-v">${esc(temp(s.temp, units))}</span></li>`).join("");
  const attrs = tappable ? ` role="link" tabindex="0" data-href="#/city/${esc(vm.city.id)}" aria-label="${esc(t("a11y.openDetail", { city: cityName(vm.city) }))}"` : "";
  return `<section class="main-card accent"${attrs}>
    <div class="mc-top">${mainIcon(vm)}<div class="mc-temp">${esc(temp(vm.curT, units))}</div>
      <div class="mc-side"><div class="mc-cond">${esc(condText(vm.code))}</div>
      <div class="mc-feel">${esc(t("feels", { v: temp(vm.curA, units) }))}</div>
      <div class="mc-hl">${esc(t("hilo", { hi: temp(vm.tmax, units), lo: temp(vm.tmin, units) }))}</div></div></div>
    <p class="mc-sum">${esc(summaryText(vm.sum, vm, units))}</p>
    ${rainLine(vm, units)}${airLine(vm)}
    <ol class="strip" aria-label="${esc(t("a11y.strip"))}">${strip}</ol>
    ${Array.isArray(vm.H.src) ? `<div class="mc-src">${esc(t("fsrc.basis", { src: srcRunsText(vm, vm.i, vm.i + 3 * (vm.strip.length - 1) + 1) }))}</div>` : ""}
  </section>`;
}

/** 7일 줄 */
export function dailyHTML(vm, units, cityId) {
  const D = vm.D, n = Math.min(7, (D.time || []).length - vm.di);
  if (n <= 0) return "";
  const rows = [];
  const mins = [], maxs = [];
  for (let k = 0; k < n; k++) { mins.push(D.temperature_2m_min[vm.di + k]); maxs.push(D.temperature_2m_max[vm.di + k]); }
  const lo = Math.min(...mins.filter((x) => x != null)), hi = Math.max(...maxs.filter((x) => x != null)), span = Math.max(1, hi - lo);
  let lastSrc = null;
  for (let k = 0; k < n; k++) {
    const d = vm.di + k, ymd = D.time[d];
    const ds = D.src?.[d] ? dailySrcLabel(D.src[d]) : null;
    const srcTag = ds && ds !== lastSrc ? `<small class="dr-src"${D.derived?.[d] ? ` title="${esc(t("fsrc.derived"))}"` : ""}>${esc(ds)}</small>` : "";
    if (ds) lastSrc = ds;
    const pp = D.precipitation_probability_max?.[d], ps = D.precipitation_sum?.[d];
    const wet = isWet(pp, ps);
    const a = (mins[k] - lo) / span, w = Math.max(0.06, (maxs[k] - mins[k]) / span);
    const bg = `background-size:${(100 / w).toFixed(1)}% 100%;background-position:${w >= 1 ? 0 : (a / (1 - w) * 100).toFixed(1)}% 0`;
    rows.push(`<li><a class="day-row${wet ? " wet" : ""}" href="#/city/${esc(cityId)}/day/${ymd}" aria-label="${esc(t("a11y.day", { day: dayLabel(ymd, vm.today, lang()) }))}">
      <span class="dr-d">${esc(dayLabel(ymd, vm.today, lang()))}${srcTag}</span>
      ${icon(iconKey(D.weather_code?.[d], true, (ps || 0) / 10), { cls: "md" })}
      <span class="dr-rain">${pp != null ? `<b>${esc(pct(pp))}</b>` : ""}${ps > 0 ? `<small>${esc(precip(ps, units))}</small>` : ""}</span>
      <span class="dr-lo">${esc(temp(mins[k], units))}</span>
      <span class="range"><i style="left:${(a * 100).toFixed(1)}%;width:${(w * 100).toFixed(1)}%;${bg}"></i></span>
      <span class="dr-hi">${esc(temp(maxs[k], units))}</span></a></li>`);
  }
  return `<section class="card daily"><h3 class="card-h">${esc(t("daily.title"))}</h3><ul>${rows.join("")}</ul></section>`;
}

/** 48시간 안 비 → 비 카드 */
export function rainCardHTML(vm, units) {
  const own = ownForecast();
  const r = vm.r48, H = vm.H, c = own ? vm.cons : null;
  const bars = [];
  for (let k = 0; k < 48 && vm.i + k < H.time.length; k++) {
    const j = vm.i + k, mm = H.precipitation?.[j] || 0, wet = isWet(H.precipitation_probability?.[j], mm);
    const chg = k > 0 && H.src?.[j] && H.src[j] !== H.src[j - 1];
    bars.push(`<i class="${wet ? "wet" : ""}${chg ? " chg" : ""}" style="height:${Math.min(100, 6 + mm * 18).toFixed(0)}%"></i>`);
  }
  const lines = [];
  lines.push(`<div class="rc-row"><span>${esc(t("rain.card.start"))}</span><b>${esc(relTime(r.start, vm.now, lang()))}</b></div>`);
  if (r.end) lines.push(`<div class="rc-row"><span>${esc(t("rain.card.end"))}</span><b>${esc(relTime(r.end, vm.now, lang()))}</b></div>`);
  let amount = precip(r.totalMm, units);
  if (c && c.mmLo != null && c.mmHi != null && c.mmHi > c.mmLo) amount += ` (${precip(c.mmLo, units)}–${precip(c.mmHi, units)})`;
  lines.push(`<div class="rc-row"><span>${esc(t("rain.card.amount"))}</span><b>${esc(amount)}</b></div>`);
  lines.push(`<div class="rc-row"><span>${esc(t("rain.card.prob"))}</span><b>${esc(pct(r.maxProb))}</b></div>`);
  if (!own && vm.agency && vm.agency.n >= 2) lines.push(`<div class="rc-row"><span>${esc(t("rain.card.agencies"))}</span><b>${esc(t("models.agree", { n: vm.agency.n, m: vm.agency.m }))}</b></div>`);
  if (c && c.n >= 2) lines.push(`<div class="rc-row"><span>${esc(t("rain.card.agree"))}</span><b>${esc(t("rain.card.agreeN", { m: Math.round((c.prob ?? 0) / 100 * c.n), n: c.n, grade: t("grade." + (c.grade || "low")) }))}</b></div>`);
  const srcH = own ? "" : ` <small class="muted">${esc(t("rain.card.basis", { src: srcRunsText(vm, vm.i, vm.i + 48) }))}</small>`;
  return `<section class="card rain-card"><h3 class="card-h">${icon("umbrella", { cls: "sm" })} ${esc(t("rain.card.title"))}${srcH}</h3>
    <div class="rc-bars" aria-hidden="true">${bars.join("")}</div><div class="rc-axis"><span>${esc(t("now"))}</span><span>+24h</span><span>+48h</span></div>${lines.join("")}</section>`;
}

/** 해·달·노을 — 「오늘의 빛」 */
export function lightCardHTML(vm, units) {
  const c = vm.city, tz = c.tz, now = new Date();
  let ymd = vm.today, label = t("light.today");
  let rs = null;
  try { rs = riseSet("sun", ymd, c.lat, c.lon, tz); } catch { /* */ }
  if (rs?.set && rs.set < now) { ymd = addDays(ymd, 1); label = t("light.tomorrow"); try { rs = riseSet("sun", ymd, c.lat, c.lon, tz); } catch { /* */ } }
  let tw = null;
  try { tw = twilight(ymd, c.lat, c.lon, tz); } catch { /* */ }
  const span = (a) => (a && a[0] && a[1] ? `${clockAt(a[0], tz)}–${clockAt(a[1], tz)}` : "–");
  const rows = [];
  if (tw?.polarNight) rows.push(`<div class="lc-row"><span>${esc(t("light.polarNight"))}</span></div>`);
  else if (tw?.polarDay) rows.push(`<div class="lc-row"><span>${esc(t("light.polarDay"))}</span></div>`);
  rows.push(`<div class="lc-row">${icon("sunrise", { cls: "sm" })}<span>${esc(t("sunrise"))}</span><b>${esc(clockAt(rs?.rise, tz))}</b>${icon("sunset", { cls: "sm" })}<span>${esc(t("sunset"))}</span><b>${esc(clockAt(rs?.set, tz))}</b></div>`);
  if (tw) {
    rows.push(`<div class="lc-row"><span class="dot gold"></span><span>${esc(t("light.golden"))}</span><b>${esc(span(tw.golden?.am))} · ${esc(span(tw.golden?.pm))}</b></div>`);
    rows.push(`<div class="lc-row"><span class="dot blue"></span><span>${esc(t("light.blue"))}</span><b>${esc(span(tw.blue?.am))} · ${esc(span(tw.blue?.pm))}</b></div>`);
  }
  const glow = rs?.set ? sunsetGlow(vm.H, dateToLocal(rs.set, tz)) : null;
  if (glow && !ownForecast()) rows.push(`<div class="lc-row glow-cond"><span class="dot glow"></span><span>${esc(t("light.glowCond"))}</span><b>${esc(t("light.clouds", { hi: Math.round(glow.hi), mid: Math.round(glow.mid), low: Math.round(glow.low) }))}</b><small class="muted">${esc(t("light.srcParen", { src: srcName(cloudSrc(vm.res)) }))}</small></div>`);
  else if (glow) rows.push(`<div class="lc-row glow-${glow.level}"><span class="dot glow"></span><span>${esc(t("light.glow"))}</span><b>${esc(t("light.glow." + glow.level))}</b><small class="muted">${esc(t("light.clouds", { hi: Math.round(glow.hi), mid: Math.round(glow.mid), low: Math.round(glow.low) }))}</small></div>`);
  // 달
  let mrs = null, mp = vm.moon;
  try { mrs = riseSet("moon", vm.today, c.lat, c.lon, tz); } catch { /* */ }
  if (!mp) { try { mp = moonPos(now, c.lat, c.lon); } catch { /* */ } }
  if (mp) {
    rows.push(`<div class="lc-row">${icon("moon-phase", { cls: "sm", phase: mp.phase, south: c.lat < 0 })}<span>${esc(t(moonPhaseName(mp.phase)))} ${esc(pct(mp.illum * 100))}</span><b>${esc(t("moon.riseSet", { rise: clockAt(mrs?.rise, tz), set: clockAt(mrs?.set, tz) }))}</b></div>`);
  }
  const nc = nightCloud(vm.H, vm.today);
  if (nc != null) rows.push(`<div class="lc-row"><span class="dot night"></span><span>${esc(t("light.nightCloud"))}</span><b>${esc(pct(nc))}</b>${ownForecast() ? "" : `<small class="muted">${esc(t("light.srcParen", { src: srcName(cloudSrc(vm.res)) }))}</small>`}</div>`);
  return `<section class="card light-card"><h3 class="card-h">${esc(t("light.title"))} <small class="muted">${esc(label)}</small></h3>${rows.join("")}${hasSky() ? "" : `<p class="muted tiny">${esc(t("light.approx"))}</p>`}</section>`;
}

/** 아래 카드: 48시간 안 비면 비 카드 먼저, 그 밖엔 오늘의 빛. 초미세먼지 나쁨 이상이면 줄 추가 */
export function adaptiveHTML(vm, units) {
  const out = [];
  if (vm.r48?.wet) out.push(rainCardHTML(vm, units));
  out.push(lightCardHTML(vm, units));
  if (vm.airG && (vm.airG.pm25 === "bad" || vm.airG.pm25 === "verybad")) out.unshift(`<div class="notice air-${vm.airG.pm25}">${esc(t("air.notice." + vm.airG.pm25))}</div>`);
  return out.join("");
}

function skeleton() { return `<section class="main-card accent skel"><div class="spin" aria-hidden="true"></div><p>${esc(t("loading"))}</p></section>`; }
function errorBox(cityId) { return `<section class="card err"><p>${esc(t("error.weather"))}</p><button class="btn" data-act="retry" data-id="${esc(cityId)}">${esc(t("retry"))}</button></section>`; }

/* ================= 도시 하나 불러오기 ================= */
async function loadCity(city, { force = false, onUpdate } = {}) {
  const res = await getWeather(city, { force });
  const air = await Promise.race([getAir(city), new Promise((r) => setTimeout(() => r(null), 2500))]);
  const vm = buildVM(city, res, air, peekModels(city));
  onUpdate?.(vm);
  // 공기질이 늦게 오면 한 번 더
  if (!air) getAir(city).then((a) => { if (a) onUpdate?.(buildVM(city, res, a, peekModels(city))); });
  return vm;
}
/** 기관 비교(합의) — 메인 도시만 미리, 나머지는 상세에서 */
function loadModels(city, res, air, onUpdate) {
  getModels(city, res.wx).then((m) => { if (m) onUpdate?.(buildVM(city, res, air, m)); });
}

/* ================= 기본 화면 B ================= */
export function renderWeather(root, ctx) {
  const st = ctx.store.get();
  return st.layout === "A" ? renderA(root, ctx) : renderB(root, ctx);
}

function pageBody(vm, units) {
  return mainCardHTML(vm, units) + dailyHTML(vm, units, vm.city.id) + adaptiveHTML(vm, units) + asPublishedNote();
}

function renderB(root, ctx) {
  const units = ctx.store.get().units;
  const cities = ctx.store.ordered();
  const pages = [];
  const gps = ctx.gpsEnabled();
  if (gps) pages.push({ kind: "gps" });
  cities.forEach((c) => pages.push({ kind: "city", city: c }));
  if (cities.length < MAX_CITIES) pages.push({ kind: "add" });
  const startIdx = ctx.pagerIdx ?? (gps ? 1 : 0);

  root.innerHTML = `<div class="weather-b">
    <div class="dots" role="tablist" aria-label="${esc(t("a11y.cities"))}">${pages.map((p, k) => `<button role="tab" class="dot-b${p.kind === "add" ? " add" : ""}${p.kind === "gps" ? " gps" : ""}" data-go="${k}" aria-label="${esc(p.kind === "add" ? t("city.add") : p.kind === "gps" ? t("gps.title") : cityName(p.city))}"></button>`).join("")}</div>
    <div class="pager" tabindex="0" aria-label="${esc(t("a11y.pager"))}">${pages.map((p, k) => pageShell(p, k, ctx)).join("")}</div></div>`;
  const pager = root.querySelector(".pager");
  const dots = [...root.querySelectorAll(".dot-b")];
  const loaded = new Set();

  const setActive = (k) => {
    k = Math.max(0, Math.min(pages.length - 1, k | 0));
    dots.forEach((d, j) => { d.classList.toggle("on", j === k); d.setAttribute("aria-selected", j === k ? "true" : "false"); });
    ctx.pagerIdx = k;
    [k, k + 1, k - 1].forEach((j) => j >= 0 && j < pages.length && ensure(j)); // 이웃 미리 불러오기
  };
  const ensure = (k) => {
    if (loaded.has(k)) return; loaded.add(k);
    const p = pages[k], el = pager.children[k];
    if (p.kind === "city") fillCity(el, p.city, ctx, units, k === (gps ? 1 : 0));
    if (p.kind === "gps") fillGps(el, ctx, units);
  };
  const goTo = (k, smooth = true) => { const el = pager.children[k]; if (el) pager.scrollTo({ left: el.offsetLeft, behavior: smooth ? "smooth" : "auto" }); };

  const nearestIdx = () => { let best = 0, d = Infinity; [...pager.children].forEach((el, j) => { const x = Math.abs(el.offsetLeft - pager.scrollLeft); if (x < d) { d = x; best = j; } }); return best; };
  let raf = 0, lastW = pager.clientWidth;
  // 창 크기·화면 회전이 바뀌면 보던 장을 그대로 유지 (크기 변화 중의 스크롤 값으로 장을 바꾸지 않음)
  try { new ResizeObserver(() => { if (pager.clientWidth === lastW) return; lastW = pager.clientWidth; goTo(ctx.pagerIdx ?? 0, false); }).observe(pager); } catch { /* 구형 브라우저 */ }
  pager.addEventListener("scroll", () => {
    if (pager.clientWidth !== lastW) return;
    cancelAnimationFrame(raf);
    // 화면이 아직 배치되지 않았으면(폭 0) 무시 — 이때의 스크롤 값으로 장을 정하면 엉뚱한 장(지역 추가)으로 감
    if (pager.clientWidth < 10) return;
    raf = requestAnimationFrame(() => setActive(nearestIdx()));
  }, { passive: true });
  root.querySelector(".dots").addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) goTo(+b.dataset.go); });
  pager.addEventListener("keydown", (e) => {
    if (e.target !== pager) return;
    const k = ctx.pagerIdx ?? 0;
    if (e.key === "ArrowRight") { goTo(Math.min(pages.length - 1, k + 1)); e.preventDefault(); }
    if (e.key === "ArrowLeft") { goTo(Math.max(0, k - 1)); e.preventDefault(); }
  });
  mouseDrag(pager, () => ctx.pagerIdx ?? 0, goTo, pages.length);
  root.addEventListener("click", (e) => {
    const r = e.target.closest("[data-act=retry]");
    if (r) { const k = [...pager.children].indexOf(r.closest(".page")); loaded.delete(k); ensure(k); }
  });

  const first = Math.min(startIdx, pages.length - 1);
  setActive(first);
  // 배치가 끝난 뒤 시작 장으로 이동 (폭이 0이면 다음 프레임에 다시 시도)
  const place = (tries) => { if (pager.clientWidth < 10 && tries > 0) return requestAnimationFrame(() => place(tries - 1)); lastW = pager.clientWidth; goTo(first, false); };
  requestAnimationFrame(() => place(30));
}

/** 마우스로 끌어서 넘기기 (터치·트랙패드는 기본 스크롤 스냅) */
function mouseDrag(pager, cur, goTo, n) {
  let x0 = null, s0 = 0, moved = false;
  pager.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse" || e.button !== 0) return; x0 = e.clientX; s0 = pager.scrollLeft; moved = false; });
  pager.addEventListener("pointermove", (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0;
    if (Math.abs(dx) > 6) { if (!moved) { try { pager.setPointerCapture(e.pointerId); } catch { /* */ } } moved = true; pager.classList.add("dragging"); pager.scrollLeft = s0 - dx; }
  });
  pager.addEventListener("pointerup", (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0; x0 = null; pager.classList.remove("dragging");
    if (!moved) return;
    const k = Math.round(s0 / Math.max(1, pager.clientWidth));
    goTo(Math.max(0, Math.min(n - 1, dx < -40 ? k + 1 : dx > 40 ? k - 1 : k)));
  });
  pager.addEventListener("click", (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
}

function pageShell(p, k, ctx) {
  if (p.kind === "add") return `<section class="page add-page" aria-label="${esc(t("city.add"))}"><a class="add-big" href="#/add">${icon("plus", { cls: "xl" })}<span>${esc(t("city.add"))}</span><small>${esc(t("city.addHint", { n: MAX_CITIES }))}</small></a></section>`;
  if (p.kind === "gps") return `<section class="page" aria-label="${esc(t("gps.title"))}"><header class="page-head"><h2>${icon("pin", { cls: "sm" })} ${esc(t("gps.title"))}</h2><span class="ph-src"></span></header><div class="page-body">${skeleton()}</div></section>`;
  const c = p.city, main = c.id === ctx.store.get().mainId;
  const peek = peekWeather(c);
  let body = skeleton();
  if (peek) { try { body = pageBody(buildVM(c, peek, null, peekModels(c)), ctx.store.get().units); } catch { /* */ } }
  return `<section class="page" data-city="${esc(c.id)}" aria-label="${esc(cityName(c))}"><header class="page-head"><h2>${main ? `<span class="star" aria-label="${esc(t("city.main"))}">${icon("star", { cls: "sm" })}</span>` : ""}${esc(cityName(c))}</h2><span class="ph-src">${peek ? sourceBadge(peek) : ""}</span></header><div class="page-body">${body}</div></section>`;
}

function fillCity(el, city, ctx, units, isMain) {
  const body = el.querySelector(".page-body"), src = el.querySelector(".ph-src");
  const update = (vm) => { body.innerHTML = pageBody(vm, units); src.innerHTML = sourceBadge(vm.res); };
  loadCity(city, { onUpdate: update }).then((vm) => { if (isMain) loadModels(city, vm.res, vm.air, update); })
    .catch(() => { if (!peekWeather(city)) body.innerHTML = errorBox(city.id); else toast(t("error.offline")); });
}

/* ---- 관리자: 내 위치 ---- */
function fillGps(el, ctx, units) {
  const body = el.querySelector(".page-body"), src = el.querySelector(".ph-src");
  ctx.getGpsCity().then((city) => {
    if (!city) { body.innerHTML = `<section class="card"><p>${esc(t("gps.denied"))}</p></section>`; return; }
    el.querySelector("h2").innerHTML = `${icon("pin", { cls: "sm" })} ${esc(t("gps.title"))} <small class="muted">${city.lat.toFixed(3)}, ${city.lon.toFixed(3)}</small>`;
    const update = (vm) => { body.innerHTML = pageBody(vm, units).replaceAll(`#/city/${city.id}`, "#/city/gps"); src.innerHTML = sourceBadge(vm.res); };
    loadCity(city, { onUpdate: update }).catch(() => { body.innerHTML = errorBox("gps"); });
  });
}

/* ================= 보조 화면 A ================= */
function renderA(root, ctx) {
  const st = ctx.store.get(), units = st.units;
  const cities = ctx.store.ordered();
  const main = cities[0], others = cities.slice(1);
  const cells = [];
  for (let k = 0; k < 4; k++) {
    const c = others[k];
    if (c) cells.push(`<a class="cell" href="#/city/${esc(c.id)}" data-id="${esc(c.id)}"><div class="cell-name">${esc(cityName(c))}</div><div class="cell-body"><div class="spin sm" aria-hidden="true"></div></div></a>`);
    else cells.push(`<a class="cell add" href="#/add">${icon("plus", { cls: "md" })}<span>${esc(t("city.add"))}</span></a>`);
  }
  root.innerHTML = `<div class="weather-a">
    <header class="page-head"><h2><span class="star">${icon("star", { cls: "sm" })}</span>${esc(cityName(main))}</h2><span class="ph-src"></span></header>
    <div class="a-main">${skeleton()}</div>
    <div class="grid2">${cells.join("")}</div>
    <div class="a-extra"></div>
    <p class="muted tiny center">${esc(t("layoutA.hint"))}</p></div>`;
  const mainEl = root.querySelector(".a-main"), extra = root.querySelector(".a-extra"), src = root.querySelector(".ph-src");
  const upd = (vm) => { mainEl.innerHTML = mainCardHTML(vm, units); extra.innerHTML = adaptiveHTML(vm, units) + asPublishedNote(); src.innerHTML = sourceBadge(vm.res); };
  loadCity(main, { onUpdate: upd }).then((vm) => loadModels(main, vm.res, vm.air, upd)).catch(() => { mainEl.innerHTML = errorBox(main.id); });
  for (const c of others) {
    const cell = root.querySelector(`.cell[data-id="${CSS.escape(c.id)}"] .cell-body`);
    loadCity(c, { onUpdate: (vm) => { cell.innerHTML = cellHTML(vm, units); } }).catch(() => { cell.innerHTML = `<span class="muted">${esc(t("error.short"))}</span>`; });
  }
  onLongPress(root, ".cell[data-id]", async (el) => {
    const id = el.dataset.id, c = ctx.store.city(id);
    const v = await actionSheet(cityName(c), [{ label: t("city.setMain"), value: "main" }, { label: t("city.remove"), value: "del", danger: true }], t("cancel"));
    if (v === "main") { ctx.store.setMain(id); toast(t("city.mainSet", { city: cityName(c) })); ctx.rerender(); }
    if (v === "del") { if (ctx.store.removeCity(id)) { toast(t("city.removed", { city: cityName(c) })); ctx.rerender(); } }
  });
  root.addEventListener("click", (e) => { const r = e.target.closest("[data-act=retry]"); if (r) ctx.rerender(); });
}

function cellHTML(vm, units) {
  const r = vm.r24;
  const rain = r?.wet ? `<div class="cell-rain">${esc(t("cell.rain", { time: relTime(r.start, vm.now, lang()) }))}</div>` : "";
  return `<div class="cell-main">${icon(vm.ik, { cls: "md", phase: vm.ik === "clear-night" ? vm.moon?.phase : undefined })}<span class="cell-temp">${esc(temp(vm.curT, units))}</span></div>
    <div class="cell-hl">${esc(temp(vm.tmax, units))} / ${esc(temp(vm.tmin, units))}</div>${rain}`;
}

export { loadCity, isDayAt, ymdOf };
