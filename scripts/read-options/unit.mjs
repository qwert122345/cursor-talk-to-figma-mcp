// readOptions.ts 순수 함수 시험 — 손으로 만든 가짜 결과(실제 피그마 데이터 아님). 사용: bun scripts/read-options/unit.mjs
import assert from "node:assert/strict";
import * as R from "../../src/talk_to_figma_mcp/readOptions.ts";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok", name); };
const deep = (v) => JSON.parse(JSON.stringify(v));

const tree = {
  id: "1:1", name: "Screen", type: "FRAME", fills: [{ type: "SOLID", color: "#ffffff" }],
  absoluteBoundingBox: { x: 0, y: 0, width: 360, height: 800 },
  children: [
    { id: "1:2", name: "Title", type: "TEXT", characters: "안녕", style: { fontSize: 20 } },
    { id: "1:3", name: "Card", type: "FRAME", children: [{ id: "1:4", name: "Label", type: "TEXT", characters: "라벨" }] },
  ],
};

t("projectNode: 옵션 없음이면 같은 내용", () => {
  assert.deepEqual(R.projectNode(tree, undefined, undefined), tree);
});
t("projectNode: 입력을 바꾸지 않는다", () => {
  const before = deep(tree); R.projectNode(tree, ["name"], 0); assert.deepEqual(tree, before);
});
t("projectNode: fields 는 모든 깊이에, id 는 늘", () => {
  const p = R.projectNode(tree, ["characters"], undefined);
  assert.deepEqual(p, { id: "1:1", children: [{ id: "1:2", characters: "안녕" }, { id: "1:3", children: [{ id: "1:4", characters: "라벨" }] }] });
});
t("projectNode: maxDepth 0 = 노드 자신 + childCount", () => {
  const p = R.projectNode(tree, undefined, 0);
  assert.equal(p.children, undefined); assert.equal(p.childCount, 2); assert.equal(p.name, "Screen");
});
t("projectNode: maxDepth 1 = 자식까지, 손자 자리는 childCount", () => {
  const p = R.projectNode(tree, ["name"], 1);
  assert.deepEqual(p, { id: "1:1", name: "Screen", children: [{ id: "1:2", name: "Title" }, { id: "1:3", name: "Card", childCount: 1 }] });
});
t("projectNode: null(VECTOR) 은 그대로", () => { assert.equal(R.projectNode(null, ["name"], 0), null); });

const hidden = { scannedNodes: 10, totalFindings: 2, returned: 2, hasMore: false, nameFilter: null, byReason: { hidden: 2 },
  findings: [{ id: "2:1", name: "A", type: "FRAME", page: "P", path: "P / X / A", reasons: ["hidden"], detail: { visible: false } }] };
t("find_hidden_nodes: fields", () => {
  assert.deepEqual(R.projectHidden(hidden, ["reasons"]).findings, [{ id: "2:1", reasons: ["hidden"] }]);
  assert.equal(R.projectHidden(hidden, ["reasons"]).totalFindings, 2);
});
t("find_hidden_nodes: summary 는 스칼라 + byReason, findings 없음", () => {
  assert.deepEqual(R.summarizeHidden(hidden), { summary: true, scannedNodes: 10, totalFindings: 2, returned: 2, hasMore: false, nameFilter: null, byReason: { hidden: 2 } });
});

const byName = { name: "Interaction", exact: false, scannedNodes: 5, totalFindings: 1, byType: { FRAME: 1 }, ids: ["3:1"],
  findings: [{ id: "3:1", name: "Interaction", type: "FRAME", page: "P", path: "P / Interaction", parentId: "3:0", parentType: "COMPONENT", component: "Btn" }] };
t("find_nodes_by_name: fields", () => {
  assert.deepEqual(R.projectByName(byName, ["parentId"]).findings, [{ id: "3:1", parentId: "3:0" }]);
});
t("find_nodes_by_name: summary 는 배열(ids·findings) 없이", () => {
  const s = R.summarizeByName(byName); assert.equal(s.findings, undefined); assert.equal(s.ids, undefined); assert.deepEqual(s.byType, { FRAME: 1 });
});

const census = { totalInstances: 5, libraryInstances: 5, localInstances: 0, uniqueComponents: 2,
  components: [{ key: "k1", componentName: "A", componentSetName: "SA", source: "library", count: 2 }, { key: "k2", componentName: "B", componentSetName: null, source: "library", count: 3 }],
  instances: [{ id: "4:1", name: "A", page: "P", path: "P / A" }] };
t("get_instance_census: fields 는 components·instances 따로", () => {
  const p = R.projectCensus(census, ["count", "instances.page"]);
  assert.deepEqual(p.components, [{ count: 2 }, { count: 3 }]); assert.deepEqual(p.instances, [{ id: "4:1", page: "P" }]);
});
t("get_instance_census: summary 는 개수 순 상위", () => {
  const s = R.summarizeCensus(census); assert.deepEqual(s.topComponents.map((c) => c.componentName), ["B", "A"]); assert.equal(s.components, undefined);
});

const bindings = { scannedNodes: 9, totalFindings: 1, byProperty: { fills: 1 }, byValue: { "#fff": 1 }, byTextStyle: {}, byComponent: { A: 1 },
  byVariable: { "Color/Primary": { total: 4, properties: { fills: 4 }, components: { A: 4 } } }, findings: [{ id: "5:1" }] };
t("get_variable_bindings: summary 는 byVariable 을 total 로", () => {
  const s = R.summarizeBindings(bindings);
  assert.deepEqual(s.byVariable, { "Color/Primary": 4 }); assert.equal(s.findings, undefined); assert.equal(s.byComponent, undefined);
});

console.log(`\n${n} passed`);
