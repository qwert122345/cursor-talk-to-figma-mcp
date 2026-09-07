// Runnable check for the DS healthcheck plugin commands.
// Loads code.js in a vm with a stubbed figma global and exercises the pure
// helpers — the branchy parts that decide what counts as "hardcoded".
//   run: bun test-ds-commands.mjs   (or: node test-ds-commands.mjs)
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import assert from "node:assert";

const MIXED = Symbol("figma.mixed");
const ctx = createContext({
  console,
  __html__: "",
  figma: {
    mixed: MIXED,
    showUI() {},
    on() {},
    ui: { postMessage() {}, set onmessage(_) {} },
    clientStorage: { getAsync: async () => null, setAsync: async () => {} },
  },
});
runInContext(readFileSync("src/cursor_mcp_plugin/code.js", "utf8"), ctx);
const { hardcodedProps, nearestComponent, paintsToValue, ancestorPath, collectBoundVars,
        resolveScanTargets, safeGet, applyLayoutSizing,
        UNBIND_FIELDS, unbindVariable, getComponentProperties } = ctx;

const solid = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }];

// fills: hardcoded vs bound to a variable vs bound to a style vs image-only.
// A finding carries the value, not just the property name — the whole point is
// being able to count "#ff0000 appears N times".
assert.deepEqual(hardcodedProps({ fills: solid }), [{ prop: "fills", value: "#ff0000" }]);
assert.deepEqual(
  hardcodedProps({ fills: solid, boundVariables: { fills: [{ type: "VARIABLE_ALIAS" }] } }),
  []
);
assert.deepEqual(hardcodedProps({ fills: solid, fillStyleId: "S:abc" }), []);
assert.deepEqual(hardcodedProps({ fills: [{ type: "IMAGE" }] }), []);
assert.deepEqual(hardcodedProps({ fills: [] }), []);

// opacity folds into alpha, otherwise a 50% grey and a solid grey land in the
// same histogram bucket
assert.equal(paintsToValue([{ color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }]), "#00000080");
assert.equal(paintsToValue([{ color: { r: 0, g: 0, b: 0 } }]), "#000000");
// stacked paints stay distinguishable from a single paint
assert.equal(
  paintsToValue([{ color: { r: 1, g: 1, b: 1 } }, { color: { r: 0, g: 0, b: 0 } }]),
  "#ffffff,#000000"
);
// invisible and non-solid paints never reach the value
assert.deepEqual(
  hardcodedProps({ fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 }, visible: false }] }),
  []
);

// cornerRadius: any of the four corner keys counts as bound
assert.deepEqual(hardcodedProps({ cornerRadius: 8 }), [{ prop: "cornerRadius", value: 8 }]);
assert.deepEqual(
  hardcodedProps({ cornerRadius: 8, boundVariables: { topLeftRadius: { id: "V:1" } } }),
  []
);

// noise guards: 0 and mixed are not findings
assert.deepEqual(hardcodedProps({ cornerRadius: 0, itemSpacing: 0, paddingLeft: 0 }), []);
assert.deepEqual(hardcodedProps({ fontSize: MIXED }), []);

// negative spacing is a real finding, not noise — the 2026Q3 UI scan found 185
// of them and the 0-guard must not swallow them
assert.deepEqual(hardcodedProps({ itemSpacing: -2 }), [{ prop: "itemSpacing", value: -2 }]);

// multiple properties on one node
assert.deepEqual(hardcodedProps({ itemSpacing: 16, paddingTop: 12, fontSize: 14 }), [
  { prop: "itemSpacing", value: 16 },
  { prop: "paddingTop", value: 12 },
  { prop: "fontSize", value: 14 },
]);

// nearestComponent: a variant reports BOTH the set and the variant, so a
// problem confined to one variant doesn't collapse into the set
const set = { type: "COMPONENT_SET", name: "Button", parent: null };
const variant = { type: "COMPONENT", name: "Size=Large, State=Pressed", parent: set };
assert.deepEqual(nearestComponent({ parent: { type: "FRAME", name: "row", parent: variant } }), {
  component: "Button",
  variant: "Size=Large, State=Pressed",
});
// a component with no set has no variant
assert.deepEqual(
  nearestComponent({ parent: { type: "COMPONENT", name: "Divider", parent: { type: "PAGE" } } }),
  { component: "Divider", variant: null }
);
// loose node on a page belongs to nothing
assert.deepEqual(nearestComponent({ parent: { type: "PAGE", name: "Color" } }), {
  component: null,
  variant: null,
});

