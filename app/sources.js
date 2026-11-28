/* SPEC 12 — 사용자 선택 예보 출처 (순수 모듈: 화면·네트워크 없음)
 * 구간: now(지금~6시간) · short(6시간~3일 = 글피까지) · mid(4~10일).
 * 출처 키: kma_ultra · kma_vilage · kma_mid(준비 중) · om(Open-Meteo 자동 = best match, 대체 시 met) · 모델 키.
 * Open-Meteo 모델 id는 server/functions/collect(2026-11 문서 기준) 값을 먼저, core compareModels 값을 대체로 쓴다. */

export const TIERS = Object.freeze([
  { id: "now", toH: 6 },     // 지금(시 단위 내림)부터 6시간
  { id: "short", toDay: 4 }, // 오늘+4일 0시 전까지 (내일·모레·글피)
  { id: "mid" },             // 그 뒤 끝까지 (4~10일)
]);

/** 해외 모델: key → Open-Meteo models 값 후보(앞에서부터 시도) */
export const MODELS = Object.freeze({
  ecmwf: ["ecmwf_ifs", "ecmwf_ifs025"],
  gfs: ["ncep_gfs_seamless", "gfs_seamless"],
  icon: ["dwd_icon_seamless", "icon_seamless"],
  jma: ["jma_seamless"],
  ukmo: ["ukmo_seamless"],
  meteofrance: ["meteofrance_seamless"],
  gem: ["cmc_gem_seamless", "gem_seamless"],
});
export const MODEL_KEYS = Object.freeze(Object.keys(MODELS));
export const KMA_KEYS = Object.freeze(["kma_ultra", "kma_vilage", "kma_mid"]);
/** 아직 쓸 수 없는 출처 (기상청 중기예보: 활용신청·서버 함수 필요) */
export const NOT_READY = Object.freeze(["kma_mid"]);
export const isKmaKey = (k) => KMA_KEYS.includes(k);

/** 구간별 선택지 (설정 화면 순서) */
export const TIER_OPTIONS = Object.freeze({
  now: ["kma_ultra", "kma_vilage", "om", ...MODEL_KEYS],
  short: ["kma_vilage", "om", ...MODEL_KEYS],
  mid: ["kma_mid", "om", ...MODEL_KEYS],
});
export const ONE_MODEL_OPTIONS = Object.freeze(["om", ...MODEL_KEYS]);

export const PRESETS = Object.freeze(["kma-first", "one-model", "custom"]);
/** Pro 전용 간편 선택 (pro_gate 켜졌을 때 잠김) */
export const PRO_PRESETS = Object.freeze(["one-model", "custom"]);

export const DEFAULT_FSRC = Object.freeze({
  preset: "kma-first",
  model: "ecmwf",
  tiers: Object.freeze({ now: "kma_ultra", short: "kma_vilage", mid: "om" }),
});

/** 저장된 값 검증 */
export function sanitizeFsrc(raw) {
  const d = DEFAULT_FSRC;
  const o = { preset: d.preset, model: d.model, tiers: { ...d.tiers } };
  if (!raw || typeof raw !== "object") return o;
  if (PRESETS.includes(raw.preset)) o.preset = raw.preset;
  if (ONE_MODEL_OPTIONS.includes(raw.model)) o.model = raw.model;
  const t = raw.tiers && typeof raw.tiers === "object" ? raw.tiers : {};
  for (const id of ["now", "short", "mid"]) if (TIER_OPTIONS[id].includes(t[id]) && !NOT_READY.includes(t[id])) o.tiers[id] = t[id];
  return o;
}

/** pro_gate가 켜져 있으면 Pro 간편 선택은 기상청 우선으로 */
export function effectivePreset(fsrc, gate) {
  const p = sanitizeFsrc(fsrc).preset;
  return gate && PRO_PRESETS.includes(p) ? "kma-first" : p;
}
export const isLocked = (preset, gate) => !!gate && PRO_PRESETS.includes(preset);

/** 고른 출처 → 후보 목록 (빈 시간은 다음 후보). base: 'om' 또는 MET 대체 시 'met' */
function chain(k, base) {
  if (k === "kma_ultra") return ["kma_ultra", "kma_vilage", base];
  if (k === "kma_vilage") return ["kma_vilage", "kma_ultra", base];
  if (k === "om" || k === "met") return [base];
  return [k, base];
}

