/* 도시 상세: 시간별 24시간 · 7일 · 비 카드 · 기관 비교 · 생활 카드. 날짜 지정 시 그날 시간별 */
import { getModels, peekModels, getAir, getWeather, ownForecast } from "../data.js";
import { icon } from "../icons.js";
import { t, cityName, lang } from "../i18n.js";
import { esc, header } from "./dom.js";
import { buildVM, isDayAt, condText, modelsForConsensus } from "./vm.js";
import { mainCardHTML, dailyHTML, rainCardHTML, lightCardHTML, sourceBadge, asPublishedNote } from "./weather.js";
import { temp, precip, wind, hourLabel, dayLabel, monthDay, clockAt, pct, compassKey, uvLevel, ymdOf } from "../format.js";
import { iconKey, isWet, fogLevel, riseSet, consensusFor } from "../core.js";

function hourCols(vm, from, to, units) {
  const H = vm.H, D = vm.D, cols = [];
  for (let j = from; j < to && j < H.time.length; j++) {
    const mm = H.precipitation?.[j] || 0, pp = H.precipitation_probability?.[j];
    const wet = isWet(pp, mm);
    const ik = iconKey(H.weather_code?.[j], isDayAt(H, D, j), mm, H.wind_speed_10m?.[j]);
    const hl = j === vm.i ? t("now") : hourLabel(H.time[j], lang(), true);
    const newDay = H.time[j].endsWith("T00:00") && j !== from;
    cols.push(`<li class="${wet ? "wet" : ""}${newDay ? " newday" : ""}"${H.kma?.[j] ? ' data-kma="1"' : ""}>
      ${newDay ? `<span class="hc-day">${esc(dayLabel(ymdOf(H.time[j]), vm.today, lang()))}</span>` : ""}
      <span class="hc-t">${esc(hl)}</span>${icon(ik, { cls: "sm" })}<span class="hc-v">${esc(temp(H.temperature_2m?.[j], units))}</span>
      <span class="hc-bar" aria-hidden="true"><i style="height:${Math.min(100, mm > 0 ? 8 + mm * 16 : 0).toFixed(0)}%"></i></span>
      <span class="hc-p">${pp != null ? esc(pct(pp)) : ""}</span><span class="hc-mm">${mm > 0 ? esc(precip(mm, units)) : ""}</span></li>`);
  }
  return `<ol class="hours" aria-label="${esc(t("detail.hourly"))}">${cols.join("")}</ol>`;
}

function modelName(m) { const k = "model." + m.name; return t.has(k) ? t(k) : m.name || m.id; }

function modelsHTML(vm, units) {
  const ms = vm.consModels;
  if (!ms || !ms.length) return `<section class="card models"><h3 class="card-h">${esc(t("models.title"))}</h3><div class="models-body"><div class="spin sm" aria-hidden="true"></div> <span class="muted">${esc(t("models.loading"))}</span></div></section>`;
  const from = vm.i, to = vm.i + 24;
  let wetN = 0;
  const rows = ms.map((m) => {
    let s = 0, wet = false, n = 0;
    for (let j = from; j < to && j < m.p.length; j++) { if (m.p[j] != null) { s += m.p[j]; n++; } if (isWet(m.pp?.[j], m.p[j])) wet = true; }
    if (wet) wetN++;
    const old = m.issued && Date.now() - Date.parse(m.issued) > 12 * 36e5;
    return `<li class="${wet ? "wet" : ""}${old ? " old" : ""}"><span class="m-n">${esc(modelName(m))}${m.dom ? ` <small class="chip">${esc(t("models.domestic"))}</small>` : ""}${m.sub && lang() === "ko" ? ` <small class="muted">${esc(m.sub)}</small>` : ""}</span>
      <span class="m-v">${n ? esc(precip(s, units)) : "–"}</span><span class="m-w">${wet ? esc(t("models.wet")) : esc(t("models.dry"))}</span></li>`;
  });
  const c = ownForecast() ? vm.cons : null; // SPEC 11: 합의 확률·등급은 own_forecast 일 때만
  const head = c && c.prob != null ? `<p class="models-sum">${esc(t("models.consensus", { prob: c.prob, grade: t("grade." + (c.grade || "low")) }))}${c.core ? "" : ` <small class="muted">(${esc(t("models.equal"))})</small>`}</p>` : "";
  return `<section class="card models"><h3 class="card-h">${esc(t("models.title"))}</h3>
    <p class="models-big"><b>${esc(t("models.agree", vm.agency || { n: ms.length, m: wetN }))}</b> <small class="muted">${esc(t("models.window"))}</small></p>${head}
    <ul class="models-list">${rows.join("")}</ul>${ownForecast() ? "" : `<p class="muted tiny">${esc(t("models.rawNote"))}</p>`}</section>`;
}