// ancestorPath: the trail that makes a census hit findable. Stops at the page
// and drops the node's own name (the caller already has it).
const page = { type: "PAGE", name: "UI (2026-1)", parent: null };
const screen = { type: "FRAME", name: "SCR-HOME/01", parent: page };
const list = { type: "INSTANCE", name: "List", parent: screen };
assert.equal(ancestorPath({ parent: list }), "SCR-HOME/01 > List");
assert.equal(ancestorPath({ parent: page }), "");
// runaway nesting is cut off rather than returned in full
const deep = Array.from({ length: 20 }).reduce(
  (acc, _, i) => ({ type: "FRAME", name: "f" + i, parent: acc }),
  page
);
assert.equal(ancestorPath({ parent: deep }, 3).split(" > ").length, 3);

// collectBoundVars: both boundVariables shapes Figma emits — a bare alias
// (fontSize) and an alias-per-paint array (fills) — plus unbound paints.
const alias = (id) => ({ type: "VARIABLE_ALIAS", id });
const hits = [];
collectBoundVars(
  {
    boundVariables: {
      fontSize: alias("V:1"),
      fills: [alias("V:2"), undefined],
      strokes: [],
    },
  },
  hits
);
assert.deepEqual(hits, [
  { prop: "fontSize", id: "V:1" },
  { prop: "fills", id: "V:2" },
]);
// a node with nothing bound contributes nothing, and must not throw
const none = [];
collectBoundVars({}, none);
assert.deepEqual(none, []);

// resolveScanTargets: the scan-scope rules the page-walking commands share.
// nodeId wins; otherwise pageName narrows and excludePages removes.
const pages = ["Cover", "Check", "Color"].map((name) => ({ type: "PAGE", name }));
ctx.figma.root = { children: pages };
ctx.figma.loadAllPagesAsync = async () => {};
ctx.figma.getNodeByIdAsync = async (id) =>
  id === "1:1" ? { id, name: "Frame", parent: pages[2] } : null;

assert.deepEqual(
  (await resolveScanTargets({})).map((t) => t.pageName),
  ["Cover", "Check", "Color"]
);
assert.deepEqual(
  (await resolveScanTargets({ excludePages: ["Check"] })).map((t) => t.pageName),
  ["Cover", "Color"]
);
assert.deepEqual(
  (await resolveScanTargets({ pageName: "Color" })).map((t) => t.pageName),
  ["Color"]
);
// pageName and excludePages both apply — naming an excluded page yields nothing
assert.deepEqual(await resolveScanTargets({ pageName: "Check", excludePages: ["Check"] }), []);
// a nodeId scopes to that subtree and reports the page it lives on
const scoped = await resolveScanTargets({ nodeId: "1:1", pageName: "Cover" });
assert.equal(scoped.length, 1);
assert.equal(scoped[0].pageName, "Color");
await assert.rejects(() => resolveScanTargets({ nodeId: "nope" }), /Node not found/);

// safeGet: a property that throws reads as undefined rather than blowing up the scan
assert.equal(safeGet({ layoutMode: "NONE" }, "layoutMode"), "NONE");
assert.equal(safeGet({}, "layoutMode"), undefined);
assert.equal(
  safeGet(
    {
      get boom() {
        throw new Error("unsupported on this node type");
      },
    },
    "boom"
  ),
  undefined
);

// applyLayoutSizing: a TEXT node inside an auto-layout frame can be told to
// FILL. The original guard rejected TEXT outright, which made it impossible to
// stop table cells being fixed-width.
const autoParent = { layoutMode: "HORIZONTAL" };
const text = { id: "1:2", name: "cell", type: "TEXT", parent: autoParent };
assert.deepEqual(applyLayoutSizing(text, "FILL", "HUG"), {
  id: "1:2",
  name: "cell",
  type: "TEXT",
  layoutSizingHorizontal: "FILL",
  layoutSizingVertical: "HUG",
  layoutMode: undefined,
});

// TEXT is judged by its parent's layoutMode, frames by their own
assert.doesNotThrow(() =>
  applyLayoutSizing({ type: "FRAME", layoutMode: "VERTICAL", parent: autoParent }, "FILL")
);
assert.throws(
  () => applyLayoutSizing({ type: "FRAME", layoutMode: "NONE", parent: autoParent }, "FILL"),
  /auto-layout frames/
);

// FILL needs an auto-layout parent whatever the node type
assert.throws(
  () => applyLayoutSizing({ type: "TEXT", parent: { layoutMode: "NONE" } }, "FILL"),
  /auto-layout children/
);
assert.throws(() => applyLayoutSizing({ type: "TEXT" }, "FILL"), /auto-layout children/);

