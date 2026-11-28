/* 설정: 내 지역 · 화면 구성 · 언어 · 단위 · 출처 · 관리자 상태 */
import { t, cityName } from "../i18n.js";
import { esc, header, toast, actionSheet } from "./dom.js";
import { icon } from "../icons.js";
import { ATTRIBUTION, APP_VERSION, MAX_CITIES } from "../config.js";
import { allFlags, flag } from "../data.js";
import { PRESETS, TIER_OPTIONS, ONE_MODEL_OPTIONS, NOT_READY, isKmaKey, isLocked, effectivePreset, sanitizeFsrc } from "../sources.js";
import { coreInfo } from "../core.js";

const seg = (name, val, opts) => `<div class="seg" role="radiogroup" aria-label="${esc(t("set." + name))}">${opts.map(([v, label]) => `<button role="radio" aria-checked="${v === val}" class="${v === val ? "on" : ""}" data-set="${name}" data-v="${v}">${esc(label)}</button>`).join("")}</div>`;

/* ---- SPEC 12 예보 출처 ---- */
const optLabel = (k) => {
  const name = t("fsrc.name." + k);
  if (NOT_READY.includes(k)) return t("fsrc.opt.notReady", { name });
  if (isKmaKey(k)) return t("fsrc.opt.krOnly", { name });
  return t.has("fsrc.desc." + k) ? t("fsrc.opt.model", { name, desc: t("fsrc.desc." + k) }) : name;
};
const selectHTML = (attr, opts, val, label) => `<select ${attr} aria-label="${esc(label)}">${opts.map((k) => `<option value="${esc(k)}"${k === val ? " selected" : ""}${NOT_READY.includes(k) ? " disabled" : ""}>${esc(optLabel(k))}</option>`).join("")}</select>`;

/** 설정 → 예보 출처 카드 (순수 HTML). gate: pro_gate 스위치 */
export function fsrcSectionHTML(fsrcRaw, gate) {
  const f = sanitizeFsrc(fsrcRaw), eff = effectivePreset(f, gate);
  const rows = PRESETS.map((p) => {
    const locked = isLocked(p, gate), on = eff === p;
    const badge = locked ? ` <span class="pro-badge">${icon("lock", { cls: "sm" })}Pro</span>` : "";
    let extra = "";
    if (on && p === "one-model") extra = `<div class="fsrc-sel"><label class="fsrc-row"><span>${esc(t("fsrc.model"))}</span>${selectHTML('data-fsrc="model"', ONE_MODEL_OPTIONS, f.model, t("fsrc.model"))}</label></div>`;
    if (on && p === "custom") extra = `<div class="fsrc-sel">${["now", "short", "mid"].map((id) => `<label class="fsrc-row"><span>${esc(t("fsrc.tier." + id))}</span>${selectHTML(`data-fsrc-tier="${id}"`, TIER_OPTIONS[id], f.tiers[id], t("fsrc.tier." + id))}</label>`).join("")}</div>`;
    return `<div class="fsrc-opt${on ? " on" : ""}${locked ? " locked" : ""}"><label class="fsrc-pick"><input type="radio" name="fsrc-preset" value="${p}"${on ? " checked" : ""}${locked ? ' disabled aria-disabled="true"' : ""}>
      <span class="fo-body"><span class="fo-title">${esc(t("fsrc.preset." + p))}${badge}</span><small class="muted">${esc(t("fsrc.preset." + p + ".desc"))}</small></span></label>${extra}</div>`;
  }).join("");
  const gated = gate && isLocked(f.preset, gate) ? `<p class="fsrc-gate tiny">${icon("lock", { cls: "sm" })} ${esc(t("fsrc.gateNote", { preset: t("fsrc.preset." + f.preset) }))}</p>` : "";
  return `<section class="card fsrc"><h3 class="card-h" id="fsrc-h">${esc(t("fsrc.title"))}</h3>
    <p class="muted tiny">${esc(t("fsrc.intro"))}</p>
    <div class="fsrc-opts" role="radiogroup" aria-labelledby="fsrc-h">${rows}</div>${gated}
    <p class="muted tiny">${esc(t("fsrc.krNote"))}</p></section>`;
}

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
    ${fsrcSectionHTML(s.fsrc, flag("pro_gate"))}
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

  // 예보 출처: 카드만 다시 그림 (화면 전체를 다시 그리면 맨 위로 올라감)
  root.addEventListener("change", (e) => {
    const el = e.target;
    let o = null;
    if (el.name === "fsrc-preset") o = { preset: el.value };
    else if (el.dataset?.fsrc === "model") o = { model: el.value };
    else if (el.dataset?.fsrcTier) o = { tiers: { [el.dataset.fsrcTier]: el.value } };
    if (!o) return;
    ctx.store.setForecastSource(o);
    const sec = root.querySelector(".fsrc");
    if (sec) sec.outerHTML = fsrcSectionHTML(ctx.store.get().fsrc, flag("pro_gate"));
    toast(t("fsrc.saved"));
  });
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