function lifeHTML(vm, units) {
  const H = vm.H, D = vm.D, i = vm.i, c = vm.city, cards = [];
  let rs = null;
  try { rs = riseSet("sun", vm.today, c.lat, c.lon, c.tz); } catch { /* */ }
  const sr = rs?.alwaysUp ? t("sun.alwaysUp") : rs?.alwaysDown ? t("sun.alwaysDown") : `${clockAt(rs?.rise, c.tz)} / ${clockAt(rs?.set, c.tz)}`;
  cards.push(life("sunrise", t("life.sun"), sr, t("life.sunSub")));
  const uv = H.uv_index?.[i], uvMax = D.uv_index_max?.[vm.di];
  if (uv != null || uvMax != null) cards.push(life("uv", t("life.uv"), `${uv != null ? Math.round(uv) : "–"} · ${t("uv." + (uvLevel(uv ?? uvMax) || "low"))}`, uvMax != null ? t("life.uvMax", { v: Math.round(uvMax) }) : ""));
  const rh = vm.hum, dp = H.dew_point_2m?.[i];
  if (rh != null) cards.push(life("drop", t("life.humidity"), pct(rh), dp != null ? t("life.dew", { v: temp(dp, units) }) : ""));
  const wd = vm.wx.current?.wind_direction_10m ?? H.wind_direction_10m?.[i], g = vm.wx.current?.wind_gusts_10m ?? H.wind_gusts_10m?.[i];
  const dir = compassKey(wd);
  cards.push(life("wind", t("life.wind"), `${wind(vm.windMs, units)}${dir ? " " + t("dir." + dir) : ""}`, g != null ? t("life.gust", { v: wind(g, units) }) : "",
    wd != null ? `<svg class="ico sm wdir" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${(wd + 180) % 360}deg)" aria-hidden="true"><path d="M12 20V4M7 9l5-5 5 5"/></svg>` : ""));
  const vis = H.visibility?.[i];
  if (vis != null) { const km = vis / 1000, fl = fogLevel(km, rh); cards.push(life("eye", t("life.fog"), t("fog." + fl), t("life.vis", { v: km >= 10 ? Math.round(km) : km.toFixed(1) }))); }
  if (vm.air && vm.airG) {
    const a = vm.air;
    cards.push(life("cloud", t("life.air"), `${t("air.grade." + (vm.airG.worst || "good"))}`,
      `PM10 ${a.pm10 != null ? Math.round(a.pm10) : "–"} · PM2.5 ${a.pm25 != null ? Math.round(a.pm25) : "–"} µg/m³ · ${a.src === "airkorea" ? t("air.src.airkorea") + (a.station ? " " + a.station : "") : t("air.src.cams")}`));
  }
  return `<section class="life">${cards.join("")}</section>`;
}
function life(ic, title, value, sub = "", extra = "") {
  return `<div class="life-card"><div class="lf-h">${icon(ic, { cls: "sm" })}<span>${esc(title)}</span></div><div class="lf-v">${esc(value)} ${extra}</div>${sub ? `<div class="lf-s">${esc(sub)}</div>` : ""}</div>`;
}

