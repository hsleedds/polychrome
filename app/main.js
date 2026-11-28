/* Polychrome 앱 진입점: 설정 → 상태 → 문구 → 스위치 → 주소(#) 라우터 */
import { SB_URL, SB_KEY } from "./config.js";
import { createStore, safeStorage } from "./state.js";
import { setLang, t } from "./i18n.js";
import { loadFlags, flag, verifyAdmin, setSourcePref } from "./data.js";
import { W } from "./core.js";
import { renderWeather } from "./ui/weather.js";
import { renderDetail } from "./ui/detail.js";
import { renderSearch } from "./ui/search.js";
import { renderSettings } from "./ui/settings.js";
import { renderShootMenu, renderShootPlaceholder } from "./ui/shoot.js";
import { renderAuroraList, renderAuroraDetail } from "./ui/aurora.js";
import { renderSilhouette } from "./ui/silhouette.js";
import { renderAccuracy } from "./ui/admin.js";
import { toast } from "./ui/dom.js";
import { icon } from "./icons.js";

const store = createStore(safeStorage(typeof localStorage !== "undefined" ? localStorage : null), navigator.language);
// SPEC 12 예보 출처: 설정이 바뀌면 데이터 계층에 바로 반영 (캐시 키에 출처 서명이 들어가 새로 불러옴)
setSourcePref(store.get().fsrc);
store.subscribe((s) => setSourcePref(s.fsrc));

// WeatherCore 설정 (기상청 함수는 스위치 kma로)
try { W()?.config?.({ kma: () => flag("kma"), sbUrl: () => SB_URL, sbKey: () => SB_KEY }); } catch (e) { console.warn(e); }

/* ---------- 관리자 위치(GPS) ---------- */
let gpsP = null;
function getGpsCity() {
  if (gpsP) return gpsP;
  gpsP = new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => {
      const lat = Math.round(p.coords.latitude * 1000) / 1000, lon = Math.round(p.coords.longitude * 1000) / 1000;
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul";
      const kr = lat > 33 && lat < 38.7 && lon > 124.5 && lon < 131;
      resolve({ id: "gps", name_ko: "내 위치", name_en: "My location", lat, lon, tz, country: kr ? "KR" : "" });
    }, () => { gpsP = null; resolve(null); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60e3 });
  });
  return gpsP;
}

/* ---------- 라우터 ---------- */
const stack = [];
const screen = document.getElementById("screen");
const ctx = {
  store, pagerIdx: null,
  isAdmin: () => !!store.get().admin,
  gpsEnabled: () => !!store.get().admin || flag("gps_public"),
  getGpsCity,
  go: (h) => { location.hash = h; },
  back() {
    if (stack.length > 1) history.back();
    else { const parts = route().parts; location.hash = parts[0] === "aurora" && parts[1] ? "#/aurora" : parts[0] === "aurora" || parts[0] === "shoot" ? "#/shoot" : parts[0] === "accuracy" ? "#/settings" : "#/weather"; }
  },
  rerender: () => render(),
  async applyLang() { await setLang(store.get().lang); paintNav(); },
};

function route() {
  const h = (location.hash || "#/weather").replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean).map(decodeURIComponent);
  return { parts, tab: ["shoot", "aurora"].includes(parts[0]) ? "shoot" : ["settings", "accuracy"].includes(parts[0]) ? "settings" : "weather" };
}

function paintNav() {
  const nav = document.getElementById("tabs");
  const tab = route().tab;
  const items = [["weather", "cloud"], ["shoot", "camera"], ["settings", "settings"]];
  nav.setAttribute("aria-label", t("a11y.tabs"));
  nav.innerHTML = items.map(([k, ic]) => `<a href="#/${k}" class="${tab === k ? "on" : ""}" ${tab === k ? 'aria-current="page"' : ""}>${icon(ic, { cls: "md" })}<span>${t("tab." + k)}</span></a>`).join("");
  document.title = t("app.title");
}

let renderSeq = 0;
function render() {
  const { parts } = route();
  const my = ++renderSeq;
  const el = document.createElement("div");
  el.className = "screen-inner";
  screen.replaceChildren(el);
  const top = parts[0] || "weather";
  document.body.dataset.screen = top === "weather" ? (store.get().layout === "A" ? "weather-a" : "weather") : "sub";
  paintNav();
  try {
    if (top === "weather") renderWeather(el, ctx);
    else if (top === "city" && parts[1]) renderDetail(el, ctx, parts[1], parts[2] === "day" ? parts[3] : null);
    else if (top === "add") renderSearch(el, ctx, parts[1] === "aurora" ? "aurora" : "weather");
    else if (top === "settings") renderSettings(el, ctx);
    else if (top === "shoot" && parts[1] === "silhouette") renderSilhouette(el, ctx);
    else if (top === "shoot" && parts[1]) renderShootPlaceholder(el, ctx, parts[1]);
    else if (top === "shoot") renderShootMenu(el, ctx);
    else if (top === "aurora" && parts[1]) renderAuroraDetail(el, ctx, parts[1]);
    else if (top === "aurora") renderAuroraList(el, ctx);
    else if (top === "accuracy") renderAccuracy(el, ctx);
    else { location.replace("#/weather"); return; }
  } catch (e) {
    console.error(e);
    el.innerHTML = `<p class="pad">${t("error.render")}</p>`;
  }
  if (my === renderSeq && top !== "weather") window.scrollTo(0, 0);
  el.querySelector("h1")?.setAttribute("tabindex", "-1");
}

window.addEventListener("hashchange", () => {
  const h = location.hash;
  if (stack.length > 1 && stack[stack.length - 2] === h) stack.pop(); else stack.push(h);
  render();
});

/* 탭 이동·뒤로·카드 탭 (전역 위임) */
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act=back]");
  if (b) { e.preventDefault(); ctx.back(); return; }
  const l = e.target.closest("[data-href]");
  if (l && !e.target.closest("a,button")) { location.hash = l.dataset.href; }
});
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[data-href]")) { e.preventDefault(); location.hash = e.target.dataset.href; }
});

/* ---------- 시작 ---------- */
async function boot() {
  await setLang(store.get().lang);
  // 관리자 토큰: 주소에서 바로 지우고 서버 확인
  const sp = new URLSearchParams(location.search);
  const token = sp.get("admin");
  if (token) {
    sp.delete("admin");
    const q = sp.toString();
    history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
    verifyAdmin(token).then((a) => {
      if (a) { store.setAdmin(a); toast(t("admin.verified")); ctx.pagerIdx = null; render(); }
      else toast(t("admin.failed"));
    });
  }
  await Promise.race([loadFlags(), new Promise((r) => setTimeout(r, 1500))]);
  stack.push(location.hash || "#/weather");
  if (!location.hash) history.replaceState(null, "", location.pathname + location.search + "#/weather");
  render();
  if (!W()) toast(t("error.core"));
  // 오래 켜 둔 화면: 15분마다 날씨 탭 다시 그리기
  setInterval(() => { if (route().tab === "weather" && document.visibilityState === "visible" && route().parts[0] !== "add") render(); }, 15 * 60e3);
}
boot();
