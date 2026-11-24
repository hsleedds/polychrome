/* Polychrome 선 아이콘 (24×24, 선 1.75px, 둥근 끝). 일부 UI 모양은 Tabler Icons(MIT) 기반.
 * app/icons/<key>.svg 파일은 이 표에서 생성된 사본(test/app-icons.test.mjs --write).
 * class: c-sun(금빛) c-rain(파랑) c-snow(하늘) c-bolt(주황) c-moon — 메인 카드(.accent)에서만 색이 들어감.
 * class occ: 뒤 모양을 가리는 채움(--occ 변수, 기본 투명). */

const SUN_RAYS = "M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.64 5.64l1.55 1.55M16.81 16.81l1.55 1.55M5.64 18.36l1.55-1.55M16.81 7.19l1.55-1.55";
const CLOUD = "M6.5 19a4 4 0 0 1-.6-7.96A6 6 0 0 1 17.4 9.6a4.75 4.75 0 0 1 .1 9.4z";
const CLOUD_UP = "M6.5 15a4 4 0 0 1-.6-7.96A6 6 0 0 1 17.4 5.6a4.75 4.75 0 0 1 .1 9.4z";
const CLOUD_SMALL = "M10.5 20a3.3 3.3 0 0 1-.5-6.57A5 5 0 0 1 18.7 12.3a3.9 3.9 0 0 1-.2 7.7z";
const MOON = "M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z";
const SMALL_SUN = `<circle class="c-sun" cx="9" cy="9" r="3"/><path class="c-sun" d="M9 4.4V2.7M4.4 9H2.7M5.75 5.75 4.55 4.55M12.25 5.75l1.2-1.2M5.75 12.25l-1.2 1.2"/>`;
const SMALL_MOON = `<g transform="translate(1.6 1.4) scale(.56)"><path class="c-moon" vector-effect="non-scaling-stroke" d="${MOON}"/></g>`;
const SHOWER_SUN = `<circle class="c-sun" cx="17" cy="6.5" r="2.6"/><path class="c-sun" d="M17 1.9v.9M21.6 6.5h-.9M20.25 3.25l-.65.65"/>`;
const SHOWER_MOON = `<g transform="translate(11.2 .6) scale(.5)"><path class="c-moon" vector-effect="non-scaling-stroke" d="${MOON}"/></g>`;
const occCloudUp = `<path class="occ" d="${CLOUD_UP}"/>`;

