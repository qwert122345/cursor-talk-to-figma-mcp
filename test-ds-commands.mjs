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
const { hardcodedProps, nearestComponent } = ctx;

const solid = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }];

// fills: hardcoded vs bound to a variable vs bound to a style vs image-only
assert.deepEqual(hardcodedProps({ fills: solid }), ["fills"]);
assert.deepEqual(
  hardcodedProps({ fills: solid, boundVariables: { fills: [{ type: "VARIABLE_ALIAS" }] } }),
  []
);
assert.deepEqual(hardcodedProps({ fills: solid, fillStyleId: "S:abc" }), []);
assert.deepEqual(hardcodedProps({ fills: [{ type: "IMAGE" }] }), []);
assert.deepEqual(hardcodedProps({ fills: [] }), []);

// cornerRadius: any of the four corner keys counts as bound
assert.deepEqual(hardcodedProps({ cornerRadius: 8 }), ["cornerRadius"]);
assert.deepEqual(
  hardcodedProps({ cornerRadius: 8, boundVariables: { topLeftRadius: { id: "V:1" } } }),
  []
);

// noise guards: 0 and mixed are not findings
assert.deepEqual(hardcodedProps({ cornerRadius: 0, itemSpacing: 0, paddingLeft: 0 }), []);
assert.deepEqual(hardcodedProps({ fontSize: MIXED }), []);

// multiple properties on one node
assert.deepEqual(hardcodedProps({ itemSpacing: 16, paddingTop: 12, fontSize: 14 }), [
  "itemSpacing",
  "paddingTop",
  "fontSize",
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

console.log("all checks passed");
