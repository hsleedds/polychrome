/* 순수 함수: 시간대·단위·날짜 표기 (DOM 없음, Node 테스트 가능) */

const fmtCache = new Map();
function partsFmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    } catch {
      f = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    }
    fmtCache.set(tz, f);
  }
  return f;
}

/** JS Date → 그 도시 현지 "YYYY-MM-DDTHH:MM" */
export function dateToLocal(d, tz) {
  const o = {};
  for (const p of partsFmt(tz).formatToParts(d)) o[p.type] = p.value;
  const h = o.hour === "24" ? "00" : o.hour;
  return `${o.year}-${o.month}-${o.day}T${h}:${o.minute}`;
}
export const localNow = (tz, d = new Date()) => dateToLocal(d, tz);

/** 시간대 오프셋(분) */
export function tzOffsetMin(tz, d) {
  const loc = Date.parse(dateToLocal(d, tz) + ":00Z");
  const utc = Math.floor(d.getTime() / 60000) * 60000;
  return Math.round((loc - utc) / 60000);
}
/** 현지 "YYYY-MM-DDTHH:MM" → JS Date */
export function localToDate(str, tz) {
  const s = str.length === 10 ? str + "T00:00" : str.slice(0, 16);
  const guess = Date.parse(s + ":00Z");
  const off = tzOffsetMin(tz, new Date(guess));
  let t = guess - off * 60000;
  const off2 = tzOffsetMin(tz, new Date(t));
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}
export const ymdOf = (s) => String(s).slice(0, 10);
export const hourOf = (s) => +String(s).slice(11, 13);
export function addDays(ymd, n) {
  const d = new Date(Date.parse(ymd + "T00:00:00Z") + n * 864e5);
  return d.toISOString().slice(0, 10);
}
/** "YYYY-MM-DDTHH:MM" → 같은 시각의 정시 문자열 */
export const hourKey = (s) => String(s).slice(0, 13) + ":00";

/** 시간 배열에서 현재(정시) 위치 */
export function nowIndex(times, now) {
  if (!Array.isArray(times) || !times.length) return 0;
  const k = hourKey(now);
  let i = times.indexOf(k);
  if (i >= 0) return i;
  // 정확히 없으면 now 이전 마지막 칸
  i = 0;
  for (let j = 0; j < times.length; j++) { if (times[j] <= k) i = j; else break; }
  return i;
}

/* ---------- 단위 ---------- */
export const cToF = (c) => c * 9 / 5 + 32;
export function tempVal(c, units) {
  if (c == null || isNaN(c)) return null;
  return Math.round(units === "imperial" ? cToF(c) : c);
}
export function temp(c, units, withUnit = false) {
  const v = tempVal(c, units);
  if (v == null) return "–";
  return `${v}°${withUnit ? (units === "imperial" ? "F" : "C") : ""}`;
}
export function tempDelta(dc, units) {
  return Math.round(units === "imperial" ? dc * 9 / 5 : dc);
}
export function precip(mm, units) {
  if (mm == null || isNaN(mm)) return "–";
  if (units === "imperial") {
    const inch = mm / 25.4;
    return (inch < 0.1 ? inch.toFixed(2) : inch.toFixed(1)) + "in";
  }
  return (mm < 10 ? (Math.round(mm * 10) / 10) : Math.round(mm)) + "mm";
}
export function wind(ms, units) {
  if (ms == null || isNaN(ms)) return "–";
  if (units === "imperial") return Math.round(ms * 2.23694) + " mph";
  return (ms < 10 ? Math.round(ms * 10) / 10 : Math.round(ms)) + " m/s";
}
export function dist(km, units) {
  if (km == null || isNaN(km)) return "–";
  if (units === "imperial") { const mi = km * 0.621371; return (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + " mi"; }
  return (km < 10 ? km.toFixed(1) : Math.round(km)) + " km";
}
export const pct = (v) => (v == null || isNaN(v) ? "–" : Math.round(v) + "%");

/* ---------- 날짜·시각 표기 ---------- */
const WD_KO = ["일", "월", "화", "수", "목", "금", "토"];
const WD_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function weekdayIdx(ymd) { return new Date(Date.parse(ymd + "T12:00:00Z")).getUTCDay(); }
export function weekdayName(ymd, lang) { const i = weekdayIdx(ymd); return lang === "en" ? WD_EN[i] : WD_KO[i]; }
export function weekdayFull(ymd, lang) {
  const i = weekdayIdx(ymd);
  return lang === "en" ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i] : WD_KO[i] + "요일";
}
/** 오늘/내일/요일 */
export function dayLabel(ymd, todayYmd, lang) {
  if (ymd === todayYmd) return lang === "en" ? "Today" : "오늘";
  if (ymd === addDays(todayYmd, 1)) return lang === "en" ? "Tomorrow" : "내일";
  return weekdayName(ymd, lang);
}
export function monthDay(ymd, lang) {
  const m = +ymd.slice(5, 7), d = +ymd.slice(8, 10);
  if (lang === "en") return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] + " " + d;
  return `${m}월 ${d}일`;
}
/** "오후 3시" / "3 PM" (시간만) */
export function hourLabel(s, lang, short = false) {
  const h = hourOf(s);
  if (lang === "en") { const h12 = h % 12 || 12; return h12 + (short ? (h < 12 ? "a" : "p") : (h < 12 ? " AM" : " PM")); }
  if (short) return h + "시";
  if (h === 0) return "자정";
  if (h === 12) return "정오";
  return (h < 12 ? "오전 " : "오후 ") + (h % 12 || 12) + "시";
}
/** "14:05" */
export const hhmm = (s) => (s ? String(s).slice(11, 16) : "–");
/** 상대 시각: 오늘이면 "오후 3시", 내일이면 "내일 오전 9시", 그 뒤는 "수 오후 3시" */
export function relTime(s, nowStr, lang) {
  if (!s) return "";
  const d = ymdOf(s), today = ymdOf(nowStr);
  const hl = hourLabel(s, lang);
  if (d === today) return hl;
  if (d === addDays(today, 1)) return (lang === "en" ? "tomorrow " : "내일 ") + hl;
  return weekdayName(d, lang) + " " + hl;
}
/** Date → 도시 현지 "HH:MM" */
export const clockAt = (date, tz) => (date instanceof Date && !isNaN(date) ? dateToLocal(date, tz).slice(11, 16) : "–");

/** 풍향(도) → 16방위 키 */
export function compassKey(deg) {
  if (deg == null || isNaN(deg)) return null;
  const K = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return K[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}
export function uvLevel(uv) {
  if (uv == null || isNaN(uv)) return null;
  return uv < 3 ? "low" : uv < 6 ? "moderate" : uv < 8 ? "high" : uv < 11 ? "veryhigh" : "extreme";
}
/** WMO 코드 → 하늘 상태 키 */
export function condKey(code) {
  if (code == null) return "unknown";
  if (code === 0) return "clear";
  if (code === 1) return "mostlyClear";
  if (code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code <= 48) return "fog";
  if (code <= 55) return "drizzle";
  if (code <= 57) return "freezingDrizzle";
  if (code <= 63) return "rain";
  if (code <= 65) return "heavyRain";
  if (code <= 67) return "freezingRain";
  if (code <= 75) return "snow";
  if (code === 77) return "snowGrains";
  if (code <= 82) return "showers";
  if (code <= 86) return "snowShowers";
  return "thunder";
}
export function kpToG(kp) { return kp >= 9 ? 5 : kp >= 8 ? 4 : kp >= 7 ? 3 : kp >= 6 ? 2 : kp >= 5 ? 1 : 0; }