export const ICONS = {
  "clear-day": `<circle class="c-sun" cx="12" cy="12" r="4"/><path class="c-sun" d="${SUN_RAYS}"/>`,
  "clear-night": `<path class="c-moon" d="${MOON}"/>`,
  "partly-day": `${SMALL_SUN}<path class="occ" d="${CLOUD_SMALL}"/>`,
  "partly-night": `${SMALL_MOON}<path class="occ" d="${CLOUD_SMALL}"/>`,
  cloudy: `<path d="${CLOUD}"/>`,
  fog: `<path d="${CLOUD_UP}"/><path d="M4.5 18.5h15M7 21.5h10"/>`,
  drizzle: `<path d="${CLOUD_UP}"/><path class="c-rain" d="M8 18.5v.01M12 18.5v.01M16 18.5v.01M10 21.5v.01M14 21.5v.01"/>`,
  rain: `<path d="${CLOUD_UP}"/><path class="c-rain" d="M8.5 18l-1 2.8M12.5 18l-1 2.8M16.5 18l-1 2.8"/>`,
  "rain-heavy": `<path d="${CLOUD_UP}"/><path class="c-rain" d="M7.5 17.6l-1.6 4.2M11 17.6l-1.6 4.2M14.5 17.6l-1.6 4.2M18 17.6l-1.6 4.2"/>`,
  "showers-day": `${SHOWER_SUN}${occCloudUp}<path class="c-rain" d="M9.5 18l-1 2.8M14 18l-1 2.8"/>`,
  "showers-night": `${SHOWER_MOON}${occCloudUp}<path class="c-rain" d="M9.5 18l-1 2.8M14 18l-1 2.8"/>`,
  snow: `<path d="${CLOUD_UP}"/><path class="c-snow" d="M8 17.6v2.6M6.7 18.9h2.6M12 19v2.6M10.7 20.3h2.6M16 17.6v2.6M14.7 18.9h2.6"/>`,
  sleet: `<path d="${CLOUD_UP}"/><path class="c-rain" d="M8.5 18l-1 2.8M16.5 18l-1 2.8"/><path class="c-snow" d="M12 18.2v2.6M10.7 19.5h2.6"/>`,
  thunder: `<path d="${CLOUD_UP}"/><path class="c-bolt" d="M12.6 14.6l-2.2 3.6h3.2l-2.2 3.6"/>`,
  wind: `<path d="M5 8h8.5a2.5 2.5 0 1 0-2.34-3.24M3 12h15.5a2.5 2.5 0 1 1-2.34 3.24M4 16h5.5a2.5 2.5 0 1 1-2.34 3.24"/>`,
  /* ---- UI ---- */
  star: `<path d="M12 17.75l-6.172 3.245l1.179-6.873l-5-4.867l6.9-1l3.086-6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  settings: `<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37c1 .608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/>`,
  camera: `<path d="M5 7h1a2 2 0 0 0 2-2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2"/><circle cx="12" cy="13" r="3"/>`,
  cloud: `<path d="${CLOUD}"/>`,
  umbrella: `<path d="M4 12a8 8 0 0 1 16 0zM12 12v6a2 2 0 0 0 4 0"/>`,
  chevron: `<path d="M9 6l6 6-6 6"/>`,
  back: `<path d="M15 6l-6 6 6 6"/>`,
  close: `<path d="M18 6 6 18M6 6l12 12"/>`,
  up: `<path d="M6 15l6-6 6 6"/>`,
  down: `<path d="M6 9l6 6 6-6"/>`,
  trash: `<path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/>`,
  pin: `<path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0-6 0M17.657 16.657l-4.243 4.243a2 2 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0z"/>`,
  search: `<circle cx="10" cy="10" r="7"/><path d="M21 21l-6-6"/>`,
  moon: `<path class="c-moon" d="${MOON}"/>`,
  sunrise: `<path class="c-sun" d="M3 17h1M20 17h1M5.6 10.6l.7.7M18.4 10.6l-.7.7M8 17a4 4 0 0 1 8 0M3 21h18M12 9V3M9 6l3-3 3 3"/>`,
  sunset: `<path class="c-sun" d="M3 17h1M20 17h1M5.6 10.6l.7.7M18.4 10.6l-.7.7M8 17a4 4 0 0 1 8 0M3 21h18M12 3v6M9 6l3 3 3-3"/>`,
  drop: `<path class="c-rain" d="M7.502 19.423c2.602 2.105 6.395 2.105 8.996 0c2.602-2.105 3.262-5.708 1.566-8.546l-4.89-7.26c-.42-.625-1.287-.803-1.936-.397a1.376 1.376 0 0 0-.41.397l-4.893 7.26c-1.695 2.838-1.035 6.441 1.567 8.546z"/>`,
  eye: `<path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0-4 0M21 12c-2.4 4-5.4 6-9 6s-6.6-2-9-6c2.4-4 5.4-6 9-6s6.6 2 9 6"/>`,
  arrow: `<path d="M12 20V4M7 9l5-5 5 5"/>`,
  aurora: `<path d="M4 20c.8-5.5 2.2-10 4.5-14M9 20c.5-5 1.6-8.8 3.6-12.5M14 20c.4-4.4 1.4-7.8 3.2-11M19 20c.3-3.6.9-6.4 2-8.6"/>`,
  line: `<path d="M4 20 20 4M14 4h6v6"/><circle cx="6.5" cy="17.5" r="1.2"/>`,
  calendar: `<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM16 3v4M8 3v4M4 11h16"/>`,
  silhouette: `<path d="M3 21h18M5 21V10l4-3v14M9 21V4h6v17M15 21v-9h4v9"/>`,
  mountain: `<path d="M3 20l6-10 4 6 2-3 6 7z"/>`,
  drone: `<path d="M10 10h4v4h-4zM10 10 7 7M14 10l3-3M14 14l3 3M10 14l-3 3"/><circle cx="5.5" cy="5.5" r="2.5"/><circle cx="18.5" cy="5.5" r="2.5"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>`,
  volcano: `<path d="M3 20l5-9h8l5 9zM10 11 9 7M14 11l1-4M12 7V3"/>`,
  chart: `<path d="M3 3v18h18M7 15l4-4 3 3 5-6"/>`,
  bell: `<path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6M9 17v1a3 3 0 0 0 6 0v-1"/>`,
  refresh: `<path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4"/>`,
  uv: `<circle class="c-sun" cx="12" cy="12" r="4"/><path class="c-sun" d="${SUN_RAYS}"/>`,
};