function dayHTML(vm, ymd, units) {
  const D = vm.D, d = (D.time || []).indexOf(ymd);
  if (d < 0) return `<p class="muted">${esc(t("error.noDay"))}</p>`;
  const from = vm.H.time.indexOf(ymd + "T00:00");
  const start = ymd === vm.today ? vm.i : from;
  const pp = D.precipitation_probability_max?.[d], ps = D.precipitation_sum?.[d];
  const c = vm.city;
  let rs = null;
  try { rs = riseSet("sun", ymd, c.lat, c.lon, c.tz); } catch { /* */ }
  return `<section class="card day-head${isWet(pp, ps) ? " wet" : ""}">
      <div class="dh-top">${icon(iconKey(D.weather_code?.[d], true, (ps || 0) / 10), { cls: "lg" })}<div>
      <div class="dh-date">${esc(dayLabel(ymd, vm.today, lang()))} · ${esc(monthDay(ymd, lang()))}</div>
      <div class="dh-cond">${esc(condText(D.weather_code?.[d]))}</div>
      <div>${esc(t("hilo", { hi: temp(D.temperature_2m_max?.[d], units), lo: temp(D.temperature_2m_min?.[d], units) }))}</div></div></div>
      <div class="dh-rain">${icon("umbrella", { cls: "sm" })} ${esc(pct(pp))} · ${esc(precip(ps ?? 0, units))}</div>
      <div class="muted">${esc(t("sunrise"))} ${esc(clockAt(rs?.rise, c.tz))} · ${esc(t("sunset"))} ${esc(clockAt(rs?.set, c.tz))}</div>
    </section>
    <section class="card"><h3 class="card-h">${esc(t("detail.dayHourly"))}</h3>${from < 0 ? `<p class="muted">${esc(t("error.noDay"))}</p>` : hourCols(vm, Math.max(0, start), from + 24, units)}</section>`;
}

export async function renderDetail(root, ctx, cityId, dayYmd) {
  const city = cityId === "gps" ? await ctx.getGpsCity() : ctx.store.city(cityId);
  const units = ctx.store.get().units;
  if (!city) { root.innerHTML = header(t("detail.title"), { backLabel: t("back") }) + `<p class="pad muted">${esc(t("error.noCity"))}</p>`; return; }
  root.innerHTML = header(cityName(city), { backLabel: t("back"), right: `<span class="ph-src"></span>` }) + `<div class="detail"><div class="spin" aria-hidden="true"></div></div>`;
  const body = root.querySelector(".detail"), src = root.querySelector(".ph-src");
  let res;
  try { res = await getWeather(city); } catch { body.innerHTML = `<p class="pad">${esc(t("error.weather"))}</p>`; return; }
  src.innerHTML = sourceBadge(res);
  let air = null, models = peekModels(city);
  const draw = () => {
    if (!root.isConnected) return;
    const vm = buildVM(city, res, air, models);
    if (dayYmd) { body.innerHTML = dayHTML(vm, dayYmd, units) + dailyHTML(vm, units, city.id) + asPublishedNote(); return; }
    body.innerHTML = mainCardHTML(vm, units, { tappable: false }) +
      `<section class="card"><h3 class="card-h">${esc(t("detail.hourly"))}${res.kmaBase ? ` <small class="muted">${esc(t("detail.kmaNote"))}</small>` : ""}</h3>${hourCols(vm, vm.i, vm.i + 24, units)}</section>` +
      dailyHTML(vm, units, city.id) + (vm.r48?.wet ? rainCardHTML(vm, units) : "") + modelsHTML(vm, units) + lifeHTML(vm, units) + lightCardHTML(vm, units) + asPublishedNote();
  };
  draw();
  getAir(city).then((a) => { air = a; draw(); });
  if (!dayYmd) getModels(city, res.wx).then((m) => {
    models = m; if (m) draw();
    else { const mb = body.querySelector(".models-body"); if (mb) mb.innerHTML = `<span class="muted">${esc(t("models.none"))}</span>`; }
  });
}
export { modelsForConsensus, consensusFor };
