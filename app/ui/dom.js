/* 작은 DOM 도우미 */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** 화면 위쪽 머리줄 (뒤로 가기 + 제목) */
export function header(title, { back = true, right = "", backLabel = "뒤로" } = {}) {
  return `<header class="topbar">${back ? `<button class="icon-btn" data-act="back" aria-label="${esc(backLabel)}">${BACK}</button>` : "<span class=\"sp\"></span>"}<h1>${esc(title)}</h1>${right || '<span class="sp"></span>'}</header>`;
}
const BACK = `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>`;

let toastT = 0;
export function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); document.body.appendChild(el); }
  el.textContent = msg; el.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("on"), 2600);
}

/** 아래에서 올라오는 선택 메뉴. items: [{label, value, danger}] → Promise<value|null> */
export function actionSheet(title, items, cancelLabel = "취소") {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "sheet-wrap";
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-title">${esc(title)}</div>${items.map((it, i) => `<button class="sheet-btn${it.danger ? " danger" : ""}" data-i="${i}">${esc(it.label)}</button>`).join("")}<button class="sheet-btn cancel" data-i="-1">${esc(cancelLabel)}</button></div>`;
    const done = (v) => { wrap.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") done(null); };
    wrap.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (b) done(+b.dataset.i >= 0 ? items[+b.dataset.i].value : null);
      else if (e.target === wrap) done(null);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(wrap);
    wrap.querySelector(".sheet-btn")?.focus();
  });
}

/** 길게 누르기 (pointer). 짧은 탭은 그대로 click으로 처리됨 */
export function onLongPress(root, selector, fn, ms = 550) {
  let tm = 0, start = null, fired = false;
  root.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(selector); if (!el) return;
    fired = false; start = [e.clientX, e.clientY];
    tm = setTimeout(() => { fired = true; fn(el); }, ms);
  });
  const cancel = () => clearTimeout(tm);
  root.addEventListener("pointerup", cancel);
  root.addEventListener("pointercancel", cancel);
  root.addEventListener("pointermove", (e) => { if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 10) cancel(); });
  // 길게 누른 뒤 따라오는 click은 막음
  root.addEventListener("click", (e) => { if (fired && e.target.closest(selector)) { e.preventDefault(); e.stopPropagation(); fired = false; } }, true);
  root.addEventListener("contextmenu", (e) => { const el = e.target.closest(selector); if (el) { e.preventDefault(); if (!fired) fn(el); } });
}
