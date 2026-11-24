/* 설정: 내 지역 · 화면 구성 · 언어 · 단위 · 출처 · 관리자 상태 */
import { t, cityName } from "../i18n.js";
import { esc, header, toast, actionSheet } from "./dom.js";
import { icon } from "../icons.js";
import { ATTRIBUTION, APP_VERSION, MAX_CITIES } from "../config.js";
import { allFlags } from "../data.js";
import { coreInfo } from "../core.js";

const seg = (name, val, opts) => `<div class="seg" role="radiogroup" aria-label="${esc(t("set." + name))}">${opts.map(([v, label]) => `<button role="radio" aria-checked="${v === val}" class="${v === val ? "on" : ""}" data-set="${name}" data-v="${v}">${esc(label)}</button>`).join("")}</div>`;

export function renderSettings(root, ctx) {
  const s = ctx.store.get();
  const cities = s.cities;
  const ci = coreInfo();
  const flags = allFlags();
  root.innerHTML = header(t("tab.settings"), { back: false }) + `<div class="settings pad">
    <section class="card"><h3 class="card-h">${esc(t("set.cities"))} <small class="muted">${cities.length}/${MAX_CITIES}</small></h3>
      <ul class="city-list">${cities.map((c, k) => `<li data-id="${esc(c.id)}">
        <button class="icon-btn star-btn${c.id === s.mainId ? " on" : ""}" data-a="main" aria-pressed="${c.id === s.mainId}" aria-label="${esc(t("city.setMain"))}: ${esc(cityName(c))}">${icon("star", { cls: "sm" })}</button>
        <span class="cl-n">${esc(cityName(c))}<small class="muted">${esc(c.tz)}</small></span>
        <button class="icon-btn" data-a="up" ${k === 0 ? "disabled" : ""} aria-label="${esc(t("set.moveUp"))}">${icon("up", { cls: "sm" })}</button>
        <button class="icon-btn" data-a="down" ${k === cities.length - 1 ? "disabled" : ""} aria-label="${esc(t("set.moveDown"))}">${icon("down", { cls: "sm" })}</button>
        <button class="icon-btn" data-a="del" ${cities.length <= 1 ? "disabled" : ""} aria-label="${esc(t("city.remove"))}: ${esc(cityName(c))}">${icon("trash", { cls: "sm" })}</button></li>`).join("")}</ul>
      ${cities.length < MAX_CITIES ? `<a class="btn ghost" href="#/add">${icon("plus", { cls: "sm" })} ${esc(t("city.add"))}</a>` : ""}
    </section>
    <section class="card"><h3 class="card-h">${esc(t("set.layout"))}</h3>${seg("layout", s.layout, [["B", t("set.layoutB")], ["A", t("set.layoutA")]])}<p class="muted tiny">${esc(t("set.layoutHint"))}</p></section>
    <section class="card"><h3 class="card-h">${esc(t("set.lang"))}</h3>${seg("lang", s.lang, [["ko", "한국어"], ["en", "English"]])}</section>
    <section class="card"><h3 class="card-h">${esc(t("set.units"))}</h3>${seg("units", s.units, [["metric", "°C · mm · m/s"], ["imperial", "°F · in · mph"]])}</section>
    <section class="card"><h3 class="card-h">${esc(t("set.attribution"))}</h3><ul class="attr">${ATTRIBUTION.map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(t("attr." + a.key))}</a><small class="muted">${esc(t("attr." + a.key + ".note"))}</small></li>`).join("")}</ul></section>
    <section class="card"><h3 class="card-h">${esc(t("set.admin"))}</h3>
      ${s.admin ? `<p>${esc(t("admin.on"))}</p><div class="row-btns"><a class="btn ghost" href="#/accuracy">${icon("chart", { cls: "sm" })} ${esc(t("admin.accuracy"))}</a><button class="btn ghost" data-a="adminOff">${esc(t("admin.off"))}</button></div>
        <details><summary>${esc(t("admin.flags"))}</summary><ul class="flags">${Object.entries(flags).map(([k, v]) => `<li><code>${esc(k)}</code> <b class="${v ? "on" : "off"}">${v ? "ON" : "off"}</b></li>`).join("")}</ul></details>`
        : `<p class="muted">${esc(t("admin.offState"))}</p>`}
    </section>
    <p class="muted tiny center">Polychrome ${esc(APP_VERSION)} · weather-core ${esc(ci.weather || "–")} · sky-core ${esc(ci.sky || "–")}<br>© 2026 HYEOKSANG LEE</p>
  </div>`;

  root.addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    if (b.dataset.set) {
      const k = b.dataset.set, v = b.dataset.v;
      if (k === "layout") ctx.store.setLayout(v);
      if (k === "units") ctx.store.setUnits(v);
      if (k === "lang") { ctx.store.setLang(v); await ctx.applyLang(); }
      ctx.pagerIdx = null;
      ctx.rerender();
      return;
    }
    const li = b.closest("li[data-id]"), id = li?.dataset.id, a = b.dataset.a;
    if (a === "main") { ctx.store.setMain(id); ctx.pagerIdx = null; ctx.rerender(); }
    if (a === "up") { ctx.store.moveCity(id, -1); ctx.rerender(); }
    if (a === "down") { ctx.store.moveCity(id, 1); ctx.rerender(); }
    if (a === "del") {
      const c = ctx.store.city(id);
      const ok = await actionSheet(t("city.removeQ", { city: cityName(c) }), [{ label: t("city.remove"), value: true, danger: true }], t("cancel"));
      if (ok && ctx.store.removeCity(id)) { toast(t("city.removed", { city: cityName(c) })); ctx.pagerIdx = null; ctx.rerender(); }
    }
    if (a === "adminOff") { ctx.store.setAdmin(null); toast(t("admin.offDone")); ctx.rerender(); }
  });
}
