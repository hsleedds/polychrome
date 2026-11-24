/* 출사 탭: 메뉴 + 준비 중 화면 (오로라는 aurora.js) */
import { t, cityName } from "../i18n.js";
import { esc, header } from "./dom.js";
import { icon } from "../icons.js";
import { S, localNow, sunPos } from "../core.js";
import { clockAt, ymdOf } from "../format.js";

export const SHOOT_ITEMS = [
  { key: "forecast", icon: "camera" },
  { key: "line", icon: "line" },
  { key: "dates", icon: "calendar" },
  { key: "silhouette", icon: "silhouette" },
  { key: "view", icon: "mountain" },
  { key: "aurora", icon: "aurora", href: "#/aurora" },
  { key: "drone", icon: "drone" },
  { key: "quake", icon: "volcano" },
];

export function renderShootMenu(root) {
  root.innerHTML = header(t("tab.shoot"), { back: false }) + `<div class="pad"><ul class="menu">${SHOOT_ITEMS.map((it) => `<li><a class="menu-row${it.key === "aurora" ? " live" : ""}" href="${it.href || "#/shoot/" + it.key}">
      <span class="menu-ic">${icon(it.icon, { cls: "md" })}</span><span class="menu-t"><b>${esc(t("shoot." + it.key))}</b><small>${esc(t("shoot." + it.key + ".desc"))}</small></span>
      ${it.key === "aurora" ? "" : `<span class="chip">${esc(t("soon"))}</span>`}${icon("chevron", { cls: "sm" })}</a></li>`).join("")}</ul></div>`;
}

/** 준비 중 화면. 계산 모듈로 바로 보여 줄 수 있는 것만 맛보기로 */
export function renderShootPlaceholder(root, ctx, key) {
  const it = SHOOT_ITEMS.find((x) => x.key === key);
  if (!it) { root.innerHTML = header(t("tab.shoot"), { backLabel: t("back") }) + `<p class="pad muted">${esc(t("error.notFound"))}</p>`; return; }
  let preview = "";
  const city = ctx.store.ordered()[0];
  try {
    const sk = S();
    if (key === "forecast" && sk && city) {
      const ymd = ymdOf(localNow(city.tz));
      const mw = typeof sk.milkyWayWindow === "function" ? sk.milkyWayWindow(ymd, city.lat, city.lon, city.tz) : undefined;
      const sp = sunPos(new Date(), city.lat, city.lon);
      const rows = [];
      if (mw !== undefined) rows.push(`<li>${esc(t("preview.milkyway"))}: <b>${mw ? `${esc(clockAt(mw.start, city.tz))}–${esc(clockAt(mw.end, city.tz))}` : esc(t("preview.none"))}</b>${mw?.moonless ? ` <small class="muted">${esc(t("preview.moonless", { s: clockAt(mw.moonless.start, city.tz), e: clockAt(mw.moonless.end, city.tz) }))}</small>` : ""}</li>`);
      if (typeof sk.rainbowPossible === "function") rows.push(`<li>${esc(t("preview.rainbow"))}: <b>${esc(sk.rainbowPossible(sp.alt) && sp.alt > 0 ? t("preview.rainbowYes") : t("preview.rainbowNo"))}</b></li>`);
      if (rows.length) preview = `<section class="card"><h3 class="card-h">${esc(t("preview.title", { city: cityName(city) }))}</h3><ul class="plain">${rows.join("")}</ul></section>`;
    }
  } catch (e) { console.warn(e); }
  root.innerHTML = header(t("shoot." + key), { backLabel: t("back") }) + `<div class="pad">
    <section class="card soon-card"><div class="soon-ic">${icon(it.icon, { cls: "xl" })}</div><p>${esc(t("shoot." + key + ".desc"))}</p><span class="chip">${esc(t("soon"))}</span></section>${preview}</div>`;
}
