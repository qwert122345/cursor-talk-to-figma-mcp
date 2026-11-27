#!/usr/bin/env node

// src/talk_to_figma_mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { readFile, writeFile, mkdir, access } from "fs/promises";
import { dirname, isAbsolute, resolve } from "path";

// src/talk_to_figma_mcp/readOptions.ts
function isScalar(v) {
  return v === null || typeof v !== "object";
}
function scalarsOf(obj) {
  const out = {};
  for (const k of Object.keys(obj)) if (isScalar(obj[k])) out[k] = obj[k];
  return out;
}
var NODE_FIELDS = [
  "name",
  "type",
  "fills",
  "strokes",
  "cornerRadius",
  "absoluteBoundingBox",
  "characters",
  "style"
];
function projectNode(node, fields, maxDepth, depth = 0) {
  if (node === null || typeof node !== "object") return node;
  const keep = fields ? /* @__PURE__ */ new Set(["id", ...fields]) : null;
  const out = {};
  for (const k of Object.keys(node)) {
    if (k === "children") continue;
    if (!keep || keep.has(k)) out[k] = node[k];
  }
  if (Array.isArray(node.children)) {
    if (maxDepth !== void 0 && depth >= maxDepth) {
      out.childCount = node.children.length;
    } else {
      out.children = node.children.map((c) => projectNode(c, fields, maxDepth, depth + 1));
    }
  }
  return out;
}
function projectItems(items, fields) {
  if (!Array.isArray(items)) return items;
  const keep = /* @__PURE__ */ new Set(["id", ...fields]);
  return items.map((it) => {
    if (it === null || typeof it !== "object") return it;
    const out = {};
    for (const k of Object.keys(it)) if (keep.has(k)) out[k] = it[k];
    return out;
  });
}
function withProjectedList(result, listKey, fields) {
  if (result === null || typeof result !== "object" || !(listKey in result)) return result;
  return { ...result, [listKey]: projectItems(result[listKey], fields) };
}
var HIDDEN_FIELDS = ["name", "type", "page", "path", "reasons", "detail"];
function projectHidden(result, fields) {
  return withProjectedList(result, "findings", fields);
}
function summarizeHidden(result) {
  if (result === null || typeof result !== "object") return result;
  const out = { summary: true, ...scalarsOf(result) };
  if (result.byReason !== void 0) out.byReason = result.byReason;
  return out;
}
var BYNAME_FIELDS = ["name", "type", "page", "path", "parentId", "parentType", "component", "variant"];
function projectByName(result, fields) {
  return withProjectedList(result, "findings", fields);
}
function summarizeByName(result) {
  if (result === null || typeof result !== "object") return result;
  const out = { summary: true, ...scalarsOf(result) };
  if (result.byType !== void 0) out.byType = result.byType;
  return out;
}
var CENSUS_FIELDS = [
  "key",
  "componentName",
  "componentSetName",
  "source",
  "count",
  "instances.name",
  "instances.page",
  "instances.path"
];
function projectCensus(result, fields) {
  if (result === null || typeof result !== "object") return result;
  const comp = fields.filter((f) => !f.startsWith("instances."));
  const inst = fields.filter((f) => f.startsWith("instances.")).map((f) => f.slice("instances.".length));
  const out = { ...result };
  if ("components" in out) out.components = projectItems(out.components, comp);
  if ("instances" in out) out.instances = projectItems(out.instances, inst);
  return out;
}
var CENSUS_TOP = 20;
function summarizeCensus(result) {
  if (result === null || typeof result !== "object") return result;
  const out = { summary: true, ...scalarsOf(result) };
  if (Array.isArray(result.components)) {
    out.topComponents = [...result.components].sort((a, b) => (b?.count ?? 0) - (a?.count ?? 0)).slice(0, CENSUS_TOP).map((c) => ({ componentName: c?.componentName, count: c?.count, source: c?.source }));
  }
  return out;
}
function summarizeBindings(result) {
  if (result === null || typeof result !== "object") return result;
  const out = { summary: true, ...scalarsOf(result) };
  for (const k of ["byProperty", "byValue", "byTextStyle"]) if (result[k] !== void 0) out[k] = result[k];
  if (result.byVariable && typeof result.byVariable === "object") {
    const byVar = {};
    for (const [name, v] of Object.entries(result.byVariable)) byVar[name] = v?.total;
    out.byVariable = byVar;
  }
  return out;
}