export const WEATHER_KEYS = ["clear-day", "clear-night", "partly-day", "partly-night", "cloudy", "fog", "drizzle", "rain", "rain-heavy", "showers-day", "showers-night", "snow", "sleet", "thunder", "wind"];

/** 실제 위상의 달 (phase 0 신월 · 0.5 보름). 북반구 기준(차는 달 오른쪽 밝음), south=true면 좌우 반전 */
export function phaseMoonInner(phase, { cx = 12, cy = 12, r = 8, south = false } = {}) {
  const p = ((phase % 1) + 1) % 1;
  const rx = Math.abs(Math.cos(2 * Math.PI * p)) * r;
  const top = `${cx} ${(cy - r).toFixed(2)}`, bot = `${cx} ${(cy + r).toFixed(2)}`;
  let d;
  if (p < 0.02 || p > 0.98) d = null; // 신월: 테두리만
  else if (Math.abs(p - 0.5) < 0.02) d = `M${top}A${r} ${r} 0 1 1 ${bot}A${r} ${r} 0 1 1 ${top}z`;
  else if (p < 0.5) { // 차는 달: 오른쪽 밝음
    const sweepT = p < 0.25 ? 0 : 1;
    d = `M${top}A${r} ${r} 0 0 1 ${bot}A${rx.toFixed(2)} ${r} 0 0 ${sweepT} ${top}z`;
  } else { // 기우는 달: 왼쪽 밝음
    const sweepT = p > 0.75 ? 1 : 0;
    d = `M${top}A${r} ${r} 0 0 0 ${bot}A${rx.toFixed(2)} ${r} 0 0 ${sweepT} ${top}z`;
  }
  const flip = south ? ` transform="matrix(-1 0 0 1 ${2 * cx} 0)"` : "";
  return `<g${flip}><circle class="c-moon moon-rim" cx="${cx}" cy="${cy}" r="${r}"/>${d ? `<path class="c-moon moon-lit" d="${d}"/>` : ""}</g>`;
}

const ATTR = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

/** 아이콘 SVG 문자열. opts: {cls, label, phase (clear-night에서 실제 위상), south, size} */
export function icon(key, opts = {}) {
  let inner = ICONS[key] || ICONS.cloud;
  if (key === "clear-night" && typeof opts.phase === "number") inner = phaseMoonInner(opts.phase, { south: opts.south });
  if (key === "moon-phase") inner = phaseMoonInner(opts.phase ?? 0.5, { south: opts.south });
  const a11y = opts.label ? `role="img" aria-label="${String(opts.label).replace(/"/g, "&quot;")}"` : 'aria-hidden="true"';
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : "";
  return `<svg class="ico ${opts.cls || ""}" ${ATTR}${size} ${a11y} focusable="false">${inner}</svg>`;
}

/** 독립 .svg 파일 내용 */
export function svgFile(key) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" ${ATTR}>${ICONS[key]}</svg>\n`;
}
