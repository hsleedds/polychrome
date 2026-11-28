// drone-zones 테스트: 기하(원·다각형·선 북쪽), 정적 자료 스키마, 알려진 지점 판정, 고도, 해외 링크, 스위치
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const test = globalThis.test ?? (await import("./run.mjs")).test;
const DZ = await import("../app/drone-zones.js");
const DATA = JSON.parse(readFileSync(new URL("../data/drone/kr.json", import.meta.url), "utf8"));
const ON = { drone_zones: true, drone_zones_server: false };
const chk = (lat, lon, alt, extra = {}) => DZ.check(lat, lon, alt, { flags: ON, data: DATA, ...extra });
const ids = (r) => r.items.map((i) => i.id).filter(Boolean);

test("drone: 기하 — 거리·점-다각형·선 보간", () => {
  // 위도 1° ≈ 111.2 km
  assert.ok(Math.abs(DZ.distanceKm(37, 127, 38, 127) - 111.2) < 0.2);
  const sq = [[0, 0], [0, 1], [1, 1], [1, 0]];
  assert.equal(DZ.pointInRing(0.5, 0.5, sq), true);
  assert.equal(DZ.pointInRing(1.5, 0.5, sq), false);
  const hole = [[0.4, 0.4], [0.4, 0.6], [0.6, 0.6], [0.6, 0.4]];
  assert.equal(DZ.pointInPolygon(0.5, 0.5, [sq, hole]), false);
  assert.equal(DZ.pointInPolygon(0.2, 0.2, [sq, hole]), true);
  const line = [[1, 2], [0, 0]]; // 정렬 안 된 입력
  assert.equal(DZ.lineLatAt(line, 1), 0.5);
  assert.equal(DZ.lineLatAt(line, 5, false), null);
  assert.equal(DZ.lineLatAt(line, 5, true), 1);
  const circle = { shape: "circle", center: [37, 127], radiusKm: 9.26 };
  assert.equal(DZ.zoneHit(circle, 37.08, 127).inside, true);   // 8.9 km
  assert.equal(DZ.zoneHit(circle, 37.09, 127).inside, false);  // 10.0 km
});

