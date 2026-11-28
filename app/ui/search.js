/* 지역 추가 (날씨 도시 / 오로라 도시) */
import { searchRegions } from "../data/regions-kr.js";
import { geocode } from "../data.js";
import { t, lang } from "../i18n.js";
import { esc, header, toast } from "./dom.js";
import { icon } from "../icons.js";
import { MAX_CITIES } from "../config.js";

export function renderSearch(root, ctx, mode = "weather") {
  const aur = mode === "aurora";
  // 지역 추가에서 그냥 나가면 메인 도시 장으로 돌아가게 (「지역 추가」 장에 머물지 않도록)
  if (!aur) ctx.pagerIdx = null;
  // 왼쪽 뒤로 버튼과 함께, 눈에 잘 띄는 「취소」 글자 버튼도 오른쪽에 둠
  const cancelBtn = `<button class="text-btn" data-act="back">${esc(t("cancel"))}</button>`;
  root.innerHTML = header(aur ? t("aurora.addCity") : t("city.add"), { backLabel: t("back"), right: cancelBtn }) + `
    <div class="search pad">
      <label class="search-box">${icon("search", { cls: "sm" })}<input type="search" id="q" autocomplete="off" enterkeyhint="search" placeholder="${esc(t(aur ? "search.placeholderWorld" : "search.placeholder"))}" aria-label="${esc(t("search.label"))}"></label>
      ${!aur && !ctx.store.canAdd() ? `<p class="notice">${esc(t("city.full", { n: MAX_CITIES }))}</p>` : ""}
      <ul class="results" aria-live="polite"></ul>
      <p class="muted tiny">${esc(t("search.hint"))}</p>
    </div>`;
  const q = root.querySelector("#q"), ul = root.querySelector(".results");
  let items = [], seq = 0, tm = 0;
  const L = lang();
  const row = (r, k) => `<li><button class="result" data-k="${k}"><span class="r-n">${esc(L === "en" ? r.name_en : r.name_ko)}</span><span class="r-s muted">${esc(r.sub || (r.country === "KR" ? (L === "en" ? "Korea" : "대한민국") : ""))}</span></button></li>`;
  const draw = (local, remote, loading) => {
    items = [...local, ...remote];
    ul.innerHTML = items.map(row).join("") + (loading ? `<li class="muted"><span class="spin sm" aria-hidden="true"></span> ${esc(t("search.searching"))}</li>` : "") +
      (!loading && !items.length && q.value.trim() ? `<li class="muted">${esc(t("search.none"))}</li>` : "");
  };
  q.addEventListener("input", () => {
    const v = q.value.trim(), my = ++seq;
    const local = aur ? [] : searchRegions(v, 12);
    clearTimeout(tm);
    if (v.length < 2) { draw(local, [], false); return; }
    draw(local, [], true);
    tm = setTimeout(async () => {
      const g = await geocode(v, L);
      if (my !== seq) return;
      // 한국 목록과 겹치는 지오코딩 결과(같은 좌표 근처)는 뺌
      const remote = g.filter((x) => !local.some((l) => Math.abs(l.lat - x.lat) < 0.05 && Math.abs(l.lon - x.lon) < 0.05))
        .map((x) => ({ ...x, sub: L === "en" ? x.sub_en : x.sub_ko }));
      draw(local, remote, false);
    }, 380);
  });
  ul.addEventListener("click", (e) => {
    const b = e.target.closest("[data-k]"); if (!b) return;
    const r = items[+b.dataset.k];
    const c = { id: r.id, name_ko: r.name_ko, name_en: r.name_en, lat: r.lat, lon: r.lon, tz: r.tz, country: r.country };
    const res = aur ? ctx.store.addAurora(c) : ctx.store.addCity(c);
    const nm = L === "en" ? c.name_en : c.name_ko;
    if (res === "ok") { toast(t("city.added", { city: nm })); if (!aur) ctx.pagerIdx = null; ctx.back(); }
    else toast(t("city.err." + res, { n: MAX_CITIES }));
  });
  setTimeout(() => q.focus(), 50);
}
