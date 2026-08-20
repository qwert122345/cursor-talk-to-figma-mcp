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
const { hardcodedProps, nearestComponent, paintsToValue, ancestorPath } = ctx;

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

console.log("all checks passed");