// src/talk_to_figma_mcp/server.ts
var logger = {
  info: (message) => process.stderr.write(`[INFO] ${message}
`),
  debug: (message) => process.stderr.write(`[DEBUG] ${message}
`),
  warn: (message) => process.stderr.write(`[WARN] ${message}
`),
  error: (message) => process.stderr.write(`[ERROR] ${message}
`),
  log: (message) => process.stderr.write(`[LOG] ${message}
`)
};
function jsonResult(result) {
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}
function errorResult(prefix, error) {
  const reason = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: prefix + reason }], isError: true };
}
var ws = null;
var pendingRequests = /* @__PURE__ */ new Map();
var currentChannel = null;
var server = new McpServer({
  name: "TalkToFigmaMCP",
  version: "1.0.0"
});
var args = process.argv.slice(2);
var serverArg = args.find((arg) => arg.startsWith("--server="));
var serverUrl = serverArg ? serverArg.split("=")[1] : "localhost";
var WS_URL = serverUrl === "localhost" ? `ws://${serverUrl}` : `wss://${serverUrl}`;
server.tool(
  "get_document_info",
  "Get detailed information about the current Figma document",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_document_info");
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error getting document info: `, error);
    }
  }
);
server.tool(
  "get_selection",
  "Get information about the current selection in Figma",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_selection");
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error getting selection: `, error);
    }
  }
);
server.tool(
  "read_my_design",
  "Get detailed information about the current selection in Figma, including all node details",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("read_my_design", {});
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error getting node info: `, error);
    }
  }
);
server.tool(
  "get_node_info",
  "Get detailed information about a specific node in Figma. To shrink a large tree, pass fields (keep only these, id always kept) and/or maxDepth (0 = the node itself; cut subtrees get childCount). Without them the result is unchanged.",
  {
    nodeId: z.string().describe("The ID of the node to get information about"),
    fields: z.array(z.enum(NODE_FIELDS)).min(1).optional().describe("Keep only these fields on every node (id is always kept)"),
    maxDepth: z.number().int().min(0).max(20).optional().describe("Stop at this depth: 0 = the node only, 1 = its children, ... Cut nodes get childCount")
  },
  async ({ nodeId, fields, maxDepth }) => {
    try {
      const result = await sendCommandToFigma("get_node_info", { nodeId });
      if (!result) {
        return jsonResult({ nodeId, type: "VECTOR", note: "VECTOR nodes are not dumped here; use get_vector_paths" });
      }
      if (fields !== void 0 || maxDepth !== void 0) {
        return jsonResult(projectNode(filterFigmaNode(result), fields, maxDepth));
      }
      return jsonResult(filterFigmaNode(result));
    } catch (error) {
      return errorResult(`Error getting node info: `, error);
    }
  }
);
function rgbaToHex(color) {
  if (color.startsWith("#")) {
    return color;
  }
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = Math.round(color.a * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}${a === 255 ? "" : a.toString(16).padStart(2, "0")}`;
}
function filterFigmaNode(node) {
  if (!node || node.type === "VECTOR") {
    return null;
  }
  const filtered = {
    id: node.id,
    name: node.name,
    type: node.type
  };
  if (node.fills && node.fills.length > 0) {
    filtered.fills = node.fills.map((fill) => {
      const processedFill = { ...fill };
      delete processedFill.boundVariables;
      delete processedFill.imageRef;
      if (processedFill.gradientStops) {
        processedFill.gradientStops = processedFill.gradientStops.map((stop) => {
          const processedStop = { ...stop };
          if (processedStop.color) {
            processedStop.color = rgbaToHex(processedStop.color);
          }
          delete processedStop.boundVariables;
          return processedStop;
        });
      }
      if (processedFill.color) {
        processedFill.color = rgbaToHex(processedFill.color);
      }
      return processedFill;
    });
  }
  if (node.strokes && node.strokes.length > 0) {
    filtered.strokes = node.strokes.map((stroke) => {
      const processedStroke = { ...stroke };
      delete processedStroke.boundVariables;
      if (processedStroke.color) {
        processedStroke.color = rgbaToHex(processedStroke.color);
      }
      return processedStroke;
    });
  }
  if (node.cornerRadius !== void 0) {
    filtered.cornerRadius = node.cornerRadius;
  }
  if (node.absoluteBoundingBox) {
    filtered.absoluteBoundingBox = node.absoluteBoundingBox;
  }
  if (node.characters) {
    filtered.characters = node.characters;
  }
  if (node.style) {
    filtered.style = {
      fontFamily: node.style.fontFamily,
      fontStyle: node.style.fontStyle,
      fontWeight: node.style.fontWeight,
      fontSize: node.style.fontSize,
      textAlignHorizontal: node.style.textAlignHorizontal,
      letterSpacing: node.style.letterSpacing,
      lineHeightPx: node.style.lineHeightPx
    };
  }
  if (node.children) {
    filtered.children = node.children.map((child) => filterFigmaNode(child)).filter((child) => child !== null);
  }
  return filtered;
}
server.tool(
  "get_nodes_info",
  "Get detailed information about multiple nodes in Figma. To shrink large trees, pass fields (keep only these, id always kept) and/or maxDepth (0 = each node itself; cut subtrees get childCount). Without them the result is unchanged.",
  {
    nodeIds: z.array(z.string()).describe("Array of node IDs to get information about"),
    fields: z.array(z.enum(NODE_FIELDS)).min(1).optional().describe("Keep only these fields on every node (id is always kept)"),
    maxDepth: z.number().int().min(0).max(20).optional().describe("Stop at this depth: 0 = each node only, 1 = its children, ... Cut nodes get childCount")
  },
  async ({ nodeIds, fields, maxDepth }) => {
    try {
      const results = await Promise.all(
        nodeIds.map(async (nodeId) => {
          const result = await sendCommandToFigma("get_node_info", { nodeId });
          return { nodeId, info: result };
        })
      );
      if (fields !== void 0 || maxDepth !== void 0) {
        return jsonResult(results.map((result) => projectNode(filterFigmaNode(result.info), fields, maxDepth)));
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results.map((result) => filterFigmaNode(result.info)))
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error getting nodes info: `, error);
    }
  }
);
server.tool(
  "create_rectangle",
  "Create a new rectangle in Figma",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    width: z.number().describe("Width of the rectangle"),
    height: z.number().describe("Height of the rectangle"),
    name: z.string().optional().describe("Optional name for the rectangle"),
    parentId: z.string().optional().describe("Optional parent node ID to append the rectangle to")
  },
  async ({ x, y, width, height, name, parentId }) => {
    try {
      const result = await sendCommandToFigma("create_rectangle", {
        x,
        y,
        width,
        height,
        name: name || "Rectangle",
        parentId
      });
      return {
        content: [
          {
            type: "text",
            text: `Created rectangle "${JSON.stringify(result)}"`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error creating rectangle: `, error);
    }
  }
);
server.tool(
  "create_frame",
  "Create a new frame in Figma",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    width: z.number().describe("Width of the frame"),
    height: z.number().describe("Height of the frame"),
    name: z.string().optional().describe("Optional name for the frame"),
    parentId: z.string().optional().describe("Optional parent node ID to append the frame to"),
    fillColor: z.object({
      r: z.number().min(0).max(1).describe("Red component (0-1)"),
      g: z.number().min(0).max(1).describe("Green component (0-1)"),
      b: z.number().min(0).max(1).describe("Blue component (0-1)"),
      a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)")
    }).optional().describe("Fill color in RGBA format"),
    strokeColor: z.object({
      r: z.number().min(0).max(1).describe("Red component (0-1)"),
      g: z.number().min(0).max(1).describe("Green component (0-1)"),
      b: z.number().min(0).max(1).describe("Blue component (0-1)"),
      a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)")
    }).optional().describe("Stroke color in RGBA format"),
    strokeWeight: z.number().positive().optional().describe("Stroke weight"),
    layoutMode: z.enum(["NONE", "HORIZONTAL", "VERTICAL"]).optional().describe("Auto-layout mode for the frame"),
    layoutWrap: z.enum(["NO_WRAP", "WRAP"]).optional().describe("Whether the auto-layout frame wraps its children"),
    paddingTop: z.number().optional().describe("Top padding for auto-layout frame"),
    paddingRight: z.number().optional().describe("Right padding for auto-layout frame"),
    paddingBottom: z.number().optional().describe("Bottom padding for auto-layout frame"),
    paddingLeft: z.number().optional().describe("Left padding for auto-layout frame"),
    primaryAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN"]).optional().describe("Primary axis alignment for auto-layout frame. Note: When set to SPACE_BETWEEN, itemSpacing will be ignored as children will be evenly spaced."),
    counterAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "BASELINE"]).optional().describe("Counter axis alignment for auto-layout frame"),
    layoutSizingHorizontal: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Horizontal sizing mode for auto-layout frame"),
    layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Vertical sizing mode for auto-layout frame"),
    itemSpacing: z.number().optional().describe("Distance between children in auto-layout frame. Note: This value will be ignored if primaryAxisAlignItems is set to SPACE_BETWEEN.")
  },
  async ({
    x,
    y,
    width,
    height,
    name,
    parentId,
    fillColor,
    strokeColor,
    strokeWeight,
    layoutMode,
    layoutWrap,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    primaryAxisAlignItems,
    counterAxisAlignItems,
    layoutSizingHorizontal,
    layoutSizingVertical,
    itemSpacing
  }) => {
    try {
      const result = await sendCommandToFigma("create_frame", {
        x,
        y,
        width,
        height,
        name: name || "Frame",
        parentId,
        fillColor: fillColor || { r: 1, g: 1, b: 1, a: 1 },
        strokeColor,
        strokeWeight,
        layoutMode,
        layoutWrap,
        paddingTop,
        paddingRight,
        paddingBottom,
        paddingLeft,
        primaryAxisAlignItems,
        counterAxisAlignItems,
        layoutSizingHorizontal,
        layoutSizingVertical,
        itemSpacing
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Created frame "${typedResult.name}" with ID: ${typedResult.id}. Use the ID as the parentId to appendChild inside this frame.`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error creating frame: `, error);
    }
  }
);
server.tool(
  "create_text",
  "Create a new text element in Figma",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    text: z.string().describe("Text content"),
    fontSize: z.number().optional().describe("Font size (default: 14)"),
    fontWeight: z.number().optional().describe("Font weight (e.g., 400 for Regular, 700 for Bold)"),
    fontColor: z.object({
      r: z.number().min(0).max(1).describe("Red component (0-1)"),
      g: z.number().min(0).max(1).describe("Green component (0-1)"),
      b: z.number().min(0).max(1).describe("Blue component (0-1)"),
      a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)")
    }).optional().describe("Font color in RGBA format"),
    name: z.string().optional().describe("Semantic layer name for the text node"),
    parentId: z.string().optional().describe("Optional parent node ID to append the text to"),
    fontFamily: z.string().optional().describe(
      "Font family name, e.g. 'SUIT'. Defaults to Inter. Falls back to Inter if the family is not available."
    ),
    fontStyle: z.string().optional().describe(
      "Font style name, e.g. 'Medium', 'Bold', 'ExtraBold'. Overrides the fontWeight mapping when given."
    ),
    width: z.number().optional().describe(
      "Fixed width with automatic height (textAutoResize=HEIGHT), so long text wraps instead of being clipped."
    )
  },
  async ({ x, y, text, fontSize, fontWeight, fontColor, name, parentId, fontFamily, fontStyle, width }) => {
    try {
      const result = await sendCommandToFigma("create_text", {
        x,
        y,
        text,
        fontSize: fontSize || 14,
        fontWeight: fontWeight || 400,
        fontColor: fontColor || { r: 0, g: 0, b: 0, a: 1 },
        name: name || "Text",
        parentId,
        fontFamily,
        fontStyle,
        width
      });
      const typedResult = result;
      const font = typedResult.fontName ? ` [font: ${typedResult.fontName.family} ${typedResult.fontName.style}]` : "";
      const fallback = typedResult.fontFallbackReason ? ` (FELL BACK to Inter: ${typedResult.fontFallbackReason})` : "";
      return {
        content: [
          {
            type: "text",
            text: `Created text "${typedResult.name}" with ID: ${typedResult.id}${font}${fallback}`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error creating text: `, error);
    }
  }
);
server.tool(
  "set_fill_color",
  "Set the fill color of a node in Figma can be TextNode or FrameNode",
  {
    nodeId: z.string().describe("The ID of the node to modify"),
    r: z.number().min(0).max(1).describe("Red component (0-1)"),
    g: z.number().min(0).max(1).describe("Green component (0-1)"),
    b: z.number().min(0).max(1).describe("Blue component (0-1)"),
    a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)")
  },
  async ({ nodeId, r, g, b, a }) => {
    try {
      const result = await sendCommandToFigma("set_fill_color", {
        nodeId,
        color: { r, g, b, a: a ?? 1 }
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Set fill color of node "${typedResult.name}" to RGBA(${r}, ${g}, ${b}, ${a ?? 1})`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error setting fill color: `, error);
    }
  }
);
server.tool(
  "set_stroke_color",
  "Set the stroke color of a node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to modify"),
    r: z.number().min(0).max(1).describe("Red component (0-1)"),
    g: z.number().min(0).max(1).describe("Green component (0-1)"),
    b: z.number().min(0).max(1).describe("Blue component (0-1)"),
    a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)"),
    weight: z.number().positive().optional().describe("Stroke weight")
  },
  async ({ nodeId, r, g, b, a, weight }) => {
    try {
      const result = await sendCommandToFigma("set_stroke_color", {
        nodeId,
        color: { r, g, b, a: a ?? 1 },
        weight
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Set stroke color of node "${typedResult.name}" to RGBA(${r}, ${g}, ${b}, ${a ?? 1})${weight !== void 0 ? ` with weight ${weight}` : ""}`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error setting stroke color: `, error);
    }
  }
);
server.tool(
  "move_node",
  "Move a node to a new position in Figma",
  {
    nodeId: z.string().describe("The ID of the node to move"),
    x: z.number().describe("New X position"),
    y: z.number().describe("New Y position")
  },
  async ({ nodeId, x, y }) => {
    try {
      const result = await sendCommandToFigma("move_node", { nodeId, x, y });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Moved node "${typedResult.name}" to position (${x}, ${y})`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error moving node: `, error);
    }
  }
);
server.tool(
  "clone_node",
  "Clone an existing node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to clone"),
    x: z.number().optional().describe("New X position for the clone"),
    y: z.number().optional().describe("New Y position for the clone")
  },
  async ({ nodeId, x, y }) => {
    try {
      const result = await sendCommandToFigma("clone_node", { nodeId, x, y });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Cloned node "${typedResult.name}" with new ID: ${typedResult.id}${x !== void 0 && y !== void 0 ? ` at position (${x}, ${y})` : ""}`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error cloning node: `, error);
    }
  }
);
server.tool(
  "resize_node",
  "Resize a node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to resize"),
    width: z.number().positive().describe("New width"),
    height: z.number().positive().describe("New height")
  },
  async ({ nodeId, width, height }) => {
    try {
      const result = await sendCommandToFigma("resize_node", {
        nodeId,
        width,
        height
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Resized node "${typedResult.name}" to width ${width} and height ${height}`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error resizing node: `, error);
    }
  }
);
server.tool(
  "delete_node",
  "Delete a node from Figma",
  {
    nodeId: z.string().describe("The ID of the node to delete")
  },
  async ({ nodeId }) => {
    try {
      await sendCommandToFigma("delete_node", { nodeId });
      return {
        content: [
          {
            type: "text",
            text: `Deleted node with ID: ${nodeId}`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error deleting node: `, error);
    }
  }
);
server.tool(
  "delete_multiple_nodes",
  "Delete multiple nodes from Figma at once",
  {
    nodeIds: z.array(z.string()).describe("Array of node IDs to delete")
  },
  async ({ nodeIds }) => {
    try {
      const result = await sendCommandToFigma("delete_multiple_nodes", { nodeIds });
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error deleting multiple nodes: `, error);
    }
  }
);
server.tool(
  "export_node_as_image",
  "Export a node as an image from Figma",
  {
    nodeId: z.string().describe("The ID of the node to export"),
    format: z.enum(["PNG", "JPG", "SVG", "PDF"]).optional().describe("Export format"),
    scale: z.number().positive().optional().describe("Export scale")
  },
  async ({ nodeId, format, scale }) => {
    try {
      const result = await sendCommandToFigma("export_node_as_image", {
        nodeId,
        format: format || "PNG",
        scale: scale || 1
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "image",
            data: typedResult.imageData,
            mimeType: typedResult.mimeType || "image/png"
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error exporting node as image: `, error);
    }
  }
);
server.tool(
  "set_text_content",
  "Set the text content of an existing text node in Figma",
  {
    nodeId: z.string().describe("The ID of the text node to modify"),
    text: z.string().describe("New text content")
  },
  async ({ nodeId, text }) => {
    try {
      const result = await sendCommandToFigma("set_text_content", {
        nodeId,
        text
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Updated text content of node "${typedResult.name}" to "${text}"`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error setting text content: `, error);
    }
  }
);
server.tool(
  "get_styles",
  "Get all styles from the current Figma document",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_styles");
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error getting styles: `, error);
    }
  }
);
server.tool(
  "rename_variant_property",
  "Rename a variant property key on component sets (e.g. Size -> Scale) via editComponentProperty, the sanctioned path that also migrates existing instances. Pass dryRun first to see which sets would change. Sets without the property are reported as skipped, not failed.",
  {
    nodeIds: z.array(z.string()).describe("COMPONENT_SET node ids"),
    from: z.string().describe("Current property key, e.g. Size"),
    to: z.string().describe("New property key, e.g. Scale"),
    dryRun: z.boolean().optional().describe("Report what would change without writing")
  },
  async ({ nodeIds, from, to, dryRun }) => {
    try {
      const result = await sendCommandToFigma("rename_variant_property", { nodeIds, from, to, dryRun });
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error renaming variant property: `, error);
    }
  }
);
server.tool(
  "bind_variable",
  "Bind a variable to one property across many nodes at once \u2014 the fix for hardcoded literals. Pass variableKey (from get_local_variables, run against the LIBRARY file) to bind a published library variable in a consuming file; variableId only works for a variable local to the current file. property 'cornerRadius' binds all four corners; 'fills'/'strokes' bind the color of the first SOLID paint and keep its opacity (re-written after binding; each result reports opacityKept). Nodes already bound are reported under skipped, not overwritten. Pass dryRun first.",
  {
    nodeIds: z.array(z.string()).describe("Node ids to bind"),
    property: z.string().describe("fills | strokes | itemSpacing | counterAxisSpacing | cornerRadius | paddingLeft/Right/Top/Bottom | strokeWeight | width | height | minWidth | maxWidth | minHeight | maxHeight"),
    variableKey: z.string().optional().describe("Key of a published variable (imported via importVariableByKeyAsync). Use this across files"),
    variableId: z.string().optional().describe("Id of a variable local to the current file"),
    variableName: z.string().optional().describe("Full variable name (e.g. max/panel): looked up in local variables first, then enabled libraries via teamLibrary"),
    variableFromNodeId: z.string().optional().describe("Use the variable bound to this node's first SOLID fill (no library permission needed)"),
    overwrite: z.boolean().optional().describe("fills/strokes only: rebind a paint already bound to another variable instead of skipping it"),
    dryRun: z.boolean().optional().describe("Report what would change without writing")
  },
  async ({ nodeIds, property, variableKey, variableId, variableFromNodeId, variableName, overwrite, dryRun }) => {
    try {
      const result = await sendCommandToFigma("bind_variable", { nodeIds, property, variableKey, variableId, variableFromNodeId, variableName, overwrite, dryRun });
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error binding variable: `, error);
    }
  }
);
server.tool(
  "unbind_variable",
  "Detach variable bindings from one or more properties \u2014 the reverse of bind_variable. The resolved value stays as a raw literal, so nothing re-renders. Two ways to aim it: pass nodeIds for a known list, or scope with pageName/nodeId (omit both to sweep the whole file) and let it find the bound nodes itself. onlyOutsideComponents keeps only documentation nodes \u2014 anything that is not a COMPONENT/COMPONENT_SET/INSTANCE and has no component ancestor \u2014 which is how you clean tokens off spec frames and the wrappers around component sets without touching the components. property 'strokeWeight' also sweeps the four per-side fields (strokeTop/Bottom/Left/RightWeight), 'cornerRadius' all four corners, 'padding' all four sides. Under a scope, nodes with nothing bound are skipped silently; with explicit nodeIds they are reported. Always pass dryRun first and read byPage/byVariable.",
  {
    nodeIds: z.array(z.string()).optional().describe("Explicit node ids to unbind"),
    pageName: z.string().optional().describe("Scope the sweep to one page"),
    nodeId: z.string().optional().describe("Scope the sweep to this node and its children"),
    excludePages: z.array(z.string()).optional().describe("Page names to skip when sweeping"),
    onlyOutsideComponents: z.boolean().optional().describe("Only nodes with no component ancestor (documentation frames)"),
    property: z.string().optional().describe("itemSpacing | counterAxisSpacing | cornerRadius | padding | paddingLeft/Right/Top/Bottom | strokeWeight | width | height"),
    properties: z.array(z.string()).optional().describe("Several of the above at once, in a single traversal"),
    dryRun: z.boolean().optional().describe("Report what would be cleared without writing")
  },
  async ({ nodeIds, pageName, nodeId, excludePages, onlyOutsideComponents, property, properties, dryRun }) => {
    try {
      const result = await sendCommandToFigma("unbind_variable", { nodeIds, pageName, nodeId, excludePages, onlyOutsideComponents, property, properties, dryRun });
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error unbinding variable: `, error);
    }
  }
);
server.tool(
  "get_component_properties",
  "Read componentPropertyDefinitions \u2014 the BOOLEAN, TEXT and INSTANCE_SWAP properties that get_local_components does not return (it gives variant axes only). Scope with nodeIds or pageName; one is required. Variant children are skipped because their definitions live on the parent COMPONENT_SET. Returns per component the full property map (type, defaultValue, variantOptions, preferredValues), the list of non-variant property names, and a byPropertyType rollup.",
  {
    nodeIds: z.array(z.string()).optional().describe("Component or component-set ids to read"),
    pageName: z.string().optional().describe("Read every top-level component on this page instead")
  },
  async ({ nodeIds, pageName }) => {
    try {
      const result = await sendCommandToFigma("get_component_properties", { nodeIds, pageName });
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error getting component properties: `, error);
    }
  }
);
server.tool(
  "swap_instances_by_key",
  "Rebind instances to a different main component, given the target component key. This is the fix for orphan instances whose old library component no longer exists in the DS file. Pass viaNodeId \u2014 the id of a healthy instance whose component set contains the target variant \u2014 and the target is resolved from that set's siblings with no document scan. viaNodeId is REQUIRED in practice for `.`-prefixed (unpublished) components: importComponentByKeyAsync cannot fetch them and create_component_instance fails on them. Without viaNodeId it falls back to importComponentByKeyAsync, then to a document scan that stops at the first match. Pass dryRun first to see what would change.",
  {
    nodeIds: z.array(z.string()).describe("INSTANCE node ids to rebind"),
    toKey: z.string().describe("Key of the component to swap to (from get_local_components)"),
    viaNodeId: z.string().optional().describe("An instance already bound to the target's component set; the target variant is taken from its siblings. Required for `.`-prefixed components"),
    dryRun: z.boolean().optional().describe("Report what would change without writing")
  },
  async ({ nodeIds, toKey, viaNodeId, dryRun }) => {
    try {
      const result = await sendCommandToFigma("swap_instances_by_key", { nodeIds, toKey, viaNodeId, dryRun });
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error swapping instances: `, error);
    }
  }
);
server.tool(
  "get_grid_usage",
  "Report which nodes consume each local grid style, with per-page counts and a node sample. Reverse lookup via style.consumers, so no full document walk. This is the only way to tell whether a grid style is actually applied: get_node_info and get_layout_audit never return gridStyleId or layoutGrids.",
  {
    sample: z.number().optional().describe("Max consumer nodes listed per style (default 20); counts are always complete")
  },
  async ({ sample }) => {
    try {
      const result = await sendCommandToFigma("get_grid_usage", { sample });
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error getting grid usage: `, error);
    }
  }
);
server.tool(
  "get_local_components",
  "Get all local components and component sets, with name, type, key, description, documentationLinks, page, parent and variant properties. Pass checkPublished to also report whether each top-level component is actually published to a team library (one network round trip per component, so it is slow).",
  {
    checkPublished: z.boolean().optional().describe("Also resolve publish state per top-level component (slow)")
  },
  async ({ checkPublished }) => {
    try {
      const result = await sendCommandToFigma("get_local_components", { checkPublished }, 6e5);
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error getting local components: `, error);
    }
  }
);
server.tool(
  "get_local_variables",
  "Get all local variable collections and variables (modes, scopes, per-mode values, resolved aliases, HEX for colors). Works on Figma Pro, where the REST variables API does not.",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_local_variables", {}, 6e4);
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error getting local variables: `, error);
    }
  }
);
server.tool(
  "get_variable_bindings",
  "Find nodes using hardcoded values (fills, strokes, cornerRadius, itemSpacing, padding, fontSize) instead of variables. Returns the actual value per finding plus a byValue histogram (e.g. how many places paint #F5F5F5), alongside per-property and per-component/variant rollups and the node list. Colors are hex with opacity folded into alpha. Scope with nodeId or pageName; skip pages with excludePages.",
  {
    nodeId: z.string().optional().describe("Limit the scan to this node and its children"),
    pageName: z.string().optional().describe("Limit the scan to a single page by name"),
    excludePages: z.array(z.string()).optional().describe("Page names to skip (e.g. the checklist page)"),
    detail: z.boolean().optional().describe("Return the node list, not just the counts (default true)"),
    limit: z.number().optional().describe("Max findings to return (default 500)"),
    offset: z.number().optional().describe("Findings to skip, for paging through large results"),
    summary: z.boolean().optional().describe("Counts only: totals, byProperty, byValue, byTextStyle and byVariable as {name: total}. No findings or per-variable component lists. Not with detail:true")
  },
  async ({ nodeId, pageName, excludePages, detail, limit, offset, summary }) => {
    try {
      if (summary === true && detail === true) {
        return errorResult("Refused: ", "summary cannot be combined with detail:true. Nothing was read.");
      }
      const result = await sendCommandToFigma(
        "get_variable_bindings",
        { nodeId, pageName, excludePages, detail, limit, offset },
        12e4
      );
      if (summary === true) {
        return jsonResult(summarizeBindings(result));
      }
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error getting variable bindings: `, error);
    }
  }
);
server.tool(
  "unbind_styles",
  "Clear shared-style bindings (fill/stroke/effect/grid/text) under a node while keeping the painted values, which cuts a dependency on an external library without changing appearance. IRREVERSIBLE - run with dryRun first. By default only external-library styles are unbound.",
  {
    nodeId: z.string().describe("Node whose descendants should have style bindings cleared"),
    dryRun: z.boolean().optional().describe("Report what would be unbound without changing anything"),
    onlyRemote: z.boolean().optional().describe("Only unbind external-library styles (default true)")
  },
  async ({ nodeId, dryRun, onlyRemote }) => {
    try {
      const result = await sendCommandToFigma(
        "unbind_styles",
        { nodeId, dryRun, onlyRemote },
        3e5
      );
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error unbinding styles: `, error);
    }
  }
);
server.tool(
  "detach_instances",
  "Detach component instances under a node, in passes so nested instances are reached too. IRREVERSIBLE - always run with dryRun first to review the list. By default only instances of remote (external library) components are detached; set onlyRemote false to detach local ones too.",
  {
    nodeId: z.string().describe("Node whose descendant instances should be detached"),
    dryRun: z.boolean().optional().describe("Report what would be detached without changing anything"),
    onlyRemote: z.boolean().optional().describe("Only detach instances of external-library components (default true)"),
    maxPasses: z.number().optional().describe("Max nesting passes (default 12)")
  },
  async ({ nodeId, dryRun, onlyRemote, maxPasses }) => {
    try {
      const result = await sendCommandToFigma(
        "detach_instances",
        { nodeId, dryRun, onlyRemote, maxPasses },
        3e5
      );
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error detaching instances: `, error);
    }
  }
);
server.tool(
  "get_hyperlinks",
  "List text hyperlinks (URL or NODE targets) with the linked text, reading live nodes. For NODE links it also reports whether the destination still exists and which page it is on, so broken index links can be found. Scope with nodeId or pageName.",
  {
    nodeId: z.string().optional().describe("Limit the scan to this node and its children"),
    pageName: z.string().optional().describe("Limit the scan to a single page by name"),
    excludePages: z.array(z.string()).optional().describe("Page names to skip")
  },
  async ({ nodeId, pageName, excludePages }) => {
    try {
      const result = await sendCommandToFigma(
        "get_hyperlinks",
        { nodeId, pageName, excludePages },
        12e4
      );
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error getting hyperlinks: `, error);
    }
  }
);
server.tool(
  "get_layout_audit",
  "Per-component rollup of auto layout usage, HUG/FILL/FIXED sizing, actual padding and itemSpacing values, drop shadows (effects), and shared text/fill style bindings. Reads live plugin nodes, so it returns fields the JSON_REST_V1 export omits. Scope with nodeId or pageName; skip pages with excludePages.",
  {
    nodeId: z.string().optional().describe("Limit the audit to this node and its children"),
    pageName: z.string().optional().describe("Limit the audit to a single page by name"),
    excludePages: z.array(z.string()).optional().describe("Page names to skip (e.g. the checklist page)")
  },
  async ({ nodeId, pageName, excludePages }) => {
    try {
      const result = await sendCommandToFigma(
        "get_layout_audit",
        { nodeId, pageName, excludePages },
        12e4
      );
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error getting layout audit: `, error);
    }
  }
);
server.tool(
  "set_multiple_opacity",
  "Set opacity on many nodes at once (0-1). Returns previousOpacity per node so the change can be undone.",
  {
    nodeIds: z.array(z.string()).describe("Nodes to change"),
    opacity: z.number().min(0).max(1).describe("Opacity 0-1, e.g. 0.3 for 30%")
  },
  async ({ nodeIds, opacity }) => {
    try {
      const result = await sendCommandToFigma("set_multiple_opacity", { nodeIds, opacity }, 6e4);
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error setting opacity: `, error);
    }
  }
);
server.tool(
  "find_nodes_by_name",
  'Find nodes by layer name across the file. find_hidden_nodes only reports nodes that are invisible and scan_nodes_by_types cannot filter by name, so this is the way to enumerate a standard layer (e.g. every "Interaction" frame). Narrow with types (node types) and parentTypes \u2014 parentTypes:["COMPONENT"] keeps only main-component children and drops copies living inside instances, which cannot be edited anyway. idsOnly returns just the id array, unpaged, ready to hand to delete_multiple_nodes or set_selections. Scope with nodeId or pageName, skip pages with excludePages.',
  {
    name: z.string().describe("Layer name to match (substring, case-insensitive, unless exact)"),
    exact: z.boolean().optional().describe("Require the whole name to match exactly, case-sensitive"),
    types: z.array(z.string()).optional().describe('Only report these node types, e.g. ["FRAME"]'),
    parentTypes: z.array(z.string()).optional().describe('Only report nodes whose direct parent is one of these types, e.g. ["COMPONENT"]'),
    idsOnly: z.boolean().optional().describe("Return only the id array (unpaged) instead of full findings"),
    nodeId: z.string().optional().describe("Limit the scan to this node and its children"),
    pageName: z.string().optional().describe("Limit the scan to a single page by name"),
    excludePages: z.array(z.string()).optional().describe("Page names to skip"),
    limit: z.number().optional().describe("Max findings to return (default 500)"),
    offset: z.number().optional().describe("Findings to skip, for paging"),
    fields: z.array(z.enum(BYNAME_FIELDS)).min(1).optional().describe("Keep only these fields on each finding (id is always kept)"),
    summary: z.boolean().optional().describe("Counts only (totals and byType), no findings. Not with fields or idsOnly")
  },
  async ({ name, exact, types, parentTypes, idsOnly, nodeId, pageName, excludePages, limit, offset, fields, summary }) => {
    try {
      if (summary === true && (fields !== void 0 || idsOnly === true)) {
        return errorResult("Refused: ", "summary cannot be combined with fields or idsOnly. Nothing was read.");
      }
      const result = await sendCommandToFigma(
        "find_nodes_by_name",
        { name, exact, types, parentTypes, idsOnly, nodeId, pageName, excludePages, limit, offset },
        12e4
      );
      if (summary === true) {
        return jsonResult(summarizeByName(result));
      }
      if (fields !== void 0) {
        return jsonResult(projectByName(result, fields));
      }
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error finding nodes by name: `, error);
    }
  }
);
server.tool(
  "find_hidden_nodes",
  `Find nodes that exist in the file but are not visible on canvas, with the reason for each: hidden (visible=false), parentHidden (an ancestor is toggled off), transparent (opacity 0), faded (opacity below 1, only with includeFaded), zeroSize, clipped (fully outside a clipsContent ancestor) or clippedPartly. get_node_info does not return visible/opacity/clipsContent, so this is the only way to answer "why can't I see it". Scope with nodeId or pageName, skip pages with excludePages, and narrow with nameFilter (substring, case-insensitive).`,
  {
    nodeId: z.string().optional().describe("Limit the scan to this node and its children"),
    pageName: z.string().optional().describe("Limit the scan to a single page by name"),
    excludePages: z.array(z.string()).optional().describe("Page names to skip"),
    nameFilter: z.string().optional().describe('Only report nodes whose name contains this (case-insensitive), e.g. ".Slot"'),
    includeFaded: z.boolean().optional().describe('Also report nodes with opacity below 1 as reason "faded" (detail.opacity holds the value). Off by default because intentionally translucent nodes are common; turn it on to read opacity, which no other command returns.'),
    limit: z.number().optional().describe("Max findings to return (default 500)"),
    offset: z.number().optional().describe("Findings to skip, for paging"),
    fields: z.array(z.enum(HIDDEN_FIELDS)).min(1).optional().describe("Keep only these fields on each finding (id is always kept)"),
    summary: z.boolean().optional().describe("Counts only (totals and byReason), no findings. Not with fields")
  },
  async ({ nodeId, pageName, excludePages, nameFilter, includeFaded, limit, offset, fields, summary }) => {
    try {
      if (summary === true && fields !== void 0) {
        return errorResult("Refused: ", "summary cannot be combined with fields. Nothing was read.");
      }
      const result = await sendCommandToFigma(
        "find_hidden_nodes",
        { nodeId, pageName, excludePages, nameFilter, includeFaded, limit, offset },
        12e4
      );
      if (summary === true) {
        return jsonResult(summarizeHidden(result));
      }
      if (fields !== void 0) {
        return jsonResult(projectHidden(result, fields));
      }
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error finding hidden nodes: `, error);
    }
  }
);
server.tool(
  "find_variable_usage",
  "Read-only. List main components (COMPONENT, grouped by COMPONENT_SET) whose own layers bind the given variables: fills, strokes, effects, text ranges, numeric fields, and paint styles bound to the variable (source 'style:<name>'). Nested instances are skipped entirely (the instance node itself, its layers and overrides). Scope by a contiguous page range in document order with fromPage/toPage.",
  {
    variableNames: z.array(z.string()).optional().describe("Local variable names, e.g. RD/SYS/primary"),
    variableIds: z.array(z.string()).optional().describe("Variable ids (VariableID:...)"),
    fromPage: z.string().optional().describe("First page name of the range (inclusive)"),
    toPage: z.string().optional().describe("Last page name of the range (inclusive)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("find_variable_usage", params, 6e5);
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error finding variable usage: `, error);
    }
  }
);
server.tool(
  "get_instance_census",
  "Count instances per main component across the current file, split into library (design system) and local components. Run it on a product file to measure design system usage. Pass instancesFor (component key/id/name) to also get where those instances are - id, page and ancestor path - which is the only way to locate instances whose layer name is the slot name rather than the component name.",
  {
    pageName: z.string().optional().describe("Limit the census to a single page by name"),
    excludePages: z.array(z.string()).optional().describe("Page names to skip"),
    instancesFor: z.string().optional().describe("Component key, id, name or set name: also list where those instances actually are (id, page, ancestor path)"),
    instanceLimit: z.number().optional().describe("Max instances to list for instancesFor (default 1000)"),
    fields: z.array(z.enum(CENSUS_FIELDS)).min(1).optional().describe("Keep only these fields: plain names for components[], 'instances.<name>' for instances[] (id is always kept)"),
    summary: z.boolean().optional().describe("Totals plus the top 20 components by count (componentName, count, source). Not with fields")
  },
  async ({ pageName, excludePages, instancesFor, instanceLimit, fields, summary }) => {
    try {
      if (summary === true && fields !== void 0) {
        return errorResult("Refused: ", "summary cannot be combined with fields. Nothing was read.");
      }
      const result = await sendCommandToFigma(
        "get_instance_census",
        { pageName, excludePages, instancesFor, instanceLimit },
        12e4
      );
      if (summary === true) {
        return jsonResult(summarizeCensus(result));
      }
      if (fields !== void 0) {
        return jsonResult(projectCensus(result, fields));
      }
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error getting instance census: `, error);
    }
  }
);
server.tool(
  "get_annotations",
  "Get all annotations in the current document or specific node",
  {
    nodeId: z.string().describe("node ID to get annotations for specific node"),
    includeCategories: z.boolean().optional().default(true).describe("Whether to include category information")
  },
  async ({ nodeId, includeCategories }) => {
    try {
      const result = await sendCommandToFigma("get_annotations", {
        nodeId,
        includeCategories
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error getting annotations: `, error);
    }
  }
);
server.tool(
  "set_annotation",
  "Create or update an annotation",
  {
    nodeId: z.string().describe("The ID of the node to annotate"),
    annotationId: z.string().optional().describe("The ID of the annotation to update (if updating existing annotation)"),
    labelMarkdown: z.string().describe("The annotation text in markdown format"),
    categoryId: z.string().optional().describe("The ID of the annotation category"),
    properties: z.array(z.object({
      type: z.string()
    })).optional().describe("Additional properties for the annotation")
  },
  async ({ nodeId, annotationId, labelMarkdown, categoryId, properties }) => {
    try {
      const result = await sendCommandToFigma("set_annotation", {
        nodeId,
        annotationId,
        labelMarkdown,
        categoryId,
        properties
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error setting annotation: `, error);
    }
  }
);
server.tool(
  "set_multiple_annotations",
  "Set multiple annotations parallelly in a node",
  {
    nodeId: z.string().describe("The ID of the node containing the elements to annotate"),
    annotations: z.array(
      z.object({
        nodeId: z.string().describe("The ID of the node to annotate"),
        labelMarkdown: z.string().describe("The annotation text in markdown format"),
        categoryId: z.string().optional().describe("The ID of the annotation category"),
        annotationId: z.string().optional().describe("The ID of the annotation to update (if updating existing annotation)"),
        properties: z.array(z.object({
          type: z.string()
        })).optional().describe("Additional properties for the annotation")
      })
    ).describe("Array of annotations to apply")
  },
  async ({ nodeId, annotations }) => {
    try {
      if (!annotations || annotations.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No annotations provided"
            }
          ]
        };
      }
      const initialStatus = {
        type: "text",
        text: `Starting annotation process for ${annotations.length} nodes. This will be processed in batches of 5...`
      };
      let totalProcessed = 0;
      const totalToProcess = annotations.length;
      const result = await sendCommandToFigma("set_multiple_annotations", {
        nodeId,
        annotations
      });
      const typedResult = result;
      const success = typedResult.annotationsApplied && typedResult.annotationsApplied > 0;
      const progressText = `
      Annotation process completed:
      - ${typedResult.annotationsApplied || 0} of ${totalToProcess} successfully applied
      - ${typedResult.annotationsFailed || 0} failed
      - Processed in ${typedResult.completedInChunks || 1} batches
      `;
      const detailedResults = typedResult.results || [];
      const failedResults = detailedResults.filter((item) => !item.success);
      let detailedResponse = "";
      if (failedResults.length > 0) {
        detailedResponse = `

Nodes that failed:
${failedResults.map(
          (item) => `- ${item.nodeId}: ${item.error || "Unknown error"}`
        ).join("\n")}`;
      }
      return {
        content: [
          initialStatus,
          {
            type: "text",
            text: progressText + detailedResponse
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error setting multiple annotations: `, error);
    }
  }
);
server.tool(
  "create_component_instance",
  "Create an instance of a component in Figma. For LOCAL components (from get_local_components), use componentId with the id field. For published LIBRARY components, use componentKey with the publishedKey field.",
  {
    componentId: z.string().optional().describe("ID of a local component (use the id field from get_local_components result). Use this for unpublished/local components."),
    componentKey: z.string().optional().describe("Key of a published library component to instantiate (use the publishedKey field from get_local_components result). Only works for published components."),
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    parentId: z.string().optional().describe("Optional parent node ID to place the instance into")
  },
  async ({ componentId, componentKey, x, y, parentId }) => {
    try {
      const result = await sendCommandToFigma("create_component_instance", {
        componentId,
        componentKey,
        x,
        y,
        parentId
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(typedResult)
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error creating component instance: `, error);
    }
  }
);
server.tool(
  "get_instance_overrides",
  "Get all override properties from a selected component instance. These overrides can be applied to other instances, which will swap them to match the source component.",
  {
    nodeId: z.string().optional().describe("Optional ID of the component instance to get overrides from. If not provided, currently selected instance will be used.")
  },
  async ({ nodeId }) => {
    try {
      const result = await sendCommandToFigma("get_instance_overrides", {
        instanceNodeId: nodeId || null
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: typedResult.success ? `Successfully got instance overrides: ${typedResult.message}` : `Failed to get instance overrides: ${typedResult.message}`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error copying instance overrides: `, error);
    }
  }
);
server.tool(
  "set_instance_overrides",
  "Apply previously copied overrides to selected component instances. Target instances will be swapped to the source component and all copied override properties will be applied.",
  {
    sourceInstanceId: z.string().describe("ID of the source component instance"),
    targetNodeIds: z.array(z.string()).describe("Array of target instance IDs. Currently selected instances will be used.")
  },
  async ({ sourceInstanceId, targetNodeIds }) => {
    try {
      const result = await sendCommandToFigma("set_instance_overrides", {
        sourceInstanceId,
        targetNodeIds: targetNodeIds || []
      });
      const typedResult = result;
      if (typedResult.success) {
        const successCount = typedResult.results?.filter((r) => r.success).length || 0;
        return {
          content: [
            {
              type: "text",
              text: `Successfully applied ${typedResult.totalCount || 0} overrides to ${successCount} instances.`
            }
          ]
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Failed to set instance overrides: ${typedResult.message}`
            }
          ]
        };
      }
    } catch (error) {
      return errorResult(`Error setting instance overrides: `, error);
    }
  }
);
server.tool(
  "set_corner_radius",
  "Set the corner radius of a node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to modify"),
    radius: z.number().min(0).describe("Corner radius value"),
    corners: z.array(z.boolean()).length(4).optional().describe(
      "Optional array of 4 booleans to specify which corners to round [topLeft, topRight, bottomRight, bottomLeft]"
    )
  },
  async ({ nodeId, radius, corners }) => {
    try {
      const result = await sendCommandToFigma("set_corner_radius", {
        nodeId,
        radius,
        corners: corners || [true, true, true, true]
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Set corner radius of node "${typedResult.name}" to ${radius}px`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error setting corner radius: `, error);
    }
  }
);
server.prompt(
  "design_strategy",
  "Best practices for working with Figma designs",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `When working with Figma designs, follow these best practices:

1. Start with Document Structure:
   - First use get_document_info() to understand the current document
   - Plan your layout hierarchy before creating elements
   - Create a main container frame for each screen/section

2. Naming Conventions:
   - Use descriptive, semantic names for all elements
   - Follow a consistent naming pattern (e.g., "Login Screen", "Logo Container", "Email Input")
   - Group related elements with meaningful names

3. Layout Hierarchy:
   - Create parent frames first, then add child elements
   - For forms/login screens:
     * Start with the main screen container frame
     * Create a logo container at the top
     * Group input fields in their own containers
     * Place action buttons (login, submit) after inputs
     * Add secondary elements (forgot password, signup links) last

4. Input Fields Structure:
   - Create a container frame for each input field
   - Include a label text above or inside the input
   - Group related inputs (e.g., username/password) together

5. Element Creation:
   - Use create_frame() for containers and input fields
   - Use create_text() for labels, buttons text, and links
   - Set appropriate colors and styles:
     * Use fillColor for backgrounds
     * Use strokeColor for borders
     * Set proper fontWeight for different text elements

6. Mofifying existing elements:
  - use set_text_content() to modify text content.

7. Visual Hierarchy:
   - Position elements in logical reading order (top to bottom)
   - Maintain consistent spacing between elements
   - Use appropriate font sizes for different text types:
     * Larger for headings/welcome text
     * Medium for input labels
     * Standard for button text
     * Smaller for helper text/links

8. Best Practices:
   - Verify each creation with get_node_info()
   - Use parentId to maintain proper hierarchy
   - Group related elements together in frames
   - Keep consistent spacing and alignment

Example Login Screen Structure:
- Login Screen (main frame)
  - Logo Container (frame)
    - Logo (image/text)
  - Welcome Text (text)
  - Input Container (frame)
    - Email Input (frame)
      - Email Label (text)
      - Email Field (frame)
    - Password Input (frame)
      - Password Label (text)
      - Password Field (frame)
  - Login Button (frame)
    - Button Text (text)
  - Helper Links (frame)
    - Forgot Password (text)
    - Don't have account (text)`
          }
        }
      ],
      description: "Best practices for working with Figma designs"
    };
  }
);
server.prompt(
  "read_design_strategy",
  "Best practices for reading Figma designs",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `When reading Figma designs, follow these best practices:

1. Start with selection:
   - First use read_my_design() to understand the current selection
   - If no selection ask user to select single or multiple nodes
`
          }
        }
      ],
      description: "Best practices for reading Figma designs"
    };
  }
);
server.tool(
  "scan_text_nodes",
  "Scan all text nodes in the selected Figma node",
  {
    nodeId: z.string().describe("ID of the node to scan")
  },
  async ({ nodeId }) => {
    try {
      const initialStatus = {
        type: "text",
        text: "Starting text node scanning. This may take a moment for large designs..."
      };
      const result = await sendCommandToFigma("scan_text_nodes", {
        nodeId,
        useChunking: true,
        // Enable chunking on the plugin side
        chunkSize: 10
        // Process 10 nodes at a time
      });
      if (result && typeof result === "object" && "chunks" in result) {
        const typedResult = result;
        const summaryText = `
        Scan completed:
        - Found ${typedResult.totalNodes} text nodes
        - Processed in ${typedResult.chunks} chunks
        `;
        return {
          content: [
            initialStatus,
            {
              type: "text",
              text: summaryText
            },
            {
              type: "text",
              text: JSON.stringify(typedResult.textNodes, null, 2)
            }
          ]
        };
      }
      return {
        content: [
          initialStatus,
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error scanning text nodes: `, error);
    }
  }
);
server.tool(
  "scan_nodes_by_types",
  "Scan for child nodes with specific types in the selected Figma node",
  {
    nodeId: z.string().describe("ID of the node to scan"),
    types: z.array(z.string()).describe("Array of node types to find in the child nodes (e.g. ['COMPONENT', 'FRAME'])")
  },
  async ({ nodeId, types }) => {
    try {
      const initialStatus = {
        type: "text",
        text: `Starting node type scanning for types: ${types.join(", ")}...`
      };
      const result = await sendCommandToFigma("scan_nodes_by_types", {
        nodeId,
        types
      });
      if (result && typeof result === "object" && "matchingNodes" in result) {
        const typedResult = result;
        const summaryText = `Scan completed: Found ${typedResult.count} nodes matching types: ${typedResult.searchedTypes.join(", ")}`;
        return {
          content: [
            initialStatus,
            {
              type: "text",
              text: summaryText
            },
            {
              type: "text",
              text: JSON.stringify(typedResult.matchingNodes, null, 2)
            }
          ]
        };
      }
      return {
        content: [
          initialStatus,
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error scanning nodes by types: `, error);
    }
  }
);
server.prompt(
  "text_replacement_strategy",
  "Systematic approach for replacing text in Figma designs",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `# Intelligent Text Replacement Strategy

## 1. Analyze Design & Identify Structure
- Scan text nodes to understand the overall structure of the design
- Use AI pattern recognition to identify logical groupings:
  * Tables (rows, columns, headers, cells)
  * Lists (items, headers, nested lists)
  * Card groups (similar cards with recurring text fields)
  * Forms (labels, input fields, validation text)
  * Navigation (menu items, breadcrumbs)
\`\`\`
scan_text_nodes(nodeId: "node-id")
get_node_info(nodeId: "node-id")  // optional
\`\`\`

## 2. Strategic Chunking for Complex Designs
- Divide replacement tasks into logical content chunks based on design structure
- Use one of these chunking strategies that best fits the design:
  * **Structural Chunking**: Table rows/columns, list sections, card groups
  * **Spatial Chunking**: Top-to-bottom, left-to-right in screen areas
  * **Semantic Chunking**: Content related to the same topic or functionality
  * **Component-Based Chunking**: Process similar component instances together

## 3. Progressive Replacement with Verification
- Create a safe copy of the node for text replacement
- Replace text chunk by chunk with continuous progress updates
- After each chunk is processed:
  * Export that section as a small, manageable image
  * Verify text fits properly and maintain design integrity
  * Fix issues before proceeding to the next chunk

\`\`\`
// Clone the node to create a safe copy
clone_node(nodeId: "selected-node-id", x: [new-x], y: [new-y])

// Replace text chunk by chunk
set_multiple_text_contents(
  nodeId: "parent-node-id", 
  text: [
    { nodeId: "node-id-1", text: "New text 1" },
    // More nodes in this chunk...
  ]
)

// Verify chunk with small, targeted image exports
export_node_as_image(nodeId: "chunk-node-id", format: "PNG", scale: 0.5)
\`\`\`

## 4. Intelligent Handling for Table Data
- For tabular content:
  * Process one row or column at a time
  * Maintain alignment and spacing between cells
  * Consider conditional formatting based on cell content
  * Preserve header/data relationships

## 5. Smart Text Adaptation
- Adaptively handle text based on container constraints:
  * Auto-detect space constraints and adjust text length
  * Apply line breaks at appropriate linguistic points
  * Maintain text hierarchy and emphasis
  * Consider font scaling for critical content that must fit

## 6. Progressive Feedback Loop
- Establish a continuous feedback loop during replacement:
  * Real-time progress updates (0-100%)
  * Small image exports after each chunk for verification
  * Issues identified early and resolved incrementally
  * Quick adjustments applied to subsequent chunks

## 7. Final Verification & Context-Aware QA
- After all chunks are processed:
  * Export the entire design at reduced scale for final verification
  * Check for cross-chunk consistency issues
  * Verify proper text flow between different sections
  * Ensure design harmony across the full composition

## 8. Chunk-Specific Export Scale Guidelines
- Scale exports appropriately based on chunk size:
  * Small chunks (1-5 elements): scale 1.0
  * Medium chunks (6-20 elements): scale 0.7
  * Large chunks (21-50 elements): scale 0.5
  * Very large chunks (50+ elements): scale 0.3
  * Full design verification: scale 0.2

## Sample Chunking Strategy for Common Design Types

### Tables
- Process by logical rows (5-10 rows per chunk)
- Alternative: Process by column for columnar analysis
- Tip: Always include header row in first chunk for reference

### Card Lists
- Group 3-5 similar cards per chunk
- Process entire cards to maintain internal consistency
- Verify text-to-image ratio within cards after each chunk

### Forms
- Group related fields (e.g., "Personal Information", "Payment Details")
- Process labels and input fields together
- Ensure validation messages and hints are updated with their fields

### Navigation & Menus
- Process hierarchical levels together (main menu, submenu)
- Respect information architecture relationships
- Verify menu fit and alignment after replacement

## Best Practices
- **Preserve Design Intent**: Always prioritize design integrity
- **Structural Consistency**: Maintain alignment, spacing, and hierarchy
- **Visual Feedback**: Verify each chunk visually before proceeding
- **Incremental Improvement**: Learn from each chunk to improve subsequent ones
- **Balance Automation & Control**: Let AI handle repetitive replacements but maintain oversight
- **Respect Content Relationships**: Keep related content consistent across chunks

Remember that text is never just text\u2014it's a core design element that must work harmoniously with the overall composition. This chunk-based strategy allows you to methodically transform text while maintaining design integrity.`
          }
        }
      ],
      description: "Systematic approach for replacing text in Figma designs"
    };
  }
);
server.tool(
  "set_multiple_text_contents",
  "Set multiple text contents parallelly in a node",
  {
    nodeId: z.string().describe("The ID of the node containing the text nodes to replace"),
    text: z.array(
      z.object({
        nodeId: z.string().describe("The ID of the text node"),
        text: z.string().describe("The replacement text")
      })
    ).describe("Array of text node IDs and their replacement texts")
  },
  async ({ nodeId, text }) => {
    try {
      if (!text || text.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No text provided"
            }
          ]
        };
      }
      const initialStatus = {
        type: "text",
        text: `Starting text replacement for ${text.length} nodes. This will be processed in batches of 5...`
      };
      let totalProcessed = 0;
      const totalToProcess = text.length;
      const result = await sendCommandToFigma("set_multiple_text_contents", {
        nodeId,
        text
      });
      const typedResult = result;
      const success = typedResult.replacementsApplied && typedResult.replacementsApplied > 0;
      const progressText = `
      Text replacement completed:
      - ${typedResult.replacementsApplied || 0} of ${totalToProcess} successfully updated
      - ${typedResult.replacementsFailed || 0} failed
      - Processed in ${typedResult.completedInChunks || 1} batches
      `;
      const detailedResults = typedResult.results || [];
      const failedResults = detailedResults.filter((item) => !item.success);
      let detailedResponse = "";
      if (failedResults.length > 0) {
        detailedResponse = `

Nodes that failed:
${failedResults.map(
          (item) => `- ${item.nodeId}: ${item.error || "Unknown error"}`
        ).join("\n")}`;
      }
      return {
        content: [
          initialStatus,
          {
            type: "text",
            text: progressText + detailedResponse
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error setting multiple text contents: `, error);
    }
  }
);
server.prompt(
  "annotation_conversion_strategy",
  "Strategy for converting manual annotations to Figma's native annotations",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `# Automatic Annotation Conversion
            
## Process Overview

The process of converting manual annotations (numbered/alphabetical indicators with connected descriptions) to Figma's native annotations:

1. Get selected frame/component information
2. Scan and collect all annotation text nodes
3. Scan target UI elements (components, instances, frames)
4. Match annotations to appropriate UI elements
5. Apply native Figma annotations

## Step 1: Get Selection and Initial Setup

First, get the selected frame or component that contains annotations:

\`\`\`typescript
// Get the selected frame/component
const selection = await get_selection();
const selectedNodeId = selection[0].id

// Get available annotation categories for later use
const annotationData = await get_annotations({
  nodeId: selectedNodeId,
  includeCategories: true
});
const categories = annotationData.categories;
\`\`\`

## Step 2: Scan Annotation Text Nodes

Scan all text nodes to identify annotations and their descriptions:

\`\`\`typescript
// Get all text nodes in the selection
const textNodes = await scan_text_nodes({
  nodeId: selectedNodeId
});

// Filter and group annotation markers and descriptions

// Markers typically have these characteristics:
// - Short text content (usually single digit/letter)
// - Specific font styles (often bold)
// - Located in a container with "Marker" or "Dot" in the name
// - Have a clear naming pattern (e.g., "1", "2", "3" or "A", "B", "C")


// Identify description nodes
// Usually longer text nodes near markers or with matching numbers in path
  
\`\`\`

## Step 3: Scan Target UI Elements

Get all potential target elements that annotations might refer to:

\`\`\`typescript
// Scan for all UI elements that could be annotation targets
const targetNodes = await scan_nodes_by_types({
  nodeId: selectedNodeId,
  types: [
    "COMPONENT",
    "INSTANCE",
    "FRAME"
  ]
});
\`\`\`

## Step 4: Match Annotations to Targets

Match each annotation to its target UI element using these strategies in order of priority:

1. **Path-Based Matching**:
   - Look at the marker's parent container name in the Figma layer hierarchy
   - Remove any "Marker:" or "Annotation:" prefixes from the parent name
   - Find UI elements that share the same parent name or have it in their path
   - This works well when markers are grouped with their target elements

2. **Name-Based Matching**:
   - Extract key terms from the annotation description
   - Look for UI elements whose names contain these key terms
   - Consider both exact matches and semantic similarities
   - Particularly effective for form fields, buttons, and labeled components

3. **Proximity-Based Matching** (fallback):
   - Calculate the center point of the marker
   - Find the closest UI element by measuring distances to element centers
   - Consider the marker's position relative to nearby elements
   - Use this method when other matching strategies fail

Additional Matching Considerations:
- Give higher priority to matches found through path-based matching
- Consider the type of UI element when evaluating matches
- Take into account the annotation's context and content
- Use a combination of strategies for more accurate matching

## Step 5: Apply Native Annotations

Convert matched annotations to Figma's native annotations using batch processing:

\`\`\`typescript
// Prepare annotations array for batch processing
const annotationsToApply = Object.values(annotations).map(({ marker, description }) => {
  // Find target using multiple strategies
  const target = 
    findTargetByPath(marker, targetNodes) ||
    findTargetByName(description, targetNodes) ||
    findTargetByProximity(marker, targetNodes);
  
  if (target) {
    // Determine appropriate category based on content
    const category = determineCategory(description.characters, categories);

    // Determine appropriate additional annotationProperty based on content
    const annotationProperty = determineProperties(description.characters, target.type);
    
    return {
      nodeId: target.id,
      labelMarkdown: description.characters,
      categoryId: category.id,
      properties: annotationProperty
    };
  }
  return null;
}).filter(Boolean); // Remove null entries

// Apply annotations in batches using set_multiple_annotations
if (annotationsToApply.length > 0) {
  await set_multiple_annotations({
    nodeId: selectedNodeId,
    annotations: annotationsToApply
  });
}
\`\`\`


This strategy focuses on practical implementation based on real-world usage patterns, emphasizing the importance of handling various UI elements as annotation targets, not just text nodes.`
          }
        }
      ],
      description: "Strategy for converting manual annotations to Figma's native annotations"
    };
  }
);
server.prompt(
  "swap_overrides_instances",
  "Guide to swap instance overrides between instances",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `# Swap Component Instance and Override Strategy

## Overview
This strategy enables transferring content and property overrides from a source instance to one or more target instances in Figma, maintaining design consistency while reducing manual work.

## Step-by-Step Process

### 1. Selection Analysis
- Use \`get_selection()\` to identify the parent component or selected instances
- For parent components, scan for instances with \`scan_nodes_by_types({ nodeId: "parent-id", types: ["INSTANCE"] })\`
- Identify custom slots by name patterns (e.g. "Custom Slot*" or "Instance Slot") or by examining text content
- Determine which is the source instance (with content to copy) and which are targets (where to apply content)

### 2. Extract Source Overrides
- Use \`get_instance_overrides()\` to extract customizations from the source instance
- This captures text content, property values, and style overrides
- Command syntax: \`get_instance_overrides({ nodeId: "source-instance-id" })\`
- Look for successful response like "Got component information from [instance name]"

### 3. Apply Overrides to Targets
- Apply captured overrides using \`set_instance_overrides()\`
- Command syntax:
  \`\`\`
  set_instance_overrides({
    sourceInstanceId: "source-instance-id", 
    targetNodeIds: ["target-id-1", "target-id-2", ...]
  })
  \`\`\`

### 4. Verification
- Verify results with \`get_node_info()\` or \`read_my_design()\`
- Confirm text content and style overrides have transferred successfully

## Key Tips
- Always join the appropriate channel first with \`join_channel()\`
- When working with multiple targets, check the full selection with \`get_selection()\`
- Preserve component relationships by using instance overrides rather than direct text manipulation`
          }
        }
      ],
      description: "Strategy for transferring overrides between component instances in Figma"
    };
  }
);
server.tool(
  "set_layout_mode",
  "Set the layout mode and wrap behavior of a frame in Figma",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    layoutMode: z.enum(["NONE", "HORIZONTAL", "VERTICAL"]).describe("Layout mode for the frame"),
    layoutWrap: z.enum(["NO_WRAP", "WRAP"]).optional().describe("Whether the auto-layout frame wraps its children")
  },
  async ({ nodeId, layoutMode, layoutWrap }) => {
    try {
      const result = await sendCommandToFigma("set_layout_mode", {
        nodeId,
        layoutMode,
        layoutWrap: layoutWrap || "NO_WRAP"
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Set layout mode of frame "${typedResult.name}" to ${layoutMode}${layoutWrap ? ` with ${layoutWrap}` : ""}`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error setting layout mode: `, error);
    }
  }
);
server.tool(
  "set_padding",
  "Set padding values for an auto-layout frame in Figma",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    paddingTop: z.number().optional().describe("Top padding value"),
    paddingRight: z.number().optional().describe("Right padding value"),
    paddingBottom: z.number().optional().describe("Bottom padding value"),
    paddingLeft: z.number().optional().describe("Left padding value")
  },
  async ({ nodeId, paddingTop, paddingRight, paddingBottom, paddingLeft }) => {
    try {
      const result = await sendCommandToFigma("set_padding", {
        nodeId,
        paddingTop,
        paddingRight,
        paddingBottom,
        paddingLeft
      });
      const typedResult = result;
      const paddingMessages = [];
      if (paddingTop !== void 0) paddingMessages.push(`top: ${paddingTop}`);
      if (paddingRight !== void 0) paddingMessages.push(`right: ${paddingRight}`);
      if (paddingBottom !== void 0) paddingMessages.push(`bottom: ${paddingBottom}`);
      if (paddingLeft !== void 0) paddingMessages.push(`left: ${paddingLeft}`);
      const paddingText = paddingMessages.length > 0 ? `padding (${paddingMessages.join(", ")})` : "padding";
      return {
        content: [
          {
            type: "text",
            text: `Set ${paddingText} for frame "${typedResult.name}"`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error setting padding: `, error);
    }
  }
);
server.tool(
  "set_axis_align",
  "Set primary and counter axis alignment for an auto-layout frame in Figma",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    primaryAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN"]).optional().describe("Primary axis alignment (MIN/MAX = left/right in horizontal, top/bottom in vertical). Note: When set to SPACE_BETWEEN, itemSpacing will be ignored as children will be evenly spaced."),
    counterAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "BASELINE"]).optional().describe("Counter axis alignment (MIN/MAX = top/bottom in horizontal, left/right in vertical)")
  },
  async ({ nodeId, primaryAxisAlignItems, counterAxisAlignItems }) => {
    try {
      const result = await sendCommandToFigma("set_axis_align", {
        nodeId,
        primaryAxisAlignItems,
        counterAxisAlignItems
      });
      const typedResult = result;
      const alignMessages = [];
      if (primaryAxisAlignItems !== void 0) alignMessages.push(`primary: ${primaryAxisAlignItems}`);
      if (counterAxisAlignItems !== void 0) alignMessages.push(`counter: ${counterAxisAlignItems}`);
      const alignText = alignMessages.length > 0 ? `axis alignment (${alignMessages.join(", ")})` : "axis alignment";
      return {
        content: [
          {
            type: "text",
            text: `Set ${alignText} for frame "${typedResult.name}"`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error setting axis alignment: `, error);
    }
  }
);
server.tool(
  "rename_multiple_nodes",
  "Rename many nodes at once. Returns each node's previous and new name, plus per-node errors.",
  {
    items: z.array(
      z.object({
        nodeId: z.string().describe("The ID of the node to rename"),
        name: z.string().describe("The new name")
      })
    ).describe("Nodes to rename")
  },
  async ({ items }) => {
    try {
      const result = await sendCommandToFigma("rename_multiple_nodes", { items });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return errorResult(`Error renaming nodes: `, error);
    }
  }
);
server.tool(
  "set_multiple_layout_sizing",
  "Set layout sizing (FIXED/HUG/FILL) on many nodes at once. Works on auto-layout frames and on TEXT nodes that are auto-layout children. Returns per-node results and errors.",
  {
    nodeIds: z.array(z.string()).optional().describe("Nodes to apply the shared sizing modes below to (compact form)"),
    layoutSizingHorizontal: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Horizontal sizing mode applied to every node that does not override it"),
    layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Vertical sizing mode applied to every node that does not override it"),
    items: z.array(
      z.object({
        nodeId: z.string().describe("The ID of the node to modify"),
        layoutSizingHorizontal: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Horizontal sizing mode for this node"),
        layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Vertical sizing mode for this node")
      })
    ).optional().describe("Per-node form; overrides the shared modes above")
  },
  async ({ nodeIds, layoutSizingHorizontal, layoutSizingVertical, items }) => {
    try {
      const result = await sendCommandToFigma("set_multiple_layout_sizing", {
        nodeIds,
        layoutSizingHorizontal,
        layoutSizingVertical,
        items
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return errorResult(`Error setting layout sizing: `, error);
    }
  }
);
server.tool(
  "clone_multiple_nodes",
  "Clone many nodes at once, optionally inserting each clone into a given parent at a given index. Returns each clone's id plus the TEXT nodes inside it (id, name, characters) so their contents can be replaced without extra get_node_info round-trips.",
  {
    items: z.array(
      z.object({
        nodeId: z.string().describe("The ID of the node to clone"),
        parentId: z.string().optional().describe("Parent to insert the clone into (default: the source node's parent)"),
        index: z.number().optional().describe("Child index to insert at (default: appended last)"),
        x: z.number().optional().describe("X position for the clone"),
        y: z.number().optional().describe("Y position for the clone"),
        name: z.string().optional().describe("Rename the clone")
      })
    ).describe("Clone operations to perform, in order"),
    includeTexts: z.boolean().optional().describe("Return the TEXT nodes inside each clone (default true)")
  },
  async ({ items, includeTexts }) => {
    try {
      const result = await sendCommandToFigma("clone_multiple_nodes", { items, includeTexts });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return errorResult(`Error cloning nodes: `, error);
    }
  }
);
server.tool(
  "set_layout_sizing",
  "Set horizontal and vertical sizing modes for an auto-layout frame (or a TEXT node inside one) in Figma",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    layoutSizingHorizontal: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Horizontal sizing mode (HUG for frames/text only, FILL for auto-layout children only)"),
    layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Vertical sizing mode (HUG for frames/text only, FILL for auto-layout children only)")
  },
  async ({ nodeId, layoutSizingHorizontal, layoutSizingVertical }) => {
    try {
      const result = await sendCommandToFigma("set_layout_sizing", {
        nodeId,
        layoutSizingHorizontal,
        layoutSizingVertical
      });
      const typedResult = result;
      const sizingMessages = [];
      if (layoutSizingHorizontal !== void 0) sizingMessages.push(`horizontal: ${layoutSizingHorizontal}`);
      if (layoutSizingVertical !== void 0) sizingMessages.push(`vertical: ${layoutSizingVertical}`);
      const sizingText = sizingMessages.length > 0 ? `layout sizing (${sizingMessages.join(", ")})` : "layout sizing";
      return {
        content: [
          {
            type: "text",
            text: `Set ${sizingText} for frame "${typedResult.name}"`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error setting layout sizing: `, error);
    }
  }
);
server.tool(
  "set_item_spacing",
  "Set distance between children in an auto-layout frame",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    itemSpacing: z.number().optional().describe("Distance between children. Note: This value will be ignored if primaryAxisAlignItems is set to SPACE_BETWEEN."),
    counterAxisSpacing: z.number().optional().describe("Distance between wrapped rows/columns. Only works when layoutWrap is set to WRAP.")
  },
  async ({ nodeId, itemSpacing, counterAxisSpacing }) => {
    try {
      const params = { nodeId };
      if (itemSpacing !== void 0) params.itemSpacing = itemSpacing;
      if (counterAxisSpacing !== void 0) params.counterAxisSpacing = counterAxisSpacing;
      const result = await sendCommandToFigma("set_item_spacing", params);
      const typedResult = result;
      let message = `Updated spacing for frame "${typedResult.name}":`;
      if (itemSpacing !== void 0) message += ` itemSpacing=${itemSpacing}`;
      if (counterAxisSpacing !== void 0) message += ` counterAxisSpacing=${counterAxisSpacing}`;
      return {
        content: [
          {
            type: "text",
            text: message
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error setting spacing: `, error);
    }
  }
);
server.tool(
  "get_reactions",
  "Get Figma Prototyping Reactions from multiple nodes. CRITICAL: The output MUST be processed using the 'reaction_to_connector_strategy' prompt IMMEDIATELY to generate parameters for connector lines via the 'create_connections' tool.",
  {
    nodeIds: z.array(z.string()).describe("Array of node IDs to get reactions from")
  },
  async ({ nodeIds }) => {
    try {
      const result = await sendCommandToFigma("get_reactions", { nodeIds });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          },
          {
            type: "text",
            text: "IMPORTANT: You MUST now use the reaction data above and follow the `reaction_to_connector_strategy` prompt to prepare the parameters for the `create_connections` tool call. This is a required next step."
          }
        ],
        followUp: {
          type: "prompt",
          prompt: "reaction_to_connector_strategy"
        }
      };
    } catch (error) {
      return errorResult(`Error getting reactions: `, error);
    }
  }
);
server.tool(
  "set_default_connector",
  "Set a copied connector node as the default connector",
  {
    connectorId: z.string().optional().describe("The ID of the connector node to set as default")
  },
  async ({ connectorId }) => {
    try {
      const result = await sendCommandToFigma("set_default_connector", {
        connectorId
      });
      return {
        content: [
          {
            type: "text",
            text: `Default connector set: ${JSON.stringify(result)}`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error setting default connector: `, error);
    }
  }
);
server.tool(
  "create_connections",
  "Create connections between nodes using the default connector style",
  {
    connections: z.array(z.object({
      startNodeId: z.string().describe("ID of the starting node"),
      endNodeId: z.string().describe("ID of the ending node"),
      text: z.string().optional().describe("Optional text to display on the connector")
    })).describe("Array of node connections to create")
  },
  async ({ connections }) => {
    try {
      if (!connections || connections.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No connections provided"
            }
          ]
        };
      }
      const result = await sendCommandToFigma("create_connections", {
        connections
      });
      return {
        content: [
          {
            type: "text",
            text: `Created ${connections.length} connections: ${JSON.stringify(result)}`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error creating connections: `, error);
    }
  }
);
server.tool(
  "set_focus",
  "Set focus on a specific node in Figma by selecting it and scrolling viewport to it",
  {
    nodeId: z.string().describe("The ID of the node to focus on")
  },
  async ({ nodeId }) => {
    try {
      const result = await sendCommandToFigma("set_focus", { nodeId });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Focused on node "${typedResult.name}" (ID: ${typedResult.id})`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error setting focus: `, error);
    }
  }
);
server.tool(
  "set_selections",
  "Set selection to multiple nodes in Figma and scroll viewport to show them. Switches to the page the nodes live on first; nodes on other pages are reported as skipped rather than failing the call (Figma keeps one selection per page).",
  {
    nodeIds: z.array(z.string()).describe("Array of node IDs to select")
  },
  async ({ nodeIds }) => {
    try {
      const result = await sendCommandToFigma("set_selections", { nodeIds });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `${typedResult.message ?? `Selected ${typedResult.count} nodes`}: ${typedResult.selectedNodes.map((node) => `"${node.name}" (${node.id})`).join(", ")}`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error setting selections: `, error);
    }
  }
);
server.tool(
  "select_hardcoded",
  "Find nodes that hardcode a property (fills, strokes, cornerRadius, itemSpacing, paddingLeft/Right/Top/Bottom, fontSize) instead of binding a variable, and SELECT them in Figma so a person can review them. Optionally filter to one exact value. Switches to the page of the first match; matches on other pages are counted but not selected, so page through with pageName or offset. Use this instead of get_variable_bindings when the goal is 'show me those nodes' rather than 'give me the numbers'.",
  {
    property: z.enum([
      "fills",
      "strokes",
      "cornerRadius",
      "itemSpacing",
      "paddingLeft",
      "paddingRight",
      "paddingTop",
      "paddingBottom",
      "fontSize"
    ]).describe("Which property to look for"),
    value: z.union([z.string(), z.number()]).optional().describe('Only match this exact value, e.g. 100 for cornerRadius or "#2974ff" for fills. Omit to match any hardcoded value'),
    pageName: z.string().optional().describe("Limit the scan to a single page by name"),
    nodeId: z.string().optional().describe("Limit the scan to this node and its children"),
    excludePages: z.array(z.string()).optional().describe("Page names to skip"),
    offset: z.number().optional().describe("Matches to skip, for paging (default 0)"),
    limit: z.number().optional().describe("Max nodes to select in one call (default 50)")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("select_hardcoded", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return errorResult(`Error selecting hardcoded nodes: `, error);
    }
  }
);
server.prompt(
  "reaction_to_connector_strategy",
  "Strategy for converting Figma prototype reactions to connector lines using the output of 'get_reactions'",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `# Strategy: Convert Figma Prototype Reactions to Connector Lines

## Goal
Process the JSON output from the \`get_reactions\` tool to generate an array of connection objects suitable for the \`create_connections\` tool. This visually represents prototype flows as connector lines on the Figma canvas.

## Input Data
You will receive JSON data from the \`get_reactions\` tool. This data contains an array of nodes, each with potential reactions. A typical reaction object looks like this:
\`\`\`json
{
  "trigger": { "type": "ON_CLICK" },
  "action": {
    "type": "NAVIGATE",
    "destinationId": "destination-node-id",
    "navigationTransition": { ... },
    "preserveScrollPosition": false
  }
}
\`\`\`

## Step-by-Step Process

### 1. Preparation & Context Gathering
   - **Action:** Call \`read_my_design\` on the relevant node(s) to get context about the nodes involved (names, types, etc.). This helps in generating meaningful connector labels later.
   - **Action:** Call \`set_default_connector\` **without** the \`connectorId\` parameter.
   - **Check Result:** Analyze the response from \`set_default_connector\`.
     - If it confirms a default connector is already set (e.g., "Default connector is already set"), proceed to Step 2.
     - If it indicates no default connector is set (e.g., "No default connector set..."), you **cannot** proceed with \`create_connections\` yet. Inform the user they need to manually copy a connector from FigJam, paste it onto the current page, select it, and then you can run \`set_default_connector({ connectorId: "SELECTED_NODE_ID" })\` before attempting \`create_connections\`. **Do not proceed to Step 2 until a default connector is confirmed.**

### 2. Filter and Transform Reactions from \`get_reactions\` Output
   - **Iterate:** Go through the JSON array provided by \`get_reactions\`. For each node in the array:
     - Iterate through its \`reactions\` array.
   - **Filter:** Keep only reactions where the \`action\` meets these criteria:
     - Has a \`type\` that implies a connection (e.g., \`NAVIGATE\`, \`OPEN_OVERLAY\`, \`SWAP_OVERLAY\`). **Ignore** types like \`CHANGE_TO\`, \`CLOSE_OVERLAY\`, etc.
     - Has a valid \`destinationId\` property.
   - **Extract:** For each valid reaction, extract the following information:
     - \`sourceNodeId\`: The ID of the node the reaction belongs to (from the outer loop).
     - \`destinationNodeId\`: The value of \`action.destinationId\`.
     - \`actionType\`: The value of \`action.type\`.
     - \`triggerType\`: The value of \`trigger.type\`.

### 3. Generate Connector Text Labels
   - **For each extracted connection:** Create a concise, descriptive text label string.
   - **Combine Information:** Use the \`actionType\`, \`triggerType\`, and potentially the names of the source/destination nodes (obtained from Step 1's \`read_my_design\` or by calling \`get_node_info\` if necessary) to generate the label.
   - **Example Labels:**
     - If \`triggerType\` is "ON_CLICK" and \`actionType\` is "NAVIGATE": "On click, navigate to [Destination Node Name]"
     - If \`triggerType\` is "ON_DRAG" and \`actionType\` is "OPEN_OVERLAY": "On drag, open [Destination Node Name] overlay"
   - **Keep it brief and informative.** Let this generated string be \`generatedText\`.

### 4. Prepare the \`connections\` Array for \`create_connections\`
   - **Structure:** Create a JSON array where each element is an object representing a connection.
   - **Format:** Each object in the array must have the following structure:
     \`\`\`json
     {
       "startNodeId": "sourceNodeId_from_step_2",
       "endNodeId": "destinationNodeId_from_step_2",
       "text": "generatedText_from_step_3"
     }
     \`\`\`
   - **Result:** This final array is the value you will pass to the \`connections\` parameter when calling the \`create_connections\` tool.

### 5. Execute Connection Creation
   - **Action:** Call the \`create_connections\` tool, passing the array generated in Step 4 as the \`connections\` argument.
   - **Verify:** Check the response from \`create_connections\` to confirm success or failure.

This detailed process ensures you correctly interpret the reaction data, prepare the necessary information, and use the appropriate tools to create the connector lines.`
          }
        }
      ],
      description: "Strategy for converting Figma prototype reactions to connector lines using the output of 'get_reactions'"
    };
  }
);
function connectToFigma(port = 3055) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    logger.info("Already connected to Figma");
    return;
  }
  const wsUrl = serverUrl === "localhost" ? `${WS_URL}:${port}` : WS_URL;
  logger.info(`Connecting to Figma socket server at ${wsUrl}...`);
  ws = new WebSocket(wsUrl);
  ws.on("open", () => {
    logger.info("Connected to Figma socket server");
    currentChannel = null;
  });
  ws.on("message", (data) => {
    try {
      const json = JSON.parse(data);
      if (json.type === "progress_update") {
        const progressData = json.message.data;
        const requestId = json.id || "";
        if (requestId && pendingRequests.has(requestId)) {
          const request = pendingRequests.get(requestId);
          request.lastActivity = Date.now();
          clearTimeout(request.timeout);
          request.timeout = setTimeout(() => {
            if (pendingRequests.has(requestId)) {
              logger.error(`Request ${requestId} timed out after extended period of inactivity`);
              pendingRequests.delete(requestId);
              request.reject(new Error("Request to Figma timed out"));
            }
          }, 6e4);
          logger.info(`Progress update for ${progressData.commandType}: ${progressData.progress}% - ${progressData.message}`);
          if (progressData.status === "completed" && progressData.progress === 100) {
            logger.info(`Operation ${progressData.commandType} completed, waiting for final result`);
          }
        }
        return;
      }
      const myResponse = json.message;
      if (myResponse && myResponse.id && pendingRequests.has(myResponse.id)) {
        const request = pendingRequests.get(myResponse.id);
        clearTimeout(request.timeout);
        if (myResponse.error) {
          logger.error(`Error from Figma: ${myResponse.error}`);
          request.reject(new Error(myResponse.error));
        } else {
          request.resolve(myResponse.result);
        }
        pendingRequests.delete(myResponse.id);
      } else {
      }
    } catch (error) {
      logger.error(`Error parsing message: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  ws.on("error", (error) => {
    logger.error(`Socket error: ${error}`);
  });
  ws.on("close", () => {
    logger.info("Disconnected from Figma socket server");
    ws = null;
    for (const [id, request] of pendingRequests.entries()) {
      clearTimeout(request.timeout);
      request.reject(new Error("Connection closed"));
      pendingRequests.delete(id);
    }
    logger.info("Attempting to reconnect in 2 seconds...");
    setTimeout(() => connectToFigma(port), 2e3);
  });
}
async function joinChannel(channelName) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("Not connected to Figma");
  }
  try {
    await sendCommandToFigma("join", { channel: channelName });
    currentChannel = channelName;
    logger.info(`Joined channel: ${channelName}`);
  } catch (error) {
    logger.error(`Failed to join channel: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
function sendCommandToFigma(command, params = {}, timeoutMs = 3e4) {
  return new Promise((resolve2, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectToFigma();
      reject(new Error("Not connected to Figma. Attempting to connect..."));
      return;
    }
    const requiresChannel = command !== "join";
    if (requiresChannel && !currentChannel) {
      reject(new Error("Must join a channel before sending commands"));
      return;
    }
    const id = uuidv4();
    const request = {
      id,
      type: command === "join" ? "join" : "message",
      ...command === "join" ? { channel: params.channel } : { channel: currentChannel },
      message: {
        id,
        command,
        params: {
          ...params,
          commandId: id
          // Include the command ID in params
        }
      }
    };
    const timeout = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        logger.error(`Request ${id} to Figma timed out after ${timeoutMs / 1e3} seconds`);
        reject(new Error("Request to Figma timed out"));
      }
    }, timeoutMs);
    pendingRequests.set(id, {
      resolve: resolve2,
      reject,
      timeout,
      lastActivity: Date.now()
    });
    logger.info(`Sending command to Figma: ${command}`);
    ws.send(JSON.stringify(request));
  });
}
server.tool(
  "set_image_fill",
  "Fill a node in Figma with an image from a local file path, a URL, or base64 data (replaces the node's existing fills)",
  {
    nodeId: z.string().describe("The ID of the node to fill"),
    imagePath: z.string().optional().describe(
      "Absolute path to a local image file, read by the MCP server (preferred: keeps image bytes out of the model context)"
    ),
    imageUrl: z.string().optional().describe(
      "Image URL, fetched by the MCP server (the Figma plugin cannot fetch arbitrary domains itself)"
    ),
    imageBase64: z.string().optional().describe(
      "Base64-encoded image data, with or without a data: URI prefix (only when the image exists nowhere else)"
    ),
    scaleMode: z.enum(["FILL", "FIT", "CROP", "TILE"]).optional().describe("How the image fills the node (default: FILL)")
  },
  async ({ nodeId, imagePath, imageUrl, imageBase64, scaleMode }) => {
    try {
      const sources = [imagePath, imageUrl, imageBase64].filter(
        (source) => source !== void 0 && source !== ""
      );
      if (sources.length !== 1) {
        throw new Error("Provide exactly one of imagePath, imageUrl or imageBase64");
      }
      let base64Data;
      if (imagePath) {
        base64Data = (await readFile(imagePath)).toString("base64");
      } else if (imageUrl) {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch image URL (HTTP ${response.status})`);
        }
        base64Data = Buffer.from(await response.arrayBuffer()).toString("base64");
      } else {
        base64Data = imageBase64.replace(/^data:[^;,]+;base64,/, "");
      }
      if (base64Data.length > 12 * 1024 * 1024) {
        throw new Error(
          "Image is too large to send over the relay (~9MB binary max); downscale it first"
        );
      }
      const result = await sendCommandToFigma("set_image_fill", {
        nodeId,
        imageBase64: base64Data,
        scaleMode: scaleMode || "FILL"
      });
      const typedResult = result;
      const sizeInfo = typedResult.imageWidth ? ` (${typedResult.imageWidth}x${typedResult.imageHeight})` : "";
      return {
        content: [
          {
            type: "text",
            text: `Set image fill of node "${typedResult.name}"${sizeInfo} with scale mode ${scaleMode || "FILL"}, imageHash: ${typedResult.imageHash}`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error setting image fill: `, error);
    }
  }
);
server.tool(
  "set_component_description",
  "Set the description of COMPONENT / COMPONENT_SET nodes \u2014 the text shown in the assets panel and Dev Mode. This is the only way to write descriptions; get_local_components can only read them. Send several at once via items; each is applied independently and reported back.",
  {
    items: z.array(
      z.object({
        nodeId: z.string().describe("COMPONENT or COMPONENT_SET node id"),
        description: z.string().describe("New description. Pass an empty string to clear it.")
      })
    ).min(1).describe("Components to update")
  },
  async ({ items }) => {
    try {
      const result = await sendCommandToFigma("set_component_description", { items });
      const typed = result;
      const lines = typed.results.map(
        (r) => r.ok ? `OK   ${r.nodeId}  ${r.name ?? ""}` : `FAIL ${r.nodeId}  ${r.error ?? "unknown"}`
      );
      return {
        content: [
          {
            type: "text",
            text: [`applied ${typed.applied}, failed ${typed.failed}`, ...lines].join("\n")
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error setting component description: `, error);
    }
  }
);
server.tool(
  "grid_layout",
  `Read and write GRID auto-layout cell placement. IMPORTANT: a child's gridRowAnchorIndex / gridColumnAnchorIndex are READ-ONLY, so op:"place" (which calls the parent frame's setGridChildPosition) is the only way to move a cell; op:"set" is for the frame's own gridRowCount / gridRowSizes. Needed because cloning a cell inside a GRID frame makes the clone inherit the source's placement, so it lands stacked on the original and the table gains no row. op:"info" dumps the frame's grid properties, every child's placement, and a \`discovered\` list of the grid-related property/method names that actually exist on this Figma version \u2014 use it before writing. op:"set" assigns the grid* properties you pass (row/column anchor and span on children, row/column count on the frame); non-grid keys are refused. Deleting cells and replacing cell text already work without this tool.`,
  {
    op: z.enum(["info", "set", "place"]).describe('"info" to inspect, "set" to assign grid* properties, "place" to position a child in the grid'),
    nodeId: z.string().optional().describe("info: the GRID frame to inspect"),
    limit: z.number().optional().describe("info: max children to report (default 60)"),
    items: z.array(
      z.object({
        nodeId: z.string().describe("Child cell, or the grid frame itself for row/column counts"),
        props: z.record(z.any()).optional().describe(
          'set: grid* properties to assign on the FRAME, e.g. {"gridRowCount":10}. Keys not starting with "grid" are refused. Child anchors are read-only \u2014 use op:"place" for those.'
        ),
        position: z.record(z.any()).optional().describe(
          'place: passed straight to parent.setGridChildPosition(child, position), e.g. {"rowAnchorIndex":7,"columnAnchorIndex":0,"rowSpan":1,"columnSpan":1}'
        )
      })
    ).optional().describe("set/place: entries to apply, each reported independently")
  },
  async ({ op, nodeId, limit, items }) => {
    try {
      const result = await sendCommandToFigma("grid_layout", { op, nodeId, limit, items });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return errorResult(`Error in grid_layout: `, error);
    }
  }
);
server.tool(
  "set_constraints",
  "Set a node's resize constraints (horizontal/vertical: MIN | CENTER | MAX | STRETCH | SCALE) and/or a frame's clipsContent, and/or its absolute positioning (positioning ABSOLUTE/AUTO) and x/y. Constraints only take effect when the parent is not auto layout, or the child is absolutely positioned. Each item is reported independently with its before/after values; dryRun returns before only.",
  {
    items: z.array(
      z.object({
        nodeId: z.string(),
        horizontal: z.enum(["MIN", "CENTER", "MAX", "STRETCH", "SCALE"]).optional(),
        vertical: z.enum(["MIN", "CENTER", "MAX", "STRETCH", "SCALE"]).optional(),
        clipsContent: z.boolean().optional().describe("Frames only"),
        positioning: z.enum(["ABSOLUTE", "AUTO"]).optional().describe("Take the node out of (ABSOLUTE) or back into (AUTO) its auto-layout parent's flow, e.g. after a component swap dropped absolute positioning"),
        x: z.number().optional().describe("Position relative to the parent, applied after positioning"),
        y: z.number().optional().describe("Position relative to the parent, applied after positioning")
      })
    ).describe("Nodes to change"),
    dryRun: z.boolean().optional().describe("Report current values without writing")
  },
  async ({ items, dryRun }) => {
    try {
      const result = await sendCommandToFigma("set_constraints", { items, dryRun });
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error in set_constraints: `, error);
    }
  }
);
server.tool(
  "rename_node",
  "Rename a node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to rename"),
    name: z.string().describe("The new name for the node")
  },
  async ({ nodeId, name }) => {
    try {
      const result = await sendCommandToFigma("rename_node", { nodeId, name });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Renamed node from "${typedResult.previousName}" to "${typedResult.name}"`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error renaming node: `, error);
    }
  }
);
server.tool(
  "reset_instance_overrides",
  "Reset all overrides on the top-level instances under the given nodes (an INSTANCE itself, or every instance not nested in another instance inside a COMPONENT/FRAME), then restore what they showed before: the top-level instance's absolute positioning, constraints, auto-layout sizing, size and position (applied after all resets) plus sublayer sizing and fixed sizes, swapped components, component properties (variant/boolean/text/instance-swap), visibility and text content. Other overrides (fills, sizes, stale ones) revert to the main component. Color tokens (variables bound to fills/strokes) are NOT restored, because whether to keep them differs per component: each result lists droppedColorTokens (layer id, field, paint index, was/now variable name) so they can be reviewed and re-bound with bind_variable overwrite:true. Failures never abort silently: each failed item carries a stage (snapshot | reset | restore | geometry | position); an instance whose snapshot or resetOverrides fails is left untouched (skipped); text is re-checked and retried after every other step, and any text still wrong is listed in textUnrestored with its original characters; the top-level incomplete array lists instances that need a look, and aborted is set if an unexpected error stopped the batch (instances already reset still get their geometry back). Run dryRun first to see which instances are hit.",
  {
    nodeIds: z.array(z.string()).describe("INSTANCE ids, or containers (COMPONENT/FRAME) whose top-level instances should be reset"),
    dryRun: z.boolean().optional().describe("List the instances that would be reset without changing anything")
  },
  async ({ nodeIds, dryRun }) => {
    try {
      const result = await sendCommandToFigma("reset_instance_overrides", { nodeIds, dryRun }, 3e5);
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error in reset_instance_overrides: `, error);
    }
  }
);
server.tool(
  "create_section",
  "Create a section in Figma to group related content on the canvas",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    width: z.number().describe("Width of the section"),
    height: z.number().describe("Height of the section"),
    name: z.string().optional().describe("Optional name for the section")
  },
  async ({ x, y, width, height, name }) => {
    try {
      const result = await sendCommandToFigma("create_section", {
        x,
        y,
        width,
        height,
        name: name || "Section"
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Created section "${typedResult.name}" with ID: ${typedResult.id}`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error creating section: `, error);
    }
  }
);
server.tool(
  "set_parent",
  "Move a node into a new parent node (e.g. a section, frame or group). Preserves the node's absolute position unless x/y are provided",
  {
    nodeId: z.string().describe("The ID of the node to move"),
    parentId: z.string().describe("The ID of the new parent node (must support children, e.g. a section, frame or group)"),
    x: z.number().optional().describe("Optional X position relative to the new parent"),
    y: z.number().optional().describe("Optional Y position relative to the new parent"),
    index: z.number().optional().describe("Optional child index to insert at (default: appended as last child)")
  },
  async ({ nodeId, parentId, x, y, index }) => {
    try {
      const result = await sendCommandToFigma("set_parent", {
        nodeId,
        parentId,
        x,
        y,
        index
      });
      const typedResult = result;
      return {
        content: [
          {
            type: "text",
            text: `Moved node "${typedResult.name}" into "${typedResult.parentName}" at (${typedResult.x}, ${typedResult.y})`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error setting parent: `, error);
    }
  }
);
server.tool(
  "join_channel",
  "Join a specific channel to communicate with Figma",
  {
    channel: z.string().describe("The name of the channel to join").default("")
  },
  async ({ channel }) => {
    try {
      if (!channel) {
        return {
          content: [
            {
              type: "text",
              text: "Please provide a channel name to join:"
            }
          ],
          followUp: {
            tool: "join_channel",
            description: "Join the specified channel"
          }
        };
      }
      await joinChannel(channel);
      return {
        content: [
          {
            type: "text",
            text: `Successfully joined channel: ${channel}`
          }
        ]
      };
    } catch (error) {
      return errorResult(`Error joining channel: `, error);
    }
  }
);
server.tool(
  "get_vector_paths",
  "Read the path geometry (vectorPaths SVG data in the node's local coordinates), fills, strokes and stroke weight of one or more VECTOR nodes. Much lighter than get_node_info for vectors, so use it to inspect or edit vector shapes.",
  {
    nodeIds: z.array(z.string()).min(1).describe("IDs of the vector nodes to read")
  },
  async ({ nodeIds }) => {
    try {
      const result = await sendCommandToFigma("get_vector_paths", { nodeIds }, 6e4);
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error getting vector paths: `, error);
    }
  }
);
server.tool(
  "set_vector_paths",
  "Replace the path geometry of a VECTOR node, keeping its fills, strokes, name and layer order. Paths use SVG path data in the node's local coordinates, the same space get_vector_paths returns (e.g. to smooth a jagged outline). Returns size and position before and after.",
  {
    nodeId: z.string().describe("ID of the VECTOR node"),
    vectorPaths: z.array(
      z.object({
        windingRule: z.enum(["NONZERO", "EVENODD", "NONE"]).optional().describe("Default NONZERO"),
        data: z.string().describe("SVG path data, e.g. 'M 0 0 L 10 0 C 12 0 14 2 14 4 Z'")
      })
    ).min(1).describe("New paths")
  },
  async ({ nodeId, vectorPaths }) => {
    try {
      const result = await sendCommandToFigma("set_vector_paths", { nodeId, vectorPaths });
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error setting vector paths: `, error);
    }
  }
);
server.tool(
  "create_vector_from_svg",
  "Import SVG markup as editable Figma vectors (a frame of vector layers), optionally inside a parent at a position. Pass svgPath to read the SVG from a local file instead of inline markup. flatten merges the imported layers into a single vector.",
  {
    svg: z.string().optional().describe("SVG markup"),
    svgPath: z.string().optional().describe("Absolute path to a local .svg file, read by the MCP server"),
    parentId: z.string().optional().describe("Parent node ID to place the result in"),
    x: z.number().optional().describe("X position (relative to the parent)"),
    y: z.number().optional().describe("Y position (relative to the parent)"),
    name: z.string().optional().describe("Layer name"),
    flatten: z.boolean().optional().describe("Flatten the imported layers into one vector")
  },
  async ({ svg, svgPath, parentId, x, y, name, flatten }) => {
    try {
      let markup = svg;
      if (!markup && svgPath) {
        const fs = await import("fs/promises");
        markup = await fs.readFile(svgPath, "utf8");
      }
      if (!markup) throw new Error("Provide svg or svgPath");
      const result = await sendCommandToFigma("create_vector_from_svg", { svg: markup, parentId, x, y, name, flatten }, 6e4);
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error creating vector from SVG: `, error);
    }
  }
);
server.tool(
  "set_text_style",
  "Change the style of an existing TEXT node without recreating it: font size, font family/style, line height, letter spacing, horizontal alignment. Only the given properties change.",
  {
    nodeId: z.string().describe("ID of the TEXT node"),
    fontSize: z.number().positive().optional().describe("Font size (decimals allowed, e.g. 9.5)"),
    fontFamily: z.string().optional().describe("Font family, e.g. 'SUIT'"),
    fontStyle: z.string().optional().describe("Font style, e.g. 'Medium', 'Bold'"),
    lineHeight: z.union([z.number(), z.literal("AUTO")]).optional().describe("Line height in px, or 'AUTO'"),
    letterSpacing: z.number().optional().describe("Letter spacing in px"),
    textAlignHorizontal: z.enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"]).optional()
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("set_text_style", params);
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error setting text style: `, error);
    }
  }
);
server.tool(
  "set_stroke_style",
  "Set stroke join, alignment, cap, miter limit and dash pattern on many nodes at once (only the given properties change). Use strokeJoin ROUND or BEVEL to stop MITER joins from shooting spikes out of sharp corners.",
  {
    nodeIds: z.array(z.string()).min(1).describe("Nodes to update"),
    strokeJoin: z.enum(["MITER", "BEVEL", "ROUND"]).optional(),
    strokeAlign: z.enum(["CENTER", "INSIDE", "OUTSIDE"]).optional(),
    strokeCap: z.enum(["NONE", "ROUND", "SQUARE", "ARROW_LINES", "ARROW_EQUILATERAL"]).optional(),
    strokeMiterLimit: z.number().min(1).optional().describe("Miter limit (applies to MITER joins)"),
    dashPattern: z.array(z.number()).optional().describe("Dash pattern, [] for solid")
  },
  async (params) => {
    try {
      const result = await sendCommandToFigma("set_stroke_style", params, 6e4);
      return jsonResult(result);
    } catch (error) {
      return errorResult(`Error setting stroke style: `, error);
    }
  }
);
function jsonToolHandler(command, label) {
  return async (params) => {
    try {
      return jsonResult(await sendCommandToFigma(command, params, 6e4));
    } catch (error) {
      return errorResult(`Error ${label}: `, error);
    }
  };
}
server.tool(
  "set_size_constraints",
  "Set min/max width and height on auto-layout frames or auto-layout children (e.g. a HUG text that should wrap at a max width). Pass null to clear a value; omitted values are unchanged.",
  {
    nodeIds: z.array(z.string()).min(1).describe("Nodes to update"),
    minWidth: z.number().min(0).nullable().optional(),
    maxWidth: z.number().min(0).nullable().optional(),
    minHeight: z.number().min(0).nullable().optional(),
    maxHeight: z.number().min(0).nullable().optional()
  },
  jsonToolHandler("set_size_constraints", "setting size constraints")
);
server.tool(
  "set_visible",
  "Show or hide many nodes at once (layer eye toggle). Hidden auto-layout children take no space.",
  {
    nodeIds: z.array(z.string()).min(1).describe("Nodes to show or hide"),
    visible: z.boolean().describe("true to show, false to hide")
  },
  jsonToolHandler("set_visible", "setting visibility")
);
server.tool(
  "get_instance_properties",
  `Read the current component property values (VARIANT, BOOLEAN, TEXT, INSTANCE_SWAP) of instances, which get_node_info does not return. Walks nested instances too (e.g. a button-group inside a dialog), giving each one's id, depth, main component name, for variants the allowed options, and the variable (token) bound to a property, if any. Keys are bare names ("size", not "size#12:3").`,
  {
    nodeIds: z.array(z.string()).min(1).describe("Instances, or containers whose instances to read"),
    nested: z.boolean().optional().describe("Also read instances nested inside instances (default true)")
  },
  jsonToolHandler("get_instance_properties", "getting instance properties")
);
server.tool(
  "get_variable_modes",
  "Diagnose variable modes (e.g. a resolution collection with 9-inch/11-inch modes) on a frame: its resolved and explicit modes, plus for the node and each direct child the position/size, constraints, positioning, auto-layout sizing, and variables bound to its fields and component properties (with the resolved value). Use it to see what follows a mode switch and what stays fixed.",
  {
    nodeId: z.string().describe("Frame/section/instance to inspect"),
    children: z.boolean().optional().describe("Also describe direct children (default true)")
  },
  jsonToolHandler("get_variable_modes", "getting variable modes")
);
server.tool(
  "find_mode_usage",
  "Read-only. Find where a variable collection (e.g. 'resolution') is used, at any depth: nodes with an explicit mode set for it (pages included) and nodes whose fields or component properties are bound to its variables. Collections whose name cannot be read (deleted or unavailable library) are kept by id and marked unresolved. Scope with pageName or nodeId (default: current page).",
  {
    collection: z.string().optional().describe("Collection name or id substring; omit to report every collection"),
    pageName: z.string().optional().describe("Page to scan, exact name"),
    nodeId: z.string().optional().describe("Limit the scan to this node and its children"),
    includeBindings: z.boolean().optional().describe("Also report variable bindings (default true)"),
    limit: z.number().optional().describe("Max nodes listed per section (default 300); totals are always full")
  },
  jsonToolHandler("find_mode_usage", "finding variable mode usage")
);
server.tool(
  "set_variable_mode",
  "Switch the variable mode a node uses for one collection, like picking a mode in the right panel (setExplicitVariableModeForCollection). collection and mode are names; the collection is looked up among those applied to the node, then local collections. Returns before/after mode.",
  {
    nodeId: z.string().describe("Frame/section/instance to switch"),
    collection: z.string().describe("Variable collection name"),
    mode: z.string().describe("Mode name, e.g. 11-inch")
  },
  jsonToolHandler("set_variable_mode", "setting variable mode")
);
server.tool(
  "set_instance_properties",
  'Set component property values on instances, including nested ones (ids like I123:4;5:6). Property names may be bare ("size") or full keys. Variant values must be one of the options get_instance_properties lists. A value of { variableName | variableId | variableKey } binds that variable (token) to the property instead, as in the properties panel; a plain value on a bound property unbinds it. Names are looked up in local variables, then enabled libraries. Returns before/after per instance.',
  {
    updates: z.array(
      z.object({
        nodeId: z.string().describe("INSTANCE id"),
        properties: z.record(
          z.union([
            z.string(),
            z.boolean(),
            z.object({
              variableName: z.string().optional(),
              variableId: z.string().optional(),
              variableKey: z.string().optional()
            })
          ])
        ).describe('Property name -> value or variable ref, e.g. { "size": { "variableName": "variants/double" } }')
      })
    ).min(1)
  },
  jsonToolHandler("set_instance_properties", "setting instance properties")
);
server.tool(
  "clear_fills",
  "Remove every fill from the given nodes (fills = []), unlike set_fill_color with alpha 0 which leaves a transparent fill behind.",
  {
    nodeIds: z.array(z.string()).min(1).describe("Nodes whose fills to remove")
  },
  jsonToolHandler("clear_fills", "clearing fills")
);
server.tool(
  "create_component_from_node",
  "Convert a frame (or other node) into a component in place, like Create component (Cmd+Opt+K). Returns the new component id; the old node id is no longer valid.",
  {
    nodeId: z.string().describe("Node to convert")
  },
  jsonToolHandler("create_component_from_node", "creating component")
);
server.tool(
  "add_component_property",
  "Add a BOOLEAN or TEXT property to a component (or the set of a variant) and bind descendant layers to it: BOOLEAN controls layer visibility, TEXT controls text characters.",
  {
    componentId: z.string().describe("Component, component set, or variant id"),
    name: z.string().describe("Property name shown in the properties panel"),
    type: z.enum(["BOOLEAN", "TEXT"]),
    defaultValue: z.union([z.boolean(), z.string()]).describe("boolean for BOOLEAN, string for TEXT"),
    bindNodeIds: z.array(z.string()).optional().describe("Descendant layers to bind to the property")
  },
  jsonToolHandler("add_component_property", "adding component property")
);
server.tool(
  "combine_as_variants",
  'Combine two or more components into one component set (Combine as variants). Name each component like "type=table" first so the variant property is read from the names. Existing instances stay linked. Returns the new set id and its variants.',
  {
    componentIds: z.array(z.string()).min(2).describe("COMPONENT ids to combine (not already variants)"),
    name: z.string().optional().describe("Name for the new component set")
  },
  jsonToolHandler("combine_as_variants", "combining as variants")
);
server.tool(
  "edit_component_property",
  'Edit the default value of a non-variant component property (BOOLEAN, TEXT, INSTANCE_SWAP), or delete the property. property may be the bare name ("Show-Label") or the full key ("Show-Label#612:58"). INSTANCE_SWAP defaultValue is a COMPONENT id (a variant id is fine). VARIANT defaults cannot be edited (they follow variant position). Deleting reports the layers that were bound to it \u2014 they keep their last value. Pass dryRun first.',
  {
    componentId: z.string().describe("Component, component set, or variant id"),
    property: z.string().describe("Property bare name or full key"),
    defaultValue: z.union([z.boolean(), z.string()]).optional().describe("boolean for BOOLEAN, string for TEXT, COMPONENT id for INSTANCE_SWAP"),
    remove: z.boolean().optional().describe("Delete the property instead of editing it"),
    dryRun: z.boolean().optional().describe("Report what would change without writing")
  },
  jsonToolHandler("edit_component_property", "editing component property")
);
server.tool(
  "replace_variable_bindings",
  `Rebind variables within a page or node. Every binding whose variable belongs to sourceCollection (matched by collection NAME, so remote/library variables count too) is rebound. matchBy 'alias' (default): bind what the variable aliases in mode ("auto" = each node's rendered mode, keeps Dark-pinned frames looking the same), following the chain out of sourceCollection; a remote variable is first swapped for the local variable with the same collection and name. matchBy 'value': bind the local variable in targetCollection that resolves to the same value on that node (numbers narrowed to the Spacing/Radius/Stroke group by property) \u2014 use it to move old-library bindings to local tokens. Covers fills/strokes (SOLID; mixed-fill TEXT per range) and numeric fields (itemSpacing, counterAxisSpacing, padding, corner radii, stroke weights). Skips nodes inside instances and components unless includeInstances. Pass dryRun first.`,
  {
    nodeId: z.string().optional().describe("Limit to this node and its children"),
    pageName: z.string().optional().describe("Or a whole page by name"),
    sourceCollection: z.string().describe("Collection name whose bindings to replace, e.g. CL/SEM or Semantic/Scale"),
    matchBy: z.enum(["alias", "value"]).optional().describe("alias (default) or value"),
    mode: z.string().optional().describe(`For alias: mode name, or "auto" (default) to follow each node's rendered mode`),
    targetCollection: z.string().optional().describe("For value: local collection to pick the same-valued variable from, e.g. NUM/SEM"),
    includeInstances: z.boolean().optional().describe("Also rebind inside instances/components (creates overrides)"),
    dryRun: z.boolean().optional().describe("Report what would change without writing")
  },
  jsonToolHandler("replace_variable_bindings", "replacing variable bindings")
);
server.tool(
  "rename_variables",
  'Rename local variables in bulk. A variable is referenced by id, so bindings and aliases survive a rename; consuming files pick the new name up after the library is published. Address each variable by variableId, or by collection (collection name) + name (current full name, e.g. "Spacing/x1_5"). A rename that would duplicate a name inside its collection is reported under errors and not written. Pass dryRun first.',
  {
    items: z.array(z.object({
      variableId: z.string().optional().describe("Variable id (VariableID:\u2026) from get_local_variables"),
      collection: z.string().optional().describe("Collection name, e.g. NUM/SEM \u2014 used with name when variableId is not given"),
      name: z.string().optional().describe("Current full variable name, e.g. Spacing/x1_5"),
      newName: z.string().describe("New full variable name, e.g. Spacing/150")
    })).min(1).describe("Variables to rename"),
    dryRun: z.boolean().optional().describe("Report what would change without writing")
  },
  jsonToolHandler("rename_variables", "renaming variables")
);
server.tool(
  "apply_text_styles",
  "Attach local text styles to TEXT nodes that have none. A style matches when fontSize, fontName (family + style), lineHeight and letterSpacing are all equal, so the look does not change. Several styles with the same shape (e.g. Title2/Medium vs Body1/Medium) are reported under ambiguous unless prefer names the one to use. Nodes already styled are skipped. Mixed-format TEXT (links, per-range fonts or styles) is styled range by range: each run of equal formatting is matched on its own and setRangeTextStyleId keeps range colors and hyperlinks; the node is changed only when every range resolves (counted in segmented). Ranges already on another style stay; nodes inside instances are skipped unless includeInstances (style the main component instead). noMatchShapes lists the size|family|style|lineHeight|letterSpacing combos no style covers. Scope with nodeIds, nodeId or pageName. Pass dryRun first.",
  {
    nodeIds: z.array(z.string()).optional().describe("Specific TEXT nodes"),
    nodeId: z.string().optional().describe("Scan TEXT nodes under this node"),
    pageName: z.string().optional().describe("Or scan a whole page by name"),
    prefer: z.array(z.string()).optional().describe("Style names to pick, in order, when several styles match"),
    restyleFrom: z.array(z.string()).optional().describe('Also re-match nodes already using these styles (exact name or name prefix, "*" = any), e.g. move Body2/Bold text to .Doc/Body2/Bold with prefer'),
    includeInstances: z.boolean().optional().describe("Also style TEXT inside instances (creates overrides)"),
    limit: z.number().optional().describe("Max listed nodes per list (default 200); counts are always complete"),
    dryRun: z.boolean().optional().describe("Report what would change without writing")
  },
  jsonToolHandler("apply_text_styles", "applying text styles")
);
server.tool(
  "create_text_styles",
  `Create local text styles. copyFrom copies an existing style's font, size, line height, letter spacing and its variable bindings; any field given on the item overrides it. bind attaches variables to style fields (fontFamily, fontStyle, fontWeight, fontSize, lineHeight, letterSpacing) by variable id or by name inside variableCollection (e.g. TY/PRI \u2192 "Size/300"). Names starting with . or _ are not published with the library. An existing name is reported under errors unless update. Pass dryRun first.`,
  {
    items: z.array(z.object({
      name: z.string().describe("Full style name, e.g. .Doc/Title1/Bold"),
      copyFrom: z.string().optional().describe("Existing style name to copy values and bindings from"),
      fontFamily: z.string().optional(),
      fontStyle: z.string().optional().describe("e.g. Bold, SemiBold"),
      fontSize: z.number().optional(),
      lineHeight: z.union([z.number(), z.literal("AUTO")]).optional().describe("px or AUTO"),
      letterSpacing: z.number().optional().describe("px"),
      letterSpacingPercent: z.number().optional().describe("% of font size"),
      bind: z.record(z.string()).optional().describe("style field \u2192 variable id or name in variableCollection"),
      description: z.string().optional()
    })).min(1),
    variableCollection: z.string().optional().describe("Collection to resolve bind names in, e.g. TY/PRI"),
    update: z.boolean().optional().describe("Change a style that already exists instead of reporting it"),
    dryRun: z.boolean().optional().describe("Report what would change without writing")
  },
  jsonToolHandler("create_text_styles", "creating text styles")
);
server.tool(
  "set_hyperlink",
  "Put a hyperlink on a range of a TEXT node: to another node in the same file (targetNodeId \u2014 a section, frame or page) or to a URL. The range is the first occurrence of match, or start/end, or the whole text. underline also underlines the range (color is left alone). remove:true clears the link on the range. Pass dryRun first to see which characters would be linked.",
  {
    nodeId: z.string().describe("TEXT node id"),
    match: z.string().optional().describe("Substring to link (first occurrence)"),
    start: z.number().optional().describe("Range start (character index) when match is not given"),
    end: z.number().optional().describe("Range end (exclusive)"),
    targetNodeId: z.string().optional().describe("Node in this file to link to"),
    url: z.string().optional().describe("Or an external URL"),
    underline: z.boolean().optional().describe("Also underline the range"),
    remove: z.boolean().optional().describe("Clear the link on the range instead"),
    dryRun: z.boolean().optional().describe("Report the range without writing")
  },
  jsonToolHandler("set_hyperlink", "setting hyperlink")
);
server.tool(
  "set_text_range_fills",
  "Bind the text color of a range inside TEXT nodes to a color variable (highlighting words, e.g. a Don't example in red and a Do example in blue). Each item names a TEXT node and a range \u2014 match (first occurrence, or the n-th with occurrence) or start/end \u2014 and the variable: collection + variableName for a local variable (e.g. CL/PRI + Coral/500), or variableId / variableKey. Characters outside the range keep their fill. Batch many nodes in one call. Pass dryRun first to see which characters each item hits.",
  {
    items: z.array(
      z.object({
        nodeId: z.string().describe("TEXT node id"),
        match: z.string().optional().describe("Substring to color"),
        occurrence: z.number().optional().describe("Which occurrence of match (default 1)"),
        start: z.number().optional().describe("Range start when match is not given"),
        end: z.number().optional().describe("Range end (exclusive)"),
        collection: z.string().optional().describe("Local collection name, with variableName"),
        variableName: z.string().optional().describe("Color variable name, e.g. Coral/500"),
        variableId: z.string().optional(),
        variableKey: z.string().optional()
      })
    ).min(1).describe("Ranges to color"),
    dryRun: z.boolean().optional().describe("Report the ranges without writing")
  },
  jsonToolHandler("set_text_range_fills", "setting text range fills")
);
server.tool(
  "export_text_tree",
  "Dump every TEXT under a page, section or node to a JSON file, with context for copy checks: nodeId, text, layer name, the TEXT property it is bound to, the nearest instance (its component and component set), the instance chain, the parent frame, the ancestor name path, position, its visible solid fills (#rrggbb, the union over text ranges), whether the outermost instance overrides its characters (textOverride), and the top-level frame (a direct child of the page or of a section) with its section (name and id) and x. Hidden texts are left out unless includeHidden. includeTopPrefixes keeps only top-level frames whose names start with one of them. The server pages through the top-level frames itself and writes the whole result to outputPath; only a summary comes back. expectFileName stops before writing when the open file has another name.",
  {
    nodeId: z.string().optional().describe("Page, section or node to read (default: current page)"),
    outputPath: z.string().describe("Absolute path of the JSON file to write"),
    expectFileName: z.string().optional().describe("Abort when the open file's name differs"),
    includeTopPrefixes: z.array(z.string()).optional().describe("Only top-level frames whose names start with these"),
    includeHidden: z.boolean().optional().describe("Also dump texts that are hidden (default false)"),
    pageSize: z.number().min(1).max(200).optional().describe("Top-level frames per plugin call (default 20)"),
    overwrite: z.boolean().optional().describe("Replace outputPath if it already exists (default false)")
  },
  async ({ nodeId, outputPath, expectFileName, includeTopPrefixes, includeHidden, pageSize, overwrite }) => {
    try {
      if (!isAbsolute(outputPath) || !outputPath.endsWith(".json")) {
        return errorResult("Bad outputPath: ", "give an absolute path ending in .json");
      }
      outputPath = resolve(outputPath);
      const exists = await access(outputPath).then(() => true, () => false);
      if (exists && overwrite !== true) {
        return errorResult("File exists: ", `${outputPath} \u2014 pass overwrite:true to replace it`);
      }
      const texts = [];
      let head = null;
      let offset = 0;
      let calls = 0;
      while (offset !== null) {
        const r = await sendCommandToFigma(
          "export_text_tree",
          { nodeId, includeTopPrefixes, includeHidden, offset, limit: pageSize || 20 },
          6e4
        );
        calls++;
        if (!head) {
          head = r;
          if (expectFileName && r.fileName !== expectFileName) {
            return errorResult("Wrong file: ", `open file is "${r.fileName}", expected "${expectFileName}". Nothing written.`);
          }
        }
        texts.push(...r.texts || []);
        offset = r.nextOffset;
      }
      const out = {
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        fileName: head.fileName,
        page: head.page,
        root: head.root,
        topFrames: { total: head.topFrames.total, matched: head.topFrames.matched },
        textCount: texts.length,
        texts
      };
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, JSON.stringify(out, null, 1), "utf8");
      return jsonResult({
        outputPath,
        fileName: out.fileName,
        page: out.page,
        root: out.root,
        topFrames: out.topFrames,
        textCount: out.textCount,
        pluginCalls: calls
      });
    } catch (error) {
      return errorResult("Error exporting text tree: ", error);
    }
  }
);
server.tool(
  "inspect_paints",
  "Read one node's own fills and strokes (not its children): hex, opacity, visibility and the bound color variable (id, key, name, collection, remote). Read-only.",
  { nodeId: z.string().describe("Node to read") },
  async ({ nodeId }) => {
    try {
      return jsonResult(await sendCommandToFigma("inspect_paints", { nodeId }));
    } catch (error) {
      return errorResult("Error inspecting paints: ", error);
    }
  }
);
server.tool(
  "build_review_listing",
  "Build an as-is / to-be review page from a plan JSON (E-37). Writes only to a NEW page whose name starts with 'UX \uB77C\uC774\uD305 \uC218\uC815 \uAC74' (refuses an existing name or any other page). Source frames are only cloned. Per section: as-is and to-be clones, text edits on the to-be clone with an extra #FF00FF fill on each changed text, as-is/to-be badges (component key, else seed clone; badges.useKey false skips the key and only clones the seed), and a 'same fix needed' table. protectedPageIds is required (the call is refused without it): before every write the plugin finds the page of the node it writes and stops at the first one on a protected page \u2014 sections built until then are kept in resultPath, the failing one as aborted. The server lays sections out row by row (gapX within a row, gapY between rows) and writes per-section results to resultPath. dryRun checks sources and edits without writing.",
  {
    planPath: z.string().describe("Absolute path of the plan JSON (listing-plan.json)"),
    resultPath: z.string().describe("Absolute path of the result JSON to write"),
    expectFileName: z.string().optional().describe("Abort when the open file's name differs"),
    dryRun: z.boolean().optional().describe("Check only, write nothing (default false)"),
    protectedPageIds: z.array(z.string()).min(1).describe("Page ids that must never be written (source UI page, guide page, seed page). Required"),
    selfTestProtectNewPage: z.boolean().optional().describe("Guard self-test only: add the newly created page to protectedPageIds so the first write must abort. Leaves an empty page to delete")
  },
  async ({ planPath, resultPath, expectFileName, dryRun, protectedPageIds, selfTestProtectNewPage }) => {
    try {
      if (!Array.isArray(protectedPageIds) || !protectedPageIds.length) {
        return errorResult("Refused: ", "protectedPageIds is required (source UI page, guide page, seed page). Nothing written.");
      }
      for (const p of [planPath, resultPath]) {
        if (!isAbsolute(p) || !p.endsWith(".json")) return errorResult("Bad path: ", `${p} \u2014 give an absolute path ending in .json`);
      }
      const plan = JSON.parse(await readFile(resolve(planPath), "utf8"));
      const page = await sendCommandToFigma("review_page", { pageName: plan.pageName, dryRun: !!dryRun, protectedPageIds });
      if (expectFileName && page.fileName !== expectFileName) {
        return errorResult("Wrong file: ", `open file is "${page.fileName}", expected "${expectFileName}". Nothing written.`);
      }
      if (selfTestProtectNewPage && !dryRun && page.pageId) protectedPageIds = [...protectedPageIds, page.pageId];
      const results = [];
      let aborted = null;
      let y = plan.layout.startY || 0;
      for (const row of plan.rows) {
        let x = plan.layout.startX || 0;
        let rowH = 0;
        for (const sec of row) {
          try {
            const r = await sendCommandToFigma("review_section", {
              ...sec,
              pageId: page.pageId,
              dryRun: !!dryRun,
              x,
              y,
              protectedPageIds,
              layout: plan.layout,
              style: plan.style,
              badges: plan.badges,
              pink: plan.pink
            }, 6e4);
            results.push({ ...r, x, y });
            x += r.width + plan.layout.gapX;
            rowH = Math.max(rowH, r.height);
          } catch (e) {
            aborted = { name: sec.name, asIs: sec.asIs, error: String(e && e.message ? e.message : e) };
            results.push({ ...aborted, aborted: true, x, y });
            break;
          }
        }
        if (aborted) break;
        y += rowH + plan.layout.gapY;
      }
      const out = {
        dryRun: !!dryRun,
        fileName: page.fileName,
        pageId: page.pageId || null,
        pageName: plan.pageName,
        protectedPageIds,
        aborted,
        sections: results
      };
      await mkdir(dirname(resolve(resultPath)), { recursive: true });
      await writeFile(resolve(resultPath), JSON.stringify(out, null, 1), "utf8");
      const missing = results.reduce((n, r) => n + (r.missing || []).length, 0);
      const failed = results.reduce((n, r) => n + (r.failed || []).length, 0);
      const badgeKeyErrors = {};
      for (const r of results) for (const e of r.badgeErrors || []) if (e) badgeKeyErrors[e] = (badgeKeyErrors[e] || 0) + 1;
      if (aborted) {
        return errorResult("Aborted: ", `section "${aborted.name}" \u2014 ${aborted.error}. ${results.length - 1} section(s) built before it are in ${resultPath}.`);
      }
      return jsonResult({
        dryRun: !!dryRun,
        pageId: out.pageId,
        pageName: out.pageName,
        sections: results.length,
        changed: results.reduce((n, r) => n + (r.changed || 0), 0),
        missing,
        failed,
        badgeKeyErrors,
        resultPath
      });
    } catch (error) {
      return errorResult("Error building review listing: ", error);
    }
  }
);
server.tool(
  "create_variables",
  "Create local variables. copyFrom (a variable in the same collection) copies its type, scopes and every mode value \u2014 including an alias that carries opacity, like State/Pressed/Background \u2014 and values then overrides modes by mode name: { hex } | { alias, aliasCollection?, opacity? } | number | string | boolean. An existing name is reported under errors. Pass dryRun first.",
  {
    items: z.array(z.object({
      collection: z.string().describe("Collection name, e.g. CL/SEM"),
      name: z.string().describe("Full variable name, e.g. State/Pressed/On-Primary"),
      type: z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]).optional().describe("Required unless copyFrom"),
      copyFrom: z.string().optional().describe("Variable name in the same collection to copy from"),
      values: z.record(z.any()).optional().describe("Mode name \u2192 value spec"),
      scopes: z.array(z.string()).optional(),
      description: z.string().optional()
    })).min(1),
    dryRun: z.boolean().optional().describe("Report what would change without writing")
  },
  jsonToolHandler("create_variables", "creating variables")
);
async function main() {
  try {
    connectToFigma();
  } catch (error) {
    logger.warn(`Could not connect to Figma initially: ${error instanceof Error ? error.message : String(error)}`);
    logger.warn("Will try to connect when the first command is sent");
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("FigmaMCP server running on stdio");
}
main().catch((error) => {
  logger.error(`Error starting FigmaMCP server: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
//# sourceMappingURL=server.js.map