/**
 * 설정 → stitchBySource 구간 목록.
 * kr: 한국 도시이고 기상청 자료를 쓸 수 있을 때. 해외 도시의 기상청 선택은 현지 기관 우선(Open-Meteo 자동)으로 바뀐다.
 * 반환: [{id, toH?, toDay?, choice, sources:[…]}] (choice = 그 구간에 실제로 적용된 첫 출처)
 */
export function resolveTiers(fsrc, { kr = false, gate = false, base = "om" } = {}) {
  const f = sanitizeFsrc(fsrc);
  const preset = effectivePreset(f, gate);
  let pick;
  if (preset === "one-model") pick = { now: f.model, short: f.model, mid: f.model };
  else if (preset === "custom") pick = { ...f.tiers };
  else pick = kr ? { now: "kma_ultra", short: "kma_vilage", mid: "om" } : { now: "om", short: "om", mid: "om" };
  return TIERS.map((t) => {
    let c = pick[t.id];
    if (NOT_READY.includes(c)) c = "om";
    if (isKmaKey(c) && !kr) c = "om";
    if (c === "om") c = base;
    return { ...t, choice: c, sources: chain(c, base) };
  });
}

/** 불러와야 할 출처 (base는 항상) */
export function neededSources(tiers) {
  const need = { kma: false, models: [] };
  for (const t of tiers) for (const k of [t.choice]) {
    if (isKmaKey(k)) need.kma = true;
    if (MODELS[k] && !need.models.includes(k)) need.models.push(k);
  }
  return need;
}

/** 캐시 키에 붙일 짧은 서명 */
export const tiersSig = (tiers) => tiers.map((t) => t.choice).join(",");

/** kma 함수 응답 → 초단기/단기 시리즈 ({hourly, daily}). hourly.src[]가 'ultra'|'vilage' */
export function kmaSeries(k) {
  if (!k || !k.hourly || !Array.isArray(k.hourly.time)) return {};
  const H = k.hourly, F = ["temperature_2m", "precipitation_probability", "precipitation", "wind_speed_10m", "relative_humidity_2m", "weather_code"];
  const pick = (which) => {
    const o = { time: H.time.slice() };
    for (const f of F) o[f] = H.time.map((_, i) => ((H.src?.[i] || "vilage") === which ? H[f]?.[i] ?? null : null));
    return o;
  };
  // 날별: 기상청 전체(초단기+단기) 시간별로, 12시간 이상 있는 날만 (kmaOverlay와 같은 기준)
  const days = new Map();
  H.time.forEach((t, i) => { const d = t.slice(0, 10); (days.get(d) || days.set(d, []).get(d)).push(i); });
  const D = { time: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [], precipitation_probability_max: [], weather_code: [], wind_speed_10m_max: [] };
  for (const [d, ii] of days) {
    const v = (f) => ii.map((i) => H[f]?.[i]).filter((x) => x != null);
    const T = v("temperature_2m");
    if (ii.length < 12 || !T.length) continue;
    const P = v("precipitation_probability"), R = v("precipitation"), W = v("wind_speed_10m");
    const C = ii.filter((i) => { const h = +H.time[i].slice(11, 13); return h >= 6 && h <= 19; }).map((i) => H.weather_code?.[i]).filter((x) => x != null);
    D.time.push(d); D.temperature_2m_max.push(Math.max(...T)); D.temperature_2m_min.push(Math.min(...T));
    D.precipitation_sum.push(R.length ? Math.round(R.reduce((a, b) => a + b, 0) * 10) / 10 : null);
    D.precipitation_probability_max.push(P.length ? Math.max(...P) : null);
    D.weather_code.push(C.length ? Math.max(...C) : null);
    D.wind_speed_10m_max.push(W.length ? Math.max(...W) : null);
  }
  const daily = D.time.length ? D : undefined;
  const has = (which) => (H.src || []).some((s) => (s || "vilage") === which);
  const out = {};
  if (has("ultra")) out.kma_ultra = { hourly: pick("ultra"), daily };
  if (has("vilage")) out.kma_vilage = { hourly: pick("vilage"), daily };
  return out;
}

/** 시간별 범위 [from, to)의 출처를 바뀌는 순서대로 (같은 출처 연속은 하나로) */
export function srcRuns(srcArr, from, to) {
  const out = [];
  if (!Array.isArray(srcArr)) return out;
  for (let j = Math.max(0, from); j < to && j < srcArr.length; j++) {
    const s = srcArr[j];
    if (s == null) continue;
    if (!out.length || out[out.length - 1].src !== s) out.push({ src: s, i: j });
  }
  return out;
}