// HUG stays limited to frames and text; other types and bad values are refused
assert.throws(
  () => applyLayoutSizing({ type: "INSTANCE", layoutMode: "HORIZONTAL" }, "HUG"),
  /HUG sizing/
);
assert.throws(
  () => applyLayoutSizing({ type: "VECTOR", parent: autoParent }, "FILL"),
  /does not support layout sizing/
);
assert.throws(
  () => applyLayoutSizing({ type: "TEXT", parent: autoParent }, "STRETCH"),
  /Invalid layoutSizingHorizontal/
);

// nothing passed means nothing set
const untouched = { type: "TEXT", parent: autoParent };
applyLayoutSizing(untouched);
assert.equal(untouched.layoutSizingHorizontal, undefined);

// ── E-21 unbind_variable ────────────────────────────────────────────────────
// 굵기는 네 변이 따로 묶여 있는 경우가 흔하다. 균일 필드만 훑으면 전부 놓치는데,
// 렌더가 안 바뀌어서 회귀해도 아무도 눈치채지 못한다 — 그래서 여기서 못박는다.
assert.deepEqual(UNBIND_FIELDS.strokeWeight, [
  "strokeWeight",
  "strokeTopWeight",
  "strokeBottomWeight",
  "strokeLeftWeight",
  "strokeRightWeight",
]);
// cornerRadius 는 BIND_FIELDS 에서 그대로 물려받는다 — 네 모서리 동시
assert.deepEqual(UNBIND_FIELDS.cornerRadius,
  ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"]);

ctx.figma.variables = { getVariableByIdAsync: async (id) => ({ name: "Sem/Scale / " + id }) };

// 묶인 변만 골라 끊고, 안 묶인 노드는 skipped 로 빠진다
const bound = {
  id: "1:1", name: "variant", type: "COMPONENT", cleared: [],
  boundVariables: { strokeTopWeight: { id: "x_25" }, strokeBottomWeight: { id: "x_25" } },
  setBoundVariable(f, v) { assert.equal(v, null); this.cleared.push(f); },
};
const loose = { id: "2:2", name: "plain", type: "COMPONENT", boundVariables: {}, setBoundVariable() {} };
ctx.figma.getNodeByIdAsync = async (id) => ({ "1:1": bound, "2:2": loose })[id] || null;

let r = await unbindVariable({ nodeIds: ["1:1", "2:2", "9:9"], property: "strokeWeight", dryRun: true });
assert.deepEqual(r.unbound.map((u) => u.cleared), [["strokeTopWeight", "strokeBottomWeight"]]);
assert.equal(r.unbound[0].variable, "Sem/Scale / x_25");
assert.equal(r.skipped[0].reason, "not bound");
assert.deepEqual(r.failed, [{ nodeId: "9:9", reason: "Node not found" }]);
assert.deepEqual(bound.cleared, [], "dryRun 은 쓰지 않는다");

r = await unbindVariable({ nodeIds: ["1:1"], property: "strokeWeight" });
assert.deepEqual(bound.cleared, ["strokeTopWeight", "strokeBottomWeight"]);
// 지원 안 하는 property 는 거부한다 (fills 는 아직 안 받는다)
await assert.rejects(unbindVariable({ nodeIds: ["1:1"], property: "fills" }), /Unsupported property/);

// ── E-22 get_component_properties ───────────────────────────────────────────
// 변이 자식은 자기 정의를 갖지 않는다(부모 세트가 갖는다) — 세면 중복이 된다
const btnSet = {
  id: "3:1", name: "Button", type: "COMPONENT_SET", parent: { type: "PAGE", name: "Button" },
  componentPropertyDefinitions: {
    Type: { type: "VARIANT", defaultValue: "Filled", variantOptions: ["Filled", "Ghost"] },
    "Label#1:2": { type: "TEXT", defaultValue: "라벨" },
  },
};
const variantChild = { id: "3:2", name: "Type=Filled", type: "COMPONENT", parent: btnSet };
ctx.figma.getNodeByIdAsync = async (id) => ({ "3:1": btnSet, "3:2": variantChild })[id] || null;

const cp = await getComponentProperties({ nodeIds: ["3:1", "3:2"] });
assert.equal(cp.scanned, 1, "변이 자식은 건너뛴다");
assert.deepEqual(cp.components[0].nonVariant, ["Label#1:2"]);
assert.deepEqual(cp.byPropertyType, { VARIANT: 1, BOOLEAN: 0, TEXT: 1, INSTANCE_SWAP: 0 });
assert.equal(cp.withNonVariantProps, 1);
assert.equal(cp.components[0].page, "Button");

await assert.rejects(getComponentProperties({}), /Missing scope/);

console.log("all checks passed");
