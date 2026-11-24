/* 관리자 적중률 화면: weights 표(익명 읽기)를 그대로 보여 줌. 비었거나 없으면 「데이터 쌓는 중」 */
import { getWeights } from "../data.js";
import { t } from "../i18n.js";
import { esc, header } from "./dom.js";

export async function renderAccuracy(root, ctx) {
  root.innerHTML = header(t("admin.accuracy"), { backLabel: t("back") }) + `<div class="pad acc"><div class="spin" aria-hidden="true"></div></div>`;
  const body = root.querySelector(".acc");
  if (!ctx.isAdmin()) { body.innerHTML = `<p class="muted">${esc(t("admin.only"))}</p>`; return; }
  const rows = await getWeights();
  if (!root.isConnected) return;
  if (!rows || !rows.length) {
    body.innerHTML = `<section class="card center"><p class="big">${esc(t("admin.collecting"))}</p><p class="muted">${esc(t("admin.collectingHint"))}</p></section>`;
    return;
  }
  // 열: 행들의 키 합집합 (숫자는 소수 3자리)
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !/^(id|created_at)$/.test(k));
  const cell = (v) => (typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(3)) : v == null ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v));
  body.innerHTML = `<section class="card"><h3 class="card-h">${esc(t("admin.weights"))} <small class="muted">${rows.length}</small></h3>
    <div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(cell(r[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section>`;
}
