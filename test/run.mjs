// Polychrome 테스트 실행기 (의존성 없음). 사용: node test/run.mjs [이름 필터]
// test/*.test.mjs 를 모두 불러온다. 각 파일은 다음 중 하나로 테스트를 등록한다.
//   const test = globalThis.test ?? (await import("./run.mjs")).test;   test("이름", async () => { ... });
//   (run.mjs가 실행 중일 때 정적 import { test } from "./run.mjs" 는 순환 대기에 걸리므로 위 형태를 쓴다)
//   또는 최상위에서 assert 실행(불러오다 예외가 나면 실패로 집계)
// 테스트 파일을 직접 실행해도(node test/x.test.mjs) 등록된 테스트가 자동으로 돈다.
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const queue = [];
const here = dirname(fileURLToPath(import.meta.url));
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
let scheduled = false;

export function test(name, fn) {
  queue.push({ name, fn, file: currentFile });
  if (!isMain && !scheduled) { scheduled = true; setTimeout(() => runQueue().then(finish), 0); }
}
globalThis.test = test;
let currentFile = "";

async function runQueue(filter) {
  let pass = 0, fail = 0;
  const failures = [];
  for (const t of queue) {
    if (filter && !t.name.includes(filter) && !t.file.includes(filter)) continue;
    try { await t.fn(); pass++; console.log(`  ok   ${t.name}`); }
    catch (e) { fail++; failures.push([t, e]); console.log(`  FAIL ${t.name}`); }
  }
  for (const [t, e] of failures) console.log(`\n--- ${t.file} :: ${t.name}\n${e && e.stack || e}`);
  return { pass, fail };
}
function finish({ pass, fail }, loadFail = 0) {
  console.log(`\n${pass} passed, ${fail + loadFail} failed`);
  // 일부 모듈은 15분 캐시 타이머를 남기므로 명시적으로 종료
  process.exit(fail + loadFail ? 1 : 0);
}

if (isMain) {
  const filter = process.argv[2] || "";
  const files = readdirSync(here).filter(f => f.endsWith(".test.mjs")).sort();
  let loadFail = 0;
  for (const f of files) {
    currentFile = f;
    console.log(`# ${f}`);
    try { await import(pathToFileURL(join(here, f)).href); }
    catch (e) { loadFail++; console.log(`  FAIL (load) ${f}\n${e && e.stack || e}`); }
  }
  currentFile = "";
  finish(await runQueue(filter), loadFail);
}
