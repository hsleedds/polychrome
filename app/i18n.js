/* 문구: app/i18n/{ko,en}.json (평평한 키 "summary.rain.start" 형태) */

/** "{time}부터 비" + {time:"오후 3시"} → 문자열. 값이 없는 자리 표시가 있으면 null */
export function interp(tpl, vars = {}, strict = false) {
  if (typeof tpl !== "string") return null;
  let missing = false;
  const out = tpl.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    if (v == null || v === "") { missing = true; return ""; }
    return String(v);
  });
  return strict && missing ? null : out;
}

/** 사전 → t(key, vars). 없는 키는 보조 사전 → 키 그대로 */
export function makeT(dict, fallback = {}) {
  const t = (key, vars) => {
    const tpl = dict[key] ?? fallback[key];
    if (tpl == null) return key;
    return interp(tpl, vars) ?? key;
  };
  t.has = (key) => key in dict || key in fallback;
  /** 값이 모두 있을 때만 문장. 비면 key+"_short" 변형을 시도 */
  t.strict = (key, vars) => {
    const tpl = dict[key] ?? fallback[key];
    const s = interp(tpl, vars, true);
    if (s != null) return s;
    const tpl2 = dict[key + "_short"] ?? fallback[key + "_short"];
    return tpl2 != null ? interp(tpl2, vars) : null;
  };
  return t;
}

let current = makeT({});
let currentLang = "ko";
export const t = (k, v) => current(k, v);
t.has = (k) => current.has(k);
t.strict = (k, v) => current.strict(k, v);
export const lang = () => currentLang;

const loaded = {};
async function fetchDict(l) {
  if (loaded[l]) return loaded[l];
  try {
    const r = await fetch(new URL(`./i18n/${l}.json`, import.meta.url));
    loaded[l] = r.ok ? await r.json() : {};
  } catch { loaded[l] = {}; }
  return loaded[l];
}
export async function setLang(l) {
  currentLang = l === "en" ? "en" : "ko";
  const [d, ko] = await Promise.all([fetchDict(currentLang), fetchDict("ko")]);
  current = makeT(d, currentLang === "ko" ? {} : ko);
  if (typeof document !== "undefined") document.documentElement.lang = currentLang;
}
/** 도시 이름 */
export const cityName = (c) => (c ? (currentLang === "en" ? c.name_en || c.name_ko : c.name_ko || c.name_en) : "");