test("drone: 정적 자료 스키마 (출처·확인 날짜·5 NM)", () => {
  assert.equal(DATA.country, "KR");
  assert.ok(Array.isArray(DATA.unverified) && DATA.unverified.length > 0);
  for (const z of DATA.zones) {
    assert.ok(z.id && z.name_ko && ["P", "R", "CTR"].includes(z.kind), z.id);
    assert.ok(/^https:\/\//.test(z.source?.url) && /^\d{4}-\d{2}-\d{2}$/.test(z.source?.checkedAt), z.id + " source");
    assert.ok(["circle", "polygon", "northOf"].includes(z.shape), z.id + " shape");
    if (z.shape === "circle") {
      assert.ok(z.center[0] > 33 && z.center[0] < 38.7 && z.center[1] > 124 && z.center[1] < 131, z.id);
      if (z.kind === "CTR") assert.equal(z.radiusKm, 9.26);
    }
    assert.equal(typeof z.approx, "boolean", z.id + " approx");
  }
  // AIP ARP 변환 확인 (김포 373325N 1264751E)
  const g = DATA.zones.find((z) => z.id === "CTR-RKSS");
  assert.ok(Math.abs(g.center[0] - 37.556944) < 1e-5 && Math.abs(g.center[1] - 126.7975) < 1e-5);
});

test("drone: 김포공항 근처 → 관제권", async () => {
  const r = await chk(37.5400, 126.8300, 50); // 김포공항 남동쪽 ~3.4 km
  assert.equal(r.level, "control");
  assert.ok(ids(r).includes("CTR-RKSS"));
  assert.ok(r.items[0].distKm > 2 && r.items[0].distKm < 5);
  assert.equal(r.label.includes("가능"), false);
});

test("drone: 광화문 → P-73A 비행금지, 여의도는 P-73B 제외선 남쪽", async () => {
  const a = await chk(37.5759, 126.9769, 30);
  assert.equal(a.level, "prohibited");
  assert.ok(ids(a).includes("P-73A"));
  assert.ok(!ids(a).includes("P-73B")); // P-73B 는 P-73A 를 뺀 고리
  assert.ok(a.notes.some((n) => n.includes("2022-11-17")));
  const y = await chk(37.5250, 126.9250, 30); // 여의도: 4.5 NM 원 안이지만 한강 남쪽 제외 구역
  assert.ok(!ids(y).includes("P-73B") && !ids(y).includes("P-73A"));
  const n = await chk(37.6000, 126.9000, 30); // 은평 쪽: P-73B (북쪽)
  assert.ok(ids(n).includes("P-73B"));
});

test("drone: 휴전선 일대 → P-518, 섬 → P-518W", async () => {
  const p = await chk(38.1000, 127.3000); // 철원 부근
  assert.ok(ids(p).includes("P-518"));
  assert.equal(p.level, "prohibited");
  const w = await chk(37.6700, 125.7000); // 연평도 부근
  assert.ok(ids(w).includes("P-518W"));
});

test("drone: 시골 지점 → none(「알려진 비행금지·제한구역 아님」), 고도 160 m → caution", async () => {
  const r = await chk(36.3000, 128.0000, 100); // 경북 내륙 (구미·김천 사이 산지)
  assert.equal(r.level, "none");
  assert.equal(r.label, "알려진 비행금지·제한구역 아님");
  assert.equal(r.items.length, 0);
  assert.ok(r.notes.some((n) => n.includes("항공촬영 허가")));
  assert.ok(r.notes.some((n) => n.includes("국립공원")));
  assert.ok(r.links.some((l) => l.url === "https://drone.onestop.go.kr/"));
  const h = await chk(36.3000, 128.0000, 160);
  assert.equal(h.level, "caution");
  assert.equal(h.items[0].kind, "altitude");
  assert.ok(h.items[0].name.includes("150 m"));
  // 관제권 + 고도 → 더 심한 쪽(control)
  const c = await chk(37.5400, 126.8300, 160);
  assert.equal(c.level, "control");
  assert.ok(c.items.some((i) => i.kind === "altitude"));
});

test("drone: 해외 → unknown + 공식 링크, countryOf", async () => {
  const cases = [[35.68, 139.76, "JP", "mlit.go.jp"], [69.65, 18.96, "NO", "luftfartstilsynet.no"], [64.15, -21.94, "IS", "island.is"],
    [66.5, 25.73, "FI", "traficom.fi"], [62.45, -114.37, "CA", "tc.canada.ca"], [64.84, -147.72, "US", "faa.gov"], [40.7, -74.0, "US", "faa.gov"]];
  for (const [la, lo, cc, host] of cases) {
    assert.equal(DZ.countryOf(la, lo), cc, `${la},${lo}`);
    const r = await chk(la, lo, 100);
    assert.equal(r.level, "unknown");
    assert.ok(r.links.length && r.links.every((l) => l.url.includes(host)), cc);
  }
  assert.equal(DZ.countryOf(37.57, 126.98), "KR");
  assert.equal(DZ.countryOf(33.5, 126.5), "KR");   // 제주
  assert.equal(DZ.countryOf(34.4, 129.3), "JP");   // 쓰시마
  assert.equal(DZ.countryOf(37.48, 130.9), "KR");  // 울릉도
  assert.equal(DZ.countryOf(-33.9, 151.2), null);
  const x = await chk(-33.9, 151.2);
  assert.equal(x.level, "unknown"); assert.equal(x.links.length, 0);
  // country 직접 지정이 우선
  const k = await chk(64.15, -21.94, 0, { country: "KR" });
  assert.equal(k.country, "KR");
});

test("drone: 스위치 off → disabled, 서버 스위치 + 실패 시 정적 자료로", async () => {
  const off = await DZ.check(37.54, 126.83, 0, { flags: { drone_zones: false }, data: DATA });
  assert.equal(off.level, "unknown"); assert.equal(off.disabled, true);
  DZ.setData(DATA);
  let called = 0;
  const failing = async () => { called++; return { ok: false, status: 503, json: async () => ({}) }; };
  const r = await DZ.check(37.54, 126.83, 0, { flags: { drone_zones: true, drone_zones_server: true }, fetch: failing });
  assert.equal(called, 1);
  assert.equal(r.level, "control");
  assert.ok(r.notes[0].includes("정적 자료"));
  // 서버 응답 형식(정규화된 다각형) 사용
  const ok = async () => ({ ok: true, json: async () => ({ ok: true, source: "VWorld 테스트", zones: [
    { id: "R-TEST", kind: "R", name_ko: "시험 제한구역", shape: "polygon", rings: [[[36.2, 127.9], [36.2, 128.1], [36.4, 128.1], [36.4, 127.9]]] }] }) });
  const s = await DZ.check(36.3, 128.0, 0, { flags: { drone_zones: true, drone_zones_server: true }, fetch: ok });
  assert.equal(s.level, "restricted"); assert.equal(s.coverage, "server"); assert.equal(s.source, "VWorld 테스트");
});

test("drone: 전역 등록", () => {
  assert.equal(typeof globalThis.PCDroneZones?.check, "function");
  assert.equal(typeof globalThis.PCDroneZones?.countryOf, "function");
});
