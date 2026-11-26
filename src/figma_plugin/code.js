// 피그마 플러그인 본체: MCP 서버의 명령을 받아 피그마 문서를 읽고 고친다 (Talk to Figma MCP)
// It handles Figma API commands

// Plugin state
const state = {
  serverPort: 3055, // Default port
};


// Helper function for progress updates
async function sendProgressUpdate(
  commandId,
  commandType,
  status,
  progress,
  totalItems,
  processedItems,
  message,
  payload = null
) {
  const update = {
    type: "command_progress",
    commandId,
    commandType,
    status,
    progress,
    totalItems,
    processedItems,
    message,
    timestamp: Date.now(),
  };

  // Add optional chunk information if present
  if (payload) {
    if (
      payload.currentChunk !== undefined &&
      payload.totalChunks !== undefined
    ) {
      update.currentChunk = payload.currentChunk;
      update.totalChunks = payload.totalChunks;
      update.chunkSize = payload.chunkSize;
    }
    update.payload = payload;
  }

  // Send to UI
  figma.ui.postMessage(update);
  console.log(`Progress update: ${status} - ${progress}% - ${message}`);

  // Yield so the Figma plugin sandbox flushes postMessage to ui.html
  // before the next iteration begins
  await new Promise((resolve) => setTimeout(resolve, 0));

  return update;
}

// Show UI (themeColors: 피그마 라이트/다크 테마 색을 CSS 변수로 받는다)
figma.showUI(__html__, { width: 320, height: 480, themeColors: true });

function postFileInfo() {
  figma.ui.postMessage({
    type: "file-info",
    fileName: figma.root.name,
    pageName: figma.currentPage.name,
  });
}

figma.on("currentpagechange", postFileInfo);

// Plugin commands from UI
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case "update-settings":
      updateSettings(msg);
      break;
    case "notify":
      figma.notify(msg.message);
      break;
    case "close-plugin":
      figma.closePlugin();
      break;
    case "execute-command":
      // Execute commands received from UI (which gets them from WebSocket)
      try {
        const result = await handleCommand(msg.command, msg.params);
        figma.ui.postMessage({
          type: "command-result",
          id: msg.id,
          result,
        });
      } catch (error) {
        figma.ui.postMessage({
          type: "command-error",
          id: msg.id,
          error: errMsg(error) || "Error executing command",
        });
      }
      break;
  }
};

// Listen for plugin commands from menu
figma.on("run", ({ command }) => {
  postFileInfo();
  figma.ui.postMessage({ type: "auto-connect" });
});

// Update plugin settings
function updateSettings(settings) {
  if (settings.serverPort) {
    state.serverPort = settings.serverPort;
  }

  figma.clientStorage.setAsync("settings", {
    serverPort: state.serverPort,
  });
}

// Handle commands from UI
async function handleCommand(command, params) {
  switch (command) {
    case "get_document_info":
      return await getDocumentInfo();
    case "get_selection":
      return await getSelection();
    case "get_node_info":
      if (!params || !params.nodeId) {
        throw new Error("Missing nodeId parameter");
      }
      return await getNodeInfo(params.nodeId);
    case "get_nodes_info":
      if (!params || !params.nodeIds || !Array.isArray(params.nodeIds)) {
        throw new Error("Missing or invalid nodeIds parameter");
      }
      return await getNodesInfo(params.nodeIds);
    case "read_my_design":
      return await readMyDesign();
    case "create_rectangle":
      return await createRectangle(params);
    case "create_frame":
      return await createFrame(params);
    case "create_text":
      return await createText(params);
    case "set_fill_color":
      return await setFillColor(params);
    case "set_stroke_color":
      return await setStrokeColor(params);
    case "move_node":
      return await moveNode(params);
    case "resize_node":
      return await resizeNode(params);
    case "delete_node":
      return await deleteNode(params);
    case "delete_multiple_nodes":
      return await deleteMultipleNodes(params);
    case "get_styles":
      return await getStyles();
    case "get_grid_usage":
      return await getGridUsage(params);
    case "get_local_components":
      return await getLocalComponents(params);
    case "get_local_variables":
      return await getLocalVariables();
    case "get_variable_bindings":
      return await getVariableBindings(params);
    case "find_variable_usage":
      return await findVariableUsage(params);
    case "get_instance_census":
      return await getInstanceCensus(params);
    case "get_layout_audit":
      return await getLayoutAudit(params);
    case "find_hidden_nodes":
      return await findHiddenNodes(params);
    case "find_nodes_by_name":
      return await findNodesByName(params);
    case "set_multiple_opacity":
      return await setMultipleOpacity(params);
    case "get_hyperlinks":
      return await getHyperlinks(params);
    case "detach_instances":
      return await detachInstances(params);
    case "unbind_styles":
      return await unbindStyles(params);
    // case "get_team_components":
    //   return await getTeamComponents();
    case "create_component_instance":
      return await createComponentInstance(params);
    case "export_node_as_image":
      return await exportNodeAsImage(params);
    case "set_corner_radius":
      return await setCornerRadius(params);
    case "set_text_content":
      return await setTextContent(params);
    case "clone_node":
      return await cloneNode(params);
    case "scan_text_nodes":
      return await scanTextNodes(params);
    case "set_multiple_text_contents":
      return await setMultipleTextContents(params);
    case "get_annotations":
      return await getAnnotations(params);
    case "set_annotation":
      return await setAnnotation(params);
    case "scan_nodes_by_types":
      return await scanNodesByTypes(params);
    case "set_multiple_annotations":
      return await setMultipleAnnotations(params);
    case "get_instance_overrides":
      // Check if instanceNode parameter is provided
      if (params && params.instanceNodeId) {
        // Get the instance node by ID
        const instanceNode = await figma.getNodeByIdAsync(params.instanceNodeId);
        if (!instanceNode) {
          throw new Error(`Instance node not found with ID: ${params.instanceNodeId}`);
        }
        return await getInstanceOverrides(instanceNode);
      }
      // Call without instance node if not provided
      return await getInstanceOverrides();

    case "set_instance_overrides":
      // Check if instanceNodeIds parameter is provided
      if (params && params.targetNodeIds) {
        // Validate that targetNodeIds is an array
        if (!Array.isArray(params.targetNodeIds)) {
          throw new Error("targetNodeIds must be an array");
        }

        // Get the instance nodes by IDs
        const targetNodes = await getValidTargetInstances(params.targetNodeIds);
        if (!targetNodes.success) {
          figma.notify(targetNodes.message);
          return { success: false, message: targetNodes.message };
        }

        if (params.sourceInstanceId) {

          // get source instance data
          let sourceInstanceData = null;
          sourceInstanceData = await getSourceInstanceData(params.sourceInstanceId);

          if (!sourceInstanceData.success) {
            figma.notify(sourceInstanceData.message);
            return { success: false, message: sourceInstanceData.message };
          }
          return await setInstanceOverrides(targetNodes.targetInstances, sourceInstanceData);
        } else {
          throw new Error("Missing sourceInstanceId parameter");
        }
      }
    case "set_layout_mode":
      return await setLayoutMode(params);
    case "set_padding":
      return await setPadding(params);
    case "set_axis_align":
      return await setAxisAlign(params);
    case "set_layout_sizing":
      return await setLayoutSizing(params);
    case "set_multiple_layout_sizing":
      return await setMultipleLayoutSizing(params);
    case "clone_multiple_nodes":
      return await cloneMultipleNodes(params);
    case "rename_multiple_nodes":
      return await renameMultipleNodes(params);
    case "rename_variant_property":
      return await renameVariantProperty(params);
    case "set_constraints":
      return await setConstraints(params);
    case "swap_instances_by_key":
      return await swapInstancesByKey(params);
    case "bind_variable":
      return await bindVariable(params);
    case "unbind_variable":
      return await unbindVariable(params);
    case "get_component_properties":
      return await getComponentProperties(params);
    case "set_item_spacing":
      return await setItemSpacing(params);
    case "get_reactions":
      if (!params || !params.nodeIds || !Array.isArray(params.nodeIds)) {
        throw new Error("Missing or invalid nodeIds parameter");
      }
      return await getReactions(params.nodeIds);  
    case "set_default_connector":
      return await setDefaultConnector(params);
    case "create_connections":
      return await createConnections(params);
    case "set_focus":
      return await setFocus(params);
    case "set_selections":
      return await setSelections(params);
    case "select_hardcoded":
      return await selectHardcoded(params);
    case "set_image_fill":
      return await setImageFill(params);
    case "rename_node":
      return await renameNode(params);
    case "reset_instance_overrides":
      return await resetInstanceOverrides(params);
    case "set_component_description":
      return await setComponentDescription(params);
    case "grid_layout":
      return await gridLayout(params);
    case "create_section":
      return await createSection(params);
    case "set_parent":
      return await setParent(params);
    case "get_vector_paths":
      return await getVectorPaths(params);
    case "set_vector_paths":
      return await setVectorPaths(params);
    case "create_vector_from_svg":
      return await createVectorFromSvg(params);
    case "set_text_style":
      return await setTextStyle(params);
    case "set_stroke_style":
      return await setStrokeStyle(params);
    case "set_size_constraints":
      return await setSizeConstraints(params);
    case "set_visible":
      return await setVisible(params);
    case "get_instance_properties":
      return await getInstanceProperties(params);
    case "get_variable_modes":
      return await getVariableModes(params);
    case "set_variable_mode":
      return await setVariableMode(params);
    case "find_mode_usage":
      return await findModeUsage(params);
    case "set_instance_properties":
      return await setInstanceProperties(params);
    case "clear_fills":
      return await clearFills(params);
    case "create_component_from_node":
      return await createComponentFromNode(params);
    case "add_component_property":
      return await addComponentProperty(params);
    case "combine_as_variants":
      return await combineAsVariants(params);
    case "edit_component_property":
      return await editComponentPropertyCmd(params);
    case "replace_variable_bindings":
      return await replaceVariableBindings(params);
    case "rename_variables":
      return await renameVariables(params);
    case "apply_text_styles":
      return await applyTextStyles(params);
    case "create_text_styles":
      return await createTextStyles(params);
    case "set_text_range_fills":
      return await setTextRangeFills(params);
    case "export_text_tree":
      return await exportTextTree(params);
    case "review_page":
      return await reviewPage(params);
    case "review_section":
      return await reviewSection(params);
    case "inspect_paints":
      return await inspectPaints(params);
    case "set_hyperlink":
      return await setHyperlink(params);
    case "create_variables":
      return await createVariables(params);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// Command implementations

function paintToPlain(paint) {
  if (!paint) return paint;
  const out = { type: paint.type, visible: paint.visible !== false };
  if (paint.type === "SOLID") {
    const c = paint.color;
    const hex = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
    out.hex = "#" + hex(c.r) + hex(c.g) + hex(c.b);
    out.opacity = paint.opacity !== undefined ? paint.opacity : 1;
  }
  return out;
}

// Read only the path geometry and paint of vectors (cheap, unlike get_node_info)
async function getVectorPaths(params) {
  const { nodeIds } = params || {};
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw new Error("Missing nodeIds parameter");
  }
  const results = [];
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) {
      results.push({ id, error: "Node not found" });
      continue;
    }
    if (!("vectorPaths" in node)) {
      results.push({ id, name: node.name, type: node.type, error: "Node has no vectorPaths" });
      continue;
    }
    results.push({
      id: node.id,
      name: node.name,
      type: node.type,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      opacity: node.opacity,
      vectorPaths: node.vectorPaths.map((p) => ({ windingRule: p.windingRule, data: p.data })),
      fills: Array.isArray(node.fills) ? node.fills.map(paintToPlain) : "MIXED",
      strokes: Array.isArray(node.strokes) ? node.strokes.map(paintToPlain) : [],
      strokeWeight: typeof node.strokeWeight === "number" ? node.strokeWeight : "MIXED",
      strokeJoin: node.strokeJoin,
      strokeAlign: node.strokeAlign,
      dashPattern: node.dashPattern,
    });
  }
  return { nodes: results };
}

// Replace the path geometry of a vector. Paths are in the node's local coordinates
// (the same space get_vector_paths returns), so fills, strokes, name and layer order are kept.
async function setVectorPaths(params) {
  const { nodeId, vectorPaths } = params || {};
  if (!nodeId) throw new Error("Missing nodeId parameter");
  if (!Array.isArray(vectorPaths) || vectorPaths.length === 0) {
    throw new Error("Missing vectorPaths parameter");
  }
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node not found with ID: ${nodeId}`);
  if (node.type !== "VECTOR") throw new Error(`Node is not a VECTOR: ${node.type}`);

  const before = { x: node.x, y: node.y, width: node.width, height: node.height };
  const absBefore = node.absoluteTransform;
  node.vectorPaths = vectorPaths.map((p) => ({
    windingRule: p.windingRule || "NONZERO",
    data: String(p.data),
  }));
  return {
    id: node.id,
    name: node.name,
    before,
    after: { x: node.x, y: node.y, width: node.width, height: node.height },
    transformChanged:
      JSON.stringify(absBefore) !== JSON.stringify(node.absoluteTransform),
  };
}

// Import SVG markup as editable vectors, optionally into a parent at a position
async function createVectorFromSvg(params) {
  const { svg, parentId, x, y, name, flatten } = params || {};
  if (!svg) throw new Error("Missing svg parameter");
  const node = figma.createNodeFromSvg(String(svg));
  if (parentId) {
    const parent = await figma.getNodeByIdAsync(parentId);
    if (!parent) throw new Error(`Parent not found with ID: ${parentId}`);
    if (!("appendChild" in parent)) throw new Error(`Parent cannot hold children: ${parent.type}`);
    parent.appendChild(node);
  }
  if (x !== undefined) node.x = x;
  if (y !== undefined) node.y = y;
  if (name) node.name = name;
  let result = node;
  if (flatten && "children" in node && node.children.length > 0) {
    result = figma.flatten(node.children, node);
    if (name) result.name = name;
  }
  return {
    id: result.id,
    name: result.name,
    type: result.type,
    x: result.x,
    y: result.y,
    width: result.width,
    height: result.height,
    children: "children" in result ? result.children.map((c) => ({ id: c.id, name: c.name, type: c.type })) : [],
  };
}

// Change stroke join / align / cap / miter limit / dashes on many nodes at once
async function setStrokeStyle(params) {
  const { nodeIds, strokeJoin, strokeAlign, strokeCap, strokeMiterLimit, dashPattern } = params || {};
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) throw new Error("Missing nodeIds parameter");
  const results = [];
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) { results.push({ id, error: "Node not found" }); continue; }
    try {
      const before = { strokeJoin: node.strokeJoin, strokeAlign: node.strokeAlign, strokeCap: node.strokeCap, strokeMiterLimit: node.strokeMiterLimit };
      if (strokeJoin && "strokeJoin" in node) node.strokeJoin = strokeJoin;
      if (strokeAlign && "strokeAlign" in node) node.strokeAlign = strokeAlign;
      if (strokeCap && "strokeCap" in node) node.strokeCap = strokeCap;
      if (strokeMiterLimit !== undefined && "strokeMiterLimit" in node) node.strokeMiterLimit = strokeMiterLimit;
      if (Array.isArray(dashPattern) && "dashPattern" in node) node.dashPattern = dashPattern;
      results.push({ id, name: node.name, before, after: { strokeJoin: node.strokeJoin, strokeAlign: node.strokeAlign, strokeCap: node.strokeCap, strokeMiterLimit: node.strokeMiterLimit } });
    } catch (e) {
      results.push({ id, error: errMsg(e) });
    }
  }
  return { updated: results.filter((r) => !r.error).length, results };
}

// Change text styling without recreating the node
async function setTextStyle(params) {
  const { nodeId, fontSize, fontFamily, fontStyle, lineHeight, letterSpacing, textAlignHorizontal } = params || {};
  if (!nodeId) throw new Error("Missing nodeId parameter");
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node not found with ID: ${nodeId}`);
  if (node.type !== "TEXT") throw new Error(`Node is not TEXT: ${node.type}`);

  // Load every font currently used so mixed-style text can be edited
  const len = node.characters.length;
  const fonts = len > 0 ? node.getRangeAllFontNames(0, len) : [node.fontName];
  for (const f of fonts) await figma.loadFontAsync(f);

  if (fontFamily || fontStyle) {
    const current = node.fontName === figma.mixed ? fonts[0] : node.fontName;
    const next = { family: fontFamily || current.family, style: fontStyle || current.style };
    await figma.loadFontAsync(next);
    node.fontName = next;
  }
  if (fontSize !== undefined) node.fontSize = parseFloat(fontSize);
  if (lineHeight !== undefined) {
    node.lineHeight = lineHeight === "AUTO"
      ? { unit: "AUTO" }
      : typeof lineHeight === "object"
        ? lineHeight
        : { unit: "PIXELS", value: parseFloat(lineHeight) };
  }
  if (letterSpacing !== undefined) {
    node.letterSpacing = typeof letterSpacing === "object"
      ? letterSpacing
      : { unit: "PIXELS", value: parseFloat(letterSpacing) };
  }
  if (textAlignHorizontal) node.textAlignHorizontal = textAlignHorizontal;

  return {
    id: node.id,
    name: node.name,
    fontName: node.fontName === figma.mixed ? "MIXED" : node.fontName,
    fontSize: node.fontSize === figma.mixed ? "MIXED" : node.fontSize,
    lineHeight: node.lineHeight === figma.mixed ? "MIXED" : node.lineHeight,
    width: node.width,
    height: node.height,
  };
}

async function getDocumentInfo() {
  await figma.currentPage.loadAsync();
  const page = figma.currentPage;
  return {
    name: page.name,
    id: page.id,
    type: page.type,
    children: page.children.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
    })),
    currentPage: {
      id: page.id,
      name: page.name,
      childCount: page.children.length,
    },
    pages: [
      {
        id: page.id,
        name: page.name,
        childCount: page.children.length,
      },
    ],
  };
}

async function getSelection() {
  return {
    selectionCount: figma.currentPage.selection.length,
    selection: figma.currentPage.selection.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      visible: node.visible,
    })),
  };
}

function rgbaToHex(color) {
  var r = Math.round(color.r * 255);
  var g = Math.round(color.g * 255);
  var b = Math.round(color.b * 255);
  var a = color.a !== undefined ? Math.round(color.a * 255) : 255;

  if (a === 255) {
    return (
      "#" +
      [r, g, b]
        .map((x) => {
          return x.toString(16).padStart(2, "0");
        })
        .join("")
    );
  }

  return (
    "#" +
    [r, g, b, a]
      .map((x) => {
        return x.toString(16).padStart(2, "0");
      })
      .join("")
  );
}

function filterFigmaNode(node) {
  if (node.type === "VECTOR") {
    return null;
  }

  var filtered = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  // E-11: 기본값이 아닐 때만 싣는다. get_node_info 가 이걸 안 줘서
  // "왜 화면에 안 보이는가"를 도구로 확인할 방법이 아예 없었다.
  if (node.visible === false) filtered.visible = false;
  if (typeof node.opacity === "number" && node.opacity < 1) filtered.opacity = node.opacity;

  if (node.fills && node.fills.length > 0) {
    filtered.fills = node.fills.map((fill) => {
      var processedFill = Object.assign({}, fill);
      delete processedFill.boundVariables;
      delete processedFill.imageRef;

      if (processedFill.gradientStops) {
        processedFill.gradientStops = processedFill.gradientStops.map(
          (stop) => {
            var processedStop = Object.assign({}, stop);
            if (processedStop.color) {
              processedStop.color = rgbaToHex(processedStop.color);
            }
            delete processedStop.boundVariables;
            return processedStop;
          }
        );
      }

      if (processedFill.color) {
        processedFill.color = rgbaToHex(processedFill.color);
      }

      return processedFill;
    });
  }

  if (node.strokes && node.strokes.length > 0) {
    filtered.strokes = node.strokes.map((stroke) => {
      var processedStroke = Object.assign({}, stroke);
      delete processedStroke.boundVariables;
      if (processedStroke.color) {
        processedStroke.color = rgbaToHex(processedStroke.color);
      }
      return processedStroke;
    });
  }

  if (node.cornerRadius !== undefined) {
    filtered.cornerRadius = node.cornerRadius;
  }

  // Note: layoutMode / padding / itemSpacing / effects / styles are NOT in the
  // JSON_REST_V1 export this function receives. Use get_layout_audit, which
  // reads them off live plugin nodes.

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
      lineHeightPx: node.style.lineHeightPx,
    };
  }

  if (node.children) {
    filtered.children = node.children
      .map((child) => {
        return filterFigmaNode(child);
      })
      .filter((child) => {
        return child !== null;
      });
  }

  return filtered;
}

async function getNodeInfo(nodeId) {
  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  const response = await node.exportAsync({
    format: "JSON_REST_V1",
  });

  return filterFigmaNode(response.document);
}

async function getNodesInfo(nodeIds) {
  try {
    // Load all nodes in parallel
    const nodes = await Promise.all(
      nodeIds.map((id) => figma.getNodeByIdAsync(id))
    );

    // Filter out any null values (nodes that weren't found)
    const validNodes = nodes.filter((node) => node !== null);

    // Export all valid nodes in parallel
    const responses = await Promise.all(
      validNodes.map(async (node) => {
        const response = await node.exportAsync({
          format: "JSON_REST_V1",
        });
        return {
          nodeId: node.id,
          document: filterFigmaNode(response.document),
        };
      })
    );

    return responses;
  } catch (error) {
    throw new Error(`Error getting nodes info: ${errMsg(error)}`);
  }
}

async function getReactions(nodeIds) {
  try {
    const commandId = generateCommandId();
    sendProgressUpdate(
      commandId,
      "get_reactions",
      "started",
      0,
      nodeIds.length,
      0,
      `Starting deep search for reactions in ${nodeIds.length} nodes and their children`
    );

    // Function to find nodes with reactions from the node and all its children
    async function findNodesWithReactions(node, processedNodes = new Set(), depth = 0, results = []) {
      // Skip already processed nodes (prevent circular references)
      if (processedNodes.has(node.id)) {
        return results;
      }
      
      processedNodes.add(node.id);
      
      // Check if the current node has reactions
      let filteredReactions = [];
      if (node.reactions && node.reactions.length > 0) {
        // Filter out reactions with navigation === 'CHANGE_TO'
        filteredReactions = node.reactions.filter(r => {
          // Some reactions may have action or actions array
          if (r.action && r.action.navigation === 'CHANGE_TO') return false;
          if (Array.isArray(r.actions)) {
            // If any action in actions array is CHANGE_TO, exclude
            return !r.actions.some(a => a.navigation === 'CHANGE_TO');
          }
          return true;
        });
      }
      const hasFilteredReactions = filteredReactions.length > 0;
      
      // If the node has filtered reactions, add it to results and apply highlight effect
      if (hasFilteredReactions) {
        results.push({
          id: node.id,
          name: node.name,
          type: node.type,
          depth: depth,
          hasReactions: true,
          reactions: filteredReactions,
          path: getNodePath(node)
        });
        // Apply highlight effect (orange border)
        await highlightNodeWithAnimation(node);
      }
      
      // If node has children, recursively search them
      if (node.children) {
        for (const child of node.children) {
          await findNodesWithReactions(child, processedNodes, depth + 1, results);
        }
      }
      
      return results;
    }
    
    // Function to apply animated highlight effect to a node
    async function highlightNodeWithAnimation(node) {
      // Save original stroke properties
      const originalStrokeWeight = node.strokeWeight;
      const originalStrokes = node.strokes ? [...node.strokes] : [];
      
      try {
        // Apply orange border stroke
        node.strokeWeight = 4;
        node.strokes = [{
          type: 'SOLID',
          color: { r: 1, g: 0.5, b: 0 }, // Orange color
          opacity: 0.8
        }];
        
        // Set timeout for animation effect (restore to original after 1.5 seconds)
        setTimeout(() => {
          try {
            // Restore original stroke properties
            node.strokeWeight = originalStrokeWeight;
            node.strokes = originalStrokes;
          } catch (restoreError) {
            console.error(`Error restoring node stroke: ${errMsg(restoreError)}`);
          }
        }, 1500);
      } catch (highlightError) {
        console.error(`Error highlighting node: ${errMsg(highlightError)}`);
        // Continue even if highlighting fails
      }
    }
    
    // Get node hierarchy path as a string
    function getNodePath(node) {
      const path = [];
      let current = node;
      
      while (current && current.parent) {
        path.unshift(current.name);
        current = current.parent;
      }
      
      return path.join(' > ');
    }

    // Array to store all results
    let allResults = [];
    let processedCount = 0;
    const totalCount = nodeIds.length;
    
    // Iterate through each node and its children to search for reactions
    for (let i = 0; i < nodeIds.length; i++) {
      try {
        const nodeId = nodeIds[i];
        const node = await figma.getNodeByIdAsync(nodeId);
        
        if (!node) {
          processedCount++;
          sendProgressUpdate(
            commandId,
            "get_reactions",
            "in_progress",
            processedCount / totalCount,
            totalCount,
            processedCount,
            `Node not found: ${nodeId}`
          );
          continue;
        }
        
        // Search for reactions in the node and its children
        const processedNodes = new Set();
        const nodeResults = await findNodesWithReactions(node, processedNodes);
        
        // Add results
        allResults = allResults.concat(nodeResults);
        
        // Update progress
        processedCount++;
        sendProgressUpdate(
          commandId,
          "get_reactions",
          "in_progress",
          processedCount / totalCount,
          totalCount,
          processedCount,
          `Processed node ${processedCount}/${totalCount}, found ${nodeResults.length} nodes with reactions`
        );
      } catch (error) {
        processedCount++;
        sendProgressUpdate(
          commandId,
          "get_reactions",
          "in_progress",
          processedCount / totalCount,
          totalCount,
          processedCount,
          `Error processing node: ${errMsg(error)}`
        );
      }
    }

    // Completion update
    sendProgressUpdate(
      commandId,
      "get_reactions",
      "completed",
      1,
      totalCount,
      totalCount,
      `Completed deep search: found ${allResults.length} nodes with reactions.`
    );

    return {
      nodesCount: nodeIds.length,
      nodesWithReactions: allResults.length,
      nodes: allResults
    };
  } catch (error) {
    throw new Error(`Failed to get reactions: ${errMsg(error)}`);
  }
}

async function readMyDesign() {
  try {
    // Load all selected nodes in parallel
    const nodes = await Promise.all(
      figma.currentPage.selection.map((node) => figma.getNodeByIdAsync(node.id))
    );

    // Filter out any null values (nodes that weren't found)
    const validNodes = nodes.filter((node) => node !== null);

    // Export all valid nodes in parallel
    const responses = await Promise.all(
      validNodes.map(async (node) => {
        const response = await node.exportAsync({
          format: "JSON_REST_V1",
        });
        return {
          nodeId: node.id,
          document: filterFigmaNode(response.document),
        };
      })
    );

    return responses;
  } catch (error) {
    throw new Error(`Error getting nodes info: ${errMsg(error)}`);
  }
}

async function createRectangle(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Rectangle",
    parentId,
  } = params || {};

  const rect = figma.createRectangle();
  rect.x = x;
  rect.y = y;
  rect.resize(width, height);
  rect.name = name;

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(rect);
  } else {
    figma.currentPage.appendChild(rect);
  }

  return {
    id: rect.id,
    name: rect.name,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    parentId: rect.parent ? rect.parent.id : undefined,
  };
}

async function createFrame(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Frame",
    parentId,
    fillColor,
    strokeColor,
    strokeWeight,
    layoutMode = "NONE",
    layoutWrap = "NO_WRAP",
    paddingTop = 10,
    paddingRight = 10,
    paddingBottom = 10,
    paddingLeft = 10,
    primaryAxisAlignItems = "MIN",
    counterAxisAlignItems = "MIN",
    layoutSizingHorizontal = "FIXED",
    layoutSizingVertical = "FIXED",
    itemSpacing = 0,
  } = params || {};

  const frame = figma.createFrame();
  frame.x = x;
  frame.y = y;
  frame.resize(width, height);
  frame.name = name;

  // Set layout mode if provided
  if (layoutMode !== "NONE") {
    frame.layoutMode = layoutMode;
    frame.layoutWrap = layoutWrap;

    // Set padding values only when layoutMode is not NONE
    frame.paddingTop = paddingTop;
    frame.paddingRight = paddingRight;
    frame.paddingBottom = paddingBottom;
    frame.paddingLeft = paddingLeft;

    // Set axis alignment only when layoutMode is not NONE
    frame.primaryAxisAlignItems = primaryAxisAlignItems;
    frame.counterAxisAlignItems = counterAxisAlignItems;

    // Set layout sizing only when layoutMode is not NONE
    frame.layoutSizingHorizontal = layoutSizingHorizontal;
    frame.layoutSizingVertical = layoutSizingVertical;

    // Set item spacing only when layoutMode is not NONE
    frame.itemSpacing = itemSpacing;
  }

  // Set fill color if provided
  if (fillColor) {
    const paintStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(fillColor.r) || 0,
        g: parseFloat(fillColor.g) || 0,
        b: parseFloat(fillColor.b) || 0,
      },
      opacity: parseFloat(fillColor.a) || 1,
    };
    frame.fills = [paintStyle];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(strokeColor.r) || 0,
        g: parseFloat(strokeColor.g) || 0,
        b: parseFloat(strokeColor.b) || 0,
      },
      opacity: parseFloat(strokeColor.a) || 1,
    };
    frame.strokes = [strokeStyle];
  }

  // Set stroke weight if provided
  if (strokeWeight !== undefined) {
    frame.strokeWeight = strokeWeight;
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(frame);
  } else {
    figma.currentPage.appendChild(frame);
  }

  return {
    id: frame.id,
    name: frame.name,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    fills: frame.fills,
    strokes: frame.strokes,
    strokeWeight: frame.strokeWeight,
    layoutMode: frame.layoutMode,
    layoutWrap: frame.layoutWrap,
    parentId: frame.parent ? frame.parent.id : undefined,
  };
}

async function createText(params) {
  const {
    x = 0,
    y = 0,
    text = "Text",
    fontSize = 14,
    fontWeight = 400,
    fontColor = { r: 0, g: 0, b: 0, a: 1 }, // Default to black
    name = "",
    parentId,
    fontFamily,
    fontStyle,
    width,
  } = params || {};

  // Map common font weights to Figma font styles
  const getFontStyle = (weight) => {
    switch (weight) {
      case 100:
        return "Thin";
      case 200:
        return "Extra Light";
      case 300:
        return "Light";
      case 400:
        return "Regular";
      case 500:
        return "Medium";
      case 600:
        return "Semi Bold";
      case 700:
        return "Bold";
      case 800:
        return "Extra Bold";
      case 900:
        return "Black";
      default:
        return "Regular";
    }
  };

  const textNode = figma.createText();
  textNode.x = x;
  textNode.y = y;
  textNode.name = name || text;
  // E-5: honour an explicit font family/style, falling back to Inter so a bad
  // family name degrades instead of failing every text node in a batch.
  const wantedFont = {
    family: fontFamily || "Inter",
    style: fontStyle || getFontStyle(fontWeight),
  };
  let appliedFont = wantedFont;
  let fontFallbackReason = null;
  try {
    await figma.loadFontAsync(wantedFont);
  } catch (error) {
    fontFallbackReason = errMsg(error);
    appliedFont = { family: "Inter", style: getFontStyle(fontWeight) };
    await figma.loadFontAsync(appliedFont);
  }
  try {
    textNode.fontName = appliedFont;
    textNode.fontSize = parseFloat(fontSize);
  } catch (error) {
    console.error("Error setting font", error);
  }
  await setCharacters(textNode, text);

  // E-7: a fixed width with auto height. resize() alone sets textAutoResize to
  // NONE, which silently clips every multi-line cell, so set HEIGHT after.
  if (typeof width === "number" && width > 0) {
    textNode.textAutoResize = "HEIGHT";
    textNode.resize(width, textNode.height);
  }

  // Set text color
  const paintStyle = {
    type: "SOLID",
    color: {
      r: parseFloat(fontColor.r) || 0,
      g: parseFloat(fontColor.g) || 0,
      b: parseFloat(fontColor.b) || 0,
    },
    opacity: fontColor.a === undefined ? 1 : parseFloat(fontColor.a),
  };
  textNode.fills = [paintStyle];

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(textNode);
  } else {
    figma.currentPage.appendChild(textNode);
  }

  return {
    id: textNode.id,
    name: textNode.name,
    x: textNode.x,
    y: textNode.y,
    width: textNode.width,
    height: textNode.height,
    characters: textNode.characters,
    fontSize: textNode.fontSize,
    fontWeight: fontWeight,
    fontColor: fontColor,
    fontName: textNode.fontName,
    fontFallbackReason: fontFallbackReason,
    fills: textNode.fills,
    parentId: textNode.parent ? textNode.parent.id : undefined,
  };
}


async function setFillColor(params) {
  console.log("setFillColor", params);
  const {
    nodeId,
    color: { r, g, b, a },
  } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("fills" in node)) {
    throw new Error(`Node does not support fills: ${nodeId}`);
  }

  // Create RGBA color
  const rgbColor = {
    r: parseFloat(r) || 0,
    g: parseFloat(g) || 0,
    b: parseFloat(b) || 0,
    a: a === undefined || a === null || isNaN(parseFloat(a)) ? 1 : parseFloat(a),
  };

  // Set fill
  const paintStyle = {
    type: "SOLID",
    color: {
      r: parseFloat(rgbColor.r),
      g: parseFloat(rgbColor.g),
      b: parseFloat(rgbColor.b),
    },
    opacity: parseFloat(rgbColor.a),
  };

  console.log("paintStyle", paintStyle);

  node.fills = [paintStyle];

  return {
    id: node.id,
    name: node.name,
    fills: [paintStyle],
  };
}

async function setStrokeColor(params) {
  const {
    nodeId,
    color: { r, g, b, a },
    weight,
  } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("strokes" in node)) {
    throw new Error(`Node does not support strokes: ${nodeId}`);
  }

  // Create RGBA color
  const rgbColor = {
    r: r !== undefined ? r : 0,
    g: g !== undefined ? g : 0,
    b: b !== undefined ? b : 0,
    a: a !== undefined ? a : 1,
  };

  // Set stroke
  const paintStyle = {
    type: "SOLID",
    color: {
      r: rgbColor.r,
      g: rgbColor.g,
      b: rgbColor.b,
    },
    opacity: rgbColor.a,
  };

  node.strokes = [paintStyle];

  // Set stroke weight only when given (keep the existing weight otherwise)
  if (weight !== undefined && weight !== null && "strokeWeight" in node) {
    node.strokeWeight = weight;
  }

  return {
    id: node.id,
    name: node.name,
    strokes: node.strokes,
    strokeWeight: "strokeWeight" in node ? node.strokeWeight : undefined,
  };
}

async function setImageFill(params) {
  const { nodeId, imageBase64, scaleMode = "FILL" } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!imageBase64) {
    throw new Error("Missing imageBase64 parameter");
  }

  const validScaleModes = ["FILL", "FIT", "CROP", "TILE"];
  if (validScaleModes.indexOf(scaleMode) === -1) {
    throw new Error(
      `Invalid scaleMode: ${scaleMode}. Must be one of: ${validScaleModes.join(", ")}`
    );
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("fills" in node)) {
    throw new Error(`Node does not support fills: ${nodeId}`);
  }

  const bytes = base64ToUint8Array(imageBase64);

  let image;
  try {
    image = figma.createImage(bytes);
  } catch (error) {
    throw new Error(
      `Figma rejected the image (supported: PNG/JPG/GIF/WEBP up to 4096x4096): ${errMsg(error)}`
    );
  }

  node.fills = [
    {
      type: "IMAGE",
      imageHash: image.hash,
      scaleMode: scaleMode,
    },
  ];

  let imageWidth;
  let imageHeight;
  try {
    const size = await image.getSizeAsync();
    imageWidth = size.width;
    imageHeight = size.height;
  } catch (sizeError) {
    // Size lookup is informational only
  }

  return {
    id: node.id,
    name: node.name,
    imageHash: image.hash,
    scaleMode: scaleMode,
    imageWidth: imageWidth,
    imageHeight: imageHeight,
  };
}

// Decode base64 in the plugin sandbox, where atob is not available
function base64ToUint8Array(base64) {
  if (typeof figma.base64Decode === "function") {
    return figma.base64Decode(base64);
  }

  const base64Chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const length = clean.length;
  const bytes = new Uint8Array(Math.floor((length * 3) / 4));

  let byteIndex = 0;
  for (let i = 0; i < length; i += 4) {
    const a = base64Chars.indexOf(clean[i]);
    const b = base64Chars.indexOf(clean[i + 1]);
    const c = base64Chars.indexOf(clean[i + 2]);
    const d = base64Chars.indexOf(clean[i + 3]);

    bytes[byteIndex++] = (a << 2) | (b >> 4);
    if (c !== -1) bytes[byteIndex++] = ((b & 15) << 4) | (c >> 2);
    if (d !== -1) bytes[byteIndex++] = ((c & 3) << 6) | d;
  }

  return bytes.slice(0, byteIndex);
}

// E-23: 컴포넌트 description 쓰기. 읽기는 get_local_components 가 하지만 쓰는 수단이 없었다.
async function setComponentDescription(params) {
  const { items } = params || {};

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Missing items parameter (expected a non-empty array)");
  }

  const results = [];
  let applied = 0;

  for (const item of items) {
    const nodeId = item && item.nodeId;
    const description = item && item.description;

    if (!nodeId) {
      results.push({ nodeId: String(nodeId), ok: false, error: "Missing nodeId" });
      continue;
    }
    if (typeof description !== "string") {
      results.push({ nodeId, ok: false, error: "description must be a string" });
      continue;
    }

    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        results.push({ nodeId, ok: false, error: "Node not found" });
        continue;
      }
      // 변이 COMPONENT 는 description 을 못 가진다 — 정본은 부모 COMPONENT_SET 이다.
      if (node.type === "COMPONENT" && node.parent && node.parent.type === "COMPONENT_SET") {
        results.push({
          nodeId,
          name: node.name,
          ok: false,
          error: "Variant COMPONENT cannot hold a description; target its COMPONENT_SET instead",
        });
        continue;
      }
      if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
        results.push({ nodeId, name: node.name, ok: false, error: "Not a COMPONENT or COMPONENT_SET (" + node.type + ")" });
        continue;
      }

      node.description = description;
      applied++;
      results.push({ nodeId, name: node.name, ok: true });
    } catch (error) {
      results.push({ nodeId, ok: false, error: errMsg(error) });
    }
  }

  return { applied, failed: results.length - applied, results };
}

// E-24: GRID 오토레이아웃의 셀 배치를 읽고 쓴다.
// 왜 필요한가 — 가이드의 토큰 표(Container/*/Token)가 GRID 라서, 셀을 clone 하면
// 클론이 원본의 grid 배치를 그대로 물려받아 같은 칸에 겹쳐 놓인다(표 높이도 안 는다).
// 행을 늘리려면 배치(anchor/span)와 부모의 행 수를 지정해야 하는데 그 수단이 없었다.
// 삭제와 텍스트 교체는 GRID 와 무관하게 잘 되므로, 부족한 건 "배치" 하나다.
var GRID_FRAME_KEYS = [
  "layoutMode",
  "layoutWrap",
  "gridRowCount",
  "gridColumnCount",
  "gridRowGap",
  "gridColumnGap",
  "gridRowSizes",
  "gridColumnSizes",
  "itemSpacing",
  "counterAxisSpacing",
];
var GRID_CHILD_KEYS = [
  "gridRowAnchorIndex",
  "gridColumnAnchorIndex",
  "gridRowSpan",
  "gridColumnSpan",
  "gridChildHorizontalAlign",
  "gridChildVerticalAlign",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
];

function readNodeProps(node, keys) {
  var out = {};
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    try {
      var v = node[k];
      if (v !== undefined) out[k] = v;
    } catch (e) {
      // 노드 타입이 지원하지 않는 getter 는 던진다 — 없는 것으로 본다
    }
  }
  return out;
}

// 이름을 추측해서 못 맞히는 경우에 대비해, 프로토타입 체인에서 grid 가 들어간
// 속성·메서드 이름을 실제로 긁어온다. 한 번의 빌드로 진상을 알 수 있게 하는 장치다.
function discoverGridMembers(node) {
  var found = [];
  try {
    var proto = Object.getPrototypeOf(node);
    while (proto) {
      var names = Object.getOwnPropertyNames(proto);
      for (var i = 0; i < names.length; i++) {
        if (/grid/i.test(names[i]) && found.indexOf(names[i]) === -1) found.push(names[i]);
      }
      proto = Object.getPrototypeOf(proto);
    }
  } catch (e) {
    // 프록시라 순회가 막히면 빈 배열로 둔다
  }
  return found.sort();
}

async function gridLayout(params) {
  var op = params && params.op;
  var nodeId = params && params.nodeId;
  var items = params && params.items;
  var limit = params && typeof params.limit === "number" ? params.limit : 60;

  if (op === "info") {
    if (!nodeId) throw new Error("Missing nodeId parameter");
    var frame = await figma.getNodeByIdAsync(nodeId);
    if (!frame) throw new Error("Node not found: " + nodeId);

    var kids = frame.children || [];
    var children = [];
    for (var i = 0; i < kids.length && i < limit; i++) {
      var kid = kids[i];
      children.push({
        id: kid.id,
        name: kid.name,
        type: kid.type,
        index: i,
        props: readNodeProps(kid, GRID_CHILD_KEYS),
      });
    }

    return {
      op: "info",
      nodeId: frame.id,
      name: frame.name,
      type: frame.type,
      childCount: kids.length,
      returned: children.length,
      frame: readNodeProps(frame, GRID_FRAME_KEYS),
      discovered: {
        frame: discoverGridMembers(frame),
        child: kids.length ? discoverGridMembers(kids[0]) : [],
      },
      children: children,
    };
  }

  if (op === "set") {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Missing items parameter (expected a non-empty array)");
    }

    var results = [];
    var applied = 0;

    for (var j = 0; j < items.length; j++) {
      var item = items[j] || {};
      var targetId = item.nodeId;
      var props = item.props;

      if (!targetId) {
        results.push({ nodeId: String(targetId), ok: false, error: "Missing nodeId" });
        continue;
      }
      if (!props || typeof props !== "object") {
        results.push({ nodeId: targetId, ok: false, error: "Missing props object" });
        continue;
      }

      try {
        var node = await figma.getNodeByIdAsync(targetId);
        if (!node) {
          results.push({ nodeId: targetId, ok: false, error: "Node not found" });
          continue;
        }

        var set = {};
        var skipped = [];
        var keys = Object.keys(props);
        for (var k = 0; k < keys.length; k++) {
          var key = keys[k];
          // grid 관련 속성만 허용한다 — 임의 속성 setter 가 되면 위험하다
          if (!/^grid/i.test(key)) {
            skipped.push(key + " (not a grid* property)");
            continue;
          }
          try {
            node[key] = props[key];
            set[key] = props[key];
          } catch (e) {
            skipped.push(key + " (" + errMsg(e) + ")");
          }
        }

        var ok = Object.keys(set).length > 0;
        if (ok) applied++;
        results.push({
          nodeId: targetId,
          name: node.name,
          ok: ok,
          set: set,
          skipped: skipped,
          after: readNodeProps(node, GRID_CHILD_KEYS.concat(GRID_FRAME_KEYS)),
        });
      } catch (error) {
        results.push({ nodeId: targetId, ok: false, error: errMsg(error) });
      }
    }

    return { op: "set", applied: applied, failed: results.length - applied, results: results };
  }

  // ★ grid 배치는 속성 대입으로 안 된다 — gridRowAnchorIndex 등은 읽기 전용이고
  // 부모 프레임의 setGridChildPosition(child, position) 이 유일한 경로다 (2026-09-11 실측).
  if (op === "place") {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Missing items parameter (expected a non-empty array)");
    }

    var placed = 0;
    var out = [];

    for (var m = 0; m < items.length; m++) {
      var it = items[m] || {};
      var childId = it.nodeId;
      var position = it.position;

      if (!childId) {
        out.push({ nodeId: String(childId), ok: false, error: "Missing nodeId" });
        continue;
      }
      if (!position || typeof position !== "object") {
        out.push({ nodeId: childId, ok: false, error: "Missing position object" });
        continue;
      }

      try {
        var child = await figma.getNodeByIdAsync(childId);
        if (!child) {
          out.push({ nodeId: childId, ok: false, error: "Node not found" });
          continue;
        }
        var parent = child.parent;
        if (!parent) {
          out.push({ nodeId: childId, ok: false, error: "Node has no parent" });
          continue;
        }
        if (typeof parent.setGridChildPosition !== "function") {
          out.push({
            nodeId: childId,
            ok: false,
            error: "Parent " + parent.type + " has no setGridChildPosition (is it a GRID frame?)",
          });
          continue;
        }

        // 인자 형태를 확정할 수 없어 양쪽을 다 시도한다.
        // 2026-09-11 실측 오류: `Property "rowIndex" failed validation: Expected number, received object`
        // → 키 이름은 rowIndex/columnIndex 이고, 객체인지 위치인자인지가 남은 갈림길이다.
        var rowIndex = typeof position.rowIndex === "number" ? position.rowIndex : position.rowAnchorIndex;
        var columnIndex = typeof position.columnIndex === "number" ? position.columnIndex : position.columnAnchorIndex;
        var rowSpan = typeof position.rowSpan === "number" ? position.rowSpan : 1;
        var columnSpan = typeof position.columnSpan === "number" ? position.columnSpan : 1;

        var tried = [];
        var done = false;

        // ★ 2026-09-11 규명: 세 형태가 전부 같은 오류
        // (`Property "rowIndex" failed validation: Expected number, received object`)를 냈다.
        // 첫 인자가 rowIndex 로 검증된다는 뜻 — 즉 이 메서드는 부모가 아니라 **자식 자신**의 것이다.
        // discovered 의 frame·child 목록이 똑같았던 것도 같은 프로토타입에 있다는 신호였다.
        if (typeof child.setGridChildPosition === "function") {
          try {
            child.setGridChildPosition(rowIndex, columnIndex);
            done = true;
            tried.push("child.setGridChildPosition(row,col): ok");
          } catch (e0) {
            tried.push("child.setGridChildPosition(row,col): " + e0.message);
          }
          if (!done) {
            try {
              child.setGridChildPosition({ rowIndex: rowIndex, columnIndex: columnIndex });
              done = true;
              tried.push("child.setGridChildPosition({rowIndex,columnIndex}): ok");
            } catch (e0b) {
              tried.push("child.setGridChildPosition({...}): " + e0b.message);
            }
          }
        }

        // ① 객체 인자 + 정규화한 키
        if (!done) try {
          parent.setGridChildPosition(child, {
            rowIndex: rowIndex,
            columnIndex: columnIndex,
            rowSpan: rowSpan,
            columnSpan: columnSpan,
          });
          done = true;
          tried.push("parent object(rowIndex,columnIndex,rowSpan,columnSpan): ok");
        } catch (e1) {
          tried.push("parent object(rowIndex,...): " + e1.message);
        }

        // ② 위치 인자
        if (!done) {
          try {
            parent.setGridChildPosition(child, rowIndex, columnIndex, rowSpan, columnSpan);
            done = true;
            tried.push("positional(row,col,rowSpan,colSpan): ok");
          } catch (e2) {
            tried.push("positional(row,col,rowSpan,colSpan): " + e2.message);
          }
        }

        // ③ 위치 인자 2개만
        if (!done) {
          try {
            parent.setGridChildPosition(child, rowIndex, columnIndex);
            done = true;
            tried.push("positional(row,col): ok");
          } catch (e3) {
            tried.push("positional(row,col): " + e3.message);
          }
        }

        if (!done) {
          out.push({ nodeId: childId, name: child.name, ok: false, tried: tried });
          continue;
        }

        if (rowSpan !== 1 || columnSpan !== 1) {
          try {
            child.gridRowSpan = rowSpan;
            child.gridColumnSpan = columnSpan;
            tried.push("span assigned");
          } catch (eS) {
            tried.push("span: " + eS.message);
          }
        }

        placed++;
        out.push({
          nodeId: childId,
          name: child.name,
          ok: true,
          tried: tried,
          after: readNodeProps(child, GRID_CHILD_KEYS),
        });
      } catch (error) {
        out.push({ nodeId: childId, ok: false, error: errMsg(error) });
      }
    }

    return { op: "place", placed: placed, failed: out.length - placed, results: out };
  }

  throw new Error('Missing or invalid op parameter (expected "info", "set" or "place")');
}

async function renameNode(params) {
  const { nodeId, name } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (name === undefined || name === null) {
    throw new Error("Missing name parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  const previousName = node.name;
  try {
    node.name = String(name);
  } catch (error) {
    throw new Error(`Cannot rename node: ${errMsg(error)}`);
  }

  return {
    id: node.id,
    previousName: previousName,
    name: node.name,
  };
}

// Put back auto-layout sizing modes and the size of fixed axes. Returns true
// when something changed.
function restoreSize(node, g) {
  let changed = false;
  // Sizing modes only exist inside auto-layout; outside they read undefined.
  if (g.sizingH && node.layoutSizingHorizontal !== g.sizingH) {
    node.layoutSizingHorizontal = g.sizingH;
    changed = true;
  }
  if (g.sizingV && node.layoutSizingVertical !== g.sizingV) {
    node.layoutSizingVertical = g.sizingV;
    changed = true;
  }
  // resize() would turn FILL/HUG into FIXED, so only touch fixed axes.
  const w = !g.sizingH || g.sizingH === "FIXED" ? g.width : node.width;
  const h = !g.sizingV || g.sizingV === "FIXED" ? g.height : node.height;
  if (Math.abs(node.width - w) > 0.01 || Math.abs(node.height - h) > 0.01) {
    node.resize(w, h);
    changed = true;
  }
  return changed;
}

// fills/strokes 각 paint 에 걸린 색 변수 id (없으면 null). 걸린 게 하나도 없으면 null.
function paintTokenIds(node) {
  let out = null;
  for (const field of ["fills", "strokes"]) {
    const paints = node[field];
    if (!Array.isArray(paints)) continue;
    const ids = paints.map((p) => (p.boundVariables && p.boundVariables.color ? p.boundVariables.color.id : null));
    if (ids.some(Boolean)) (out = out || {})[field] = ids;
  }
  return out;
}

// Figma 는 Error 가 아닌 값(문자열 등)을 던지기도 해서, catch 안에서 error.message 를 바로 읽으면 그 자리에서 다시 터진다.
function errMsg(error) {
  if (error && typeof error.message === "string") return error.message;
  try {
    return String(error);
  } catch (_) {
    return "unknown error";
  }
}

// reset 복원 전용 텍스트 쓰기. setCharacters 는 글꼴 로드가 실패하면 조용히 Inter 로 바꾸고
// 쓰기 실패도 경고만 남기므로, 여기서는 노드가 쓰는 글꼴을 전부 불러오고 실패하면 그대로 던진다.
async function restoreText(node, characters) {
  const len = node.characters.length;
  const fonts =
    node.fontName === figma.mixed && len > 0 ? node.getRangeAllFontNames(0, len) : [node.fontName];
  for (const font of fonts) {
    if (font && font !== figma.mixed) await figma.loadFontAsync(font);
  }
  node.characters = characters;
  if (node.characters !== characters) throw new Error("text did not stick");
}

// Reset all overrides on the top-level instances under each node, then
// re-apply what they showed before: swapped components, component
// properties, visibility and text. Everything else (fills, sizes, stale
// overrides) goes back to the main component.
async function resetInstanceOverrides(params) {
  const { nodeIds, dryRun = false } = params || {};
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw new Error("Missing nodeIds parameter");
  }

  // Instances not nested inside another instance (nested ones are reset by their parent).
  const targets = [];
  const collect = (node) => {
    if (node.type === "INSTANCE") {
      targets.push(node);
      return;
    }
    if ("children" in node) node.children.forEach(collect);
  };
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) throw new Error(`Node not found with ID: ${id}`);
    collect(node);
  }

  // Document order, so parents are restored before their children.
  const snapshot = async (root) => {
    const out = [];
    const walk = async (node) => {
      const entry = { id: node.id, name: node.name, visible: node.visible };
      if (node.type === "TEXT") entry.characters = node.characters;
      // 색 토큰: 복원 여부가 컴포넌트마다 달라 되돌리지 않고, reset 이 지운 것을 보고만 한다.
      const paintTokens = paintTokenIds(node);
      if (paintTokens) entry.paintTokens = paintTokens;
      // Sublayer size overrides (e.g. a list clipped to a fixed height) are
      // dropped by resetOverrides too. Text sizes follow their content.
      if (node !== root && node.type !== "TEXT" && "resize" in node) {
        entry.size = {
          width: node.width,
          height: node.height,
          sizingH: node.layoutSizingHorizontal,
          sizingV: node.layoutSizingVertical,
        };
      }
      if (node.type === "INSTANCE") {
        const main = await node.getMainComponentAsync();
        entry.mainId = main ? main.id : null;
        entry.props = {};
        entry.bound = {};
        for (const [key, p] of Object.entries(node.componentProperties)) {
          entry.props[key] = p.value;
          // 속성에 걸린 변수(토큰)도 resetOverrides 가 지우므로 같이 기록한다.
          if (p.boundVariables && p.boundVariables.value) entry.bound[key] = p.boundVariables.value.id;
        }
      }
      out.push(entry);
      if ("children" in node) for (const c of node.children) await walk(c);
    };
    await walk(root);
    return out;
  };

  // resetOverrides also drops the instance's own resize and auto-layout sizing,
  // and a size change moves siblings (constraints, hugging parents). So record
  // every target's geometry before touching any of them, and put it back only
  // after all resets are done.
  const geometry = targets.map((inst) => ({
    x: inst.x,
    y: inst.y,
    width: inst.width,
    height: inst.height,
    sizingH: inst.layoutSizingHorizontal,
    sizingV: inst.layoutSizingVertical,
    positioning: inst.layoutPositioning,
    constraints: inst.constraints,
    // 인스턴스 자신의 필드에 걸린 변수(예: maxHeight ← max/panel). 칠/속성 바인딩은 따로 처리.
    bound: Object.fromEntries(
      Object.entries(inst.boundVariables || {})
        .filter(([field, a]) => a && !Array.isArray(a) && a.id && field !== "componentProperties")
        .map(([field, a]) => [field, a.id])
    ),
  }));

  const results = [];
  // 이미 reset 한 인스턴스. 중간에 예상 못 한 예외가 나도 이 인스턴스들의 위치·크기는 아래에서 꼭 되돌린다.
  const resetDone = new Array(targets.length).fill(false);
  let aborted = null;
  try {
  for (let i = 0; i < targets.length; i++) {
    const inst = targets[i];
    const result = { id: inst.id, name: inst.name, nodes: 0, restored: 0, failed: [] };
    results.push(result);
    // 기록에 실패하면 되돌릴 근거가 없으니 reset 자체를 하지 않는다.
    let before;
    try {
      before = await snapshot(inst);
    } catch (error) {
      result.failed.push({ id: inst.id, name: inst.name, stage: "snapshot", reason: errMsg(error) });
      result.skipped = "snapshot failed, not reset";
      continue;
    }
    result.nodes = before.length;
    if (dryRun) continue;

    try {
      inst.resetOverrides();
    } catch (error) {
      result.failed.push({ id: inst.id, name: inst.name, stage: "reset", reason: errMsg(error) });
      result.skipped = "resetOverrides failed";
      continue;
    }
    resetDone[i] = true;

    for (const entry of before) {
      try {
        const node = await figma.getNodeByIdAsync(entry.id);
        if (!node) {
          result.failed.push({ id: entry.id, name: entry.name, stage: "restore", reason: "missing after reset" });
          continue;
        }
        let changed = false;
        if (node.type === "INSTANCE" && entry.mainId) {
          const main = await node.getMainComponentAsync();
          if (!main || main.id !== entry.mainId) {
            const target = await figma.getNodeByIdAsync(entry.mainId);
            if (!target) throw new Error(`component ${entry.mainId} not found`);
            node.swapComponent(target);
            changed = true;
          }
          const diff = {};
          for (const [key, value] of Object.entries(entry.props)) {
            const cur = node.componentProperties[key];
            if (!cur) continue;
            const wantId = entry.bound[key];
            const curId = cur.boundVariables && cur.boundVariables.value ? cur.boundVariables.value.id : null;
            if (wantId) {
              if (curId !== wantId) {
                const variable = await figma.variables.getVariableByIdAsync(wantId);
                if (!variable) throw new Error(`variable ${wantId} for ${bareProp(key)} not found`);
                diff[key] = figma.variables.createVariableAlias(variable);
              }
            } else if (cur.value !== value) {
              diff[key] = value;
            }
          }
          if (Object.keys(diff).length) {
            node.setProperties(diff);
            changed = true;
          }
        }
        if (node.visible !== entry.visible) {
          node.visible = entry.visible;
          changed = true;
        }
        if (node.type === "TEXT" && node.characters !== entry.characters) {
          await restoreText(node, entry.characters);
          changed = true;
        }
        if (entry.size && restoreSize(node, entry.size)) changed = true;
        if (changed) result.restored++;
        if (entry.paintTokens) {
          const now = paintTokenIds(node) || {};
          for (const [field, ids] of Object.entries(entry.paintTokens)) {
            for (let p = 0; p < ids.length; p++) {
              if (!ids[p] || (now[field] && now[field][p] === ids[p])) continue;
              const was = await figma.variables.getVariableByIdAsync(ids[p]);
              const nowId = now[field] && now[field][p];
              const cur = nowId ? await figma.variables.getVariableByIdAsync(nowId) : null;
              result.droppedColorTokens = result.droppedColorTokens || [];
              result.droppedColorTokens.push({
                id: entry.id, name: entry.name, field, index: p,
                was: was ? was.name : ids[p], now: cur ? cur.name : nowId || null,
              });
            }
          }
        }
      } catch (error) {
        result.failed.push({ id: entry.id, name: entry.name, stage: "restore", reason: errMsg(error) });
      }
    }

    // 텍스트는 다른 단계가 실패해도 끝까지 되돌린다. 한 번 더 비교해 남은 것만 다시 쓰고,
    // 그래도 안 되면 원래 글자를 결과에 남겨 손으로라도 복구할 수 있게 한다.
    for (const entry of before) {
      if (entry.characters === undefined) continue;
      try {
        const node = await figma.getNodeByIdAsync(entry.id);
        if (!node || node.type !== "TEXT" || node.characters === entry.characters) continue;
        await restoreText(node, entry.characters);
        result.restored++;
      } catch (error) {
        result.textUnrestored = result.textUnrestored || [];
        result.textUnrestored.push({ id: entry.id, name: entry.name, characters: entry.characters, reason: errMsg(error) });
      }
    }
    if (result.failed.length || result.textUnrestored) result.incomplete = true;

    sendProgressUpdate(
      "reset_instance_overrides", "reset_instance_overrides", "in_progress",
      Math.round(((i + 1) / targets.length) * 100), targets.length, i + 1,
      `Reset ${i + 1}/${targets.length}: ${inst.name}`
    );
  }
  } catch (error) {
    // 루프 밖으로 새는 예외는 여기서 멈추되, 이미 reset 한 인스턴스의 위치·크기 복원은 계속한다.
    aborted = { afterInstances: results.length, reason: errMsg(error) };
  }

  if (!dryRun) {
    // Locked layers ignore x/y writes; unlock while putting geometry back.
    const locked = targets.filter((inst, i) => resetDone[i] && inst.locked);
    locked.forEach((inst) => (inst.locked = false));
    for (let i = 0; i < targets.length; i++) {
      if (!resetDone[i]) continue;
      const inst = targets[i];
      const g = geometry[i];
      try {
        let changed = false;
        // An ABSOLUTE child left in auto-layout flow shifts every sibling, so first.
        // Figma rejects ABSOLUTE under a non-auto-layout parent, where it is meaningless anyway.
        if (g.positioning && inst.layoutPositioning !== g.positioning &&
            inst.parent && inst.parent.layoutMode && inst.parent.layoutMode !== "NONE") {
          inst.layoutPositioning = g.positioning;
          changed = true;
        }
        if (
          g.constraints &&
          (inst.constraints.horizontal !== g.constraints.horizontal ||
            inst.constraints.vertical !== g.constraints.vertical)
        ) {
          inst.constraints = g.constraints;
          changed = true;
        }
        if (restoreSize(inst, g)) changed = true;
        for (const [field, varId] of Object.entries(g.bound)) {
          const cur = inst.boundVariables && inst.boundVariables[field];
          if (cur && cur.id === varId) continue;
          const variable = await figma.variables.getVariableByIdAsync(varId);
          if (!variable) throw new Error(`variable ${varId} for ${field} not found`);
          inst.setBoundVariable(field, variable);
          changed = true;
        }
        if (changed) results[i].restored++;
      } catch (error) {
        results[i].failed.push({ id: inst.id, name: inst.name, stage: "geometry", reason: errMsg(error) });
        results[i].incomplete = true;
      }
    }
    // Positions last: a later sibling's resize can shrink a hugging parent and
    // drag constrained siblings that were already put back. Auto layout can
    // reflow after a move too, so repeat until nothing drifts.
    // ponytail: 3 passes, raise if a deeper chain of hugging parents shows up
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (let i = 0; i < targets.length; i++) {
        if (!resetDone[i]) continue;
        const inst = targets[i];
        const g = geometry[i];
        try {
          if (inst.x !== g.x || inst.y !== g.y) {
            inst.x = g.x;
            inst.y = g.y;
            if (pass === 0) results[i].restored++;
            moved = true;
          }
        } catch (error) {
          if (pass === 0) {
            results[i].failed.push({ id: inst.id, name: inst.name, stage: "position", reason: errMsg(error) });
            results[i].incomplete = true;
          }
        }
      }
      if (!moved) break;
    }
    locked.forEach((inst) => (inst.locked = true));
  }

  const incomplete = results.filter((r) => r.incomplete || r.skipped).map((r) => r.id);
  const out = { dryRun, instances: results.length, results };
  if (incomplete.length) out.incomplete = incomplete;
  if (aborted) out.aborted = aborted;
  return out;
}

async function createSection(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Section",
  } = params || {};

  const section = figma.createSection();
  section.name = name;
  section.x = x;
  section.y = y;
  section.resizeWithoutConstraints(width, height);

  return {
    id: section.id,
    name: section.name,
    x: section.x,
    y: section.y,
    width: section.width,
    height: section.height,
  };
}

async function setParent(params) {
  const { nodeId, parentId, x, y, index } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!parentId) {
    throw new Error("Missing parentId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  const parentNode = await figma.getNodeByIdAsync(parentId);
  if (!parentNode) {
    throw new Error(`Parent node not found with ID: ${parentId}`);
  }

  if (!("appendChild" in parentNode)) {
    throw new Error(`Parent node does not support children: ${parentId}`);
  }

  // Refuse to create a cycle
  let ancestor = parentNode;
  while (ancestor) {
    if (ancestor.id === node.id) {
      throw new Error("Cannot move a node into its own subtree");
    }
    ancestor = ancestor.parent;
  }

  // Capture the absolute position so it can be preserved across the move
  const hasAbsolute = "absoluteTransform" in node;
  const absoluteX = hasAbsolute ? node.absoluteTransform[0][2] : undefined;
  const absoluteY = hasAbsolute ? node.absoluteTransform[1][2] : undefined;

  if (index !== undefined) {
    parentNode.insertChild(index, node);
  } else {
    parentNode.appendChild(node);
  }

  if (x !== undefined && y !== undefined) {
    node.x = x;
    node.y = y;
  } else if (hasAbsolute && "x" in node) {
    const parentAbsoluteX =
      "absoluteTransform" in parentNode ? parentNode.absoluteTransform[0][2] : 0;
    const parentAbsoluteY =
      "absoluteTransform" in parentNode ? parentNode.absoluteTransform[1][2] : 0;
    node.x = absoluteX - parentAbsoluteX;
    node.y = absoluteY - parentAbsoluteY;
  }

  return {
    id: node.id,
    name: node.name,
    parentId: parentNode.id,
    parentName: parentNode.name,
    x: "x" in node ? node.x : undefined,
    y: "y" in node ? node.y : undefined,
    index: parentNode.children.indexOf(node),
  };
}

async function moveNode(params) {
  const { nodeId, x, y } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (x === undefined || y === undefined) {
    throw new Error("Missing x or y parameters");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("x" in node) || !("y" in node)) {
    throw new Error(`Node does not support position: ${nodeId}`);
  }

  node.x = x;
  node.y = y;

  return {
    id: node.id,
    name: node.name,
    x: node.x,
    y: node.y,
  };
}

async function resizeNode(params) {
  const { nodeId, width, height } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (width === undefined || height === undefined) {
    throw new Error("Missing width or height parameters");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("resize" in node)) {
    throw new Error(`Node does not support resizing: ${nodeId}`);
  }

  node.resize(width, height);

  return {
    id: node.id,
    name: node.name,
    width: node.width,
    height: node.height,
  };
}

async function deleteNode(params) {
  const { nodeId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Save node info before deleting
  const nodeInfo = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  node.remove();

  return nodeInfo;
}

async function getStyles() {
  const styles = {
    colors: await figma.getLocalPaintStylesAsync(),
    texts: await figma.getLocalTextStylesAsync(),
    effects: await figma.getLocalEffectStylesAsync(),
    grids: await figma.getLocalGridStylesAsync(),
  };

  return {
    colors: styles.colors.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      paint: style.paints[0],
    })),
    texts: styles.texts.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      fontSize: style.fontSize,
      fontName: style.fontName,
    })),
    effects: styles.effects.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
    grids: styles.grids.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
  };
}

// E-15: 그리드 스타일이 실제로 쓰이는지 역조회한다 (C3_06).
// gridStyleId·layoutGrids 를 주는 커맨드가 없어 이 항목은 측정 자체가 불가능했다.
// style.consumers 가 피그마가 주는 유일한 역인덱스라 전수 순회 없이 끝난다.
// dynamic-page 라 loadAllPagesAsync 없이는 다른 페이지 소비자가 통째로 빠진다.
async function getGridUsage(params) {
  params = params || {};
  var sample = typeof params.sample === "number" ? params.sample : 20;

  await figma.loadAllPagesAsync();
  var styles = await figma.getLocalGridStylesAsync();

  var out = [];
  for (var s = 0; s < styles.length; s++) {
    var style = styles[s];
    // style.consumers 는 dynamic-page 에서 던진다 — 비동기 쪽만 쓸 수 있다.
    var consumers = await style.getStyleConsumersAsync();
    var byPage = {};
    var nodes = [];
    for (var i = 0; i < consumers.length; i++) {
      var node = consumers[i].node;
      var page = pageNameOf(node) || "(unknown)";
      byPage[page] = (byPage[page] || 0) + 1;
      if (nodes.length < sample) {
        nodes.push({ id: node.id, name: node.name, type: node.type, page: page });
      }
    }
    out.push({
      id: style.id,
      name: style.name,
      key: style.key,
      count: consumers.length,
      byPage: byPage,
      nodes: nodes,
    });
  }

  return { total: styles.length, styles: out };
}

async function getLocalComponents(params) {
  const commandId = (params && params.commandId) || generateCommandId();
  const pages = figma.root.children;
  const totalPages = pages.length;

  await sendProgressUpdate(
    commandId,
    "get_local_components",
    "started",
    0,
    totalPages,
    0,
    "Starting component scan across " + totalPages + " pages...",
    null
  );

  var allComponents = [];

  for (var i = 0; i < totalPages; i++) {
    var page = pages[i];
    await page.loadAsync();

    var pageComponents = page.findAllWithCriteria({
      types: ["COMPONENT", "COMPONENT_SET"],
    });

    for (var j = 0; j < pageComponents.length; j++) {
      var component = pageComponents[j];
      var parent = component.parent;
      // A variant's description lives on its parent set, so report both the
      // set and its variants and let the caller roll up by parentId.
      allComponents.push({
        id: component.id,
        name: component.name,
        type: component.type,
        key: "key" in component ? component.key : null,
        description: component.description || "",
        documentationLinks: component.documentationLinks || [],
        pageName: page.name,
        parentId: parent ? parent.id : null,
        parentName: parent ? parent.name : null,
        variantProperties:
          component.type === "COMPONENT_SET"
            ? component.variantGroupProperties || null
            : component.variantProperties || null,
      });
    }

    var progress = Math.round(((i + 1) / totalPages) * 100);
    await sendProgressUpdate(
      commandId,
      "get_local_components",
      "in_progress",
      progress,
      totalPages,
      i + 1,
      "Scanned " + page.name + ": " + pageComponents.length + " components (total so far: " + allComponents.length + ")",
      null
    );
  }

  // Publish state: importing by key only resolves for components that are
  // actually published to a team library. Opt-in because it is one network
  // round trip per component.
  if (params && params.checkPublished) {
    var tops = allComponents.filter(function (c) {
      if (!c.key) return false;
      if (c.type === "COMPONENT_SET") return true;
      return !allComponents.some(function (o) {
        return o.type === "COMPONENT_SET" && o.id === c.parentId;
      });
    });
    // One import per component is a network round trip, so run them in
    // batches instead of serially or the whole command times out.
    var BATCH = 12;
    for (var k = 0; k < tops.length; k += BATCH) {
      var batch = tops.slice(k, k + BATCH);
      await Promise.all(
        batch.map(function (c) {
          var imp =
            c.type === "COMPONENT_SET"
              ? figma.importComponentSetByKeyAsync(c.key)
              : figma.importComponentByKeyAsync(c.key);
          // An unpublished key does not reject promptly, so cap each lookup.
          var p = Promise.race([
            imp,
            new Promise(function (_, reject) {
              setTimeout(function () {
                reject(new Error("import timed out"));
              }, 4000);
            }),
          ]);
          return p.then(
            function () {
              c.published = true;
            },
            function (e) {
              c.published = false;
              c.publishError = errMsg(e);
            }
          );
        })
      );
      var doneN = Math.min(k + BATCH, tops.length);
      await sendProgressUpdate(
        commandId,
        "get_local_components",
        "in_progress",
        Math.round((doneN / tops.length) * 100),
        tops.length,
        doneN,
        "Checked publish state for " + doneN + "/" + tops.length,
        null
      );
    }
  }

  await sendProgressUpdate(
    commandId,
    "get_local_components",
    "completed",
    100,
    totalPages,
    totalPages,
    "Found " + allComponents.length + " components across " + totalPages + " pages",
    null
  );

  return {
    count: allComponents.length,
    components: allComponents,
  };
}

// async function getTeamComponents() {
//   try {
//     const teamComponents =
//       await figma.teamLibrary.getAvailableComponentsAsync();

//     return {
//       count: teamComponents.length,
//       components: teamComponents.map((component) => ({
//         key: component.key,
//         name: component.name,
//         description: component.description,
//         libraryName: component.libraryName,
//       })),
//     };
//   } catch (error) {
//     throw new Error(`Error getting team components: ${error.message}`);
//   }
// }

async function createComponentInstance(params) {
  const { componentKey, componentId, x = 0, y = 0, parentId } = params || {};

  if (!componentKey && !componentId) {
    throw new Error("Missing componentKey or componentId parameter. Use componentId for local components (from get_local_components), or componentKey for published library components.");
  }

  try {
    let component;

    if (componentId) {
      // Local component: get node directly by ID
      const node = await figma.getNodeByIdAsync(componentId);
      if (!node) {
        throw new Error(`Component node not found with id: ${componentId}`);
      }
      if (node.type !== "COMPONENT") {
        throw new Error(`Node ${componentId} is not a COMPONENT (got type: ${node.type}). Use get_local_components to find valid component IDs.`);
      }
      component = node;
    } else {
      // Published library component: import by key
      component = await figma.importComponentByKeyAsync(componentKey);
    }

    const instance = component.createInstance();
    instance.x = x;
    instance.y = y;

    if (parentId) {
      const parent = await figma.getNodeByIdAsync(parentId);
      if (parent && "appendChild" in parent) {
        parent.appendChild(instance);
      } else {
        figma.currentPage.appendChild(instance);
      }
    } else {
      figma.currentPage.appendChild(instance);
    }

    const mainComponent = await instance.getMainComponentAsync();

    return {
      id: instance.id,
      name: instance.name,
      x: instance.x,
      y: instance.y,
      width: instance.width,
      height: instance.height,
      mainComponentId: mainComponent ? mainComponent.id : undefined,
    };
  } catch (error) {
    throw new Error(`Error creating component instance: ${errMsg(error)}`);
  }
}

async function exportNodeAsImage(params) {
  const { nodeId, scale = 1 } = params || {};

  const format = "PNG";

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("exportAsync" in node)) {
    throw new Error(`Node does not support exporting: ${nodeId}`);
  }

  try {
    const settings = {
      format: format,
      constraint: { type: "SCALE", value: scale },
    };

    const bytes = await node.exportAsync(settings);

    let mimeType;
    switch (format) {
      case "PNG":
        mimeType = "image/png";
        break;
      case "JPG":
        mimeType = "image/jpeg";
        break;
      case "SVG":
        mimeType = "image/svg+xml";
        break;
      case "PDF":
        mimeType = "application/pdf";
        break;
      default:
        mimeType = "application/octet-stream";
    }

    // Proper way to convert Uint8Array to base64
    const base64 = customBase64Encode(bytes);
    // const imageData = `data:${mimeType};base64,${base64}`;

    return {
      nodeId,
      format,
      scale,
      mimeType,
      imageData: base64,
    };
  } catch (error) {
    throw new Error(`Error exporting node as image: ${errMsg(error)}`);
  }
}
function customBase64Encode(bytes) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let base64 = "";

  const byteLength = bytes.byteLength;
  const byteRemainder = byteLength % 3;
  const mainLength = byteLength - byteRemainder;

  let a, b, c, d;
  let chunk;

  // Main loop deals with bytes in chunks of 3
  for (let i = 0; i < mainLength; i = i + 3) {
    // Combine the three bytes into a single integer
    chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];

    // Use bitmasks to extract 6-bit segments from the triplet
    a = (chunk & 16515072) >> 18; // 16515072 = (2^6 - 1) << 18
    b = (chunk & 258048) >> 12; // 258048 = (2^6 - 1) << 12
    c = (chunk & 4032) >> 6; // 4032 = (2^6 - 1) << 6
    d = chunk & 63; // 63 = 2^6 - 1

    // Convert the raw binary segments to the appropriate ASCII encoding
    base64 += chars[a] + chars[b] + chars[c] + chars[d];
  }

  // Deal with the remaining bytes and padding
  if (byteRemainder === 1) {
    chunk = bytes[mainLength];

    a = (chunk & 252) >> 2; // 252 = (2^6 - 1) << 2

    // Set the 4 least significant bits to zero
    b = (chunk & 3) << 4; // 3 = 2^2 - 1

    base64 += chars[a] + chars[b] + "==";
  } else if (byteRemainder === 2) {
    chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];

    a = (chunk & 64512) >> 10; // 64512 = (2^6 - 1) << 10
    b = (chunk & 1008) >> 4; // 1008 = (2^6 - 1) << 4

    // Set the 2 least significant bits to zero
    c = (chunk & 15) << 2; // 15 = 2^4 - 1

    base64 += chars[a] + chars[b] + chars[c] + "=";
  }

  return base64;
}

async function setCornerRadius(params) {
  const { nodeId, radius, corners } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (radius === undefined) {
    throw new Error("Missing radius parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Check if node supports corner radius
  if (!("cornerRadius" in node)) {
    throw new Error(`Node does not support corner radius: ${nodeId}`);
  }

  // If corners array is provided, set individual corner radii
  if (corners && Array.isArray(corners) && corners.length === 4) {
    if ("topLeftRadius" in node) {
      // Node supports individual corner radii
      if (corners[0]) node.topLeftRadius = radius;
      if (corners[1]) node.topRightRadius = radius;
      if (corners[2]) node.bottomRightRadius = radius;
      if (corners[3]) node.bottomLeftRadius = radius;
    } else {
      // Node only supports uniform corner radius
      node.cornerRadius = radius;
    }
  } else {
    // Set uniform corner radius
    node.cornerRadius = radius;
  }

  return {
    id: node.id,
    name: node.name,
    cornerRadius: "cornerRadius" in node ? node.cornerRadius : undefined,
    topLeftRadius: "topLeftRadius" in node ? node.topLeftRadius : undefined,
    topRightRadius: "topRightRadius" in node ? node.topRightRadius : undefined,
    bottomRightRadius:
      "bottomRightRadius" in node ? node.bottomRightRadius : undefined,
    bottomLeftRadius:
      "bottomLeftRadius" in node ? node.bottomLeftRadius : undefined,
  };
}

async function setTextContent(params) {
  const { nodeId, text } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (text === undefined) {
    throw new Error("Missing text parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    // Linked / mixed-style text: node.fontName is figma.mixed (loadFontAsync throws
    // "Cannot unwrap symbol") and setCharacters would flatten the link styling.
    if (hasRichText(node)) {
      const { keptLinks, droppedLinks } = await setTextPreservingLinks(node, text);
      return {
        id: node.id,
        name: node.name,
        characters: node.characters,
        keptLinks,
        droppedLinks,
      };
    }

    await figma.loadFontAsync(node.fontName);

    await setCharacters(node, text);

    return {
      id: node.id,
      name: node.name,
      characters: node.characters,
      fontName: node.fontName,
    };
  } catch (error) {
    throw new Error(`Error setting text content: ${errMsg(error)}`);
  }
}

function hasRichText(node) {
  if (node.fontName === figma.mixed || node.fills === figma.mixed) return true;
  if (!node.characters.length) return false;
  return node.getStyledTextSegments(["hyperlink"]).some((s) => s.hyperlink);
}

// Replace characters, then re-apply the base style to the whole text and each
// hyperlink segment's style + link to the first match of its text (in order).
// A link whose text no longer appears in the new string is reported as dropped.
async function setTextPreservingLinks(node, text) {
  const len = node.characters.length;
  const segs = len
    ? node.getStyledTextSegments([
        "fontName",
        "fills",
        "fillStyleId",
        "textStyleId",
        "textDecoration",
        "hyperlink",
      ])
    : [];
  const fonts = len ? node.getRangeAllFontNames(0, len) : [];
  await Promise.all(fonts.map((f) => figma.loadFontAsync(f)));

  const base = segs.find((s) => !s.hyperlink) || segs[0];
  const links = segs.filter((s) => s.hyperlink);

  node.characters = text;
  if (base && text.length) await applyTextSegment(node, 0, text.length, base, true);

  const keptLinks = [];
  const droppedLinks = [];
  let from = 0;
  for (const s of links) {
    let i = text.indexOf(s.characters, from);
    if (i < 0) i = text.indexOf(s.characters);
    if (i < 0) {
      droppedLinks.push(s.characters);
      continue;
    }
    try {
      await applyTextSegment(node, i, i + s.characters.length, s, false);
    } catch (e) {
      // e.g. NODE link whose target was deleted: Figma refuses to re-set it
      droppedLinks.push(`${s.characters} (${errMsg(e)})`);
      continue;
    }
    keptLinks.push(s.characters);
    from = i + s.characters.length;
  }
  return { keptLinks, droppedLinks };
}

async function applyTextSegment(node, start, end, seg, clearLink) {
  if (seg.textStyleId) await node.setRangeTextStyleIdAsync(start, end, seg.textStyleId);
  const cur = node.getRangeFontName(start, end);
  if (
    cur === figma.mixed ||
    cur.family !== seg.fontName.family ||
    cur.style !== seg.fontName.style
  ) {
    node.setRangeFontName(start, end, seg.fontName);
  }
  if (seg.fillStyleId) await node.setRangeFillStyleIdAsync(start, end, seg.fillStyleId);
  else node.setRangeFills(start, end, seg.fills);
  node.setRangeTextDecoration(start, end, seg.textDecoration);
  node.setRangeHyperlink(start, end, clearLink ? null : seg.hyperlink);
}

// Initialize settings on load
(async function initializePlugin() {
  try {
    const savedSettings = await figma.clientStorage.getAsync("settings");
    if (savedSettings) {
      if (savedSettings.serverPort) {
        state.serverPort = savedSettings.serverPort;
      }
    }

    // Send initial settings to UI
    figma.ui.postMessage({
      type: "init-settings",
      settings: {
        serverPort: state.serverPort,
      },
    });
  } catch (error) {
    console.error("Error loading settings:", error);
  }
})();

function uniqBy(arr, predicate) {
  const cb = typeof predicate === "function" ? predicate : (o) => o[predicate];
  return [
    ...arr
      .reduce((map, item) => {
        const key = item === null || item === undefined ? item : cb(item);

        map.has(key) || map.set(key, item);

        return map;
      }, new Map())
      .values(),
  ];
}
const setCharacters = async (node, characters, options) => {
  const fallbackFont = (options && options.fallbackFont) || {
    family: "Inter",
    style: "Regular",
  };
  try {
    if (node.fontName === figma.mixed) {
      if (options && options.smartStrategy === "prevail") {
        const fontHashTree = {};
        for (let i = 1; i < node.characters.length; i++) {
          const charFont = node.getRangeFontName(i - 1, i);
          const key = `${charFont.family}::${charFont.style}`;
          fontHashTree[key] = fontHashTree[key] ? fontHashTree[key] + 1 : 1;
        }
        const prevailedTreeItem = Object.entries(fontHashTree).sort(
          (a, b) => b[1] - a[1]
        )[0];
        const [family, style] = prevailedTreeItem[0].split("::");
        const prevailedFont = {
          family,
          style,
        };
        await figma.loadFontAsync(prevailedFont);
        node.fontName = prevailedFont;
      } else if (options && options.smartStrategy === "strict") {
        return setCharactersWithStrictMatchFont(node, characters, fallbackFont);
      } else if (options && options.smartStrategy === "experimental") {
        return setCharactersWithSmartMatchFont(node, characters, fallbackFont);
      } else {
        const firstCharFont = node.getRangeFontName(0, 1);
        await figma.loadFontAsync(firstCharFont);
        node.fontName = firstCharFont;
      }
    } else {
      await figma.loadFontAsync({
        family: node.fontName.family,
        style: node.fontName.style,
      });
    }
  } catch (err) {
    console.warn(
      `Failed to load "${node.fontName["family"]} ${node.fontName["style"]}" font and replaced with fallback "${fallbackFont.family} ${fallbackFont.style}"`,
      err
    );
    await figma.loadFontAsync(fallbackFont);
    node.fontName = fallbackFont;
  }
  try {
    node.characters = characters;
    return true;
  } catch (err) {
    console.warn(`Failed to set characters. Skipped.`, err);
    return false;
  }
};

const setCharactersWithStrictMatchFont = async (
  node,
  characters,
  fallbackFont
) => {
  const fontHashTree = {};
  for (let i = 1; i < node.characters.length; i++) {
    const startIdx = i - 1;
    const startCharFont = node.getRangeFontName(startIdx, i);
    const startCharFontVal = `${startCharFont.family}::${startCharFont.style}`;
    while (i < node.characters.length) {
      i++;
      const charFont = node.getRangeFontName(i - 1, i);
      if (startCharFontVal !== `${charFont.family}::${charFont.style}`) {
        break;
      }
    }
    fontHashTree[`${startIdx}_${i}`] = startCharFontVal;
  }
  await figma.loadFontAsync(fallbackFont);
  node.fontName = fallbackFont;
  node.characters = characters;
  console.log(fontHashTree);
  await Promise.all(
    Object.keys(fontHashTree).map(async (range) => {
      console.log(range, fontHashTree[range]);
      const [start, end] = range.split("_");
      const [family, style] = fontHashTree[range].split("::");
      const matchedFont = {
        family,
        style,
      };
      await figma.loadFontAsync(matchedFont);
      return node.setRangeFontName(Number(start), Number(end), matchedFont);
    })
  );
  return true;
};

const getDelimiterPos = (str, delimiter, startIdx = 0, endIdx = str.length) => {
  const indices = [];
  let temp = startIdx;
  for (let i = startIdx; i < endIdx; i++) {
    if (
      str[i] === delimiter &&
      i + startIdx !== endIdx &&
      temp !== i + startIdx
    ) {
      indices.push([temp, i + startIdx]);
      temp = i + startIdx + 1;
    }
  }
  temp !== endIdx && indices.push([temp, endIdx]);
  return indices.filter(Boolean);
};

const buildLinearOrder = (node) => {
  const fontTree = [];
  const newLinesPos = getDelimiterPos(node.characters, "\n");
  newLinesPos.forEach(([newLinesRangeStart, newLinesRangeEnd], n) => {
    const newLinesRangeFont = node.getRangeFontName(
      newLinesRangeStart,
      newLinesRangeEnd
    );
    if (newLinesRangeFont === figma.mixed) {
      const spacesPos = getDelimiterPos(
        node.characters,
        " ",
        newLinesRangeStart,
        newLinesRangeEnd
      );
      spacesPos.forEach(([spacesRangeStart, spacesRangeEnd], s) => {
        const spacesRangeFont = node.getRangeFontName(
          spacesRangeStart,
          spacesRangeEnd
        );
        if (spacesRangeFont === figma.mixed) {
          const spacesRangeFont = node.getRangeFontName(
            spacesRangeStart,
            spacesRangeStart[0]
          );
          fontTree.push({
            start: spacesRangeStart,
            delimiter: " ",
            family: spacesRangeFont.family,
            style: spacesRangeFont.style,
          });
        } else {
          fontTree.push({
            start: spacesRangeStart,
            delimiter: " ",
            family: spacesRangeFont.family,
            style: spacesRangeFont.style,
          });
        }
      });
    } else {
      fontTree.push({
        start: newLinesRangeStart,
        delimiter: "\n",
        family: newLinesRangeFont.family,
        style: newLinesRangeFont.style,
      });
    }
  });
  return fontTree
    .sort((a, b) => +a.start - +b.start)
    .map(({ family, style, delimiter }) => ({ family, style, delimiter }));
};

const setCharactersWithSmartMatchFont = async (
  node,
  characters,
  fallbackFont
) => {
  const rangeTree = buildLinearOrder(node);
  const fontsToLoad = uniqBy(
    rangeTree,
    ({ family, style }) => `${family}::${style}`
  ).map(({ family, style }) => ({
    family,
    style,
  }));

  await Promise.all([...fontsToLoad, fallbackFont].map(figma.loadFontAsync));

  node.fontName = fallbackFont;
  node.characters = characters;

  let prevPos = 0;
  rangeTree.forEach(({ family, style, delimiter }) => {
    if (prevPos < node.characters.length) {
      const delimeterPos = node.characters.indexOf(delimiter, prevPos);
      const endPos =
        delimeterPos > prevPos ? delimeterPos : node.characters.length;
      const matchedFont = {
        family,
        style,
      };
      node.setRangeFontName(prevPos, endPos, matchedFont);
      prevPos = endPos + 1;
    }
  });
  return true;
};

// Add the cloneNode function implementation
async function cloneNode(params) {
  const { nodeId, x, y } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Clone the node
  const clone = node.clone();

  // If x and y are provided, move the clone to that position
  if (x !== undefined && y !== undefined) {
    if (!("x" in clone) || !("y" in clone)) {
      throw new Error(`Cloned node does not support position: ${nodeId}`);
    }
    clone.x = x;
    clone.y = y;
  }

  // Add the clone to the same parent as the original node
  if (node.parent) {
    node.parent.appendChild(clone);
  } else {
    figma.currentPage.appendChild(clone);
  }

  return {
    id: clone.id,
    name: clone.name,
    x: "x" in clone ? clone.x : undefined,
    y: "y" in clone ? clone.y : undefined,
    width: "width" in clone ? clone.width : undefined,
    height: "height" in clone ? clone.height : undefined,
  };
}

async function scanTextNodes(params) {
  console.log(`Starting to scan text nodes from node ID: ${params.nodeId}`);
  const {
    nodeId,
    useChunking = true,
    chunkSize = 10,
    commandId = generateCommandId(),
  } = params || {};

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    console.error(`Node with ID ${nodeId} not found`);
    // Send error progress update
    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "error",
      0,
      0,
      0,
      `Node with ID ${nodeId} not found`,
      { error: `Node not found: ${nodeId}` }
    );
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // If chunking is not enabled, use the original implementation
  if (!useChunking) {
    const textNodes = [];
    try {
      // Send started progress update
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "started",
        0,
        1, // Not known yet how many nodes there are
        0,
        `Starting scan of node "${node.name || nodeId}" without chunking`,
        null
      );

      await findTextNodes(node, [], 0, textNodes);

      // Send completed progress update
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "completed",
        100,
        textNodes.length,
        textNodes.length,
        `Scan complete. Found ${textNodes.length} text nodes.`,
        { textNodes }
      );

      return {
        success: true,
        message: `Scanned ${textNodes.length} text nodes.`,
        count: textNodes.length,
        textNodes: textNodes,
        commandId,
      };
    } catch (error) {
      console.error("Error scanning text nodes:", error);

      // Send error progress update
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "error",
        0,
        0,
        0,
        `Error scanning text nodes: ${errMsg(error)}`,
        { error: errMsg(error) }
      );

      throw new Error(`Error scanning text nodes: ${errMsg(error)}`);
    }
  }

  // Chunked implementation
  console.log(`Using chunked scanning with chunk size: ${chunkSize}`);

  // First, collect all nodes to process (without processing them yet)
  const nodesToProcess = [];

  // Send started progress update
  sendProgressUpdate(
    commandId,
    "scan_text_nodes",
    "started",
    0,
    0, // Not known yet how many nodes there are
    0,
    `Starting chunked scan of node "${node.name || nodeId}"`,
    { chunkSize }
  );

  await collectNodesToProcess(node, [], 0, nodesToProcess);

  const totalNodes = nodesToProcess.length;
  console.log(`Found ${totalNodes} total nodes to process`);

  // Calculate number of chunks needed
  const totalChunks = Math.ceil(totalNodes / chunkSize);
  console.log(`Will process in ${totalChunks} chunks`);

  // Send update after node collection
  sendProgressUpdate(
    commandId,
    "scan_text_nodes",
    "in_progress",
    5, // 5% progress for collection phase
    totalNodes,
    0,
    `Found ${totalNodes} nodes to scan. Will process in ${totalChunks} chunks.`,
    {
      totalNodes,
      totalChunks,
      chunkSize,
    }
  );

  // Process nodes in chunks
  const allTextNodes = [];
  let processedNodes = 0;
  let chunksProcessed = 0;

  for (let i = 0; i < totalNodes; i += chunkSize) {
    const chunkEnd = Math.min(i + chunkSize, totalNodes);
    console.log(
      `Processing chunk ${chunksProcessed + 1}/${totalChunks} (nodes ${i} to ${chunkEnd - 1
      })`
    );

    // Send update before processing chunk
    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "in_progress",
      Math.round(5 + (chunksProcessed / totalChunks) * 90), // 5-95% for processing
      totalNodes,
      processedNodes,
      `Processing chunk ${chunksProcessed + 1}/${totalChunks}`,
      {
        currentChunk: chunksProcessed + 1,
        totalChunks,
        textNodesFound: allTextNodes.length,
      }
    );

    const chunkNodes = nodesToProcess.slice(i, chunkEnd);
    const chunkTextNodes = [];

    // Process each node in this chunk
    for (const nodeInfo of chunkNodes) {
      if (nodeInfo.node.type === "TEXT") {
        try {
          const textNodeInfo = await processTextNode(
            nodeInfo.node,
            nodeInfo.parentPath,
            nodeInfo.depth
          );
          if (textNodeInfo) {
            chunkTextNodes.push(textNodeInfo);
          }
        } catch (error) {
          console.error(`Error processing text node: ${errMsg(error)}`);
          // Continue with other nodes
        }
      }

      // Brief delay to allow UI updates and prevent freezing
      await delay(5);
    }

    // Add results from this chunk
    allTextNodes.push(...chunkTextNodes);
    processedNodes += chunkNodes.length;
    chunksProcessed++;

    // Send update after processing chunk
    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "in_progress",
      Math.round(5 + (chunksProcessed / totalChunks) * 90), // 5-95% for processing
      totalNodes,
      processedNodes,
      `Processed chunk ${chunksProcessed}/${totalChunks}. Found ${allTextNodes.length} text nodes so far.`,
      {
        currentChunk: chunksProcessed,
        totalChunks,
        processedNodes,
        textNodesFound: allTextNodes.length,
        chunkResult: chunkTextNodes,
      }
    );

    // Small delay between chunks to prevent UI freezing
    if (i + chunkSize < totalNodes) {
      await delay(50);
    }
  }

  // Send completed progress update
  sendProgressUpdate(
    commandId,
    "scan_text_nodes",
    "completed",
    100,
    totalNodes,
    processedNodes,
    `Scan complete. Found ${allTextNodes.length} text nodes.`,
    {
      textNodes: allTextNodes,
      processedNodes,
      chunks: chunksProcessed,
    }
  );

  return {
    success: true,
    message: `Chunked scan complete. Found ${allTextNodes.length} text nodes.`,
    totalNodes: allTextNodes.length,
    processedNodes: processedNodes,
    chunks: chunksProcessed,
    textNodes: allTextNodes,
    commandId,
  };
}

// Helper function to collect all nodes that need to be processed
async function collectNodesToProcess(
  node,
  parentPath = [],
  depth = 0,
  nodesToProcess = []
) {
  // Skip invisible nodes
  if (node.visible === false) return;

  // Get the path to this node
  const nodePath = [...parentPath, node.name || `Unnamed ${node.type}`];

  // Add this node to the processing list
  nodesToProcess.push({
    node: node,
    parentPath: nodePath,
    depth: depth,
  });

  // Recursively add children
  if ("children" in node) {
    for (const child of node.children) {
      await collectNodesToProcess(child, nodePath, depth + 1, nodesToProcess);
    }
  }
}

// Process a single text node
async function processTextNode(node, parentPath, depth) {
  if (node.type !== "TEXT") return null;

  try {
    // Safely extract font information
    let fontFamily = "";
    let fontStyle = "";

    if (node.fontName) {
      if (typeof node.fontName === "object") {
        if ("family" in node.fontName) fontFamily = node.fontName.family;
        if ("style" in node.fontName) fontStyle = node.fontName.style;
      }
    }

    // Create a safe representation of the text node
    const safeTextNode = {
      id: node.id,
      name: node.name || "Text",
      type: node.type,
      characters: node.characters,
      fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
      fontFamily: fontFamily,
      fontStyle: fontStyle,
      x: typeof node.x === "number" ? node.x : 0,
      y: typeof node.y === "number" ? node.y : 0,
      width: typeof node.width === "number" ? node.width : 0,
      height: typeof node.height === "number" ? node.height : 0,
      path: parentPath.join(" > "),
      depth: depth,
    };

    // Highlight the node briefly (optional visual feedback)
    try {
      const originalFills = JSON.parse(JSON.stringify(node.fills));
      node.fills = [
        {
          type: "SOLID",
          color: { r: 1, g: 0.5, b: 0 },
          opacity: 0.3,
        },
      ];

      // Brief delay for the highlight to be visible
      await delay(100);

      try {
        node.fills = originalFills;
      } catch (err) {
        console.error("Error resetting fills:", err);
      }
    } catch (highlightErr) {
      console.error("Error highlighting text node:", highlightErr);
      // Continue anyway, highlighting is just visual feedback
    }

    return safeTextNode;
  } catch (nodeErr) {
    console.error("Error processing text node:", nodeErr);
    return null;
  }
}

// A delay function that returns a promise
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Keep the original findTextNodes for backward compatibility
async function findTextNodes(node, parentPath = [], depth = 0, textNodes = []) {
  // Skip invisible nodes
  if (node.visible === false) return;

  // Get the path to this node including its name
  const nodePath = [...parentPath, node.name || `Unnamed ${node.type}`];

  if (node.type === "TEXT") {
    try {
      // Safely extract font information to avoid Symbol serialization issues
      let fontFamily = "";
      let fontStyle = "";

      if (node.fontName) {
        if (typeof node.fontName === "object") {
          if ("family" in node.fontName) fontFamily = node.fontName.family;
          if ("style" in node.fontName) fontStyle = node.fontName.style;
        }
      }

      // Create a safe representation of the text node with only serializable properties
      const safeTextNode = {
        id: node.id,
        name: node.name || "Text",
        type: node.type,
        characters: node.characters,
        fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
        fontFamily: fontFamily,
        fontStyle: fontStyle,
        x: typeof node.x === "number" ? node.x : 0,
        y: typeof node.y === "number" ? node.y : 0,
        width: typeof node.width === "number" ? node.width : 0,
        height: typeof node.height === "number" ? node.height : 0,
        path: nodePath.join(" > "),
        depth: depth,
      };

      // Only highlight the node if it's not being done via API
      try {
        // Safe way to create a temporary highlight without causing serialization issues
        const originalFills = JSON.parse(JSON.stringify(node.fills));
        node.fills = [
          {
            type: "SOLID",
            color: { r: 1, g: 0.5, b: 0 },
            opacity: 0.3,
          },
        ];

        // Promise-based delay instead of setTimeout
        await delay(500);

        try {
          node.fills = originalFills;
        } catch (err) {
          console.error("Error resetting fills:", err);
        }
      } catch (highlightErr) {
        console.error("Error highlighting text node:", highlightErr);
        // Continue anyway, highlighting is just visual feedback
      }

      textNodes.push(safeTextNode);
    } catch (nodeErr) {
      console.error("Error processing text node:", nodeErr);
      // Skip this node but continue with others
    }
  }

  // Recursively process children of container nodes
  if ("children" in node) {
    for (const child of node.children) {
      await findTextNodes(child, nodePath, depth + 1, textNodes);
    }
  }
}

// Replace text in a specific node
async function setMultipleTextContents(params) {
  const { nodeId, text } = params || {};
  const commandId = params.commandId || generateCommandId();

  if (!nodeId || !text || !Array.isArray(text)) {
    const errorMsg = "Missing required parameters: nodeId and text array";

    // Send error progress update
    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "error",
      0,
      0,
      0,
      errorMsg,
      { error: errorMsg }
    );

    throw new Error(errorMsg);
  }

  console.log(
    `Starting text replacement for node: ${nodeId} with ${text.length} text replacements`
  );

  // Send started progress update
  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "started",
    0,
    text.length,
    0,
    `Starting text replacement for ${text.length} nodes`,
    { totalReplacements: text.length }
  );

  // Define the results array and counters
  const results = [];
  let successCount = 0;
  let failureCount = 0;

  // Split text replacements into chunks of 5
  const CHUNK_SIZE = 5;
  const chunks = [];

  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  console.log(`Split ${text.length} replacements into ${chunks.length} chunks`);

  // Send chunking info update
  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "in_progress",
    5, // 5% progress for planning phase
    text.length,
    0,
    `Preparing to replace text in ${text.length} nodes using ${chunks.length} chunks`,
    {
      totalReplacements: text.length,
      chunks: chunks.length,
      chunkSize: CHUNK_SIZE,
    }
  );

  // Process each chunk sequentially
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    console.log(
      `Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length
      } replacements`
    );

    // Send chunk processing start update
    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "in_progress",
      Math.round(5 + (chunkIndex / chunks.length) * 90), // 5-95% for processing
      text.length,
      successCount + failureCount,
      `Processing text replacements chunk ${chunkIndex + 1}/${chunks.length}`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
      }
    );

    // Process replacements within a chunk in parallel
    const chunkPromises = chunk.map(async (replacement) => {
      if (!replacement.nodeId || replacement.text === undefined) {
        console.error(`Missing nodeId or text for replacement`);
        return {
          success: false,
          nodeId: replacement.nodeId || "unknown",
          error: "Missing nodeId or text in replacement entry",
        };
      }

      try {
        console.log(
          `Attempting to replace text in node: ${replacement.nodeId}`
        );

        // Get the text node to update (just to check it exists and get original text)
        const textNode = await figma.getNodeByIdAsync(replacement.nodeId);

        if (!textNode) {
          console.error(`Text node not found: ${replacement.nodeId}`);
          return {
            success: false,
            nodeId: replacement.nodeId,
            error: `Node not found: ${replacement.nodeId}`,
          };
        }

        if (textNode.type !== "TEXT") {
          console.error(
            `Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`
          );
          return {
            success: false,
            nodeId: replacement.nodeId,
            error: `Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`,
          };
        }

        // Save original text for the result
        const originalText = textNode.characters;
        console.log(`Original text: "${originalText}"`);
        console.log(`Will translate to: "${replacement.text}"`);

        // Highlight the node before changing text
        let originalFills;
        // Rich text (links / mixed styles): skip the highlight — overwriting and
        // restoring whole-node fills would wipe the per-range link colors.
        if (!hasRichText(textNode)) try {
          // Save original fills for restoration later
          originalFills = JSON.parse(JSON.stringify(textNode.fills));
          // Apply highlight color (orange with 30% opacity)
          textNode.fills = [
            {
              type: "SOLID",
              color: { r: 1, g: 0.5, b: 0 },
              opacity: 0.3,
            },
          ];
        } catch (highlightErr) {
          console.error(
            `Error highlighting text node: ${highlightErr.message}`
          );
          // Continue anyway, highlighting is just visual feedback
        }

        // Use the existing setTextContent function to handle font loading and text setting
        const setResult = await setTextContent({
          nodeId: replacement.nodeId,
          text: replacement.text,
        });

        // Keep highlight for a moment after text change, then restore original fills
        if (originalFills) {
          try {
            // Use delay function for consistent timing
            await delay(500);
            textNode.fills = originalFills;
          } catch (restoreErr) {
            console.error(`Error restoring fills: ${restoreErr.message}`);
          }
        }

        console.log(
          `Successfully replaced text in node: ${replacement.nodeId}`
        );
        return {
          success: true,
          nodeId: replacement.nodeId,
          originalText: originalText,
          translatedText: replacement.text,
          keptLinks: setResult.keptLinks,
          droppedLinks: setResult.droppedLinks,
        };
      } catch (error) {
        console.error(
          `Error replacing text in node ${replacement.nodeId}: ${errMsg(error)}`
        );
        return {
          success: false,
          nodeId: replacement.nodeId,
          error: `Error applying replacement: ${errMsg(error)}`,
        };
      }
    });

    // Wait for all replacements in this chunk to complete
    const chunkResults = await Promise.all(chunkPromises);

    // Process results for this chunk
    chunkResults.forEach((result) => {
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
      results.push(result);
    });

    // Send chunk processing complete update with partial results
    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "in_progress",
      Math.round(5 + ((chunkIndex + 1) / chunks.length) * 90), // 5-95% for processing
      text.length,
      successCount + failureCount,
      `Completed chunk ${chunkIndex + 1}/${chunks.length
      }. ${successCount} successful, ${failureCount} failed so far.`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
        chunkResults: chunkResults,
      }
    );

    // Add a small delay between chunks to avoid overloading Figma
    if (chunkIndex < chunks.length - 1) {
      console.log("Pausing between chunks to avoid overloading Figma...");
      await delay(1000); // 1 second delay between chunks
    }
  }

  console.log(
    `Replacement complete: ${successCount} successful, ${failureCount} failed`
  );

  // Send completed progress update
  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "completed",
    100,
    text.length,
    successCount + failureCount,
    `Text replacement complete: ${successCount} successful, ${failureCount} failed`,
    {
      totalReplacements: text.length,
      replacementsApplied: successCount,
      replacementsFailed: failureCount,
      completedInChunks: chunks.length,
      results: results,
    }
  );

  return {
    success: successCount > 0,
    nodeId: nodeId,
    replacementsApplied: successCount,
    replacementsFailed: failureCount,
    totalReplacements: text.length,
    results: results,
    completedInChunks: chunks.length,
    commandId,
  };
}

// Function to generate simple UUIDs for command IDs
function generateCommandId() {
  return (
    "cmd_" +
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

async function getAnnotations(params) {
  try {
    const { nodeId, includeCategories = true } = params;

    // Get categories first if needed
    let categoriesMap = {};
    if (includeCategories) {
      const categories = await figma.annotations.getAnnotationCategoriesAsync();
      categoriesMap = categories.reduce((map, category) => {
        map[category.id] = {
          id: category.id,
          label: category.label,
          color: category.color,
          isPreset: category.isPreset,
        };
        return map;
      }, {});
    }

    if (nodeId) {
      // Get annotations for a specific node
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found: ${nodeId}`);
      }

      if (!("annotations" in node)) {
        throw new Error(`Node type ${node.type} does not support annotations`);
      }

      // Collect annotations from this node and all its descendants
      const mergedAnnotations = [];
      const collect = async (n) => {
        if ("annotations" in n && n.annotations && n.annotations.length > 0) {
          for (const a of n.annotations) {
            mergedAnnotations.push({ nodeId: n.id, annotation: a });
          }
        }
        if ("children" in n) {
          for (const child of n.children) {
            await collect(child);
          }
        }
      };
      await collect(node);

      const result = {
        nodeId: node.id,
        name: node.name,
        annotations: mergedAnnotations,
      };

      if (includeCategories) {
        result.categories = Object.values(categoriesMap);
      }

      return result;
    } else {
      // Get all annotations in the current page
      const annotations = [];
      const processNode = async (node) => {
        if (
          "annotations" in node &&
          node.annotations &&
          node.annotations.length > 0
        ) {
          annotations.push({
            nodeId: node.id,
            name: node.name,
            annotations: node.annotations,
          });
        }
        if ("children" in node) {
          for (const child of node.children) {
            await processNode(child);
          }
        }
      };

      // Start from current page
      await processNode(figma.currentPage);

      const result = {
        annotatedNodes: annotations,
      };

      if (includeCategories) {
        result.categories = Object.values(categoriesMap);
      }

      return result;
    }
  } catch (error) {
    console.error("Error in getAnnotations:", error);
    throw error;
  }
}

async function setAnnotation(params) {
  try {
    console.log("=== setAnnotation Debug Start ===");
    console.log("Input params:", JSON.stringify(params, null, 2));

    const { nodeId, annotationId, labelMarkdown, categoryId, properties } =
      params;

    // Validate required parameters
    if (!nodeId) {
      console.error("Validation failed: Missing nodeId");
      return { success: false, error: "Missing nodeId" };
    }

    if (!labelMarkdown) {
      console.error("Validation failed: Missing labelMarkdown");
      return { success: false, error: "Missing labelMarkdown" };
    }

    console.log("Attempting to get node:", nodeId);
    // Get and validate node
    const node = await figma.getNodeByIdAsync(nodeId);
    console.log("Node lookup result:", {
      id: nodeId,
      found: !!node,
      type: node ? node.type : undefined,
      name: node ? node.name : undefined,
      hasAnnotations: node ? "annotations" in node : false,
    });

    if (!node) {
      console.error("Node lookup failed:", nodeId);
      return { success: false, error: `Node not found: ${nodeId}` };
    }

    // Validate node supports annotations
    if (!("annotations" in node)) {
      console.error("Node annotation support check failed:", {
        nodeType: node.type,
        nodeId: node.id,
      });
      return {
        success: false,
        error: `Node type ${node.type} does not support annotations`,
      };
    }

    // Create the annotation object
    const newAnnotation = {
      labelMarkdown,
    };

    // Validate and add categoryId if provided
    if (categoryId) {
      console.log("Adding categoryId to annotation:", categoryId);
      newAnnotation.categoryId = categoryId;
    }

    // Validate and add properties if provided
    if (properties && Array.isArray(properties) && properties.length > 0) {
      console.log(
        "Adding properties to annotation:",
        JSON.stringify(properties, null, 2)
      );
      newAnnotation.properties = properties;
    }

    // Log current annotations before update
    console.log("Current node annotations:", node.annotations);

    // Overwrite annotations
    console.log(
      "Setting new annotation:",
      JSON.stringify(newAnnotation, null, 2)
    );
    node.annotations = [newAnnotation];

    // Verify the update
    console.log("Updated node annotations:", node.annotations);
    console.log("=== setAnnotation Debug End ===");

    return {
      success: true,
      nodeId: node.id,
      name: node.name,
      annotations: node.annotations,
    };
  } catch (error) {
    console.error("=== setAnnotation Error ===");
    console.error("Error details:", {
      message: errMsg(error),
      stack: error.stack,
      params: JSON.stringify(params, null, 2),
    });
    return { success: false, error: errMsg(error) };
  }
}

/**
 * Scan for nodes with specific types within a node
 * @param {Object} params - Parameters object
 * @param {string} params.nodeId - ID of the node to scan within
 * @param {Array<string>} params.types - Array of node types to find (e.g. ['COMPONENT', 'FRAME'])
 * @returns {Object} - Object containing found nodes
 */
async function scanNodesByTypes(params) {
  console.log(`Starting to scan nodes by types from node ID: ${params.nodeId}`);
  const { nodeId, types = [] } = params || {};

  if (!types || types.length === 0) {
    throw new Error("No types specified to search for");
  }

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Simple implementation without chunking
  const matchingNodes = [];

  // Send a single progress update to notify start
  const commandId = generateCommandId();
  sendProgressUpdate(
    commandId,
    "scan_nodes_by_types",
    "started",
    0,
    1,
    0,
    `Starting scan of node "${node.name || nodeId}" for types: ${types.join(
      ", "
    )}`,
    null
  );

  // Recursively find nodes with specified types
  await findNodesByTypes(node, types, matchingNodes);

  // Send completion update
  sendProgressUpdate(
    commandId,
    "scan_nodes_by_types",
    "completed",
    100,
    matchingNodes.length,
    matchingNodes.length,
    `Scan complete. Found ${matchingNodes.length} matching nodes.`,
    { matchingNodes }
  );

  return {
    success: true,
    message: `Found ${matchingNodes.length} matching nodes.`,
    count: matchingNodes.length,
    matchingNodes: matchingNodes,
    searchedTypes: types,
  };
}

/**
 * Helper function to recursively find nodes with specific types
 * @param {SceneNode} node - The root node to start searching from
 * @param {Array<string>} types - Array of node types to find
 * @param {Array} matchingNodes - Array to store found nodes
 */
async function findNodesByTypes(node, types, matchingNodes = []) {
  // Skip invisible nodes
  if (node.visible === false) return;

  // Check if this node is one of the specified types
  if (types.includes(node.type)) {
    // Create a minimal representation with just ID, type and bbox
    matchingNodes.push({
      id: node.id,
      name: node.name || `Unnamed ${node.type}`,
      type: node.type,
      // Basic bounding box info
      bbox: {
        x: typeof node.x === "number" ? node.x : 0,
        y: typeof node.y === "number" ? node.y : 0,
        width: typeof node.width === "number" ? node.width : 0,
        height: typeof node.height === "number" ? node.height : 0,
      },
    });
  }

  // Recursively process children of container nodes
  if ("children" in node) {
    for (const child of node.children) {
      await findNodesByTypes(child, types, matchingNodes);
    }
  }
}

// Set multiple annotations with async progress updates
async function setMultipleAnnotations(params) {
  console.log("=== setMultipleAnnotations Debug Start ===");
  console.log("Input params:", JSON.stringify(params, null, 2));

  const { nodeId, annotations } = params;

  if (!annotations || annotations.length === 0) {
    console.error("Validation failed: No annotations provided");
    return { success: false, error: "No annotations provided" };
  }

  console.log(
    `Processing ${annotations.length} annotations for node ${nodeId}`
  );

  const results = [];
  let successCount = 0;
  let failureCount = 0;

  // Process annotations sequentially
  for (let i = 0; i < annotations.length; i++) {
    const annotation = annotations[i];
    console.log(
      `\nProcessing annotation ${i + 1}/${annotations.length}:`,
      JSON.stringify(annotation, null, 2)
    );

    try {
      console.log("Calling setAnnotation with params:", {
        nodeId: annotation.nodeId,
        labelMarkdown: annotation.labelMarkdown,
        categoryId: annotation.categoryId,
        properties: annotation.properties,
      });

      const result = await setAnnotation({
        nodeId: annotation.nodeId,
        labelMarkdown: annotation.labelMarkdown,
        categoryId: annotation.categoryId,
        properties: annotation.properties,
      });

      console.log("setAnnotation result:", JSON.stringify(result, null, 2));

      if (result.success) {
        successCount++;
        results.push({ success: true, nodeId: annotation.nodeId });
        console.log(`✓ Annotation ${i + 1} applied successfully`);
      } else {
        failureCount++;
        results.push({
          success: false,
          nodeId: annotation.nodeId,
          error: result.error,
        });
        console.error(`✗ Annotation ${i + 1} failed:`, result.error);
      }
    } catch (error) {
      failureCount++;
      const errorResult = {
        success: false,
        nodeId: annotation.nodeId,
        error: errMsg(error),
      };
      results.push(errorResult);
      console.error(`✗ Annotation ${i + 1} failed with error:`, error);
      console.error("Error details:", {
        message: errMsg(error),
        stack: error.stack,
      });
    }
  }

  const summary = {
    success: successCount > 0,
    annotationsApplied: successCount,
    annotationsFailed: failureCount,
    totalAnnotations: annotations.length,
    results: results,
  };

  console.log("\n=== setMultipleAnnotations Summary ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("=== setMultipleAnnotations Debug End ===");

  return summary;
}

async function deleteMultipleNodes(params) {
  const { nodeIds } = params || {};
  const commandId = generateCommandId();

  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
    const errorMsg = "Missing or invalid nodeIds parameter";
    sendProgressUpdate(
      commandId,
      "delete_multiple_nodes",
      "error",
      0,
      0,
      0,
      errorMsg,
      { error: errorMsg }
    );
    throw new Error(errorMsg);
  }

  console.log(`Starting deletion of ${nodeIds.length} nodes`);

  // Send started progress update
  sendProgressUpdate(
    commandId,
    "delete_multiple_nodes",
    "started",
    0,
    nodeIds.length,
    0,
    `Starting deletion of ${nodeIds.length} nodes`,
    { totalNodes: nodeIds.length }
  );

  const results = [];
  let successCount = 0;
  let failureCount = 0;

  // Process nodes in chunks of 5 to avoid overwhelming Figma
  const CHUNK_SIZE = 5;
  const chunks = [];

  for (let i = 0; i < nodeIds.length; i += CHUNK_SIZE) {
    chunks.push(nodeIds.slice(i, i + CHUNK_SIZE));
  }

  console.log(`Split ${nodeIds.length} deletions into ${chunks.length} chunks`);

  // Send chunking info update
  sendProgressUpdate(
    commandId,
    "delete_multiple_nodes",
    "in_progress",
    5,
    nodeIds.length,
    0,
    `Preparing to delete ${nodeIds.length} nodes using ${chunks.length} chunks`,
    {
      totalNodes: nodeIds.length,
      chunks: chunks.length,
      chunkSize: CHUNK_SIZE,
    }
  );

  // Process each chunk sequentially
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    console.log(
      `Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length
      } nodes`
    );

    // Send chunk processing start update
    sendProgressUpdate(
      commandId,
      "delete_multiple_nodes",
      "in_progress",
      Math.round(5 + (chunkIndex / chunks.length) * 90),
      nodeIds.length,
      successCount + failureCount,
      `Processing deletion chunk ${chunkIndex + 1}/${chunks.length}`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
      }
    );

    // Process deletions within a chunk in parallel
    const chunkPromises = chunk.map(async (nodeId) => {
      try {
        const node = await figma.getNodeByIdAsync(nodeId);

        if (!node) {
          console.error(`Node not found: ${nodeId}`);
          return {
            success: false,
            nodeId: nodeId,
            error: `Node not found: ${nodeId}`,
          };
        }

        // Save node info before deleting
        const nodeInfo = {
          id: node.id,
          name: node.name,
          type: node.type,
        };

        // Delete the node
        node.remove();

        console.log(`Successfully deleted node: ${nodeId}`);
        return {
          success: true,
          nodeId: nodeId,
          nodeInfo: nodeInfo,
        };
      } catch (error) {
        console.error(`Error deleting node ${nodeId}: ${errMsg(error)}`);
        return {
          success: false,
          nodeId: nodeId,
          error: errMsg(error),
        };
      }
    });

    // Wait for all deletions in this chunk to complete
    const chunkResults = await Promise.all(chunkPromises);

    // Process results for this chunk
    chunkResults.forEach((result) => {
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
      results.push(result);
    });

    // Send chunk processing complete update
    sendProgressUpdate(
      commandId,
      "delete_multiple_nodes",
      "in_progress",
      Math.round(5 + ((chunkIndex + 1) / chunks.length) * 90),
      nodeIds.length,
      successCount + failureCount,
      `Completed chunk ${chunkIndex + 1}/${chunks.length
      }. ${successCount} successful, ${failureCount} failed so far.`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
        chunkResults: chunkResults,
      }
    );

    // Add a small delay between chunks
    if (chunkIndex < chunks.length - 1) {
      console.log("Pausing between chunks...");
      await delay(1000);
    }
  }

  console.log(
    `Deletion complete: ${successCount} successful, ${failureCount} failed`
  );

  // Send completed progress update
  sendProgressUpdate(
    commandId,
    "delete_multiple_nodes",
    "completed",
    100,
    nodeIds.length,
    successCount + failureCount,
    `Node deletion complete: ${successCount} successful, ${failureCount} failed`,
    {
      totalNodes: nodeIds.length,
      nodesDeleted: successCount,
      nodesFailed: failureCount,
      completedInChunks: chunks.length,
      results: results,
    }
  );

  return {
    success: successCount > 0,
    nodesDeleted: successCount,
    nodesFailed: failureCount,
    totalNodes: nodeIds.length,
    results: results,
    completedInChunks: chunks.length,
    commandId,
  };
}

// Implementation for getInstanceOverrides function
async function getInstanceOverrides(instanceNode = null) {
  console.log("=== getInstanceOverrides called ===");

  let sourceInstance = null;

  // Check if an instance node was passed directly
  if (instanceNode) {
    console.log("Using provided instance node");

    // Validate that the provided node is an instance
    if (instanceNode.type !== "INSTANCE") {
      console.error("Provided node is not an instance");
      figma.notify("Provided node is not a component instance");
      return { success: false, message: "Provided node is not a component instance" };
    }

    sourceInstance = instanceNode;
  } else {
    // No node provided, use selection
    console.log("No node provided, using current selection");

    // Get the current selection
    const selection = figma.currentPage.selection;

    // Check if there's anything selected
    if (selection.length === 0) {
      console.log("No nodes selected");
      figma.notify("Please select at least one instance");
      return { success: false, message: "No nodes selected" };
    }

    // Filter for instances in the selection
    const instances = selection.filter(node => node.type === "INSTANCE");

    if (instances.length === 0) {
      console.log("No instances found in selection");
      figma.notify("Please select at least one component instance");
      return { success: false, message: "No instances found in selection" };
    }

    // Take the first instance from the selection
    sourceInstance = instances[0];
  }

  try {
    console.log(`Getting instance information:`);
    console.log(sourceInstance);

    // Get component overrides and main component
    const overrides = sourceInstance.overrides || [];
    console.log(`  Raw Overrides:`, overrides);

    // Get main component
    const mainComponent = await sourceInstance.getMainComponentAsync();
    if (!mainComponent) {
      console.error("Failed to get main component");
      figma.notify("Failed to get main component");
      return { success: false, message: "Failed to get main component" };
    }

    // return data to MCP server
    const returnData = {
      success: true,
      message: `Got component information from "${sourceInstance.name}" for overrides.length: ${overrides.length}`,
      sourceInstanceId: sourceInstance.id,
      mainComponentId: mainComponent.id,
      overridesCount: overrides.length
    };

    console.log("Data to return to MCP server:", returnData);
    figma.notify(`Got component information from "${sourceInstance.name}"`);

    return returnData;
  } catch (error) {
    console.error("Error in getInstanceOverrides:", error);
    figma.notify(`Error: ${errMsg(error)}`);
    return {
      success: false,
      message: `Error: ${errMsg(error)}`
    };
  }
}

/**
 * Helper function to validate and get target instances
 * @param {string[]} targetNodeIds - Array of instance node IDs
 * @returns {instanceNode[]} targetInstances - Array of target instances
 */
async function getValidTargetInstances(targetNodeIds) {
  let targetInstances = [];

  // Handle array of instances or single instance
  if (Array.isArray(targetNodeIds)) {
    if (targetNodeIds.length === 0) {
      return { success: false, message: "No instances provided" };
    }
    for (const targetNodeId of targetNodeIds) {
      const targetNode = await figma.getNodeByIdAsync(targetNodeId);
      if (targetNode && targetNode.type === "INSTANCE") {
        targetInstances.push(targetNode);
      }
    }
    if (targetInstances.length === 0) {
      return { success: false, message: "No valid instances provided" };
    }
  } else {
    return { success: false, message: "Invalid target node IDs provided" };
  }


  return { success: true, message: "Valid target instances provided", targetInstances };
}

/**
 * Helper function to validate and get saved override data
 * @param {string} sourceInstanceId - Source instance ID
 * @returns {Promise<Object>} - Validation result with source instance data or error
 */
async function getSourceInstanceData(sourceInstanceId) {
  if (!sourceInstanceId) {
    return { success: false, message: "Missing source instance ID" };
  }

  // Get source instance by ID
  const sourceInstance = await figma.getNodeByIdAsync(sourceInstanceId);
  if (!sourceInstance) {
    return {
      success: false,
      message: "Source instance not found. The original instance may have been deleted."
    };
  }

  // Verify it's an instance
  if (sourceInstance.type !== "INSTANCE") {
    return {
      success: false,
      message: "Source node is not a component instance."
    };
  }

  // Get main component
  const mainComponent = await sourceInstance.getMainComponentAsync();
  if (!mainComponent) {
    return {
      success: false,
      message: "Failed to get main component from source instance."
    };
  }

  return {
    success: true,
    sourceInstance,
    mainComponent,
    overrides: sourceInstance.overrides || []
  };
}

/**
 * Sets saved overrides to the selected component instance(s)
 * @param {InstanceNode[] | null} targetInstances - Array of instance nodes to set overrides to
 * @param {Object} sourceResult - Source instance data from getSourceInstanceData
 * @returns {Promise<Object>} - Result of the set operation
 */
async function setInstanceOverrides(targetInstances, sourceResult) {
  try {


    const { sourceInstance, mainComponent, overrides } = sourceResult;

    console.log(`Processing ${targetInstances.length} instances with ${overrides.length} overrides`);
    console.log(`Source instance: ${sourceInstance.id}, Main component: ${mainComponent.id}`);
    console.log(`Overrides:`, overrides);

    // Process all instances
    const results = [];
    let totalAppliedCount = 0;

    for (const targetInstance of targetInstances) {
      try {
        // // Skip if trying to apply to the source instance itself
        // if (targetInstance.id === sourceInstance.id) {
        //   console.log(`Skipping source instance itself: ${targetInstance.id}`);
        //   results.push({
        //     success: false,
        //     instanceId: targetInstance.id,
        //     instanceName: targetInstance.name,
        //     message: "This is the source instance itself, skipping"
        //   });
        //   continue;
        // }

        // Swap component
        try {
          targetInstance.swapComponent(mainComponent);
          console.log(`Swapped component for instance "${targetInstance.name}"`);
        } catch (error) {
          console.error(`Error swapping component for instance "${targetInstance.name}":`, error);
          results.push({
            success: false,
            instanceId: targetInstance.id,
            instanceName: targetInstance.name,
            message: `Error: ${errMsg(error)}`
          });
        }

        // Prepare overrides by replacing node IDs
        let appliedCount = 0;

        // Apply each override
        for (const override of overrides) {
          // Skip if no ID or overriddenFields
          if (!override.id || !override.overriddenFields || override.overriddenFields.length === 0) {
            continue;
          }

          // Replace source instance ID with target instance ID in the node path
          const overrideNodeId = override.id.replace(sourceInstance.id, targetInstance.id);
          const overrideNode = await figma.getNodeByIdAsync(overrideNodeId);

          if (!overrideNode) {
            console.log(`Override node not found: ${overrideNodeId}`);
            continue;
          }

          // Get source node to copy properties from
          const sourceNode = await figma.getNodeByIdAsync(override.id);
          if (!sourceNode) {
            console.log(`Source node not found: ${override.id}`);
            continue;
          }

          // Apply each overridden field
          let fieldApplied = false;
          for (const field of override.overriddenFields) {
            try {
              if (field === "componentProperties") {
                // Apply component properties
                if (sourceNode.componentProperties && overrideNode.componentProperties) {
                  const properties = {};
                  for (const key in sourceNode.componentProperties) {
                    // if INSTANCE_SWAP use id, otherwise use value
                    if (sourceNode.componentProperties[key].type === 'INSTANCE_SWAP') {
                      properties[key] = sourceNode.componentProperties[key].value;
                    
                    } else {
                      properties[key] = sourceNode.componentProperties[key].value;
                    }
                  }
                  overrideNode.setProperties(properties);
                  fieldApplied = true;
                }
              } else if (field === "characters" && overrideNode.type === "TEXT") {
                // For text nodes, need to load fonts first
                await figma.loadFontAsync(overrideNode.fontName);
                overrideNode.characters = sourceNode.characters;
                fieldApplied = true;
              } else if (field in overrideNode) {
                // Direct property assignment
                overrideNode[field] = sourceNode[field];
                fieldApplied = true;
              }
            } catch (fieldError) {
              console.error(`Error applying field ${field}:`, fieldError);
            }
          }

          if (fieldApplied) {
            appliedCount++;
          }
        }

        if (appliedCount > 0) {
          totalAppliedCount += appliedCount;
          results.push({
            success: true,
            instanceId: targetInstance.id,
            instanceName: targetInstance.name,
            appliedCount
          });
          console.log(`Applied ${appliedCount} overrides to "${targetInstance.name}"`);
        } else {
          results.push({
            success: false,
            instanceId: targetInstance.id,
            instanceName: targetInstance.name,
            message: "No overrides were applied"
          });
        }
      } catch (instanceError) {
        console.error(`Error processing instance "${targetInstance.name}":`, instanceError);
        results.push({
          success: false,
          instanceId: targetInstance.id,
          instanceName: targetInstance.name,
          message: `Error: ${errMsg(instanceError)}`
        });
      }
    }

    // Return results
    if (totalAppliedCount > 0) {
      const instanceCount = results.filter(r => r.success).length;
      const message = `Applied ${totalAppliedCount} overrides to ${instanceCount} instances`;
      figma.notify(message);
      return {
        success: true,
        message,
        totalCount: totalAppliedCount,
        results
      };
    } else {
      const message = "No overrides applied to any instance";
      figma.notify(message);
      return { success: false, message, results };
    }

  } catch (error) {
    console.error("Error in setInstanceOverrides:", error);
    const message = `Error: ${errMsg(error)}`;
    figma.notify(message);
    return { success: false, message };
  }
}

async function setLayoutMode(params) {
  const { nodeId, layoutMode = "NONE", layoutWrap = "NO_WRAP" } = params || {};

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports layoutMode
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support layoutMode`);
  }

  // Set layout mode
  node.layoutMode = layoutMode;

  // Set layoutWrap if applicable
  if (layoutMode !== "NONE") {
    node.layoutWrap = layoutWrap;
  }

  return {
    id: node.id,
    name: node.name,
    layoutMode: node.layoutMode,
    layoutWrap: node.layoutWrap,
  };
}

async function setPadding(params) {
  const { nodeId, paddingTop, paddingRight, paddingBottom, paddingLeft } =
    params || {};

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports padding
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support padding`);
  }

  // Check if the node has auto-layout enabled
  if (node.layoutMode === "NONE") {
    throw new Error(
      "Padding can only be set on auto-layout frames (layoutMode must not be NONE)"
    );
  }

  // Set padding values if provided
  if (paddingTop !== undefined) node.paddingTop = paddingTop;
  if (paddingRight !== undefined) node.paddingRight = paddingRight;
  if (paddingBottom !== undefined) node.paddingBottom = paddingBottom;
  if (paddingLeft !== undefined) node.paddingLeft = paddingLeft;

  return {
    id: node.id,
    name: node.name,
    paddingTop: node.paddingTop,
    paddingRight: node.paddingRight,
    paddingBottom: node.paddingBottom,
    paddingLeft: node.paddingLeft,
  };
}

async function setAxisAlign(params) {
  const { nodeId, primaryAxisAlignItems, counterAxisAlignItems } = params || {};

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports axis alignment
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support axis alignment`);
  }

  // Check if the node has auto-layout enabled
  if (node.layoutMode === "NONE") {
    throw new Error(
      "Axis alignment can only be set on auto-layout frames (layoutMode must not be NONE)"
    );
  }

  // Validate and set primaryAxisAlignItems if provided
  if (primaryAxisAlignItems !== undefined) {
    if (
      !["MIN", "MAX", "CENTER", "SPACE_BETWEEN"].includes(primaryAxisAlignItems)
    ) {
      throw new Error(
        "Invalid primaryAxisAlignItems value. Must be one of: MIN, MAX, CENTER, SPACE_BETWEEN"
      );
    }
    node.primaryAxisAlignItems = primaryAxisAlignItems;
  }

  // Validate and set counterAxisAlignItems if provided
  if (counterAxisAlignItems !== undefined) {
    if (!["MIN", "MAX", "CENTER", "BASELINE"].includes(counterAxisAlignItems)) {
      throw new Error(
        "Invalid counterAxisAlignItems value. Must be one of: MIN, MAX, CENTER, BASELINE"
      );
    }
    // BASELINE is only valid for horizontal layout
    if (
      counterAxisAlignItems === "BASELINE" &&
      node.layoutMode !== "HORIZONTAL"
    ) {
      throw new Error(
        "BASELINE alignment is only valid for horizontal auto-layout frames"
      );
    }
    node.counterAxisAlignItems = counterAxisAlignItems;
  }

  return {
    id: node.id,
    name: node.name,
    primaryAxisAlignItems: node.primaryAxisAlignItems,
    counterAxisAlignItems: node.counterAxisAlignItems,
    layoutMode: node.layoutMode,
  };
}

// E-9: 텍스트 노드도 대상에 포함한다. 오토레이아웃 자식인 TEXT 는
// layoutSizingHorizontal/Vertical 을 실제로 지원하는데 기존 구현이 막고 있었다.
// 오토레이아웃 자식인 도형(LINE 등)도 FIXED/FILL 을 지원한다. 점선 LINE 을 FILL 로
// 늘려야 하는 경우가 있어서 허용한다 (HUG 는 아래 validate 에서 막힌다).
function applyLayoutSizing(node, layoutSizingHorizontal, layoutSizingVertical) {
  const SIZABLE = [
    "FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "TEXT",
    "LINE", "RECTANGLE", "ELLIPSE", "VECTOR",
  ];
  if (!SIZABLE.includes(node.type)) {
    throw new Error(`Node type ${node.type} does not support layout sizing`);
  }

  // 프레임류는 스스로 오토레이아웃이어야 하고, TEXT 는 부모가 오토레이아웃이면 된다
  if (node.type !== "TEXT" && node.layoutMode === "NONE") {
    throw new Error(
      "Layout sizing can only be set on auto-layout frames (layoutMode must not be NONE)"
    );
  }

  const validate = (value, axis) => {
    if (!["FIXED", "HUG", "FILL"].includes(value)) {
      throw new Error(
        `Invalid layoutSizing${axis} value. Must be one of: FIXED, HUG, FILL`
      );
    }
    if (value === "HUG" && !["FRAME", "TEXT"].includes(node.type)) {
      throw new Error(
        "HUG sizing is only valid on auto-layout frames and text nodes"
      );
    }
    if (value === "FILL" && (!node.parent || node.parent.layoutMode === "NONE")) {
      throw new Error("FILL sizing is only valid on auto-layout children");
    }
  };

  if (layoutSizingHorizontal !== undefined) {
    validate(layoutSizingHorizontal, "Horizontal");
    node.layoutSizingHorizontal = layoutSizingHorizontal;
  }

  if (layoutSizingVertical !== undefined) {
    validate(layoutSizingVertical, "Vertical");
    node.layoutSizingVertical = layoutSizingVertical;
  }

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    layoutSizingHorizontal: node.layoutSizingHorizontal,
    layoutSizingVertical: node.layoutSizingVertical,
    layoutMode: node.layoutMode,
  };
}

async function setLayoutSizing(params) {
  const { nodeId, layoutSizingHorizontal, layoutSizingVertical } = params || {};

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  return applyLayoutSizing(node, layoutSizingHorizontal, layoutSizingVertical);
}

// E-9: 한 번에 수백 개 노드의 sizing 을 바꾼다. 단건 호출로는 표 전체를 FILL 로
// 돌리는 데만 수백 번 왕복이 필요해서 배치를 추가했다.
async function setMultipleLayoutSizing(params) {
  const {
    nodeIds,
    layoutSizingHorizontal: defaultHorizontal,
    layoutSizingVertical: defaultVertical,
  } = params || {};

  // nodeIds + 공통 sizing 으로도, 노드별 items 로도 부를 수 있다
  const items =
    params && params.items
      ? params.items
      : (nodeIds || []).map((nodeId) => ({ nodeId }));

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Missing or empty items/nodeIds parameter");
  }

  const results = [];
  const errors = [];

  for (const item of items) {
    try {
      const node = await figma.getNodeByIdAsync(item.nodeId);
      if (!node) {
        throw new Error(`Node with ID ${item.nodeId} not found`);
      }
      results.push(
        applyLayoutSizing(
          node,
          item.layoutSizingHorizontal !== undefined
            ? item.layoutSizingHorizontal
            : defaultHorizontal,
          item.layoutSizingVertical !== undefined
            ? item.layoutSizingVertical
            : defaultVertical
        )
      );
    } catch (error) {
      errors.push({ nodeId: item.nodeId, error: errMsg(error) });
    }
  }

  return {
    requested: items.length,
    succeeded: results.length,
    failed: errors.length,
    results,
    errors,
  };
}

// E-9: 이름만 바꾸는 왕복도 표 단위로는 수십 번이라 배치를 둔다.
// E-16: 변이 속성 키 개명 (C4_03 의 Size -> Scale).
// 변이 속성은 자식 COMPONENT 의 이름("Size=Regular, Type=Filled")이 정의라
// 노드 이름을 직접 갈아도 되지만, 그러면 기존 인스턴스의 선택값이 살아남는지가
// 보장되지 않는다. editComponentProperty 가 피그마가 인스턴스 이관까지 책임지는
// 정식 경로라 이쪽만 쓴다.
async function setConstraints(params) {
  params = params || {};
  var items = params.items || [];
  var dryRun = params.dryRun === true;
  var results = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    try {
      var node = await figma.getNodeByIdAsync(it.nodeId);
      if (!node) throw new Error("Node not found with ID: " + it.nodeId);
      var snap = function () {
        return {
          constraints: "constraints" in node ? node.constraints : null,
          clipsContent: "clipsContent" in node ? node.clipsContent : null,
          positioning: "layoutPositioning" in node ? node.layoutPositioning : null,
          x: node.x,
          y: node.y,
        };
      };
      var before = snap();
      if (!dryRun) {
        // auto-layout 부모 안에서 흐름에서 빼기(ABSOLUTE)/넣기(AUTO). 컴포넌트 교체(swap) 뒤 풀리는 경우 복구용.
        if (it.positioning) {
          if (!("layoutPositioning" in node)) throw new Error("Node has no layoutPositioning: " + node.type);
          var p = node.parent;
          if (it.positioning === "ABSOLUTE" && !(p && p.layoutMode && p.layoutMode !== "NONE")) {
            throw new Error("ABSOLUTE needs an auto-layout parent");
          }
          node.layoutPositioning = it.positioning;
        }
        if (typeof it.x === "number") node.x = it.x;
        if (typeof it.y === "number") node.y = it.y;
        if (it.horizontal || it.vertical) {
          if (!("constraints" in node)) throw new Error("Node has no constraints: " + node.type);
          node.constraints = {
            horizontal: it.horizontal || node.constraints.horizontal,
            vertical: it.vertical || node.constraints.vertical,
          };
        }
        if (it.clipsContent !== undefined) {
          if (!("clipsContent" in node)) throw new Error("Node has no clipsContent: " + node.type);
          node.clipsContent = it.clipsContent;
        }
      }
      results.push({ id: node.id, name: node.name, before: before, after: dryRun ? undefined : snap() });
    } catch (error) {
      results.push({ id: it.nodeId, error: errMsg(error) });
    }
  }
  return { dryRun: dryRun, results: results };
}

async function renameVariantProperty(params) {
  params = params || {};
  var nodeIds = params.nodeIds;
  var from = params.from;
  var to = params.to;
  var dryRun = params.dryRun === true;

  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0)
    throw new Error("Missing or empty nodeIds parameter");
  if (!from || !to) throw new Error("Missing from/to parameter");

  var results = [];
  var errors = [];

  for (var i = 0; i < nodeIds.length; i++) {
    var id = nodeIds[i];
    try {
      var node = await figma.getNodeByIdAsync(id);
      if (!node) throw new Error("Node not found with ID: " + id);
      if (node.type !== "COMPONENT_SET" && node.type !== "COMPONENT")
        throw new Error("Not a COMPONENT_SET/COMPONENT: " + node.type);

      // TEXT·BOOLEAN·INSTANCE_SWAP 은 "이름#id" 키로 componentPropertyDefinitions 에만 있다
      var defs = node.componentPropertyDefinitions || {};
      var defKey = Object.keys(defs).filter(function (k) {
        return defs[k].type !== "VARIANT" && k.split("#")[0] === from;
      })[0];
      if (defKey) {
        if (!dryRun) node.editComponentProperty(defKey, { name: to });
        results.push({
          id: id,
          name: node.name,
          status: dryRun ? "would-rename" : "renamed",
          type: defs[defKey].type,
          from: defKey,
          to: to,
          properties: Object.keys(node.componentPropertyDefinitions || {}),
        });
        continue;
      }

      var props = node.type === "COMPONENT_SET" ? node.variantGroupProperties || {} : {};
      if (!props[from]) {
        results.push({
          id: id,
          name: node.name,
          status: "skipped",
          reason: "no property named " + from,
          properties: Object.keys(props),
        });
        continue;
      }
      if (props[to]) throw new Error("Property " + to + " already exists on " + node.name);

      var values = props[from].values || [];
      if (dryRun) {
        results.push({
          id: id,
          name: node.name,
          status: "would-rename",
          from: from,
          to: to,
          values: values,
          variants: node.children.length,
        });
        continue;
      }

      node.editComponentProperty(from, { name: to });
      var after = Object.keys(node.variantGroupProperties || {});
      results.push({
        id: id,
        name: node.name,
        status: after.indexOf(to) !== -1 ? "renamed" : "unverified",
        from: from,
        to: to,
        values: values,
        properties: after,
      });
    } catch (error) {
      errors.push({ nodeId: id, error: errMsg(error) });
    }
  }

  return {
    requested: nodeIds.length,
    dryRun: dryRun,
    succeeded: results.length,
    failed: errors.length,
    results: results,
    errors: errors,
  };
}

// E-17 (2026-08-29) — 인스턴스의 main component 를 key 로 교체한다.
// 왜 필요했나: 고아 인스턴스(C8_03)를 고치려면 새 컴포넌트로 스왑해야 하는데,
//  - create_component_instance 는 `.` 접두사 컴포넌트에서 실패한다(발행 자산이 아니라 importComponentByKeyAsync 가 못 잡는다)
//  - set_instance_overrides 는 "소스 인스턴스"를 요구하는데, 문제의 변이는 파일에 healthy 인스턴스가 하나도 없다
// 해결: viaNodeId 로 같은 세트의 건강한 인스턴스를 하나 받아, 그 mainComponent 의 부모
//       COMPONENT_SET 에서 형제 변이를 꺼낸다. 임포트된 세트라 형제는 이미 문서 안에 있다.
async function swapInstancesByKey(params) {
  params = params || {};
  var nodeIds = params.nodeIds;
  var toKey = params.toKey;
  var viaNodeId = params.viaNodeId;
  var dryRun = params.dryRun === true;

  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0)
    throw new Error("Missing or empty nodeIds parameter");
  if (!toKey) throw new Error("Missing toKey parameter");

  var target = null;
  var resolvedVia = null;

  // (a) viaNodeId 경유 — 스캔 없이 O(1). 권장 경로.
  if (viaNodeId) {
    var via = await figma.getNodeByIdAsync(viaNodeId);
    if (!via) throw new Error("viaNodeId not found: " + viaNodeId);
    var viaMain =
      via.type === "INSTANCE" ? await via.getMainComponentAsync() : via;
    if (!viaMain) throw new Error("viaNodeId has no main component");
    if (viaMain.key === toKey) {
      target = viaMain;
      resolvedVia = "viaNodeId (direct)";
    } else if (viaMain.parent && viaMain.parent.type === "COMPONENT_SET") {
      var sibs = viaMain.parent.children;
      for (var s0 = 0; s0 < sibs.length; s0++) {
        if (sibs[s0].key === toKey) {
          target = sibs[s0];
          resolvedVia = "viaNodeId (sibling variant of " + viaMain.parent.name + ")";
          break;
        }
      }
    }
    if (!target)
      throw new Error(
        "toKey not found via viaNodeId. Its set is " +
          (viaMain.parent ? viaMain.parent.name : "(none)") +
          ". Pass a viaNodeId whose component set contains the target key."
      );
  }

  // (b) 발행 컴포넌트면 키로 바로 임포트된다.
  if (!target) {
    try {
      target = await figma.importComponentByKeyAsync(toKey);
      if (target) resolvedVia = "importComponentByKeyAsync";
    } catch (e) {
      target = null;
    }
  }

  // (c) 최후 수단 — 문서를 훑되 첫 매치에서 즉시 멈춘다.
  //     census 가 느린 이유는 전수를 끝까지 돌기 때문이다. 여기선 early exit 이 핵심.
  var scanned = 0;
  if (!target) {
    await figma.loadAllPagesAsync();
    var all = figma.root.findAllWithCriteria({ types: ["INSTANCE"] });
    for (var i0 = 0; i0 < all.length; i0++) {
      scanned++;
      var m = null;
      try {
        m = await all[i0].getMainComponentAsync();
      } catch (e) {
        continue;
      }
      if (!m) continue;
      if (m.key === toKey) {
        target = m;
        resolvedVia = "document scan (direct)";
        break;
      }
      if (m.parent && m.parent.type === "COMPONENT_SET") {
        var kids = m.parent.children;
        for (var k0 = 0; k0 < kids.length; k0++) {
          if (kids[k0].key === toKey) {
            target = kids[k0];
            resolvedVia = "document scan (sibling variant)";
            break;
          }
        }
        if (target) break;
      }
    }
  }

  if (!target)
    throw new Error(
      "Could not resolve a component for key " +
        toKey +
        ". For `.`-prefixed (unpublished) components pass viaNodeId — an instance whose component set contains the target variant."
    );

  var results = [];
  var errors = [];
  for (var i = 0; i < nodeIds.length; i++) {
    var id = nodeIds[i];
    try {
      var node = await figma.getNodeByIdAsync(id);
      if (!node) throw new Error("Node not found with ID: " + id);
      if (node.type !== "INSTANCE")
        throw new Error("Not an INSTANCE: " + node.type);

      var before = await node.getMainComponentAsync();
      var beforeKey = before ? before.key : null;
      var beforeName = before ? before.name : null;

      if (beforeKey === toKey) {
        results.push({
          id: id,
          name: node.name,
          status: "skipped",
          reason: "already bound to toKey",
        });
        continue;
      }
      if (dryRun) {
        results.push({
          id: id,
          name: node.name,
          status: "would-swap",
          fromKey: beforeKey,
          fromName: beforeName,
        });
        continue;
      }

      // swapComponent 가 auto-layout 안의 절대 위치(ABSOLUTE)를 풀어 버리면 형제들이 밀린다.
      // 교체 전 positioning/constraints 를 기록했다가 되돌린다.
      var keepPositioning = "layoutPositioning" in node ? node.layoutPositioning : null;
      var keepConstraints = "constraints" in node ? node.constraints : null;
      node.swapComponent(target);
      var positioningKept = true;
      if (keepPositioning && node.layoutPositioning !== keepPositioning) {
        try {
          node.layoutPositioning = keepPositioning;
        } catch (e) {
          positioningKept = false;
        }
      }
      if (keepConstraints && keepPositioning === "ABSOLUTE") node.constraints = keepConstraints;
      var after = await node.getMainComponentAsync();
      results.push({
        id: id,
        name: node.name,
        positioning: "layoutPositioning" in node ? node.layoutPositioning : null,
        positioningKept: positioningKept,
        status: after && after.key === toKey ? "swapped" : "unverified",
        fromKey: beforeKey,
        fromName: beforeName,
        toName: after ? after.name : null,
      });
    } catch (error) {
      errors.push({ nodeId: id, error: errMsg(error) });
    }
  }

  return {
    requested: nodeIds.length,
    toKey: toKey,
    resolvedVia: resolvedVia,
    targetName: target.name,
    targetSet: target.parent && target.parent.type === "COMPONENT_SET" ? target.parent.name : null,
    scannedInstances: scanned,
    dryRun: dryRun,
    succeeded: results.filter(function (r) { return r.status === "swapped" || r.status === "would-swap"; }).length,
    skipped: results.filter(function (r) { return r.status === "skipped"; }).length,
    failed: errors.length,
    results: results,
    errors: errors,
  };
}

async function renameMultipleNodes(params) {
  const { items } = params || {};

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error("Missing or empty items parameter");
  }

  const results = [];
  const errors = [];

  for (const item of items) {
    try {
      const node = await figma.getNodeByIdAsync(item.nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${item.nodeId}`);
      }
      const previousName = node.name;
      node.name = item.name;
      results.push({ id: node.id, previousName, name: node.name });
    } catch (error) {
      errors.push({ nodeId: item.nodeId, error: errMsg(error) });
    }
  }

  return {
    requested: items.length,
    succeeded: results.length,
    failed: errors.length,
    results,
    errors,
  };
}

// E-9: 행마다 컬럼을 하나씩 끼워 넣는 것 같은 작업은 clone → set_parent → 텍스트 id 조회로
// 행당 3회 왕복이 든다. 한 번에 복제·삽입하고 클론 안의 TEXT 목록까지 돌려준다.
async function cloneMultipleNodes(params) {
  const { items, includeTexts = true } = params || {};

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error("Missing or empty items parameter");
  }

  const collectTexts = (node, out) => {
    if (node.type === "TEXT") {
      out.push({ id: node.id, name: node.name, characters: node.characters });
    }
    if ("children" in node) {
      for (const child of node.children) collectTexts(child, out);
    }
    return out;
  };

  const results = [];
  const errors = [];

  for (const item of items) {
    try {
      const node = await figma.getNodeByIdAsync(item.nodeId);
      if (!node) {
        throw new Error(`Node not found with ID: ${item.nodeId}`);
      }

      const clone = node.clone();

      let parent = node.parent;
      if (item.parentId) {
        parent = await figma.getNodeByIdAsync(item.parentId);
        if (!parent) {
          clone.remove();
          throw new Error(`Parent node not found with ID: ${item.parentId}`);
        }
        if (!("appendChild" in parent)) {
          clone.remove();
          throw new Error(
            `Parent node does not support children: ${item.parentId}`
          );
        }
      }

      if (item.index !== undefined) {
        parent.insertChild(item.index, clone);
      } else {
        parent.appendChild(clone);
      }

      if (item.x !== undefined && item.y !== undefined && "x" in clone) {
        clone.x = item.x;
        clone.y = item.y;
      }

      if (item.name !== undefined) {
        clone.name = item.name;
      }

      results.push({
        sourceId: item.nodeId,
        cloneId: clone.id,
        name: clone.name,
        parentId: parent.id,
        index: parent.children.indexOf(clone),
        texts: includeTexts ? collectTexts(clone, []) : undefined,
      });
    } catch (error) {
      errors.push({ nodeId: item.nodeId, error: errMsg(error) });
    }
  }

  return {
    requested: items.length,
    succeeded: results.length,
    failed: errors.length,
    results,
    errors,
  };
}

async function setItemSpacing(params) {
  const { nodeId, itemSpacing, counterAxisSpacing } = params || {};

  // Validate that at least one spacing parameter is provided
  if (itemSpacing === undefined && counterAxisSpacing === undefined) {
    throw new Error("At least one of itemSpacing or counterAxisSpacing must be provided");
  }

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports item spacing
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support item spacing`);
  }

  // Check if the node has auto-layout enabled
  if (node.layoutMode === "NONE") {
    throw new Error(
      "Item spacing can only be set on auto-layout frames (layoutMode must not be NONE)"
    );
  }

  // Set item spacing if provided
  if (itemSpacing !== undefined) {
    if (typeof itemSpacing !== "number") {
      throw new Error("Item spacing must be a number");
    }
    node.itemSpacing = itemSpacing;
  }

  // Set counter axis spacing if provided
  if (counterAxisSpacing !== undefined) {
    if (typeof counterAxisSpacing !== "number") {
      throw new Error("Counter axis spacing must be a number");
    }
    // counterAxisSpacing only applies when layoutWrap is WRAP
    if (node.layoutWrap !== "WRAP") {
      throw new Error(
        "Counter axis spacing can only be set on frames with layoutWrap set to WRAP"
      );
    }
    node.counterAxisSpacing = counterAxisSpacing;
  }

  return {
    id: node.id,
    name: node.name,
    itemSpacing: node.itemSpacing || undefined,
    counterAxisSpacing: node.counterAxisSpacing || undefined,
    layoutMode: node.layoutMode,
    layoutWrap: node.layoutWrap,
  };
}

async function setDefaultConnector(params) {
  const { connectorId } = params || {};
  
  // If connectorId is provided, search and set by that ID (do not check existing storage)
  if (connectorId) {
    // Get node by specified ID
    const node = await figma.getNodeByIdAsync(connectorId);
    if (!node) {
      throw new Error(`Connector node not found with ID: ${connectorId}`);
    }
    
    // Check node type
    if (node.type !== 'CONNECTOR') {
      throw new Error(`Node is not a connector: ${connectorId}`);
    }
    
    // Set the found connector as the default connector
    await figma.clientStorage.setAsync('defaultConnectorId', connectorId);
    
    return {
      success: true,
      message: `Default connector set to: ${connectorId}`,
      connectorId: connectorId
    };
  } 
  // If connectorId is not provided, check existing storage
  else {
    // Check if there is an existing default connector in client storage
    try {
      const existingConnectorId = await figma.clientStorage.getAsync('defaultConnectorId');
      
      // If there is an existing connector ID, check if the node is still valid
      if (existingConnectorId) {
        try {
          const existingConnector = await figma.getNodeByIdAsync(existingConnectorId);
          
          // If the stored connector still exists and is of type CONNECTOR
          if (existingConnector && existingConnector.type === 'CONNECTOR') {
            return {
              success: true,
              message: `Default connector is already set to: ${existingConnectorId}`,
              connectorId: existingConnectorId,
              exists: true
            };
          }
          // The stored connector is no longer valid - find a new connector
          else {
            console.log(`Stored connector ID ${existingConnectorId} is no longer valid, finding a new connector...`);
          }
        } catch (error) {
          console.log(`Error finding stored connector: ${errMsg(error)}. Will try to set a new one.`);
        }
      }
    } catch (error) {
      console.log(`Error checking for existing connector: ${errMsg(error)}`);
    }
    
    // If there is no stored default connector or it is invalid, find one in the current page
    try {
      // Find CONNECTOR type nodes in the current page
      const currentPageConnectors = figma.currentPage.findAllWithCriteria({ types: ['CONNECTOR'] });
      
      if (currentPageConnectors && currentPageConnectors.length > 0) {
        // Use the first connector found
        const foundConnector = currentPageConnectors[0];
        const autoFoundId = foundConnector.id;
        
        // Set the found connector as the default connector
        await figma.clientStorage.setAsync('defaultConnectorId', autoFoundId);
        
        return {
          success: true,
          message: `Automatically found and set default connector to: ${autoFoundId}`,
          connectorId: autoFoundId,
          autoSelected: true
        };
      } else {
        // If no connector is found in the current page, show a guide message
        throw new Error('No connector found in the current page. Please create a connector in Figma first or specify a connector ID.');
      }
    } catch (error) {
      // Error occurred while running findAllWithCriteria
      throw new Error(`Failed to find a connector: ${errMsg(error)}`);
    }
  }
}

async function createCursorNode(targetNodeId) {
  const svgString = `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 8V35.2419L22 28.4315L27 39.7823C27 39.7823 28.3526 40.2722 29 39.7823C29.6474 39.2924 30.2913 38.3057 30 37.5121C28.6247 33.7654 25 26.1613 25 26.1613H32L16 8Z" fill="#202125" />
  </svg>`;
  try {
    const targetNode = await figma.getNodeByIdAsync(targetNodeId);
    if (!targetNode) throw new Error("Target node not found");

    // The targetNodeId has semicolons since it is a nested node.
    // So we need to get the parent node ID from the target node ID and check if we can appendChild to it or not.
    let parentNodeId = targetNodeId.includes(';') 
      ? targetNodeId.split(';')[0] 
      : targetNodeId;
    if (!parentNodeId) throw new Error("Could not determine parent node ID");

    // Find the parent node to append cursor node as child
    let parentNode = await figma.getNodeByIdAsync(parentNodeId);
    if (!parentNode) throw new Error("Parent node not found");

    // If the parent node is not eligible to appendChild, set the parentNode to the parent of the parentNode
    if (parentNode.type === 'INSTANCE' || parentNode.type === 'COMPONENT' || parentNode.type === 'COMPONENT_SET') {
      parentNode = parentNode.parent;
      if (!parentNode) throw new Error("Parent node not found");
    }

    // Create the cursor node
    const importedNode = await figma.createNodeFromSvg(svgString);
    if (!importedNode || !importedNode.id) {
      throw new Error("Failed to create imported cursor node");
    }
    importedNode.name = "TTF_Connector / Mouse Cursor";
    importedNode.resize(48, 48);

    const cursorNode = importedNode.findOne(node => node.type === 'VECTOR');
    if (cursorNode) {
      cursorNode.fills = [{
        type: 'SOLID',
        color: { r: 0, g: 0, b: 0 },
        opacity: 1
      }];
      cursorNode.strokes = [{
        type: 'SOLID',
        color: { r: 1, g: 1, b: 1 },
        opacity: 1
      }];
      cursorNode.strokeWeight = 2;
      cursorNode.strokeAlign = 'OUTSIDE';
      cursorNode.effects = [{
        type: "DROP_SHADOW",
        color: { r: 0, g: 0, b: 0, a: 0.3 },
        offset: { x: 1, y: 1 },
        radius: 2,
        spread: 0,
        visible: true,
        blendMode: "NORMAL"
      }];
    }

    // Append the cursor node to the parent node
    parentNode.appendChild(importedNode);

    // if the parentNode has auto-layout enabled, set the layoutPositioning to ABSOLUTE
    if ('layoutMode' in parentNode && parentNode.layoutMode !== 'NONE') {
      importedNode.layoutPositioning = 'ABSOLUTE';
    }

    // Adjust the importedNode's position to the targetNode's position
    if (
      targetNode.absoluteBoundingBox &&
      parentNode.absoluteBoundingBox
    ) {
      // if the targetNode has absoluteBoundingBox, set the importedNode's absoluteBoundingBox to the targetNode's absoluteBoundingBox
      console.log('targetNode.absoluteBoundingBox', targetNode.absoluteBoundingBox);
      console.log('parentNode.absoluteBoundingBox', parentNode.absoluteBoundingBox);
      importedNode.x = targetNode.absoluteBoundingBox.x - parentNode.absoluteBoundingBox.x  + targetNode.absoluteBoundingBox.width / 2 - 48 / 2
      importedNode.y = targetNode.absoluteBoundingBox.y - parentNode.absoluteBoundingBox.y + targetNode.absoluteBoundingBox.height / 2 - 48 / 2;
    } else if (
      'x' in targetNode && 'y' in targetNode && 'width' in targetNode && 'height' in targetNode) {
        // if the targetNode has x, y, width, height, calculate center based on relative position
        console.log('targetNode.x/y/width/height', targetNode.x, targetNode.y, targetNode.width, targetNode.height);
        importedNode.x = targetNode.x + targetNode.width / 2 - 48 / 2;
        importedNode.y = targetNode.y + targetNode.height / 2 - 48 / 2;
    } else {
      // Fallback: Place at top-left of target if possible, otherwise at (0,0) relative to parent
      if ('x' in targetNode && 'y' in targetNode) {
        console.log('Fallback to targetNode x/y');
        importedNode.x = targetNode.x;
        importedNode.y = targetNode.y;
      } else {
        console.log('Fallback to (0,0)');
        importedNode.x = 0;
        importedNode.y = 0;
      }
    }

    // get the importedNode ID and the importedNode
    console.log('importedNode', importedNode);


    return { id: importedNode.id, node: importedNode };
    
  } catch (error) {
    console.error("Error creating cursor from SVG:", error);
    return { id: null, node: null, error: errMsg(error) };
  }
}

async function createConnections(params) {
  if (!params || !params.connections || !Array.isArray(params.connections)) {
    throw new Error('Missing or invalid connections parameter');
  }
  
  const { connections } = params;
  
  // Command ID for progress tracking
  const commandId = generateCommandId();
  sendProgressUpdate(
    commandId,
    "create_connections",
    "started",
    0,
    connections.length,
    0,
    `Starting to create ${connections.length} connections`
  );
  
  // Get default connector ID from client storage
  const defaultConnectorId = await figma.clientStorage.getAsync('defaultConnectorId');
  if (!defaultConnectorId) {
    throw new Error('No default connector set. Please try one of the following options to create connections:\n1. Create a connector in FigJam and copy/paste it to your current page, then run the "set_default_connector" command.\n2. Select an existing connector on the current page, then run the "set_default_connector" command.');
  }
  
  // Get the default connector
  const defaultConnector = await figma.getNodeByIdAsync(defaultConnectorId);
  if (!defaultConnector) {
    throw new Error(`Default connector not found with ID: ${defaultConnectorId}`);
  }
  if (defaultConnector.type !== 'CONNECTOR') {
    throw new Error(`Node is not a connector: ${defaultConnectorId}`);
  }
  
  // Results array for connection creation
  const results = [];
  let processedCount = 0;
  const totalCount = connections.length;
  
  // Preload fonts (used for text if provided)
  let fontLoaded = false;
  
  for (let i = 0; i < connections.length; i++) {
    try {
      const { startNodeId: originalStartId, endNodeId: originalEndId, text } = connections[i];
      let startId = originalStartId;
      let endId = originalEndId;

      // Check and potentially replace start node ID
      if (startId.includes(';')) {
        console.log(`Nested start node detected: ${startId}. Creating cursor node.`);
        const cursorResult = await createCursorNode(startId);
        if (!cursorResult || !cursorResult.id) {
          throw new Error(`Failed to create cursor node for nested start node: ${startId}`);
        }
        startId = cursorResult.id; 
      }  
      
      const startNode = await figma.getNodeByIdAsync(startId);
      if (!startNode) throw new Error(`Start node not found with ID: ${startId}`);

      // Check and potentially replace end node ID
      if (endId.includes(';')) {
        console.log(`Nested end node detected: ${endId}. Creating cursor node.`);
        const cursorResult = await createCursorNode(endId);
        if (!cursorResult || !cursorResult.id) {
          throw new Error(`Failed to create cursor node for nested end node: ${endId}`);
        }
        endId = cursorResult.id;
      }
      const endNode = await figma.getNodeByIdAsync(endId);
      if (!endNode) throw new Error(`End node not found with ID: ${endId}`);

      
      // Clone the default connector
      const clonedConnector = defaultConnector.clone();
      
      // Update connector name using potentially replaced node names
      clonedConnector.name = `TTF_Connector/${startNode.id}/${endNode.id}`;
      
      // Set start and end points using potentially replaced IDs
      clonedConnector.connectorStart = {
        endpointNodeId: startId,
        magnet: 'AUTO'
      };
      
      clonedConnector.connectorEnd = {
        endpointNodeId: endId,
        magnet: 'AUTO'
      };
      
      // Add text (if provided)
      if (text) {
        try {
          // Try to load the necessary fonts
          try {
            // First check if default connector has font and use the same
            if (defaultConnector.text && defaultConnector.text.fontName) {
              const fontName = defaultConnector.text.fontName;
              await figma.loadFontAsync(fontName);
              clonedConnector.text.fontName = fontName;
            } else {
              // Try default Inter font
              await figma.loadFontAsync({ family: "Inter", style: "Regular" });
            }
          } catch (fontError) {
            // If first font load fails, try another font style
            try {
              await figma.loadFontAsync({ family: "Inter", style: "Medium" });
            } catch (mediumFontError) {
              // If second font fails, try system font
              try {
                await figma.loadFontAsync({ family: "System", style: "Regular" });
              } catch (systemFontError) {
                // If all font loading attempts fail, throw error
                throw new Error(`Failed to load any font: ${errMsg(fontError)}`);
              }
            }
          }
          
          // Set the text
          clonedConnector.text.characters = text;
        } catch (textError) {
          console.error("Error setting text:", textError);
          // Continue with connection even if text setting fails
          results.push({
            id: clonedConnector.id,
            startNodeId: originalStartId,
            endNodeId: originalEndId,
            text: "",
            textError: errMsg(textError)
          });
          
          // Continue to next connection
          continue;
        }
      }
      
      // Add to results (using the *original* IDs for reference if needed)
      results.push({
        id: clonedConnector.id,
        originalStartNodeId: originalStartId,
        originalEndNodeId: originalEndId,
        usedStartNodeId: startId, // ID actually used for connection
        usedEndNodeId: endId,     // ID actually used for connection
        text: text || ""
      });
      
      // Update progress
      processedCount++;
      sendProgressUpdate(
        commandId,
        "create_connections",
        "in_progress",
        processedCount / totalCount,
        totalCount,
        processedCount,
        `Created connection ${processedCount}/${totalCount}`
      );
      
    } catch (error) {
      console.error("Error creating connection", error);
      // Continue processing remaining connections even if an error occurs
      processedCount++;
      sendProgressUpdate(
        commandId,
        "create_connections",
        "in_progress",
        processedCount / totalCount,
        totalCount,
        processedCount,
        `Error creating connection: ${errMsg(error)}`
      );
      
      results.push({
        error: errMsg(error),
        connectionInfo: connections[i]
      });
    }
  }
  
  // Completion update
  sendProgressUpdate(
    commandId,
    "create_connections",
    "completed",
    1,
    totalCount,
    totalCount,
    `Completed creating ${results.length} connections`
  );
  
  return {
    success: true,
    count: results.length,
    connections: results
  };
}

// Set focus on a specific node
async function setFocus(params) {
  if (!params || !params.nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(params.nodeId);
  if (!node) {
    throw new Error(`Node with ID ${params.nodeId} not found`);
  }

  // Set selection to the node
  figma.currentPage.selection = [node];
  
  // Scroll and zoom to show the node in viewport
  figma.viewport.scrollAndZoomIntoView([node]);

  return {
    success: true,
    name: node.name,
    id: node.id,
    message: `Focused on node "${node.name}"`
  };
}

// Set selection to multiple nodes
async function setSelections(params) {
  if (!params || !params.nodeIds || !Array.isArray(params.nodeIds)) {
    throw new Error("Missing or invalid nodeIds parameter");
  }

  if (params.nodeIds.length === 0) {
    throw new Error("nodeIds array cannot be empty");
  }

  // Get all valid nodes
  const nodes = [];
  const notFoundIds = [];
  
  for (const nodeId of params.nodeIds) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (node) {
      nodes.push(node);
    } else {
      notFoundIds.push(nodeId);
    }
  }

  if (nodes.length === 0) {
    throw new Error(`No valid nodes found for the provided IDs: ${params.nodeIds.join(', ')}`);
  }

  // E-14: selection is per page. Without switching first, any node that lives on
  // another page throws and the whole call fails - which is exactly the case when
  // a scan hands back hits from 22 component pages.
  const result = await selectOnOwnPage(nodes);

  return {
    success: true,
    count: result.selected.length,
    selectedNodes: result.selected.map(node => ({ name: node.name, id: node.id })),
    notFoundIds: notFoundIds,
    page: result.pageName,
    skippedOtherPages: result.skipped.length,
    skippedIds: result.skipped.map(node => node.id),
    message: `Selected ${result.selected.length} nodes on "${result.pageName}"` +
      (result.skipped.length > 0 ? ` (${result.skipped.length} on other pages, not selected)` : '') +
      (notFoundIds.length > 0 ? ` (${notFoundIds.length} not found)` : '')
  };
}

function pageOfNode(node) {
  var p = node;
  while (p && p.type !== "PAGE") p = p.parent;
  return p;
}

// Switches to the page of the first node, selects everything that lives there,
// and reports the rest instead of throwing. Figma has one selection per page.
async function selectOnOwnPage(nodes) {
  var page = null;
  for (var i = 0; i < nodes.length && !page; i++) page = pageOfNode(nodes[i]);
  if (!page) throw new Error("None of the nodes are on a page");

  if (figma.currentPage.id !== page.id) await figma.setCurrentPageAsync(page);

  var selected = [];
  var skipped = [];
  for (var j = 0; j < nodes.length; j++) {
    var owner = pageOfNode(nodes[j]);
    if (owner && owner.id === page.id) selected.push(nodes[j]);
    else skipped.push(nodes[j]);
  }

  figma.currentPage.selection = selected;
  if (selected.length) figma.viewport.scrollAndZoomIntoView(selected);

  return { pageName: page.name, selected: selected, skipped: skipped };
}

// E-14: find nodes whose PROPERTY is hardcoded (optionally to a given VALUE) and
// select them, so a human can review them in the file. get_variable_bindings can
// already report them, but shipping 500-finding JSON back just to pick 12 node ids
// is the slow way round. Scope with pageName/nodeId, page through with offset/limit.
async function selectHardcoded(params) {
  params = params || {};
  if (!params.property) throw new Error("Missing property parameter");
  var wanted = params.value === undefined || params.value === null ? null : String(params.value);

  var targets = await resolveScanTargets(params);
  var hits = [];
  var scannedNodes = 0;

  for (var i = 0; i < targets.length; i++) {
    var target = targets[i];
    if (target.node.type === "PAGE") await target.node.loadAsync();
    var nodes = target.node.findAll ? target.node.findAll(function () { return true; }) : [];
    if (target.node.type !== "PAGE") nodes = [target.node].concat(nodes);

    for (var j = 0; j < nodes.length; j++) {
      scannedNodes++;
      var found = hardcodedProps(nodes[j]);
      for (var k = 0; k < found.length; k++) {
        if (found[k].prop !== params.property) continue;
        if (wanted !== null && String(found[k].value) !== wanted) continue;
        hits.push({ node: nodes[j], value: found[k].value, page: target.pageName });
      }
    }
  }

  var offset = params.offset || 0;
  var limit = params.limit || 50;
  var slice = hits.slice(offset, offset + limit);

  var result = { pageName: null, selected: [], skipped: [] };
  if (slice.length) {
    result = await selectOnOwnPage(slice.map(function (h) { return h.node; }));
  }

  var selectedIds = {};
  result.selected.forEach(function (n) { selectedIds[n.id] = true; });

  return {
    property: params.property,
    value: wanted,
    scannedNodes: scannedNodes,
    total: hits.length,
    offset: offset,
    limit: limit,
    returned: slice.length,
    hasMore: offset + slice.length < hits.length,
    page: result.pageName,
    selectedCount: result.selected.length,
    skippedOtherPages: result.skipped.length,
    nodes: slice.map(function (h) {
      return {
        id: h.node.id,
        name: h.node.name,
        type: h.node.type,
        page: h.page,
        value: h.value,
        component: nearestComponent(h.node).component,
        path: ancestorPath(h.node, 6),
        selected: !!selectedIds[h.node.id],
      };
    }),
  };
}

// ============================================================
// DS healthcheck commands: variables, hardcoded values, instance census
// ============================================================

// Readable trail from the page down to the node, so a census hit can actually
// be found by a human. Instance children are named after the slot they sit in
// ("Leading Icon"), so the path is the only thing that says which screen.
function ancestorPath(node, maxDepth) {
  var parts = [];
  var p = node.parent;
  var depth = 0;
  while (p && p.type !== "PAGE" && p.type !== "DOCUMENT" && depth < (maxDepth || 8)) {
    parts.unshift(p.name);
    p = p.parent;
    depth++;
  }
  return parts.join(" > ");
}

function pageNameOf(node) {
  var p = node;
  while (p && p.type !== "PAGE") p = p.parent;
  return p ? p.name : null;
}

// Nearest component-ish ancestor, reported as { component, variant }.
// A variant gives both ("Button" + "Size=Large, State=Pressed") so a problem
// isolated to one variant stays visible instead of collapsing into the set.
// Scan scope, shared by the page-walking commands: a nodeId means just that
// subtree, otherwise every page minus excludePages. documentAccess is
// dynamic-page, so without loadAllPagesAsync the other pages scan as empty.
async function resolveScanTargets(params) {
  if (params.nodeId) {
    var root = await figma.getNodeByIdAsync(params.nodeId);
    if (!root) throw new Error("Node not found with ID: " + params.nodeId);
    return [{ pageName: pageNameOf(root), node: root }];
  }
  await figma.loadAllPagesAsync();
  var exclude = params.excludePages || [];
  return figma.root.children
    .filter(function (p) {
      return (
        (!params.pageName || p.name === params.pageName) && exclude.indexOf(p.name) === -1
      );
    })
    .map(function (p) {
      return { pageName: p.name, node: p };
    });
}

function nearestComponent(node) {
  var p = node.parent;
  while (p && p.type !== "PAGE" && p.type !== "DOCUMENT") {
    if (p.type === "COMPONENT_SET") return { component: p.name, variant: null };
    if (p.type === "COMPONENT") {
      return p.parent && p.parent.type === "COMPONENT_SET"
        ? { component: p.parent.name, variant: p.name }
        : { component: p.name, variant: null };
    }
    if (p.type === "INSTANCE") return { component: p.name, variant: null };
    p = p.parent;
  }
  return { component: null, variant: null };
}

// Turn one mode's raw value into something readable.
// COLOR carries both 0-1 RGBA and HEX so contrast math needs no second call.
async function resolveVariableValue(value, resolvedType, nameById) {
  if (value && value.type === "VARIABLE_ALIAS") {
    var name = nameById[value.id];
    if (name === undefined) {
      // Aliases can point at library variables, which aren't in the local map.
      var target = await figma.variables.getVariableByIdAsync(value.id);
      name = target ? target.name : null;
      nameById[value.id] = name;
    }
    return { alias: true, variableId: value.id, name: name };
  }
  if (resolvedType === "COLOR" && value && typeof value === "object") {
    return { rgba: value, hex: rgbaToHex(value) };
  }
  return value;
}

async function getLocalVariables() {
  var collections = await figma.variables.getLocalVariableCollectionsAsync();
  var variables = await figma.variables.getLocalVariablesAsync();

  var nameById = {};
  var byCollection = {};
  variables.forEach(function (v) {
    nameById[v.id] = v.name;
    (byCollection[v.variableCollectionId] = byCollection[v.variableCollectionId] || []).push(v);
  });

  var result = [];
  for (var i = 0; i < collections.length; i++) {
    var collection = collections[i];
    var modes = collection.modes.map(function (m) {
      return { modeId: m.modeId, name: m.name };
    });
    var vars = byCollection[collection.id] || [];
    var out = [];

    for (var j = 0; j < vars.length; j++) {
      var v = vars[j];
      var valuesByMode = {};
      for (var k = 0; k < modes.length; k++) {
        var raw = v.valuesByMode[modes[k].modeId];
        valuesByMode[modes[k].name] =
          raw === undefined
            ? null
            : await resolveVariableValue(raw, v.resolvedType, nameById);
      }
      out.push({
        id: v.id,
        key: v.key,
        name: v.name,
        type: v.resolvedType,
        scopes: v.scopes,
        valuesByMode: valuesByMode,
      });
    }

    result.push({
      id: collection.id,
      name: collection.name,
      modes: modes,
      variableCount: out.length,
      variables: out,
    });
  }

  return {
    collectionCount: result.length,
    variableCount: variables.length,
    collections: result,
  };
}

// Properties worth flagging, with the boundVariables keys that would prove
// they're NOT hardcoded, plus the style field that means "bound to a style".
// E-19: 오토레이아웃이 꺼진 프레임에도 itemSpacing·padding 값이 남아 있다.
// 피그마는 layoutMode 를 NONE 으로 바꿔도 그 값을 지우지 않는데, 렌더에는
// 전혀 반영되지 않는다. 죽은 값을 "하드코딩 위반"으로 세면 모수가 부풀고
// 화면과 대조가 안 된다(2026-08-29 btn-speaking 74건이 이 경우였다).
// 같은 이유로 간격이 Auto(SPACE_BETWEEN)일 때도 저장된 숫자는 쓰이지 않는다
// (x-axis 50건. 둘 다 사람이 화면을 보고 "그 간격 아닌데?" 라고 짚어 드러났다).
var LAYOUT_ONLY_PROPS = {
  itemSpacing: true,
  counterAxisSpacing: true,
  paddingLeft: true,
  paddingRight: true,
  paddingTop: true,
  paddingBottom: true,
};

var HARDCODE_CHECKS = [
  { prop: "fills", keys: ["fills"], styleId: "fillStyleId", paints: true },
  { prop: "strokes", keys: ["strokes"], styleId: "strokeStyleId", paints: true },
  {
    prop: "cornerRadius",
    keys: ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"],
  },
  { prop: "itemSpacing", keys: ["itemSpacing"] },
  { prop: "paddingLeft", keys: ["paddingLeft"] },
  { prop: "paddingRight", keys: ["paddingRight"] },
  { prop: "paddingTop", keys: ["paddingTop"] },
  { prop: "paddingBottom", keys: ["paddingBottom"] },
  { prop: "fontSize", keys: ["fontSize"], styleId: "textStyleId" },
];

function isBound(bound, keys) {
  return keys.some(function (k) {
    var b = bound[k];
    if (!b) return false;
    return Array.isArray(b) ? b.length > 0 : true;
  });
}

// Paints render as hex so the caller can count "#F5F5F5 appears 23 times".
// Opacity folds into the alpha byte, otherwise two visually different greys
// collapse into one bucket.
function paintsToValue(paints) {
  return paints
    .map(function (p) {
      return rgbaToHex({
        r: p.color.r,
        g: p.color.g,
        b: p.color.b,
        a: p.opacity === undefined ? 1 : p.opacity,
      });
    })
    .join(",");
}

// Returns [{ prop, value }] — the value is what the node actually paints/spaces
// with, which is the whole point: "fills is hardcoded" is not actionable,
// "#F5F5F5 is hardcoded in 23 places" is.
function hardcodedProps(node) {
  var bound = node.boundVariables || {};
  var out = [];
  for (var i = 0; i < HARDCODE_CHECKS.length; i++) {
    var check = HARDCODE_CHECKS[i];
    var value = node[check.prop];
    if (value === undefined || value === null) continue;
    if (value === figma.mixed) continue;
    // 오토레이아웃이 없으면 간격·패딩은 렌더에 안 쓰인다 — 위반이 아니다.
    if (LAYOUT_ONLY_PROPS[check.prop] && node.layoutMode === "NONE") continue;
    // 간격이 Auto(SPACE_BETWEEN)면 저장된 숫자를 안 쓰고 계산한다. 역시 죽은 값.
    if (check.prop === "itemSpacing" && node.primaryAxisAlignItems === "SPACE_BETWEEN") continue;
    if (check.prop === "counterAxisSpacing" && node.counterAxisAlignContent === "SPACE_BETWEEN") continue;
    // ponytail: a 0 radius/spacing/padding is almost never a missing token,
    // and flagging it buries the real findings. Drop the guard if 0 matters.
    if (value === 0) continue;
    var reported = value;
    if (check.paints) {
      if (!Array.isArray(value)) continue;
      // Only solid paints are token candidates — image fills aren't.
      var solid = value.filter(function (p) {
        return p.type === "SOLID" && p.visible !== false;
      });
      if (!solid.length) continue;
      reported = paintsToValue(solid);
    }
    if (check.styleId && node[check.styleId]) continue;
    // ponytail: any binding on the property counts as bound. A node with 2 fills
    // where only one is tokenised reads as clean; split per-paint if that bites.
    if (isBound(bound, check.keys)) continue;
    out.push({ prop: check.prop, value: reported });
  }
  return out;
}

// E-8: bound-variable consumers — the inverse of the hardcoded scan.
// "Which nodes use Semantic/Color / Interactive/Regular, and on what property"
// has no Figma API of its own, so it rides along on the same node walk.
// boundVariables values are VariableAlias or VariableAlias[]; concat covers both.
function collectBoundVars(node, out) {
  var bound = node.boundVariables || {};
  Object.keys(bound).forEach(function (prop) {
    [].concat(bound[prop]).forEach(function (a) {
      if (a && a.type === "VARIABLE_ALIAS") out.push({ prop: prop, id: a.id });
    });
  });
}

// E-12: 여러 노드의 불투명도를 한 번에. 점검표에서 "끝난 행을 흐리게" 처럼
// 상태를 시각적으로 죽이는 용도라 단건 커맨드로는 왕복이 너무 많다.
async function setMultipleOpacity(params) {
  params = params || {};
  var nodeIds = params.nodeIds || [];
  var opacity = params.opacity;
  if (!nodeIds.length) throw new Error("nodeIds is required");
  if (typeof opacity !== "number" || opacity < 0 || opacity > 1)
    throw new Error("opacity must be a number between 0 and 1");

  var results = [];
  var errors = [];
  for (var i = 0; i < nodeIds.length; i++) {
    try {
      var node = await figma.getNodeByIdAsync(nodeIds[i]);
      if (!node) throw new Error("Node not found");
      if (!("opacity" in node)) throw new Error(node.type + " has no opacity");
      var before = node.opacity;
      node.opacity = opacity;
      results.push({
        id: node.id,
        name: node.name,
        type: node.type,
        previousOpacity: before,
        opacity: node.opacity,
      });
    } catch (e) {
      errors.push({ id: nodeIds[i], error: errMsg(e) });
    }
  }
  return {
    requested: nodeIds.length,
    succeeded: results.length,
    failed: errors.length,
    results: results,
    errors: errors,
  };
}

// E-11: "분명히 있다는데 화면에서 못 찾겠다" 를 푸는 스캔.
// 노드가 안 보이는 이유는 눈 아이콘만이 아니다 — 부모가 꺼졌거나, 투명하거나,
// 크기가 0이거나, 부모의 clipsContent 에 잘려 나갔거나다. 이유를 함께 돌려준다.
// E-20: 이름으로 노드를 찾는다. find_hidden_nodes 의 nameFilter 는 "안 보이는" 것만 돌려주고
// scan_nodes_by_types 는 이름을 못 거른다 — 표준 레이어(예: "Interaction")를 전수로 집는 수단이 없었다.
async function findNodesByName(params) {
  params = params || {};
  var commandId = params.commandId || generateCommandId();
  var limit = params.limit || 500;
  var offset = params.offset || 0;
  var name = String(params.name || "");
  if (!name) throw new Error("name is required");
  var needle = name.toLowerCase();
  var exact = params.exact === true;
  var types = params.types || null;
  var parentTypes = params.parentTypes || null;
  var idsOnly = params.idsOnly === true;

  var targets = await resolveScanTargets(params);

  await sendProgressUpdate(
    commandId,
    "find_nodes_by_name",
    "started",
    0,
    targets.length,
    0,
    "Scanning " + targets.length + " target(s) for \"" + name + "\"...",
    null
  );

  var findings = [];
  var byType = {};
  var scannedNodes = 0;

  for (var i = 0; i < targets.length; i++) {
    var target = targets[i];
    if (target.node.type === "PAGE") await target.node.loadAsync();

    var nodes = target.node.findAll
      ? target.node.findAll(function () {
          return true;
        })
      : [];
    if (target.node.type !== "PAGE") nodes = [target.node].concat(nodes);

    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      scannedNodes++;
      var nodeName = String(node.name);
      if (exact ? nodeName !== name : nodeName.toLowerCase().indexOf(needle) === -1)
        continue;
      if (types && types.indexOf(node.type) === -1) continue;
      var parent = node.parent;
      if (parentTypes && (!parent || parentTypes.indexOf(parent.type) === -1)) continue;

      byType[node.type] = (byType[node.type] || 0) + 1;
      if (idsOnly) {
        findings.push(node.id);
        continue;
      }
      var where = nearestComponent(node);
      findings.push({
        id: node.id,
        name: nodeName,
        type: node.type,
        page: target.pageName,
        parentId: parent ? parent.id : null,
        parentType: parent ? parent.type : null,
        component: where.component,
        variant: where.variant,
        path: ancestorPath(node),
      });
    }
  }

  await sendProgressUpdate(
    commandId,
    "find_nodes_by_name",
    "completed",
    100,
    1,
    1,
    "Found " + findings.length + " node(s)",
    null
  );

  var out = {
    scannedNodes: scannedNodes,
    totalFindings: findings.length,
    byType: byType,
    name: name,
    exact: exact,
  };
  // idsOnly 는 페이징하지 않는다 — 대량 삭제·선택에 그대로 넘기는 게 목적이라 잘리면 위험하다.
  if (idsOnly) {
    out.ids = findings;
    return out;
  }
  out.offset = offset;
  out.limit = limit;
  out.returned = Math.min(limit, Math.max(0, findings.length - offset));
  out.hasMore = offset + limit < findings.length;
  out.findings = findings.slice(offset, offset + limit);
  return out;
}

async function findHiddenNodes(params) {
  params = params || {};
  var commandId = params.commandId || generateCommandId();
  var limit = params.limit || 500;
  var offset = params.offset || 0;
  var nameFilter = params.nameFilter ? String(params.nameFilter).toLowerCase() : null;
  // E-12: opacity 가 1 미만인 노드도 "faded" 로 잡는다. 기본은 꺼둔다 —
  // 30% 딱지·강조 배경처럼 의도적으로 반투명한 노드가 많아 기존 결과가 오염된다.
  var includeFaded = params.includeFaded === true;

  var targets = await resolveScanTargets(params);

  await sendProgressUpdate(
    commandId,
    "find_hidden_nodes",
    "started",
    0,
    targets.length,
    0,
    "Scanning " + targets.length + " target(s) for invisible nodes...",
    null
  );

  function rectOf(n) {
    var b = safeGet(n, "absoluteBoundingBox");
    if (b && typeof b.x === "number") return b;
    return null;
  }

  // 부모 중 clipsContent 인 것들의 사각형과 비교해 완전히 벗어났는지 본다.
  function clippedBy(node) {
    var r = rectOf(node);
    if (!r) return null;
    var p = node.parent;
    while (p && p.type !== "PAGE" && p.type !== "DOCUMENT") {
      if (safeGet(p, "clipsContent") === true) {
        var pr = rectOf(p);
        if (pr) {
          var outside =
            r.x >= pr.x + pr.width ||
            r.y >= pr.y + pr.height ||
            r.x + r.width <= pr.x ||
            r.y + r.height <= pr.y;
          var partial =
            !outside &&
            (r.x < pr.x ||
              r.y < pr.y ||
              r.x + r.width > pr.x + pr.width ||
              r.y + r.height > pr.y + pr.height);
          if (outside) return { id: p.id, name: p.name, mode: "fully" };
          if (partial) return { id: p.id, name: p.name, mode: "partly" };
        }
      }
      p = p.parent;
    }
    return null;
  }

  var findings = [];
  var byReason = {};
  var scannedNodes = 0;

  for (var i = 0; i < targets.length; i++) {
    var target = targets[i];
    if (target.node.type === "PAGE") await target.node.loadAsync();

    var nodes = target.node.findAll
      ? target.node.findAll(function () {
          return true;
        })
      : [];
    if (target.node.type !== "PAGE") nodes = [target.node].concat(nodes);

    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      scannedNodes++;
      if (nameFilter && String(node.name).toLowerCase().indexOf(nameFilter) === -1)
        continue;

      var reasons = [];
      var detail = {};

      if (safeGet(node, "visible") === false) reasons.push("hidden");

      var op = safeGet(node, "opacity");
      if (typeof op === "number" && op < 1) {
        detail.opacity = op;
        if (op === 0) reasons.push("transparent");
        else if (includeFaded) reasons.push("faded");
      }

      var r = rectOf(node);
      if (r && (r.width === 0 || r.height === 0)) reasons.push("zeroSize");

      // 조상 중 꺼진 것이 있는가 (자기는 켜져 있어도 화면엔 안 나온다)
      var anc = node.parent;
      while (anc && anc.type !== "PAGE" && anc.type !== "DOCUMENT") {
        if (safeGet(anc, "visible") === false) {
          reasons.push("parentHidden");
          detail.hiddenAncestor = { id: anc.id, name: anc.name };
          break;
        }
        anc = anc.parent;
      }

      var clip = clippedBy(node);
      if (clip) {
        reasons.push(clip.mode === "fully" ? "clipped" : "clippedPartly");
        detail.clippedBy = clip;
      }

      if (!reasons.length) continue;

      reasons.forEach(function (rs) {
        byReason[rs] = (byReason[rs] || 0) + 1;
      });

      findings.push({
        id: node.id,
        name: node.name,
        type: node.type,
        page: target.pageName,
        path: ancestorPath(node),
        reasons: reasons,
        detail: detail,
      });
    }
  }

  await sendProgressUpdate(
    commandId,
    "find_hidden_nodes",
    "completed",
    100,
    1,
    1,
    "Found " + findings.length + " invisible node(s)",
    null
  );

  return {
    scannedNodes: scannedNodes,
    totalFindings: findings.length,
    byReason: byReason,
    nameFilter: params.nameFilter || null,
    offset: offset,
    limit: limit,
    returned: Math.min(limit, Math.max(0, findings.length - offset)),
    hasMore: offset + limit < findings.length,
    findings: findings.slice(offset, offset + limit),
  };
}

async function getVariableBindings(params) {
  params = params || {};
  var commandId = params.commandId || generateCommandId();
  var detail = params.detail !== false;
  var limit = params.limit || 500;
  var offset = params.offset || 0;

  var targets = await resolveScanTargets(params);

  await sendProgressUpdate(
    commandId,
    "get_variable_bindings",
    "started",
    0,
    targets.length,
    0,
    "Scanning " + targets.length + " target(s) for hardcoded values...",
    null
  );

  var findings = [];
  var byProperty = {};
  var byValue = {};
  var byComponent = {};
  var byVariable = {};
  var scannedNodes = 0;
  // E-10: which text styles are actually bound, not just which values look alike.
  // Figma has no "where is this style used" API and get_node_info drops
  // textStyleId, so it rides along on the scan that already walks every node.
  var byTextStyleId = {};
  var textStat = { total: 0, styled: 0, unstyled: 0, mixed: 0 };

  for (var i = 0; i < targets.length; i++) {
    var target = targets[i];
    if (target.node.type === "PAGE") await target.node.loadAsync();

    var nodes = target.node.findAll
      ? target.node.findAll(function () {
          return true;
        })
      : [];
    if (target.node.type !== "PAGE") nodes = [target.node].concat(nodes);

    for (var j = 0; j < nodes.length; j++) {
      scannedNodes++;

      if (nodes[j].type === "TEXT") {
        textStat.total++;
        var tsid = safeGet(nodes[j], "textStyleId");
        if (typeof tsid === "string" && tsid) {
          textStat.styled++;
          byTextStyleId[tsid] = (byTextStyleId[tsid] || 0) + 1;
        } else if (tsid === figma.mixed) {
          textStat.mixed++;
        } else {
          textStat.unstyled++;
        }
      }

      var boundHits = [];
      collectBoundVars(nodes[j], boundHits);
      if (boundHits.length) {
        var boundOwner = nearestComponent(nodes[j]);
        var boundOwnerKey = boundOwner.component || "(no component)";
        boundHits.forEach(function (h) {
          var vb2 =
            byVariable[h.id] ||
            (byVariable[h.id] = { total: 0, properties: {}, components: {} });
          vb2.total++;
          vb2.properties[h.prop] = (vb2.properties[h.prop] || 0) + 1;
          var cb =
            vb2.components[boundOwnerKey] ||
            (vb2.components[boundOwnerKey] = { total: 0, variants: {} });
          cb.total++;
          if (boundOwner.variant)
            cb.variants[boundOwner.variant] = (cb.variants[boundOwner.variant] || 0) + 1;
        });
      }

      var props = hardcodedProps(nodes[j]);
      if (!props.length) continue;
      var propNames = [];
      var values = {};
      props.forEach(function (p) {
        byProperty[p.prop] = (byProperty[p.prop] || 0) + 1;
        propNames.push(p.prop);
        values[p.prop] = p.value;
        // The rollup is the reason this command exists: without it the caller
        // has to page through every finding just to build a histogram.
        var vb = byValue[p.prop] || (byValue[p.prop] = {});
        var vk = String(p.value);
        vb[vk] = (vb[vk] || 0) + 1;
      });
      var owner = nearestComponent(nodes[j]);
      var ownerKey = owner.component || "(no component)";
      var bucket = byComponent[ownerKey] || (byComponent[ownerKey] = { total: 0, variants: {} });
      bucket.total++;
      if (owner.variant) bucket.variants[owner.variant] = (bucket.variants[owner.variant] || 0) + 1;
      findings.push({
        id: nodes[j].id,
        name: nodes[j].name,
        type: nodes[j].type,
        page: target.pageName,
        component: owner.component,
        variant: owner.variant,
        hardcoded: propNames,
        values: values,
      });
    }

    await sendProgressUpdate(
      commandId,
      "get_variable_bindings",
      i + 1 === targets.length ? "completed" : "in_progress",
      Math.round(((i + 1) / targets.length) * 100),
      targets.length,
      i + 1,
      "Scanned " + target.pageName + ": " + findings.length + " hardcoded node(s) so far",
      null
    );
  }

  // Resolve variable ids to "Collection / Name" once per distinct id.
  var byVariableNamed = {};
  var collNameById = {};
  var varIds = Object.keys(byVariable);
  for (var v = 0; v < varIds.length; v++) {
    var label = varIds[v];
    var variable = await figma.variables.getVariableByIdAsync(varIds[v]);
    if (variable) {
      var cname = collNameById[variable.variableCollectionId];
      if (cname === undefined) {
        var coll = await figma.variables.getVariableCollectionByIdAsync(
          variable.variableCollectionId
        );
        cname = coll ? coll.name : "(unknown collection)";
        collNameById[variable.variableCollectionId] = cname;
      }
      label = cname + " / " + variable.name;
    }
    byVariableNamed[label] = byVariable[varIds[v]];
  }

  var byTextStyle = {};
  var tsIds = Object.keys(byTextStyleId);
  for (var t = 0; t < tsIds.length; t++) {
    var st = null;
    try {
      st = await figma.getStyleByIdAsync(tsIds[t]);
    } catch (e) {
      st = null;
    }
    var tlabel = st
      ? st.name + (st.remote ? " (library)" : " (local)")
      : "(unresolved " + tsIds[t] + ")";
    byTextStyle[tlabel] = (byTextStyle[tlabel] || 0) + byTextStyleId[tsIds[t]];
  }

  var page = detail ? findings.slice(offset, offset + limit) : [];
  return {
    scannedNodes: scannedNodes,
    byTextStyle: byTextStyle,
    textNodes: textStat,
    totalFindings: findings.length,
    byProperty: byProperty,
    byValue: byValue,
    byComponent: byComponent,
    byVariable: byVariableNamed,
    offset: offset,
    limit: limit,
    returned: page.length,
    hasMore: detail && offset + page.length < findings.length,
    findings: page,
  };
}

// Unbind shared styles while keeping the painted values. Setting a *StyleId
// to "" bakes the current paint/effect in as a raw value, which is how you cut
// a dependency on an external library without changing how anything looks.
async function unbindStyles(params) {
  params = params || {};
  var commandId = params.commandId || generateCommandId();
  if (!params.nodeId) throw new Error("nodeId is required");
  var onlyRemote = params.onlyRemote !== false;
  var dryRun = params.dryRun === true;

  var root = await figma.getNodeByIdAsync(params.nodeId);
  if (!root) throw new Error("Node not found with ID: " + params.nodeId);

  var FIELDS = [
    "fillStyleId",
    "strokeStyleId",
    "effectStyleId",
    "gridStyleId",
    "textStyleId",
  ];
  var SETTERS = {
    fillStyleId: "setFillStyleIdAsync",
    strokeStyleId: "setStrokeStyleIdAsync",
    effectStyleId: "setEffectStyleIdAsync",
    gridStyleId: "setGridStyleIdAsync",
    textStyleId: "setTextStyleIdAsync",
  };

  var nodes = root.findAll(function () {
    return true;
  });
  nodes = [root].concat(nodes);

  var remoteCache = {};
  async function isRemote(styleId) {
    if (remoteCache[styleId] !== undefined) return remoteCache[styleId];
    var r = false;
    try {
      var st = await figma.getStyleByIdAsync(styleId);
      r = !!(st && st.remote);
    } catch (e) {
      r = false;
    }
    remoteCache[styleId] = r;
    return r;
  }

  var cleared = [];
  var kept = [];

  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    for (var f = 0; f < FIELDS.length; f++) {
      var field = FIELDS[f];
      var val = safeGet(node, field);
      if (!val || typeof val !== "string") continue; // absent or figma.mixed
      var remote = await isRemote(val);
      if (onlyRemote && !remote) {
        kept.push({ id: node.id, name: node.name, field: field, styleId: val });
        continue;
      }
      var rec = {
        id: node.id,
        name: node.name,
        type: node.type,
        field: field,
        styleId: val,
        remote: remote,
      };
      if (!dryRun) {
        // documentAccess: dynamic-page forbids the sync setters.
        var setter = SETTERS[field];
        try {
          if (typeof node[setter] === "function") {
            await node[setter]("");
          } else {
            node[field] = "";
          }
        } catch (e) {
          rec.error = errMsg(e);
        }
      }
      cleared.push(rec);
    }
  }

  await sendProgressUpdate(
    commandId,
    "unbind_styles",
    "completed",
    100,
    1,
    1,
    (dryRun ? "Dry run: " : "Unbound ") + cleared.length + " style binding(s)",
    null
  );

  var byField = {};
  cleared.forEach(function (c) {
    byField[c.field] = (byField[c.field] || 0) + 1;
  });

  return {
    dryRun: dryRun,
    rootName: root.name,
    scannedNodes: nodes.length,
    clearedCount: cleared.length,
    byField: byField,
    keptLocalCount: kept.length,
    keptLocalSample: kept.slice(0, 10),
    sample: cleared.slice(0, 15),
  };
}

// Detach instances under a node. Figma does not allow detaching an instance
// that sits inside another instance, so this runs in passes: detach the
// outermost ones, which turns previously nested instances into real editable
// instances, then repeat. Irreversible, hence dryRun.
async function detachInstances(params) {
  params = params || {};
  var commandId = params.commandId || generateCommandId();
  if (!params.nodeId) throw new Error("nodeId is required");
  var onlyRemote = params.onlyRemote !== false;
  var dryRun = params.dryRun === true;
  var maxPasses = params.maxPasses || 12;

  var root = await figma.getNodeByIdAsync(params.nodeId);
  if (!root) throw new Error("Node not found with ID: " + params.nodeId);

  function hasInstanceAncestor(node, stopAt) {
    var p = node.parent;
    while (p && p.id !== stopAt.id) {
      if (p.type === "INSTANCE") return true;
      p = p.parent;
    }
    return false;
  }

  var detached = [];
  var skipped = [];
  var passes = 0;

  for (var pass = 0; pass < maxPasses; pass++) {
    var all = root.findAll(function (n) {
      return n.type === "INSTANCE";
    });
    if (root.type === "INSTANCE") all = [root].concat(all);

    var targets = [];
    for (var i = 0; i < all.length; i++) {
      var inst = all[i];
      if (hasInstanceAncestor(inst, root)) continue; // not detachable yet
      var main = null;
      try {
        main = await inst.getMainComponentAsync();
      } catch (e) {
        main = null;
      }
      var isRemote = !!(main && main.remote);
      if (onlyRemote && !isRemote) {
        skipped.push({ id: inst.id, name: inst.name, reason: "local component" });
        continue;
      }
      targets.push({
        node: inst,
        id: inst.id,
        name: inst.name,
        mainName: main ? main.name : null,
        remote: isRemote,
      });
    }

    if (!targets.length) break;
    passes = pass + 1;

    for (var j = 0; j < targets.length; j++) {
      var t = targets[j];
      detached.push({
        id: t.id,
        name: t.name,
        mainComponent: t.mainName,
        remote: t.remote,
        pass: passes,
      });
      if (!dryRun) {
        try {
          t.node.detachInstance();
        } catch (e) {
          detached[detached.length - 1].error = errMsg(e);
        }
      }
    }

    await sendProgressUpdate(
      commandId,
      "detach_instances",
      "in_progress",
      Math.round(((pass + 1) / maxPasses) * 100),
      maxPasses,
      pass + 1,
      "Pass " + passes + ": " + targets.length + " instance(s)",
      null
    );

    if (dryRun) break; // nothing changed, so further passes would repeat
  }

  await sendProgressUpdate(
    commandId,
    "detach_instances",
    "completed",
    100,
    1,
    1,
    (dryRun ? "Dry run: " : "Detached ") + detached.length + " instance(s)",
    null
  );

  return {
    dryRun: dryRun,
    rootName: root.name,
    passes: passes,
    detachedCount: detached.length,
    detached: detached,
    skippedCount: skipped.length,
    skippedSample: skipped.slice(0, 10),
  };
}

// Hyperlinks on text. Not present in the JSON_REST_V1 export, but readable
// off live TEXT nodes. Answers "does this index/link actually point anywhere".
async function getHyperlinks(params) {
  params = params || {};
  var commandId = params.commandId || generateCommandId();

  var targets = await resolveScanTargets(params);

  var links = [];
  var textNodes = 0;

  for (var i = 0; i < targets.length; i++) {
    var target = targets[i];
    if (target.node.type === "PAGE") await target.node.loadAsync();

    var nodes = target.node.findAll
      ? target.node.findAll(function (n) {
          return n.type === "TEXT";
        })
      : [];
    if (target.node.type === "TEXT") nodes = [target.node].concat(nodes);

    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      textNodes++;
      var segments = [];
      try {
        segments = node.getStyledTextSegments(["hyperlink"]) || [];
      } catch (e) {
        continue;
      }
      for (var k = 0; k < segments.length; k++) {
        var seg = segments[k];
        if (!seg.hyperlink) continue;
        var target_ = seg.hyperlink;
        var entry = {
          id: node.id,
          name: node.name,
          page: target.pageName,
          text: seg.characters,
          linkType: target_.type,
          value: target_.value,
        };
        // A NODE link can point at something that no longer exists.
        if (target_.type === "NODE") {
          try {
            var dest = await figma.getNodeByIdAsync(target_.value);
            entry.destExists = !!dest;
            entry.destName = dest ? dest.name : null;
            entry.destPage = dest ? pageNameOf(dest) : null;
          } catch (e2) {
            entry.destExists = false;
            entry.destError = errMsg(e2);
          }
        }
        links.push(entry);
      }
    }

    await sendProgressUpdate(
      commandId,
      "get_hyperlinks",
      i + 1 === targets.length ? "completed" : "in_progress",
      Math.round(((i + 1) / targets.length) * 100),
      targets.length,
      i + 1,
      "Scanned " + target.pageName + ": " + links.length + " link(s) so far",
      null
    );
  }

  return { textNodes: textNodes, totalLinks: links.length, links: links };
}

// Auto layout / sizing / padding / effect / shared-style audit.
// exportAsync(JSON_REST_V1) drops all of these, so read them off live nodes.
function safeGet(node, key) {
  try {
    return node[key];
  } catch (e) {
    return undefined;
  }
}

async function getLayoutAudit(params) {
  params = params || {};
  var commandId = params.commandId || generateCommandId();

  var targets = await resolveScanTargets(params);

  await sendProgressUpdate(
    commandId,
    "get_layout_audit",
    "started",
    0,
    targets.length,
    0,
    "Auditing layout on " + targets.length + " target(s)...",
    null
  );

  var byComponent = {};
  var scannedNodes = 0;

  function bucketFor(name, page) {
    var key = name || "(no component)";
    if (!byComponent[key]) {
      byComponent[key] = {
        page: page,
        nodes: 0,
        autoLayoutFrames: 0,
        noAutoLayoutFrames: 0,
        sizing: { HUG: 0, FILL: 0, FIXED: 0 },
        paddingValues: {},
        itemSpacingValues: {},
        textNodes: 0,
        textWithSharedStyle: 0,
        fillNodes: 0,
        fillWithSharedStyle: 0,
        effectNodes: [],
      };
    }
    return byComponent[key];
  }

  for (var i = 0; i < targets.length; i++) {
    var target = targets[i];
    if (target.node.type === "PAGE") await target.node.loadAsync();

    var nodes = target.node.findAll
      ? target.node.findAll(function () {
          return true;
        })
      : [];
    if (target.node.type !== "PAGE") nodes = [target.node].concat(nodes);

    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      scannedNodes++;
      var owner = nearestComponent(node);
      var b = bucketFor(owner.component, target.pageName);
      b.nodes++;

      var layoutMode = safeGet(node, "layoutMode");
      if (layoutMode !== undefined) {
        if (layoutMode === "NONE") b.noAutoLayoutFrames++;
        else {
          b.autoLayoutFrames++;
          var sp = safeGet(node, "itemSpacing");
          if (typeof sp === "number")
            b.itemSpacingValues[sp] = (b.itemSpacingValues[sp] || 0) + 1;
          ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom"].forEach(
            function (p) {
              var v = safeGet(node, p);
              if (typeof v === "number")
                b.paddingValues[v] = (b.paddingValues[v] || 0) + 1;
            }
          );
        }
      }

      ["layoutSizingHorizontal", "layoutSizingVertical"].forEach(function (k) {
        var v = safeGet(node, k);
        if (v && b.sizing[v] !== undefined) b.sizing[v]++;
      });

      if (node.type === "TEXT") {
        b.textNodes++;
        var ts = safeGet(node, "textStyleId");
        if (ts && typeof ts === "string") b.textWithSharedStyle++;
      }

      var fills = safeGet(node, "fills");
      if (fills && fills !== figma.mixed && fills.length > 0) {
        b.fillNodes++;
        var fs = safeGet(node, "fillStyleId");
        if (fs && typeof fs === "string") b.fillWithSharedStyle++;
      }

      var effects = safeGet(node, "effects");
      if (effects && effects.length > 0) {
        b.effectNodes.push({
          id: node.id,
          name: node.name,
          type: node.type,
          effectStyleId: safeGet(node, "effectStyleId") || null,
          effects: effects.map(function (e) {
            return {
              type: e.type,
              visible: e.visible,
              radius: e.radius,
              spread: e.spread,
              offset: e.offset,
              color: e.color ? rgbaToHex(e.color) : undefined,
            };
          }),
        });
      }
    }

    await sendProgressUpdate(
      commandId,
      "get_layout_audit",
      i + 1 === targets.length ? "completed" : "in_progress",
      Math.round(((i + 1) / targets.length) * 100),
      targets.length,
      i + 1,
      "Audited " + target.pageName + " (" + scannedNodes + " nodes so far)",
      null
    );
  }

  return { scannedNodes: scannedNodes, byComponent: byComponent };
}

async function getInstanceCensus(params) {
  params = params || {};
  var commandId = params.commandId || generateCommandId();
  var exclude = params.excludePages || [];

  await figma.loadAllPagesAsync();
  var instances = figma.root.findAllWithCriteria({ types: ["INSTANCE"] });
  if (params.pageName || exclude.length) {
    instances = instances.filter(function (n) {
      var page = pageNameOf(n);
      if (params.pageName && page !== params.pageName) return false;
      return exclude.indexOf(page) === -1;
    });
  }

  await sendProgressUpdate(
    commandId,
    "get_instance_census",
    "started",
    0,
    instances.length,
    0,
    "Counting " + instances.length + " instance(s)...",
    null
  );

  var census = {};
  var unresolved = 0;
  // instancesFor: name/key/id of one component. Without it the census is a pure
  // rollup and says nothing about where the instances actually are.
  var wanted = params.instancesFor || null;
  var instanceLimit = params.instanceLimit || 1000;
  var matches = [];
  var matchTotal = 0;

  for (var i = 0; i < instances.length; i++) {
    var instance = instances[i];
    var main = null;
    try {
      main =
        typeof instance.getMainComponentAsync === "function"
          ? await instance.getMainComponentAsync()
          : instance.mainComponent;
    } catch (e) {
      main = null;
    }
    if (!main) {
      unresolved++;
    } else {
      var set = main.parent && main.parent.type === "COMPONENT_SET" ? main.parent : null;
      if (!census[main.id]) {
        census[main.id] = {
          componentName: main.name,
          componentSetName: set ? set.name : null,
          key: main.key || null,
          source: main.remote ? "library" : "local",
          count: 0,
        };
      }
      census[main.id].count++;
      if (wanted && (main.key === wanted || main.id === wanted ||
          main.name === wanted || (set && set.name === wanted))) {
        if (matches.length < instanceLimit) {
          matches.push({
            id: instance.id,
            name: instance.name,
            page: pageNameOf(instance),
            path: ancestorPath(instance),
          });
        }
        matchTotal++;
      }
    }

    if ((i + 1) % 100 === 0 || i + 1 === instances.length) {
      await sendProgressUpdate(
        commandId,
        "get_instance_census",
        i + 1 === instances.length ? "completed" : "in_progress",
        Math.round(((i + 1) / (instances.length || 1)) * 100),
        instances.length,
        i + 1,
        "Resolved " + (i + 1) + "/" + instances.length + " instances",
        null
      );
    }
  }

  var components = Object.keys(census)
    .map(function (id) {
      return census[id];
    })
    .sort(function (a, b) {
      return b.count - a.count;
    });

  var libraryInstances = components.reduce(function (sum, c) {
    return sum + (c.source === "library" ? c.count : 0);
  }, 0);

  return {
    totalInstances: instances.length,
    unresolvedInstances: unresolved,
    uniqueComponents: components.length,
    libraryInstances: libraryInstances,
    localInstances: instances.length - unresolved - libraryInstances,
    components: components,
    instancesFor: wanted,
    matchedInstances: wanted ? matchTotal : undefined,
    instances: wanted ? matches : undefined,
  };
}

// ── E-18: bind_variable ─────────────────────────────────────────────────────
// 노드 여러 개의 한 속성을 변수에 일괄 바인딩한다.
// variableKey(라이브러리 변수, importVariableByKeyAsync) 또는 variableId(로컬) 중 하나.
// property: itemSpacing | cornerRadius(네 모서리 동시) | paddingLeft/Right/Top/Bottom
//         | strokeWeight | width | height | fills(첫 SOLID paint 의 color)
var BIND_FIELDS = {
  itemSpacing: ["itemSpacing"],
  counterAxisSpacing: ["counterAxisSpacing"],
  cornerRadius: ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"],
  paddingLeft: ["paddingLeft"],
  paddingRight: ["paddingRight"],
  paddingTop: ["paddingTop"],
  paddingBottom: ["paddingBottom"],
  strokeWeight: ["strokeWeight"],
  width: ["width"],
  height: ["height"],
  // auto-layout 프레임/자식의 최소·최대 크기 (예: 패널 max height 에 max/panel 토큰)
  minWidth: ["minWidth"],
  maxWidth: ["maxWidth"],
  minHeight: ["minHeight"],
  maxHeight: ["maxHeight"],
};

async function bindVariable(params) {
  params = params || {};
  var nodeIds = params.nodeIds;
  var property = params.property;
  var dryRun = params.dryRun === true;

  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw new Error("Missing or invalid nodeIds parameter");
  }
  if (!property) throw new Error("Missing property parameter");
  var isPaint = property === "fills" || property === "strokes";
  if (!isPaint && !BIND_FIELDS[property]) {
    throw new Error(
      "Unsupported property: " + property + ". Supported: fills, strokes, " + Object.keys(BIND_FIELDS).join(", ")
    );
  }

  // 변수 해석
  var variable = null;
  if (params.variableKey) {
    try {
      variable = await figma.variables.importVariableByKeyAsync(params.variableKey);
    } catch (e) {
      throw new Error("importVariableByKeyAsync failed for key " + params.variableKey + ": " + errMsg(e));
    }
  } else if (params.variableId) {
    variable = await figma.variables.getVariableByIdAsync(params.variableId);
    if (!variable) throw new Error("Variable not found: " + params.variableId);
  } else if (params.variableFromNodeId) {
    // 참조 노드의 첫 SOLID fill 에 묶인 변수를 그대로 쓴다 (권한 불필요).
    var ref = await figma.getNodeByIdAsync(params.variableFromNodeId);
    if (!ref) throw new Error("Reference node not found: " + params.variableFromNodeId);
    var refFills = Array.isArray(ref.fills) ? ref.fills : [];
    var refPaint = refFills.find(function (p) { return p.type === "SOLID"; });
    var refBinding = refPaint && refPaint.boundVariables && refPaint.boundVariables.color;
    if (!refBinding) throw new Error("Reference node has no variable-bound SOLID fill: " + params.variableFromNodeId);
    variable = await figma.variables.getVariableByIdAsync(refBinding.id);
    if (!variable) throw new Error("Variable not found: " + refBinding.id);
  } else if (params.variableName) {
    // 로컬 변수 → 활성화된 라이브러리 순으로 이름으로 찾는다 (라이브러리는 teamlibrary 권한 필요).
    variable = await resolveVariableRef({ variableName: params.variableName });
  } else {
    throw new Error("Missing variableKey, variableId, variableFromNodeId or variableName parameter");
  }

  if (isPaint && variable.resolvedType !== "COLOR") {
    throw new Error("property '" + property + "' requires a COLOR variable, got " + variable.resolvedType);
  }
  if (!isPaint && variable.resolvedType !== "FLOAT") {
    throw new Error("property '" + property + "' requires a FLOAT variable, got " + variable.resolvedType);
  }

  var bound = [];
  var skipped = [];
  var failed = [];
  var fields = BIND_FIELDS[property] || [];

  for (var i = 0; i < nodeIds.length; i++) {
    var id = nodeIds[i];
    var node;
    try {
      node = await figma.getNodeByIdAsync(id);
    } catch (e) {
      failed.push({ nodeId: id, reason: errMsg(e) });
      continue;
    }
    if (!node) {
      failed.push({ nodeId: id, reason: "Node not found" });
      continue;
    }
    if (typeof node.setBoundVariable !== "function") {
      failed.push({ nodeId: id, name: node.name, reason: "Node type " + node.type + " cannot bind variables" });
      continue;
    }

    try {
      if (property === "fills" || property === "strokes") {
        var paintKey = property;
        var fills = node[paintKey];
        if (fills === figma.mixed || !Array.isArray(fills) || fills.length === 0) {
          skipped.push({ nodeId: id, name: node.name, reason: "no " + paintKey + " / mixed" });
          continue;
        }
        var idx = -1;
        for (var f = 0; f < fills.length; f++) {
          if (fills[f].type === "SOLID") { idx = f; break; }
        }
        if (idx === -1) {
          skipped.push({ nodeId: id, name: node.name, reason: "no SOLID " + paintKey });
          continue;
        }
        if (fills[idx].boundVariables && fills[idx].boundVariables.color && params.overwrite !== true) {
          skipped.push({ nodeId: id, name: node.name, reason: "already bound" });
          continue;
        }
        if (dryRun) {
          bound.push({ nodeId: id, name: node.name, type: node.type, dryRun: true });
          continue;
        }
        var origOpacity = typeof fills[idx].opacity === "number" ? fills[idx].opacity : 1;
        var next = fills.slice();
        next[idx] = figma.variables.setBoundVariableForPaint(next[idx], "color", variable);
        node[paintKey] = next;
        // 묶는 순간 피그마가 칠 투명도를 변수 알파(보통 1)로 덮는다 — 묶인 뒤의 칠을 다시 읽어
        // 투명도만 원래 값으로 한 번 더 쓴다(바인딩은 그대로 남는다).
        var opacityKept = true;
        if (origOpacity !== 1) {
          var after = node[paintKey].slice();
          after[idx] = Object.assign({}, after[idx], { opacity: origOpacity });
          node[paintKey] = after;
          var check = node[paintKey][idx];
          opacityKept = Math.abs((typeof check.opacity === "number" ? check.opacity : 1) - origOpacity) < 0.001
            && !!(check.boundVariables && check.boundVariables.color);
        }
        var rec = { nodeId: id, name: node.name, type: node.type };
        if (origOpacity !== 1) { rec.opacity = origOpacity; rec.opacityKept = opacityKept; }
        bound.push(rec);
      } else {
        var already = fields.every(function (fl) {
          return node.boundVariables && node.boundVariables[fl];
        });
        if (already) {
          skipped.push({ nodeId: id, name: node.name, reason: "already bound" });
          continue;
        }
        if (dryRun) {
          bound.push({ nodeId: id, name: node.name, type: node.type, dryRun: true });
          continue;
        }
        for (var g = 0; g < fields.length; g++) {
          node.setBoundVariable(fields[g], variable);
        }
        bound.push({ nodeId: id, name: node.name, type: node.type });
      }
    } catch (e) {
      failed.push({ nodeId: id, name: node.name, reason: errMsg(e) });
    }
  }

  return {
    property: property,
    fields: isPaint ? [property + "[].color"] : fields,
    variable: { id: variable.id, key: variable.key, name: variable.name, type: variable.resolvedType },
    dryRun: dryRun,
    requested: nodeIds.length,
    boundCount: bound.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    bound: bound,
    skipped: skipped,
    failed: failed,
  };
}

// ── E-21: unbind_variable ───────────────────────────────────────────────────
// bind_variable 의 반대. 노드 여러 개의 한 속성에서 변수 바인딩을 떼어낸다.
// fills(색) 는 아직 안 받는다 — 필요해지면 그때 넣는다.
// 값은 그대로 남는다(해제 시점의 해석값이 raw 로 굳는다) — 렌더는 바뀌지 않는다.
// ★ strokeWeight 는 네 변이 따로 바인딩돼 있을 수 있어 per-side 필드까지 함께 훑는다.
//   (2026-09-07 Button 계열 27건이 정확히 이 경우였다: strokeTop/Bottom/Left/RightWeight)
var UNBIND_FIELDS = Object.assign({}, BIND_FIELDS, {
  strokeWeight: [
    "strokeWeight",
    "strokeTopWeight",
    "strokeBottomWeight",
    "strokeLeftWeight",
    "strokeRightWeight",
  ],
  // 네 변을 한 번에. 문서 프레임 청소처럼 "패딩 전부"가 대상일 때 스캔을 4번 안 돌아도 된다
  padding: ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom"],
});

// 문서 프레임 판정: 자신이 컴포넌트가 아니고, 조상에도 컴포넌트가 없는 노드.
// ⚠️ nearestComponent 는 node.parent 부터 보므로 COMPONENT_SET 자신도 null 이 나온다 — 타입을 따로 걸러야 한다.
function isOutsideComponent(node) {
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET" || node.type === "INSTANCE") return false;
  return nearestComponent(node).component === null;
}

async function unbindVariable(params) {
  params = params || {};
  var nodeIds = params.nodeIds;
  var property = params.property;
  var dryRun = params.dryRun === true;

  var props = params.properties && params.properties.length ? params.properties : (property ? [property] : null);
  if (!props) throw new Error("Missing property (or properties) parameter");
  for (var pi = 0; pi < props.length; pi++) {
    if (!UNBIND_FIELDS[props[pi]]) {
      throw new Error(
        "Unsupported property: " + props[pi] + ". Supported: " + Object.keys(UNBIND_FIELDS).join(", ")
      );
    }
  }
  var fields = [];
  for (var pj = 0; pj < props.length; pj++) {
    var fl2 = UNBIND_FIELDS[props[pj]];
    for (var fk = 0; fk < fl2.length; fk++) if (fields.indexOf(fl2[fk]) === -1) fields.push(fl2[fk]);
  }

  var explicit = nodeIds && Array.isArray(nodeIds) && nodeIds.length > 0;
  var scoped = params.pageName || params.nodeId || params.onlyOutsideComponents;
  if (!explicit && !scoped) {
    throw new Error("Missing scope: pass nodeIds, or pageName/nodeId (optionally with onlyOutsideComponents)");
  }
  // 캐시는 스코프 스윕 때문에 있다. 명시 nodeIds 27건이면 없어도 그만이지만,
  // 문서 프레임 전수 스윕은 16,000번 넘게 부르고 그러면 120초를 넘긴다(2026-09-07 실측).
  var nameCache = {};
  async function variableLabel(id) {
    if (!id) return null;
    if (nameCache[id] !== undefined) return nameCache[id];
    var label = id;
    try {
      var v = await figma.variables.getVariableByIdAsync(id);
      if (v) label = v.name;
    } catch (e) { /* 지워진 변수면 id 그대로 둔다 */ }
    nameCache[id] = label;
    return label;
  }

  var unbound = [];
  var skipped = [];
  var failed = [];
  var onlyOutside = params.onlyOutsideComponents === true;

  // 대상 수집 — 명시 id 이거나, 스코프 순회로 "실제로 묶여 있는 노드"만 골라낸다
  var queue = [];
  if (explicit) {
    for (var i = 0; i < nodeIds.length; i++) {
      var nd;
      try {
        nd = await figma.getNodeByIdAsync(nodeIds[i]);
      } catch (e) {
        failed.push({ nodeId: nodeIds[i], reason: errMsg(e) });
        continue;
      }
      if (!nd) { failed.push({ nodeId: nodeIds[i], reason: "Node not found" }); continue; }
      queue.push(nd);
    }
  } else {
    var targets = await resolveScanTargets(params);
    for (var ti = 0; ti < targets.length; ti++) {
      var stack = [targets[ti].node];
      while (stack.length) {
        var cur = stack.pop();
        // 컴포넌트 안은 통째로 건너뛴다 — 대상이 아니고, 안 내려가면 스캔도 훨씬 가볍다
        var isComp = cur.type === "COMPONENT" || cur.type === "COMPONENT_SET" || cur.type === "INSTANCE";
        if (onlyOutside && isComp) continue;
        if (cur.type !== "PAGE" && (!onlyOutside || isOutsideComponent(cur))) {
          if (typeof cur.setBoundVariable === "function") queue.push(cur);
        }
        if (cur.children) for (var ci = 0; ci < cur.children.length; ci++) stack.push(cur.children[ci]);
      }
    }
  }

  for (var i = 0; i < queue.length; i++) {
    var node = queue[i];
    var id = node.id;
    if (typeof node.setBoundVariable !== "function") {
      failed.push({ nodeId: id, name: node.name, reason: "Node type " + node.type + " cannot bind variables" });
      continue;
    }

    try {
      var hit = [];
      var wasNames = [];
      for (var g = 0; g < fields.length; g++) {
        var fl = fields[g];
        if (node.boundVariables && node.boundVariables[fl]) {
          hit.push(fl);
          // 변마다 다른 변수에 묶일 수 있다(top 만 x_5 등) — 첫 것만 보고하면 틀린다
          var nm = await variableLabel(node.boundVariables[fl].id);
          if (wasNames.indexOf(nm) === -1) wasNames.push(nm);
        }
      }
      if (hit.length === 0) {
        // 스코프 순회는 후보가 수천 개라 안 묶인 건 조용히 넘긴다. 명시 호출일 때만 보고한다
        if (explicit) skipped.push({ nodeId: id, name: node.name, reason: "not bound" });
        continue;
      }
      if (dryRun) {
        unbound.push({ nodeId: id, name: node.name, type: node.type, page: pageNameOf(node), cleared: hit, variable: wasNames.join(", "), dryRun: true });
        continue;
      }
      for (var h = 0; h < hit.length; h++) {
        node.setBoundVariable(hit[h], null);
      }
      unbound.push({ nodeId: id, name: node.name, type: node.type, page: pageNameOf(node), cleared: hit, variable: wasNames.join(", ") });
    } catch (e) {
      failed.push({ nodeId: id, name: node.name, reason: errMsg(e) });
    }
  }

  var byPage = {};
  var byVariable = {};
  for (var ui = 0; ui < unbound.length; ui++) {
    var u = unbound[ui];
    byPage[u.page || "?"] = (byPage[u.page || "?"] || 0) + 1;
    byVariable[u.variable] = (byVariable[u.variable] || 0) + 1;
  }

  return {
    properties: props,
    fieldsScanned: fields,
    scope: explicit ? "nodeIds" : (params.nodeId || params.pageName || "whole file"),
    onlyOutsideComponents: onlyOutside,
    dryRun: dryRun,
    candidates: queue.length,
    unboundCount: unbound.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    byPage: byPage,
    byVariable: byVariable,
    // 작은 작업은 무엇을 건드렸는지 목록으로 남긴다(감사용). 스윕은 5,000건이 넘어
    // 응답이 1MB 를 넘으므로 롤업만 준다 — 목록이 필요하면 dryRun 을 보면 된다.
    unbound: dryRun || unbound.length <= 200 ? unbound : undefined,
    skipped: skipped,
    failed: failed,
  };
}

// ── E-22: get_component_properties ──────────────────────────────────────────
// componentPropertyDefinitions 를 읽는 유일한 커맨드.
// get_local_components 는 variantProperties(변이 축)만 주고 BOOLEAN·TEXT·INSTANCE_SWAP 은 안 준다.
// 범위: nodeIds(명시) 또는 pageName(그 페이지의 최상위 컴포넌트 전부). 둘 중 하나는 필수.
// ⚠️ 변이 COMPONENT(부모가 COMPONENT_SET)는 자신의 정의를 갖지 않는다 — 세트가 갖는다. 그래서 건너뛴다.
async function getComponentProperties(params) {
  params = params || {};
  var targets = [];

  var failed = [];

  if (params.nodeIds && Array.isArray(params.nodeIds) && params.nodeIds.length) {
    for (var i = 0; i < params.nodeIds.length; i++) {
      var n = await figma.getNodeByIdAsync(params.nodeIds[i]);
      if (n) targets.push(n);
      else failed.push({ nodeId: params.nodeIds[i], reason: "Node not found" });
    }
  } else if (params.pageName) {
    await figma.loadAllPagesAsync();
    var page = figma.root.children.filter(function (p) { return p.name === params.pageName; })[0];
    if (!page) throw new Error("Page not found: " + params.pageName);
    var stack = page.children.slice();
    while (stack.length) {
      var node = stack.shift();
      if (node.type === "COMPONENT_SET") { targets.push(node); continue; } // 세트 안 변이는 안 내려간다
      if (node.type === "COMPONENT") { targets.push(node); continue; }
      if (node.children) stack = stack.concat(node.children);
    }
  } else {
    throw new Error("Missing scope: pass nodeIds or pageName");
  }

  var results = [];
  var summary = { VARIANT: 0, BOOLEAN: 0, TEXT: 0, INSTANCE_SWAP: 0 };
  var withNonVariant = 0;

  for (var j = 0; j < targets.length; j++) {
    var t = targets[j];
    if (t.type !== "COMPONENT" && t.type !== "COMPONENT_SET") {
      failed.push({ nodeId: t.id, name: t.name, reason: "Not a component: " + t.type });
      continue;
    }
    // 변이는 정의를 갖지 않는다
    if (t.type === "COMPONENT" && t.parent && t.parent.type === "COMPONENT_SET") continue;

    var defs;
    try {
      defs = t.componentPropertyDefinitions;
    } catch (e) {
      failed.push({ nodeId: t.id, name: t.name, reason: errMsg(e) });
      continue;
    }

    var props = {};
    var nonVariant = [];
    for (var key in defs) {
      if (!Object.prototype.hasOwnProperty.call(defs, key)) continue;
      var d = defs[key];
      var entry = { type: d.type, defaultValue: d.defaultValue };
      if (d.variantOptions) entry.variantOptions = d.variantOptions;
      if (d.preferredValues) entry.preferredValues = d.preferredValues;
      props[key] = entry;
      summary[d.type] = (summary[d.type] || 0) + 1;
      if (d.type !== "VARIANT") nonVariant.push(key);
    }
    if (nonVariant.length) withNonVariant++;

    results.push({
      id: t.id,
      name: t.name,
      type: t.type,
      page: (function (n) { while (n && n.type !== "PAGE") n = n.parent; return n ? n.name : null; })(t),
      nonVariant: nonVariant,
      properties: props,
    });
  }

  return {
    scope: params.nodeIds ? "nodeIds" : ("page:" + params.pageName),
    scanned: results.length,
    withNonVariantProps: withNonVariant,
    byPropertyType: summary,
    failedCount: failed.length,
    components: results,
    failed: failed,
  };
}

// ---------------------------------------------------------------------------
// 컴포넌트 제작 보조 명령: 크기 제한, 표시 여부, fill 비우기, 컴포넌트 변환, 속성 추가
// ---------------------------------------------------------------------------

async function getNodesOrThrow(nodeIds) {
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw new Error("nodeIds must be a non-empty array");
  }
  const nodes = [];
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) throw new Error(`Node not found with ID: ${id}`);
    nodes.push(node);
  }
  return nodes;
}

// min/max width·height. null 을 주면 해제, 생략하면 그대로 둔다.
// 오토레이아웃 프레임이나 오토레이아웃 자식에서만 Figma 가 허용한다.
async function setSizeConstraints(params) {
  const { nodeIds } = params || {};
  const keys = ["minWidth", "maxWidth", "minHeight", "maxHeight"];
  const nodes = await getNodesOrThrow(nodeIds);
  const results = [];
  for (const node of nodes) {
    try {
      for (const key of keys) {
        if (params[key] === undefined) continue;
        if (!(key in node)) throw new Error(`Node type ${node.type} does not support ${key}`);
        node[key] = params[key];
      }
      const entry = { id: node.id, name: node.name, success: true };
      for (const key of keys) entry[key] = node[key];
      results.push(entry);
    } catch (error) {
      results.push({ id: node.id, name: node.name, success: false, error: errMsg(error) });
    }
  }
  return { updated: results.filter((r) => r.success).length, results };
}

async function setVisible(params) {
  const { nodeIds, visible } = params || {};
  if (typeof visible !== "boolean") throw new Error("visible must be a boolean");
  const nodes = await getNodesOrThrow(nodeIds);
  const results = [];
  for (const node of nodes) {
    try {
      node.visible = visible;
      results.push({ id: node.id, name: node.name, visible: node.visible, success: true });
    } catch (error) {
      results.push({ id: node.id, name: node.name, success: false, error: errMsg(error) });
    }
  }
  return { updated: results.filter((r) => r.success).length, results };
}

// 인스턴스의 컴포넌트 속성(variant/boolean/text/instance-swap) 현재 값을 읽는다.
// get_node_info 는 이 값을 걸러내므로, 중첩 인스턴스(button-group 등)의 variant 를
// 확인하려면 이 명령을 쓴다. 키의 "#id" 꼬리는 떼고 bare name 으로 돌려준다.
const bareProp = (key) => key.split("#")[0];

async function describeInstanceProps(node) {
  const main = await node.getMainComponentAsync();
  const owner = main && main.parent && main.parent.type === "COMPONENT_SET" ? main.parent : main;
  let defs = {};
  try {
    defs = (owner && owner.componentPropertyDefinitions) || {};
  } catch (e) {
    defs = {};
  }
  const props = {};
  for (const [key, p] of Object.entries(node.componentProperties)) {
    const entry = { type: p.type, value: p.value };
    const def = defs[key];
    if (def && def.variantOptions) entry.options = def.variantOptions;
    // 속성에 변수(토큰)가 걸려 있으면 value 는 그 변수의 해석값이다.
    const alias = p.boundVariables && p.boundVariables.value;
    if (alias) {
      const v = await figma.variables.getVariableByIdAsync(alias.id);
      entry.variable = { id: alias.id, name: v ? v.name : null };
    }
    props[bareProp(key)] = entry;
  }
  return { id: node.id, name: node.name, component: main ? main.name : null, properties: props };
}

async function getInstanceProperties(params) {
  const { nodeIds, nested = true } = params || {};
  const nodes = await getNodesOrThrow(nodeIds);
  const out = [];
  const walk = async (node, depth) => {
    if (node.type === "INSTANCE") {
      const info = await describeInstanceProps(node);
      info.depth = depth;
      out.push(info);
      if (!nested) return;
    }
    if ("children" in node) for (const c of node.children) await walk(c, node.type === "INSTANCE" ? depth + 1 : depth);
  };
  for (const node of nodes) await walk(node, 0);
  return { count: out.length, instances: out };
}

// 변수 모드(예: resolution 9-inch/11-inch) 진단. 노드와 직속 자식의 적용 모드, 크기/위치 필드에 걸린
// 토큰, 속성 토큰, constraints/positioning 을 읽는다. 모드를 바꿨을 때 무엇이 따라오고 무엇이 안 따라오는지 보는 용도.
async function describeModes(modes) {
  const out = {};
  for (const [collId, modeId] of Object.entries(modes || {})) {
    const coll = await figma.variables.getVariableCollectionByIdAsync(collId);
    const mode = coll && coll.modes.find((m) => m.modeId === modeId);
    out[coll ? coll.name : collId] = mode ? mode.name : modeId;
  }
  return out;
}

async function describeLayoutNode(node) {
  const info = {
    id: node.id, name: node.name, type: node.type,
    x: node.x, y: node.y, width: node.width, height: node.height,
  };
  if ("constraints" in node) info.constraints = node.constraints;
  if ("layoutPositioning" in node && node.layoutPositioning !== "AUTO") info.layoutPositioning = node.layoutPositioning;
  if ("layoutMode" in node && node.layoutMode !== "NONE") info.layoutMode = node.layoutMode;
  if ("layoutSizingHorizontal" in node) info.sizing = [node.layoutSizingHorizontal, node.layoutSizingVertical];
  const bound = {};
  for (const [field, a] of Object.entries(node.boundVariables || {})) {
    if (!a || Array.isArray(a) || !a.id) continue;
    const v = await figma.variables.getVariableByIdAsync(a.id);
    bound[field] = v ? v.name : a.id;
  }
  if (node.type === "INSTANCE") {
    for (const [key, p] of Object.entries(node.componentProperties)) {
      const a = p.boundVariables && p.boundVariables.value;
      if (!a) continue;
      const v = await figma.variables.getVariableByIdAsync(a.id);
      bound["prop:" + bareProp(key)] = (v ? v.name : a.id) + " → " + p.value;
    }
  }
  if (Object.keys(bound).length) info.tokens = bound;
  const explicit = await describeModes(node.explicitVariableModes);
  if (Object.keys(explicit).length) info.explicitModes = explicit;
  return info;
}

async function getVariableModes(params) {
  const { nodeId, children = true } = params || {};
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node not found with ID: ${nodeId}`);
  const out = await describeLayoutNode(node);
  out.resolvedModes = await describeModes(node.resolvedVariableModes);
  if (children && "children" in node) {
    out.children = [];
    for (const c of node.children) out.children.push(await describeLayoutNode(c));
  }
  return out;
}

// 한 컬렉션(예: resolution)이 어디서 쓰이는지 전수 조사한다. 두 갈래:
//  1) explicit: 모드를 직접 지정한 노드 (페이지 포함, 깊이 무관)
//  2) bindings: 그 컬렉션의 변수가 필드/속성에 묶인 노드
// get_variable_modes 는 노드+직속 자식만 보므로 깊은 곳의 모드 지정을 놓친다.
// 컬렉션 이름을 못 읽는 경우(삭제·비활성 라이브러리)는 id 그대로 남기고 unresolved 로 표시한다.
async function findModeUsage(params) {
  params = params || {};
  var commandId = params.commandId || generateCommandId();
  var filter = params.collection ? String(params.collection).toLowerCase() : null;
  var limit = typeof params.limit === "number" ? params.limit : 300;
  var includeBindings = params.includeBindings !== false;

  var root;
  if (params.nodeId) {
    root = await figma.getNodeByIdAsync(params.nodeId);
    if (!root) throw new Error("Node not found with ID: " + params.nodeId);
  } else if (params.pageName) {
    await figma.loadAllPagesAsync();
    root = figma.root.children.find(function (p) { return p.name === params.pageName; });
    if (!root) throw new Error("Page not found: " + params.pageName);
  } else {
    root = figma.currentPage;
  }
  if (root.type === "PAGE") await root.loadAsync();

  var collCache = {};
  async function coll(id) {
    if (!(id in collCache)) {
      var c = null;
      try { c = await figma.variables.getVariableCollectionByIdAsync(id); } catch (e) { c = null; }
      collCache[id] = c;
    }
    return collCache[id];
  }
  var varCache = {};
  async function variable(id) {
    if (!(id in varCache)) {
      var v = null;
      try { v = await figma.variables.getVariableByIdAsync(id); } catch (e) { v = null; }
      varCache[id] = v;
    }
    return varCache[id];
  }
  function matches(name, id) {
    if (!filter) return true;
    return (name && name.toLowerCase().indexOf(filter) !== -1) || id.toLowerCase().indexOf(filter) !== -1;
  }
  // 최상위 화면: 부모가 PAGE 또는 SECTION 인 가장 가까운 조상
  function screenOf(node) {
    if (node.type === "PAGE" || node.type === "DOCUMENT") return null;
    var n = node;
    while (n && n.parent && n.parent.type !== "PAGE" && n.parent.type !== "SECTION") n = n.parent;
    return n && n.type !== "PAGE" ? { id: n.id, name: n.name } : null;
  }
  function insideInstance(node) {
    for (var p = node.parent; p && p.type !== "PAGE"; p = p.parent) if (p.type === "INSTANCE") return true;
    return false;
  }

  var nodes = [root];
  if ("findAll" in root) nodes = nodes.concat(root.findAll());
  await sendProgressUpdate(commandId, "find_mode_usage", "started", 0, nodes.length, 0,
    "Scanning " + nodes.length + " node(s)...", null);

  var explicit = [];
  var explicitTotal = 0;
  var bindings = [];
  var bindingTotal = 0;
  var byVariable = {};
  var byScreen = {};
  var collectionsSeen = {};

  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    if (i > 0 && i % 2000 === 0) {
      await sendProgressUpdate(commandId, "find_mode_usage", "in_progress",
        Math.round((i / nodes.length) * 100), nodes.length, i, "Scanned " + i + " node(s)", null);
    }

    var modes = node.explicitVariableModes || {};
    var hit = {};
    for (var collId in modes) {
      var c = await coll(collId);
      var cname = c ? c.name : null;
      collectionsSeen[collId] = cname || "(unresolved)";
      if (!matches(cname, collId)) continue;
      var mode = c && c.modes.find(function (m) { return m.modeId === modes[collId]; });
      hit[cname || collId] = mode ? mode.name : modes[collId] + (c ? " (mode not found)" : " (unresolved collection)");
    }
    if (Object.keys(hit).length) {
      explicitTotal++;
      if (explicit.length < limit) {
        var sc = screenOf(node);
        explicit.push({ id: node.id, name: node.name, type: node.type, screen: sc ? sc.name : null,
          insideInstance: insideInstance(node), modes: hit });
      }
    }

    if (!includeBindings) continue;
    var fields = [];
    var bv = node.boundVariables || {};
    for (var field in bv) {
      var a = bv[field];
      var list = Array.isArray(a) ? a : [a];
      for (var k = 0; k < list.length; k++) if (list[k] && list[k].id) fields.push({ field: field, id: list[k].id });
    }
    if (node.type === "INSTANCE") {
      try {
        var props = node.componentProperties || {};
        for (var key in props) {
          var pa = props[key].boundVariables && props[key].boundVariables.value;
          if (pa && pa.id) fields.push({ field: "prop:" + key.split("#")[0], id: pa.id });
        }
      } catch (e) { /* 깨진 인스턴스는 건너뛴다 */ }
    }
    var nodeHits = [];
    for (var f = 0; f < fields.length; f++) {
      var v = await variable(fields[f].id);
      if (!v) continue;
      var vc = await coll(v.variableCollectionId);
      var vcName = vc ? vc.name : null;
      collectionsSeen[v.variableCollectionId] = vcName || "(unresolved)";
      if (!matches(vcName, v.variableCollectionId)) continue;
      nodeHits.push(fields[f].field + " = " + v.name);
      var vkey = (vcName || v.variableCollectionId) + " / " + v.name;
      byVariable[vkey] = (byVariable[vkey] || 0) + 1;
    }
    if (nodeHits.length) {
      bindingTotal++;
      var s = screenOf(node);
      var sname = s ? s.name : "(page)";
      byScreen[sname] = (byScreen[sname] || 0) + 1;
      if (bindings.length < limit) {
        bindings.push({ id: node.id, name: node.name, type: node.type, screen: s ? s.name : null,
          insideInstance: insideInstance(node), uses: nodeHits });
      }
    }
  }

  await sendProgressUpdate(commandId, "find_mode_usage", "completed", 100, nodes.length, nodes.length,
    "Done", null);

  // 같은 이름의 컬렉션이 여러 라이브러리에서 올 수 있다 — key 로 라이브러리 이름을 붙인다.
  var libByKey = {};
  try {
    var libColls = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    for (var li = 0; li < libColls.length; li++) libByKey[libColls[li].key] = libColls[li].libraryName;
  } catch (e) { /* teamlibrary 권한 없음 */ }
  var collections = {};
  for (var cid in collectionsSeen) {
    var cobj = collCache[cid];
    collections[cid] = {
      name: cobj ? cobj.name : "(unresolved)",
      remote: cobj ? !!cobj.remote : null,
      library: cobj && cobj.remote ? (libByKey[cobj.key] || "(library not enabled)") : (cobj ? "(local)" : null),
    };
  }

  return {
    scope: { id: root.id, name: root.name, type: root.type },
    filter: params.collection || null,
    scannedNodes: nodes.length,
    collectionsSeen: collections,
    explicitTotal: explicitTotal,
    explicit: explicit,
    bindingTotal: includeBindings ? bindingTotal : null,
    byVariable: byVariable,
    byScreen: byScreen,
    bindings: bindings,
  };
}

// 노드의 변수 모드를 바꾼다 (오른쪽 패널의 모드 선택과 같음). collection/mode 는 이름.
// 컬렉션은 노드에 적용 중인 것(resolvedVariableModes) → 로컬 컬렉션 순으로 찾는다.
async function setVariableMode(params) {
  const { nodeId, collection, mode } = params || {};
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node not found with ID: ${nodeId}`);
  if (typeof node.setExplicitVariableModeForCollection !== "function") {
    throw new Error(`Node type ${node.type} cannot have variable modes`);
  }
  let coll = null;
  for (const collId of Object.keys(node.resolvedVariableModes || {})) {
    const c = await figma.variables.getVariableCollectionByIdAsync(collId);
    if (c && c.name === collection) { coll = c; break; }
  }
  if (!coll) {
    const locals = await figma.variables.getLocalVariableCollectionsAsync();
    coll = locals.find((c) => c.name === collection) || null;
  }
  if (!coll) throw new Error(`Collection "${collection}" not found on node or locally`);
  const m = coll.modes.find((x) => x.name === mode);
  if (!m) throw new Error(`Mode "${mode}" not in "${coll.name}" (has: ${coll.modes.map((x) => x.name).join(", ")})`);
  const before = await describeModes(node.resolvedVariableModes);
  node.setExplicitVariableModeForCollection(coll, m.modeId);
  const after = await describeModes(node.resolvedVariableModes);
  return { id: node.id, name: node.name, collection: coll.name, before: before[coll.name], after: after[coll.name] };
}

// { variableId } | { variableKey } | { variableName } 를 Variable 로 바꾼다.
// 이름은 로컬 변수 → 활성화된 라이브러리 순으로 찾는다. 같은 이름을 여러 번 찾지 않게 캐시한다.
const variableRefCache = new Map();
async function resolveVariableRef(ref) {
  const cacheKey = JSON.stringify(ref);
  if (variableRefCache.has(cacheKey)) return variableRefCache.get(cacheKey);
  let variable = null;
  if (ref.variableId) {
    variable = await figma.variables.getVariableByIdAsync(ref.variableId);
  } else if (ref.variableKey) {
    variable = await figma.variables.importVariableByKeyAsync(ref.variableKey);
  } else if (ref.variableName) {
    const locals = await figma.variables.getLocalVariablesAsync();
    const local = locals.filter((v) => v.name === ref.variableName);
    if (local.length === 1) variable = local[0];
    else if (local.length > 1) throw new Error(`Ambiguous local variable "${ref.variableName}", pass variableId`);
    else {
      const matches = [];
      for (const coll of await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()) {
        for (const lv of await figma.teamLibrary.getVariablesInLibraryCollectionAsync(coll.key)) {
          if (lv.name === ref.variableName) matches.push({ key: lv.key, collection: coll.name, library: coll.libraryName });
        }
      }
      if (matches.length > 1) throw new Error(`Ambiguous variableName, pass variableKey: ${JSON.stringify(matches)}`);
      if (matches.length === 1) variable = await figma.variables.importVariableByKeyAsync(matches[0].key);
    }
  } else {
    throw new Error("Variable ref needs variableId, variableKey or variableName");
  }
  if (!variable) throw new Error(`Variable not found: ${cacheKey}`);
  variableRefCache.set(cacheKey, variable);
  return variable;
}

// 인스턴스 속성 값을 바꾼다. properties 의 키는 bare name("size")이나 전체 키 모두 된다.
// 값으로 { variableName | variableId | variableKey } 를 주면 그 변수(토큰)를 속성에 건다.
async function setInstanceProperties(params) {
  const { updates } = params || {};
  if (!Array.isArray(updates) || updates.length === 0) throw new Error("Missing updates");
  const results = [];
  for (const { nodeId, properties } of updates) {
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error(`Node not found with ID: ${nodeId}`);
      if (node.type !== "INSTANCE") throw new Error(`Node ${nodeId} is ${node.type}, not INSTANCE`);
      const keys = Object.keys(node.componentProperties);
      const boundId = (k) => {
        const a = node.componentProperties[k].boundVariables;
        return a && a.value ? a.value.id : null;
      };
      const describe = async (k) => {
        const id = boundId(k);
        if (!id) return node.componentProperties[k].value;
        const v = await figma.variables.getVariableByIdAsync(id);
        return { value: node.componentProperties[k].value, variable: v ? v.name : id };
      };
      const diff = {};
      const before = {};
      for (const [name, value] of Object.entries(properties || {})) {
        const key = keys.find((k) => k === name) || keys.find((k) => bareProp(k) === name);
        if (!key) throw new Error(`Property "${name}" not found (has: ${keys.map(bareProp).join(", ")})`);
        before[bareProp(key)] = await describe(key);
        if (value && typeof value === "object") {
          const variable = await resolveVariableRef(value);
          if (boundId(key) !== variable.id) diff[key] = figma.variables.createVariableAlias(variable);
        } else if (boundId(key) || node.componentProperties[key].value !== value) {
          // 토큰이 걸린 속성에 일반 값을 주면 토큰이 풀리고 그 값이 들어간다.
          diff[key] = value;
        }
      }
      if (Object.keys(diff).length) node.setProperties(diff);
      const after = {};
      for (const k of Object.keys(diff)) after[bareProp(k)] = await describe(k);
      results.push({ id: nodeId, name: node.name, before, after, changed: Object.keys(diff).length, success: true });
    } catch (error) {
      results.push({ id: nodeId, success: false, error: errMsg(error) });
    }
  }
  return { updated: results.filter((r) => r.success && r.changed).length, results };
}

// set_fill_color 에 a=0 을 주면 투명 fill 이 남는다. 레이어 패널에서 fill 을
// 지운 것과 같은 상태(fills = [])를 만든다.
async function clearFills(params) {
  const nodes = await getNodesOrThrow((params || {}).nodeIds);
  const results = [];
  for (const node of nodes) {
    try {
      if (!("fills" in node)) throw new Error(`Node type ${node.type} has no fills`);
      node.fills = [];
      results.push({ id: node.id, name: node.name, success: true });
    } catch (error) {
      results.push({ id: node.id, name: node.name, success: false, error: errMsg(error) });
    }
  }
  return { updated: results.filter((r) => r.success).length, results };
}

// 프레임을 그 자리에서 컴포넌트로 바꾼다 (⌘⌥K 와 동일). 새 노드 ID 가 생긴다.
async function createComponentFromNode(params) {
  const { nodeId } = params || {};
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node not found with ID: ${nodeId}`);
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    throw new Error(`Node ${nodeId} is already a ${node.type}`);
  }
  const component = figma.createComponentFromNode(node);
  return {
    id: component.id,
    name: component.name,
    key: component.key,
    previousId: nodeId,
  };
}

// BOOLEAN/TEXT 컴포넌트 속성을 추가하고 하위 레이어에 연결한다.
// BOOLEAN → 레이어 visible, TEXT → 텍스트 characters.
async function addComponentProperty(params) {
  const { componentId, name, type, defaultValue, bindNodeIds } = params || {};
  let target = await figma.getNodeByIdAsync(componentId);
  if (!target) throw new Error(`Node not found with ID: ${componentId}`);
  // variant 하나를 넘겨도 속성은 세트에 정의된다
  if (target.type === "COMPONENT" && target.parent && target.parent.type === "COMPONENT_SET") {
    target = target.parent;
  }
  if (target.type !== "COMPONENT" && target.type !== "COMPONENT_SET") {
    throw new Error(`Node ${componentId} is ${target.type}, not a component`);
  }
  if (type !== "BOOLEAN" && type !== "TEXT") {
    throw new Error("type must be BOOLEAN or TEXT");
  }
  if (type === "BOOLEAN" && typeof defaultValue !== "boolean") {
    throw new Error("BOOLEAN property needs a boolean defaultValue");
  }
  if (type === "TEXT" && typeof defaultValue !== "string") {
    throw new Error("TEXT property needs a string defaultValue");
  }

  const propertyKey = target.addComponentProperty(name, type, defaultValue);
  const field = type === "BOOLEAN" ? "visible" : "characters";

  const bound = [];
  const failed = [];
  for (const id of bindNodeIds || []) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) {
      failed.push({ id, error: "not found" });
      continue;
    }
    try {
      if (type === "TEXT" && node.type !== "TEXT") {
        throw new Error(`TEXT property can only bind TEXT nodes, got ${node.type}`);
      }
      node.componentPropertyReferences = Object.assign(
        {},
        node.componentPropertyReferences || {},
        { [field]: propertyKey }
      );
      bound.push({ id: node.id, name: node.name });
    } catch (error) {
      failed.push({ id, name: node.name, error: errMsg(error) });
    }
  }

  return { componentId: target.id, propertyKey, type, field, bound, failed };
}

// E-28: 변이 아닌 컴포넌트 속성(BOOLEAN·TEXT·INSTANCE_SWAP)의 기본값을 바꾸거나 속성을 지운다.
// property 는 맨이름("Show-Label") 또는 전체 키("Show-Label#612:58").
// INSTANCE_SWAP 기본값은 컴포넌트 id(변이 COMPONENT 포함). VARIANT 기본값은 API 로 못 바꾼다(세트 안 변이 위치로 정해짐).
// delete 는 연결돼 있던 레이어를 같이 보고한다 — 연결이 풀린 레이어는 마지막 값 그대로 남는다.
async function editComponentPropertyCmd(params) {
  const { componentId, property, defaultValue, remove, dryRun } = params || {};
  let target = await figma.getNodeByIdAsync(componentId);
  if (!target) throw new Error(`Node not found with ID: ${componentId}`);
  if (target.type === "COMPONENT" && target.parent && target.parent.type === "COMPONENT_SET") {
    target = target.parent;
  }
  if (target.type !== "COMPONENT" && target.type !== "COMPONENT_SET") {
    throw new Error(`Node ${componentId} is ${target.type}, not a component`);
  }
  const defs = target.componentPropertyDefinitions || {};
  const keys = Object.keys(defs);
  let key = keys.find((k) => k === property);
  if (!key) {
    const hits = keys.filter((k) => k.split("#")[0] === property);
    if (hits.length > 1) throw new Error(`Ambiguous property "${property}": ${hits.join(", ")}`);
    key = hits[0];
  }
  if (!key) throw new Error(`Property "${property}" not found. Have: ${keys.join(", ")}`);
  const def = defs[key];
  if (def.type === "VARIANT") {
    throw new Error("VARIANT default cannot be edited via API (it follows variant position in the set)");
  }

  // 이 속성에 연결된 레이어
  const boundLayers = [];
  const roots = target.type === "COMPONENT_SET" ? target.children : [target];
  for (const root of roots) {
    const all = [root].concat(root.findAll ? root.findAll(() => true) : []);
    for (const n of all) {
      const refs = n.componentPropertyReferences;
      if (!refs) continue;
      for (const field of Object.keys(refs)) {
        if (refs[field] === key) {
          boundLayers.push({ id: n.id, name: n.name, field, variant: root.name, visible: n.visible });
        }
      }
    }
  }

  const before = { type: def.type, defaultValue: def.defaultValue };
  if (remove) {
    if (!dryRun) target.deleteComponentProperty(key);
    return { componentId: target.id, key, action: "delete", dryRun: !!dryRun, before, boundLayers };
  }
  if (defaultValue === undefined) throw new Error("Pass defaultValue or remove:true");
  let value = defaultValue;
  if (def.type === "BOOLEAN" && typeof value !== "boolean") throw new Error("BOOLEAN needs a boolean defaultValue");
  if (def.type === "TEXT" && typeof value !== "string") throw new Error("TEXT needs a string defaultValue");
  if (def.type === "INSTANCE_SWAP") {
    const comp = await figma.getNodeByIdAsync(String(value));
    if (!comp || comp.type !== "COMPONENT") throw new Error(`INSTANCE_SWAP defaultValue must be a COMPONENT id, got ${value}`);
    value = comp.id;
  }
  if (!dryRun) target.editComponentProperty(key, { defaultValue: value });
  const after = dryRun ? null : { defaultValue: (target.componentPropertyDefinitions[key] || {}).defaultValue };
  return { componentId: target.id, key, action: "edit", dryRun: !!dryRun, before, after, boundLayers };
}

// E-29: 범위 안 바인딩 중 sourceCollection(로컬·원격 모두, 컬렉션 "이름"으로 판정) 소속을 다시 묶는다.
//  - 대상 찾기 matchBy:
//    "alias"(기본) — 그 변수가 mode 에서 가리키는 별칭(다른 컬렉션이 나올 때까지). mode "auto" = 노드가 렌더되던 모드.
//                    원격 변수는 같은 컬렉션 이름·같은 변수 이름의 로컬 변수로 먼저 바꿔 읽는다.
//    "value"        — targetCollection 의 로컬 변수 중 노드에서 같은 값으로 풀리는 것(숫자는 이름 그룹 Spacing/Radius/Stroke 로 좁힘). 옛 라이브러리 → 로컬.
//  - 속성: fills·strokes(SOLID, 혼합 서식 TEXT 는 구간별), 숫자(itemSpacing·counterAxisSpacing·padding·radius·strokeWeight).
//  - 기본은 인스턴스·컴포넌트 안쪽을 건너뛴다(includeInstances:true 로 포함).
async function replaceVariableBindings(params) {
  params = params || {};
  var sourceCollection = params.sourceCollection;
  var modeName = params.mode || "auto";
  var matchBy = params.matchBy || "alias";
  var targetCollection = params.targetCollection;
  var dryRun = params.dryRun === true;
  var includeInstances = params.includeInstances === true;
  if (!sourceCollection) throw new Error("sourceCollection is required");
  if (matchBy === "value" && !targetCollection) throw new Error("matchBy value needs targetCollection");

  var root;
  if (params.nodeId) {
    root = await figma.getNodeByIdAsync(params.nodeId);
    if (!root) throw new Error("Node not found: " + params.nodeId);
  } else if (params.pageName) {
    root = figma.root.children.find(function (p) { return p.name === params.pageName; });
    if (!root) throw new Error("Page not found: " + params.pageName);
    await root.loadAsync();
  } else {
    throw new Error("nodeId or pageName is required");
  }

  var collections = await figma.variables.getLocalVariableCollectionsAsync();
  var collById = {};
  for (var c = 0; c < collections.length; c++) collById[collections[c].id] = collections[c];
  var localVars = await figma.variables.getLocalVariablesAsync();
  var localByKey = {}; // "컬렉션이름|변수이름" -> var
  for (var lv = 0; lv < localVars.length; lv++) {
    var lc = collById[localVars[lv].variableCollectionId];
    if (lc) localByKey[lc.name + "|" + localVars[lv].name] = localVars[lv];
  }
  var varCache = {};
  async function getVar(id) {
    if (!(id in varCache)) { try { varCache[id] = await figma.variables.getVariableByIdAsync(id); } catch (e) { varCache[id] = null; } }
    return varCache[id];
  }
  var remoteCollName = {};
  async function collName(v) {
    if (collById[v.variableCollectionId]) return collById[v.variableCollectionId].name;
    if (!(v.variableCollectionId in remoteCollName)) {
      var n = null;
      try { var rc = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId); n = rc ? rc.name : null; } catch (e) {}
      remoteCollName[v.variableCollectionId] = n;
    }
    return remoteCollName[v.variableCollectionId];
  }

  var usedModes = {};
  async function resolveAlias(v, node) {
    var cur = v;
    for (var hop = 0; hop < 6; hop++) {
      var coll = collById[cur.variableCollectionId];
      if (!coll) {
        var nm = await collName(cur);
        var loc = nm ? localByKey[nm + "|" + cur.name] : null;
        if (!loc) return { error: "remote " + (nm || "?") + " / " + cur.name + " has no local twin" };
        cur = loc; coll = collById[cur.variableCollectionId];
      }
      if (coll.name !== sourceCollection) return { variable: cur };
      var mode = null;
      if (modeName === "auto") {
        var rm = node && node.resolvedVariableModes ? node.resolvedVariableModes[coll.id] : null;
        mode = rm ? coll.modes.find(function (m) { return m.modeId === rm; }) : null;
        if (!mode) mode = coll.modes.find(function (m) { return m.modeId === coll.defaultModeId; });
      } else {
        mode = coll.modes.find(function (m) { return m.name === modeName; }) || (coll.modes.length === 1 ? coll.modes[0] : null);
      }
      if (!mode) return { error: "mode " + modeName + " not in " + coll.name };
      usedModes[mode.name] = (usedModes[mode.name] || 0) + 1;
      var val = cur.valuesByMode[mode.modeId];
      if (!val || val.type !== "VARIABLE_ALIAS") return { error: "not an alias in " + mode.name };
      cur = await getVar(val.id);
      if (!cur) return { error: "alias target missing" };
    }
    return { error: "alias chain too deep" };
  }
  function sameValue(a, b) {
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.001;
    if (a && b && typeof a === "object") return ["r", "g", "b", "a"].every(function (k) { return Math.abs((a[k] || 0) - (b[k] || 0)) < 0.002; });
    return a === b;
  }
  async function resolveByValue(v, node, family) {
    var srcVal;
    try { srcVal = v.resolveForConsumer(node).value; } catch (e) { return { error: "cannot resolve source value" }; }
    var hits = [];
    for (var i = 0; i < localVars.length; i++) {
      var t = localVars[i];
      var tc = collById[t.variableCollectionId];
      if (!tc || tc.name !== targetCollection || t.resolvedType !== v.resolvedType) continue;
      if (family && t.name.split("/")[0] !== family) continue;
      var tv; try { tv = t.resolveForConsumer(node).value; } catch (e) { continue; }
      if (sameValue(srcVal, tv)) hits.push(t);
    }
    if (hits.length === 1) return { variable: hits[0] };
    if (hits.length === 0) return { error: "no " + targetCollection + (family ? "/" + family : "") + " var with value " + JSON.stringify(srcVal) };
    return { error: "ambiguous: " + hits.map(function (h) { return h.name; }).join(", ") };
  }
  async function findTarget(v, node, family) {
    return matchBy === "value" ? resolveByValue(v, node, family) : resolveAlias(v, node);
  }

  var NUM_FIELDS = {
    itemSpacing: "Spacing", counterAxisSpacing: "Spacing",
    paddingLeft: "Spacing", paddingRight: "Spacing", paddingTop: "Spacing", paddingBottom: "Spacing",
    topLeftRadius: "Radius", topRightRadius: "Radius", bottomLeftRadius: "Radius", bottomRightRadius: "Radius",
    strokeWeight: "Stroke", strokeTopWeight: "Stroke", strokeBottomWeight: "Stroke", strokeLeftWeight: "Stroke", strokeRightWeight: "Stroke",
  };

  var byMapping = {}, skippedInside = {}, unresolved = [], changed = {}, gradientBound = 0;
  function record(label, nodeId) {
    if (!byMapping[label]) byMapping[label] = { count: 0, nodeIds: [] };
    byMapping[label].count++;
    if (byMapping[label].nodeIds.length < 30) byMapping[label].nodeIds.push(nodeId);
  }
  function insideInstanceOrComponent(n) {
    var p = n.parent;
    while (p && p.type !== "PAGE" && p.type !== "DOCUMENT") {
      if (p.type === "INSTANCE" || p.type === "COMPONENT" || p.type === "COMPONENT_SET") return true;
      p = p.parent;
    }
    return n.type === "COMPONENT" || n.type === "COMPONENT_SET";
  }
  async function inSource(v) { var n = await collName(v); return n === sourceCollection; }
  async function processPaints(node, paints, where) {
    var next = paints.slice(), touched = false;
    for (var k = 0; k < paints.length; k++) {
      var paint = paints[k];
      if (paint.type !== "SOLID") {
        if (paint.gradientStops && paint.gradientStops.some(function (gs) { return gs.boundVariables && gs.boundVariables.color; })) gradientBound++;
        continue;
      }
      var b = paint.boundVariables && paint.boundVariables.color;
      if (!b) continue;
      var v = await getVar(b.id);
      if (!v || !(await inSource(v))) continue;
      if (!includeInstances && insideInstanceOrComponent(node)) { skippedInside[v.name] = (skippedInside[v.name] || 0) + 1; continue; }
      var t = await findTarget(v, node, null);
      if (t.error) { unresolved.push({ nodeId: node.id, name: node.name, where: where, variable: v.name, reason: t.error }); continue; }
      record(sourceCollection + " / " + v.name + (v.remote ? " (remote)" : "") + " -> " + collById[t.variable.variableCollectionId].name + " / " + t.variable.name + " [" + where.split(":")[0] + "]", node.id);
      next[k] = figma.variables.setBoundVariableForPaint(paint, "color", t.variable);
      touched = true;
    }
    return touched ? next : null;
  }

  var nodes = [root].concat(root.findAll ? root.findAll(function () { return true; }) : []);
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    // 색
    var props = ["fills", "strokes"];
    for (var pi = 0; pi < props.length; pi++) {
      var prop = props[pi];
      if (!(prop in node)) continue;
      var paints = node[prop];
      if (prop === "fills" && paints === figma.mixed && node.type === "TEXT") {
        var segs = node.getStyledTextSegments(["fills"]);
        for (var sg = 0; sg < segs.length; sg++) {
          var nx = await processPaints(node, segs[sg].fills, "textRange:" + segs[sg].start + "-" + segs[sg].end);
          if (nx && !dryRun) {
            try {
              await Promise.all(node.getRangeAllFontNames(segs[sg].start, segs[sg].end).map(function (f) { return figma.loadFontAsync(f); }));
              node.setRangeFills(segs[sg].start, segs[sg].end, nx); changed[node.id] = true;
            } catch (e) { unresolved.push({ nodeId: node.id, name: node.name, where: "textRange", reason: errMsg(e) }); }
          }
        }
        continue;
      }
      if (paints === figma.mixed || !Array.isArray(paints) || paints.length === 0) continue;
      var nxt = await processPaints(node, paints, prop);
      if (nxt && !dryRun) {
        try { node[prop] = nxt; changed[node.id] = true; }
        catch (e) { unresolved.push({ nodeId: node.id, name: node.name, where: prop, reason: errMsg(e) }); }
      }
    }
    // 숫자
    var bv = node.boundVariables || {};
    for (var field in NUM_FIELDS) {
      var ref = bv[field];
      if (!ref || Array.isArray(ref)) continue;
      var nv = await getVar(ref.id);
      if (!nv || !(await inSource(nv))) continue;
      if (!includeInstances && insideInstanceOrComponent(node)) { skippedInside[nv.name] = (skippedInside[nv.name] || 0) + 1; continue; }
      var tg = await findTarget(nv, node, NUM_FIELDS[field]);
      if (tg.error) { unresolved.push({ nodeId: node.id, name: node.name, where: field, variable: nv.name, reason: tg.error }); continue; }
      record(sourceCollection + " / " + nv.name + (nv.remote ? " (remote)" : "") + " -> " + collById[tg.variable.variableCollectionId].name + " / " + tg.variable.name + " [" + field + "]", node.id);
      if (!dryRun) {
        try { node.setBoundVariable(field, tg.variable); changed[node.id] = true; }
        catch (e) { unresolved.push({ nodeId: node.id, name: node.name, where: field, reason: errMsg(e) }); }
      }
    }
  }
  var total = 0;
  for (var key in byMapping) total += byMapping[key].count;
  return {
    root: root.id, sourceCollection: sourceCollection, matchBy: matchBy, mode: modeName, targetCollection: targetCollection || null, dryRun: dryRun,
    rebound: total, usedModes: usedModes, byMapping: byMapping, skippedInsideInstances: skippedInside,
    gradientStopsBoundSkipped: gradientBound, unresolved: unresolved.slice(0, 50), unresolvedCount: unresolved.length,
    changedNodes: dryRun ? 0 : Object.keys(changed).length,
  };
}

// 컴포넌트 여러 개를 하나의 컴포넌트 세트로 합친다 (Combine as variants).
// variant 이름은 각 컴포넌트 이름("type=table" 형식)에서 Figma 가 읽는다.
// 기존 인스턴스는 연결이 유지된다.
async function combineAsVariants(params) {
  const { componentIds, name } = params || {};
  const nodes = await getNodesOrThrow(componentIds);
  for (const node of nodes) {
    if (node.type !== "COMPONENT") {
      throw new Error(`Node ${node.id} is ${node.type}, not a COMPONENT`);
    }
    if (node.parent && node.parent.type === "COMPONENT_SET") {
      throw new Error(`Component ${node.id} is already a variant of ${node.parent.name}`);
    }
  }
  // 첫 컴포넌트가 있던 곳(페이지·섹션·프레임)에 세트를 둔다
  const parent = nodes[0].parent || figma.currentPage;
  const set = figma.combineAsVariants(nodes, parent);
  if (name) set.name = String(name);
  return {
    id: set.id,
    name: set.name,
    key: set.key,
    variants: set.children.map((c) => ({ id: c.id, name: c.name })),
    variantGroupProperties: set.variantGroupProperties,
  };
}

// E-30: 로컬 변수 이름을 한꺼번에 바꾼다. 변수는 id 로 묶이므로 이름을 바꿔도 바인딩·alias 는 그대로다.
// 대상은 variableId, 또는 collection(컬렉션 이름) + name(현재 이름)으로 집는다.
// 같은 컬렉션 안에서 이름이 겹치면(바꾼 뒤 기준) 그 항목은 쓰지 않고 errors 로 돌려준다.
// E-31: 텍스트 스타일이 없는 TEXT 노드에 같은 모양의 로컬 텍스트 스타일을 건다.
// 매칭 = fontSize + fontName(family/style) + lineHeight + letterSpacing. 후보가 여럿이면 prefer 순서로 고르고, 못 고르면 ambiguous 로 보고.
async function applyTextStyles(params) {
  params = params || {};
  var dryRun = params.dryRun === true;
  var includeInstances = params.includeInstances === true;
  var prefer = Array.isArray(params.prefer) ? params.prefer : [];
  var limit = typeof params.limit === "number" ? params.limit : 200;

  var styles = await figma.getLocalTextStylesAsync();
  var byName = {};
  styles.forEach(function (s) { byName[s.name] = s; });
  var restyleIds = {};
  var restyleFrom = Array.isArray(params.restyleFrom) ? params.restyleFrom : [];
  styles.forEach(function (s) {
    if (restyleFrom.some(function (r) { return r === "*" || s.name === r || s.name.indexOf(r) === 0; })) restyleIds[s.id] = true;
  });

  function num(v) { return Math.round(v * 100) / 100; }
  // % 와 px 가 섞여 저장되므로 px 로 환산해 비교한다.
  function lhKey(lh, size) {
    if (!lh || lh === figma.mixed) return "mixed";
    if (lh.unit === "AUTO") return "AUTO";
    var px = lh.unit === "PERCENT" ? lh.value * size / 100 : lh.value;
    return num(px) + "px";
  }
  function lsKey(ls, size) {
    if (!ls || ls === figma.mixed) return "mixed";
    var px = ls.unit === "PERCENT" ? ls.value * size / 100 : ls.value;
    return num(px) + "px";
  }
  function shapeKey(size, font, lh, ls) {
    return num(size) + "|" + font.family + "|" + font.style + "|" + lhKey(lh, size) + "|" + lsKey(ls, size);
  }
  var byShape = {};
  styles.forEach(function (s) {
    var k = shapeKey(s.fontSize, s.fontName, s.lineHeight, s.letterSpacing);
    (byShape[k] = byShape[k] || []).push(s);
  });

  // 대상 TEXT 노드 모으기
  var targets = [];
  if (Array.isArray(params.nodeIds) && params.nodeIds.length) {
    for (var i = 0; i < params.nodeIds.length; i++) {
      var n0 = await figma.getNodeByIdAsync(params.nodeIds[i]);
      if (n0) targets.push(n0);
    }
  } else {
    var root = null;
    if (params.nodeId) {
      root = await figma.getNodeByIdAsync(params.nodeId);
      if (!root) throw new Error("Node not found: " + params.nodeId);
    } else if (params.pageName) {
      root = figma.root.children.find(function (p) { return p.name === params.pageName; });
      if (!root) throw new Error("Page not found: " + params.pageName);
      await root.loadAsync();
    } else {
      throw new Error("Pass nodeIds, nodeId or pageName");
    }
    targets = root.type === "TEXT" ? [root] : root.findAllWithCriteria({ types: ["TEXT"] });
  }

  function insideInstance(node) {
    var p = node.parent;
    while (p) {
      if (p.type === "INSTANCE") return true;
      p = p.parent;
    }
    return false;
  }

  var applied = [], ambiguous = [], noMatch = [], failed = [];
  var skipped = { alreadyStyled: 0, insideInstance: 0 };
  var byStyle = {}, noMatchShapes = {};
  var segmentedCount = 0;

  // 후보 스타일 중 하나 고르기: 하나뿐이면 그것, 여럿이면 prefer 순서. 못 고르면 null.
  function pickFrom(cands) {
    if (cands.length === 1) return cands[0];
    for (var p = 0; p < prefer.length; p++) {
      var hit = cands.find(function (c) { return c.name === prefer[p]; });
      if (hit) return hit;
    }
    return null;
  }

  // 서식이 섞인 TEXT(링크·구간별 폰트·구간별 스타일): 서식이 같은 구간마다 스타일을 고른다.
  // 노드 전체가 풀릴 때만(모든 구간이 그대로 두거나 매칭) 적용 — 일부만 바꿔 두지 않는다.
  // 텍스트 스타일은 칠·링크를 건드리지 않으므로 구간 색·하이퍼링크는 그대로 남는다.
  async function styleBySegments(node) {
    var segs = node.getStyledTextSegments(["fontName", "fontSize", "lineHeight", "letterSpacing", "textStyleId"]);
    var plan = [], missShapes = [], ambShapes = [];
    for (var s = 0; s < segs.length; s++) {
      var seg = segs[s];
      if (seg.textStyleId && !restyleIds[seg.textStyleId]) continue; // 이미 다른 스타일 — 그대로
      var k = shapeKey(seg.fontSize, seg.fontName, seg.lineHeight, seg.letterSpacing);
      var cs = byShape[k] || [];
      var pk = pickFrom(cs);
      if (pk) plan.push({ start: seg.start, end: seg.end, style: pk });
      else if (cs.length > 1) ambShapes.push({ shape: k, candidates: cs.map(function (c) { return c.name; }) });
      else missShapes.push(k);
    }
    if (!plan.length && !missShapes.length && !ambShapes.length) { skipped.alreadyStyled++; return; }
    if (ambShapes.length) {
      if (ambiguous.length < limit) ambiguous.push({ id: node.id, name: node.name, segmented: true, shapes: ambShapes });
      return;
    }
    if (missShapes.length) {
      missShapes.forEach(function (k) { noMatchShapes[k] = (noMatchShapes[k] || 0) + 1; });
      if (noMatch.length < limit) noMatch.push({ id: node.id, name: node.name, segmented: true, shapes: missShapes, text: node.characters.slice(0, 30) });
      return;
    }
    if (!dryRun) {
      try {
        var len = node.characters.length;
        var fonts = len > 0 ? node.getRangeAllFontNames(0, len) : [];
        for (var f = 0; f < fonts.length; f++) await figma.loadFontAsync(fonts[f]);
        for (var q = 0; q < plan.length; q++) {
          await figma.loadFontAsync(plan[q].style.fontName);
          await node.setRangeTextStyleIdAsync(plan[q].start, plan[q].end, plan[q].style.id);
        }
      } catch (e) {
        failed.push({ id: node.id, name: node.name, reason: errMsg(e) });
        return;
      }
    }
    segmentedCount++;
    var names = {};
    plan.forEach(function (x) { names[x.style.name] = true; });
    Object.keys(names).forEach(function (nm) { byStyle[nm] = (byStyle[nm] || 0) + 1; });
    if (applied.length < limit) applied.push({ id: node.id, name: node.name, style: Object.keys(names).join(", "), segments: plan.length });
  }

  for (var t = 0; t < targets.length; t++) {
    var node = targets[t];
    if (node.type !== "TEXT") continue;
    var isMixed = node.textStyleId === figma.mixed || node.fontSize === figma.mixed || node.fontName === figma.mixed ||
      node.lineHeight === figma.mixed || node.letterSpacing === figma.mixed;
    if (!isMixed && node.textStyleId) {
      // restyleFrom: 이 스타일들에 묶인 노드는 다시 매칭한다(예: Body2/Bold → .Doc/Body2/Bold).
      var cur = restyleIds[node.textStyleId];
      if (!cur) { skipped.alreadyStyled++; continue; }
    }
    if (!includeInstances && insideInstance(node)) { skipped.insideInstance++; continue; }
    if (isMixed) { await styleBySegments(node); continue; }

    var key = shapeKey(node.fontSize, node.fontName, node.lineHeight, node.letterSpacing);
    var cands = byShape[key] || [];
    var pick = pickFrom(cands);
    if (!pick && cands.length > 1) {
      if (ambiguous.length < limit) ambiguous.push({ id: node.id, name: node.name, shape: key, candidates: cands.map(function (c) { return c.name; }) });
      continue;
    }
    if (!pick) {
      noMatchShapes[key] = (noMatchShapes[key] || 0) + 1;
      if (noMatch.length < limit) noMatch.push({ id: node.id, name: node.name, shape: key, text: node.characters.slice(0, 30) });
      continue;
    }
    byStyle[pick.name] = (byStyle[pick.name] || 0) + 1;
    if (!dryRun) {
      try {
        await figma.loadFontAsync(pick.fontName);
        await node.setTextStyleIdAsync(pick.id);
      } catch (e) {
        failed.push({ id: node.id, name: node.name, reason: errMsg(e) });
        byStyle[pick.name]--;
        continue;
      }
    }
    if (applied.length < limit) applied.push({ id: node.id, name: node.name, style: pick.name });
  }

  var appliedCount = Object.keys(byStyle).reduce(function (a, k) { return a + byStyle[k]; }, 0);
  return {
    dryRun: dryRun,
    scanned: targets.length,
    applied: appliedCount,
    byStyle: byStyle,
    segmented: segmentedCount, // 서식이 섞여 구간별로 스타일을 건 노드 수
    skipped: skipped,
    ambiguousCount: ambiguous.length,
    noMatchCount: Object.keys(noMatchShapes).reduce(function (a, k) { return a + noMatchShapes[k]; }, 0),
    noMatchShapes: noMatchShapes,
    failed: failed,
    ambiguous: ambiguous,
    noMatch: noMatch,
    appliedSample: applied.slice(0, 30),
  };
}

// E-32: 로컬 텍스트 스타일 만들기. copyFrom 이면 기존 스타일의 값과 변수 바인딩을 복사한 뒤 항목 값으로 덮는다.
// bind = { fontFamily|fontWeight|fontSize|lineHeight|letterSpacing|fontStyle: 변수 id 또는 variableCollection 안의 이름 }.
async function createTextStyles(params) {
  params = params || {};
  var items = params.items;
  var dryRun = params.dryRun === true;
  var update = params.update === true;
  if (!Array.isArray(items) || items.length === 0) throw new Error("Missing items");

  var styles = await figma.getLocalTextStylesAsync();
  var byName = {};
  styles.forEach(function (s) { byName[s.name] = s; });

  var collVars = {};
  if (params.variableCollection) {
    var colls = await figma.variables.getLocalVariableCollectionsAsync();
    var coll = colls.find(function (c) { return c.name === params.variableCollection; });
    if (!coll) throw new Error("Variable collection not found: " + params.variableCollection);
    var all = await figma.variables.getLocalVariablesAsync();
    all.forEach(function (v) { if (v.variableCollectionId === coll.id) collVars[v.name] = v; });
  }
  async function resolveVar(ref) {
    if (/^VariableID:/.test(ref)) return await figma.variables.getVariableByIdAsync(ref);
    return collVars[ref] || null;
  }

  var results = [], errors = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    try {
      if (!it.name) throw new Error("item without name");
      var existing = byName[it.name];
      if (existing && !update) { errors.push({ name: it.name, reason: "already exists (pass update:true to change it)" }); continue; }
      var src = null;
      if (it.copyFrom) {
        src = byName[it.copyFrom];
        if (!src) throw new Error("copyFrom style not found: " + it.copyFrom);
      }
      var font = {
        family: it.fontFamily || (src ? src.fontName.family : null),
        style: it.fontStyle || (src ? src.fontName.style : null),
      };
      if (!font.family || !font.style) throw new Error("fontFamily/fontStyle required (or copyFrom)");
      var size = typeof it.fontSize === "number" ? it.fontSize : (src ? src.fontSize : null);
      if (!size) throw new Error("fontSize required (or copyFrom)");
      var lh = it.lineHeight === "AUTO" ? { unit: "AUTO" }
        : typeof it.lineHeight === "number" ? { unit: "PIXELS", value: it.lineHeight }
        : (src ? src.lineHeight : { unit: "AUTO" });
      var ls = typeof it.letterSpacingPercent === "number" ? { unit: "PERCENT", value: it.letterSpacingPercent }
        : typeof it.letterSpacing === "number" ? { unit: "PIXELS", value: it.letterSpacing }
        : (src ? src.letterSpacing : { unit: "PIXELS", value: 0 });

      // 바인딩 목록: copyFrom 의 것 + 항목 bind
      var binds = {};
      if (src && src.boundVariables) {
        Object.keys(src.boundVariables).forEach(function (f) {
          var a = src.boundVariables[f];
          if (a && a.id) binds[f] = a.id;
        });
      }
      if (it.bind) Object.keys(it.bind).forEach(function (f) { binds[f] = it.bind[f]; });
      var resolved = {}, unresolved = [];
      for (var f in binds) {
        var v = await resolveVar(binds[f]);
        if (v) resolved[f] = v; else unresolved.push(f + "=" + binds[f]);
      }

      var out = {
        name: it.name, action: existing ? "update" : "create", copyFrom: it.copyFrom || null,
        fontName: font, fontSize: size, lineHeight: lh, letterSpacing: ls,
        bound: Object.keys(resolved).reduce(function (o, k) { o[k] = resolved[k].name; return o; }, {}),
        unresolved: unresolved,
      };
      if (!dryRun) {
        await figma.loadFontAsync(font);
        var s = existing || figma.createTextStyle();
        s.name = it.name;
        s.fontName = font;
        s.fontSize = size;
        s.lineHeight = lh;
        s.letterSpacing = ls;
        if (typeof it.description === "string") s.description = it.description;
        for (var k in resolved) s.setBoundVariable(k, resolved[k]);
        out.id = s.id;
        out.key = s.key;
      }
      results.push(out);
    } catch (e) {
      errors.push({ name: it && it.name, reason: errMsg(e) });
    }
  }
  return { dryRun: dryRun, requested: items.length, done: results.length, results: results, errors: errors };
}

// E-33: TEXT 노드의 글자 범위에 링크를 건다. 범위 = match(처음 나오는 부분 문자열) 또는 start/end, 없으면 전체.
// 대상 = targetNodeId(같은 파일 노드) 또는 url. remove:true 면 링크를 지운다.
async function setHyperlink(params) {
  params = params || {};
  var node = await figma.getNodeByIdAsync(params.nodeId);
  if (!node) throw new Error("Node not found: " + params.nodeId);
  if (node.type !== "TEXT") throw new Error("Not a TEXT node: " + node.type);
  var text = node.characters;
  var start = 0, end = text.length;
  if (typeof params.match === "string" && params.match.length) {
    var at = text.indexOf(params.match);
    if (at === -1) throw new Error("match not found in text: " + params.match);
    start = at; end = at + params.match.length;
  } else {
    if (typeof params.start === "number") start = params.start;
    if (typeof params.end === "number") end = params.end;
  }
  if (start < 0 || end > text.length || start >= end) throw new Error("Bad range " + start + "-" + end);

  var link = null;
  if (params.remove !== true) {
    if (params.targetNodeId) {
      var target = await figma.getNodeByIdAsync(params.targetNodeId);
      if (!target) throw new Error("Target node not found: " + params.targetNodeId);
      link = { type: "NODE", value: target.id };
    } else if (params.url) {
      link = { type: "URL", value: params.url };
    } else {
      throw new Error("Pass targetNodeId, url or remove:true");
    }
  }

  var fonts = node.getRangeAllFontNames(start, end);
  for (var i = 0; i < fonts.length; i++) await figma.loadFontAsync(fonts[i]);
  if (params.dryRun !== true) {
    node.setRangeHyperlink(start, end, link);
    if (params.underline === true) node.setRangeTextDecoration(start, end, "UNDERLINE");
  }
  return {
    dryRun: params.dryRun === true,
    nodeId: node.id,
    range: [start, end],
    linkedText: text.slice(start, end),
    hyperlink: link,
    underline: params.underline === true,
  };
}

// E-35: TEXT 노드의 글자 범위 색을 변수에 묶는다(강조색 등). 범위 = match(처음 나오는 부분 문자열, occurrence 로 n번째)
// 또는 start/end. 색 = collection+variableName(로컬) | variableId | variableKey. 범위 밖 글자는 그대로.
// E-36: read every TEXT under a page (or node) with its context, for copy checks.
// Pages through the top-level frames (offset/limit) so one reply stays small;
// the MCP server loops and writes the whole result to a file.
async function exportTextTree(params) {
  params = params || {};
  var root = params.nodeId ? await figma.getNodeByIdAsync(params.nodeId) : figma.currentPage;
  if (!root) throw new Error("Node not found: " + params.nodeId);
  var page = root;
  while (page && page.type !== "PAGE") page = page.parent;
  if (page && page.loadAsync) await page.loadAsync();
  var includeHidden = params.includeHidden === true;
  var prefixes = Array.isArray(params.includeTopPrefixes) ? params.includeTopPrefixes : null;

  // Top-level frames: direct children of the root, and of sections inside it.
  var tops = [];
  function collectTops(n, sec) {
    if (!("children" in n)) return;
    n.children.forEach(function (c) {
      if (c.type === "SECTION") collectTops(c, c);
      else tops.push({ node: c, section: sec ? sec.name : null, sectionId: sec ? sec.id : null });
    });
  }
  if (root.type === "PAGE" || root.type === "SECTION") collectTops(root, root.type === "SECTION" ? root : null);
  else tops.push({ node: root, section: null });
  var totalTops = tops.length;
  if (prefixes) {
    tops = tops.filter(function (t) {
      return prefixes.some(function (p) { return t.node.name.indexOf(p) === 0; });
    });
  }
  var matchedTops = tops.length;
  var offset = params.offset || 0;
  var limit = params.limit || 20;
  var slice = tops.slice(offset, offset + limit);

  var mainCache = {};
  async function instanceInfo(inst) {
    if (mainCache[inst.id]) return mainCache[inst.id];
    var main = null;
    try { main = await inst.getMainComponentAsync(); } catch (e) { main = null; }
    var info = {
      id: inst.id,
      name: inst.name,
      component: main ? main.name : null,
      componentSet: main && main.parent && main.parent.type === "COMPONENT_SET" ? main.parent.name : null,
    };
    mainCache[inst.id] = info;
    return info;
  }

  function hex2(v) { var h = Math.round(v * 255).toString(16); return h.length < 2 ? "0" + h : h; }
  function solidHexes(paints, out) {
    if (!paints || paints === figma.mixed) return;
    for (var q = 0; q < paints.length; q++) {
      var p = paints[q];
      if (p.type !== "SOLID" || p.visible === false) continue;
      var c = "#" + hex2(p.color.r) + hex2(p.color.g) + hex2(p.color.b);
      if (out.indexOf(c) < 0) out.push(c);
    }
  }
  // 보이는 단색 채우기(#rrggbb). 글자 범위마다 채우기가 다르면 범위들의 합집합
  function textFills(t) {
    var out = [];
    if (t.fills !== figma.mixed) { solidHexes(t.fills, out); return out; }
    try {
      var segs = t.getStyledTextSegments(["fills"]);
      for (var s = 0; s < segs.length; s++) solidHexes(segs[s].fills, out);
    } catch (e) { /* ignore */ }
    return out;
  }

  // 화면에 놓인(가장 바깥) 인스턴스가 이 글자를 바꿨나 — 덮어쓰기 기록(overrides)이 아니라 실제 글자로 판단한다.
  // 메인 컴포넌트에서 같은 자리 TEXT 를 찾아 글자가 다르면 true. TEXT 속성으로 넣은 글자도 기본 글자와 다르면 바꾼 것.
  // 라이브러리(원격) 메인은 노드 id 가 달라 경로(순번·이름)로 따라간다. 안쪽 인스턴스의 변이를 바꿔 구조가 달라지면
  // 그 아래는 같은 이름의 TEXT 로 찾고, 그래도 없으면 지금 연결된(바뀐 변이) 메인에서 같은 자리를 찾는다. 못 찾으면 null.
  var mainOf = {};
  async function mainComp(inst) {
    if (!(inst.id in mainOf)) {
      try { mainOf[inst.id] = await inst.getMainComponentAsync(); } catch (e) { mainOf[inst.id] = null; }
    }
    return mainOf[inst.id];
  }
  function childLike(parent, node) {
    var kids = parent.children || [];
    var idx = node.parent.children.indexOf(node);
    if (kids[idx] && kids[idx].name === node.name && kids[idx].type === node.type) return kids[idx];
    for (var k = 0; k < kids.length; k++) if (kids[k].name === node.name && kids[k].type === node.type) return kids[k];
    return null;
  }
  function textByName(root, name) {
    if (!("findAll" in root)) return null;
    var hits = root.findAll(function (n) { return n.type === "TEXT" && n.name === name; });
    return hits.length === 1 ? hits[0] : null;
  }
  async function twinIn(main, from, t) {
    // from(인스턴스) 아래 t 까지의 경로를 main 에서 따라간다
    var chain = [];
    for (var n = t; n && n !== from; n = n.parent) chain.unshift(n);
    var cur = main;
    for (var c = 0; c < chain.length; c++) {
      var cand = childLike(cur, chain[c]);
      if (!cand) {
        // 구조가 달라진 곳(바뀐 변이 등): 지금까지 따라온 노드 아래에서 같은 이름의 TEXT 하나
        return textByName(cur, t.name);
      }
      cur = cand;
    }
    return cur.type === "TEXT" ? cur : null;
  }
  async function overridesText(inst, t) {
    var main = await mainComp(inst);
    var twin = main ? await twinIn(main, inst, t) : null;
    if (!twin) {
      // 안쪽에서 가장 가까운 인스턴스의 지금 연결된 메인(바뀐 변이 기준)
      for (var n = t.parent; n && n !== inst.parent; n = n.parent) {
        if (n.type === "INSTANCE") {
          var m = await mainComp(n);
          twin = m ? await twinIn(m, n, t) : null;
          break;
        }
      }
    }
    return twin ? twin.characters !== t.characters : null;
  }

  var texts = [];
  for (var i = 0; i < slice.length; i++) {
    var top = slice[i].node;
    var found = top.type === "TEXT" ? [top] : ("findAllWithCriteria" in top ? top.findAllWithCriteria({ types: ["TEXT"] }) : []);
    for (var j = 0; j < found.length; j++) {
      var t = found[j];
      var visible = true;
      var instances = [];
      var parentFrame = null;
      var path = [];
      var n = t;
      while (n && n !== top.parent) {
        if (n.visible === false) visible = false;
        if (n !== t) path.unshift(n.name);
        if (n !== t && n.type === "INSTANCE") instances.unshift(n);
        if (n !== t && !parentFrame && (n.type === "FRAME" || n.type === "INSTANCE" || n.type === "COMPONENT" || n.type === "GROUP")) parentFrame = n.name;
        n = n.parent;
      }
      if (!visible && !includeHidden) continue;
      var chain = [];
      for (var k = 0; k < instances.length; k++) chain.push(await instanceInfo(instances[k]));
      var ref = t.componentPropertyReferences && t.componentPropertyReferences.characters;
      texts.push({
        nodeId: t.id,
        text: t.characters,
        layer: t.name,
        visible: visible,
        textProperty: ref || null,
        instance: chain.length ? chain[chain.length - 1] : null,
        instancePath: chain.map(function (c) { return c.componentSet || c.component || c.name; }),
        parentFrame: parentFrame,
        path: path,
        x: Math.round(t.absoluteTransform[0][2]),
        y: Math.round(t.absoluteTransform[1][2]),
        fills: textFills(t),
        // 화면에 놓인(가장 바깥) 인스턴스에서 이 글자를 덮어썼나 — false 면 메인 컴포넌트 기본 글자
        textOverride: instances.length ? await overridesText(instances[0], t) : null,
        topFrame: { id: top.id, name: top.name, section: slice[i].section, sectionId: slice[i].sectionId || null, x: Math.round(top.absoluteTransform[0][2]) },
      });
    }
  }
  var next = offset + limit < matchedTops ? offset + limit : null;
  return {
    fileName: figma.root.name,
    page: page ? { id: page.id, name: page.name } : null,
    root: { id: root.id, name: root.name, type: root.type },
    topFrames: { total: totalTops, matched: matchedTops, offset: offset, returned: slice.length },
    nextOffset: next,
    texts: texts,
  };
}

async function setTextRangeFills(params) {
  params = params || {};
  var items = params.items;
  var dryRun = params.dryRun === true;
  if (!Array.isArray(items) || items.length === 0) throw new Error("Missing items");

  var colls = await figma.variables.getLocalVariableCollectionsAsync();
  var collNameById = {};
  colls.forEach(function (c) { collNameById[c.id] = c.name; });
  var locals = await figma.variables.getLocalVariablesAsync("COLOR");

  async function findVariable(it) {
    if (it.variableName && it.collection) {
      var hits = locals.filter(function (v) { return v.name === it.variableName && collNameById[v.variableCollectionId] === it.collection; });
      if (hits.length !== 1) throw new Error("Color variable " + it.collection + " / " + it.variableName + ": " + hits.length + " found");
      return hits[0];
    }
    return await resolveVariableRef(it);
  }

  var results = [], errors = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    try {
      var node = await figma.getNodeByIdAsync(it.nodeId);
      if (!node) throw new Error("Node not found");
      if (node.type !== "TEXT") throw new Error("Not a TEXT node: " + node.type);
      var text = node.characters;
      var start, end;
      if (typeof it.match === "string" && it.match.length) {
        var nth = typeof it.occurrence === "number" && it.occurrence > 1 ? it.occurrence : 1;
        var at = -1;
        for (var k = 0; k < nth; k++) {
          at = text.indexOf(it.match, at + 1);
          if (at === -1) break;
        }
        if (at === -1) throw new Error("match not found: " + it.match);
        start = at; end = at + it.match.length;
      } else if (typeof it.start === "number" && typeof it.end === "number") {
        start = it.start; end = it.end;
      } else {
        throw new Error("Pass match or start/end");
      }
      if (start < 0 || end > text.length || start >= end) throw new Error("Bad range " + start + "-" + end);

      var variable = await findVariable(it);
      if (!dryRun) {
        var fonts = node.getRangeAllFontNames(0, text.length);
        for (var f = 0; f < fonts.length; f++) await figma.loadFontAsync(fonts[f]);
        var paint = figma.variables.setBoundVariableForPaint({ type: "SOLID", color: { r: 0, g: 0, b: 0 } }, "color", variable);
        node.setRangeFills(start, end, [paint]);
      }
      results.push({ nodeId: node.id, range: [start, end], text: text.slice(start, end), variable: (collNameById[variable.variableCollectionId] || "?") + " / " + variable.name });
    } catch (e) {
      errors.push({ nodeId: it.nodeId, match: it.match, reason: errMsg(e) });
    }
  }
  return { dryRun: dryRun, requested: items.length, done: results.length, results: results, errors: errors };
}

// E-34: 로컬 변수 만들기. copyFrom(같은 컬렉션 변수)이면 타입·scope·모드별 값을 그대로 복사한 뒤 values 로 모드별로 덮는다.
// values[모드이름] = { hex } | { alias: "이름", aliasCollection?, opacity? } | 숫자 | 문자열 | 불리언.
async function createVariables(params) {
  params = params || {};
  var items = params.items;
  var dryRun = params.dryRun === true;
  if (!Array.isArray(items) || items.length === 0) throw new Error("Missing items");

  var colls = await figma.variables.getLocalVariableCollectionsAsync();
  var all = await figma.variables.getLocalVariablesAsync();
  function collByName(n) { return colls.find(function (c) { return c.name === n; }); }
  function varIn(collName, name) {
    var c = collByName(collName);
    if (!c) return null;
    return all.find(function (v) { return v.variableCollectionId === c.id && v.name === name; }) || null;
  }
  function hexToRgba(h) {
    h = h.replace("#", "");
    var a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: a };
  }

  var results = [], errors = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    try {
      var coll = collByName(it.collection);
      if (!coll) throw new Error("Collection not found: " + it.collection);
      if (varIn(it.collection, it.name)) throw new Error("Already exists: " + it.collection + " / " + it.name);
      var src = it.copyFrom ? varIn(it.collection, it.copyFrom) : null;
      if (it.copyFrom && !src) throw new Error("copyFrom not found: " + it.copyFrom);
      var type = it.type || (src ? src.resolvedType : null);
      if (!type) throw new Error("type required (COLOR | FLOAT | STRING | BOOLEAN) or copyFrom");

      // 모드별 값 계산
      var planned = {};
      for (var m = 0; m < coll.modes.length; m++) {
        var mode = coll.modes[m];
        var val = src ? src.valuesByMode[mode.modeId] : undefined;
        var spec = it.values ? it.values[mode.name] : undefined;
        if (spec !== undefined) {
          if (spec && typeof spec === "object" && spec.alias) {
            var target = varIn(spec.aliasCollection || it.collection, spec.alias);
            if (!target) throw new Error("alias not found: " + (spec.aliasCollection || it.collection) + " / " + spec.alias);
            var aliasVal = figma.variables.createVariableAlias(target);
            val = typeof spec.opacity === "number" ? { color: aliasVal, opacity: spec.opacity } : aliasVal;
          } else if (spec && typeof spec === "object" && spec.hex) {
            val = hexToRgba(spec.hex);
          } else {
            val = spec;
          }
        }
        if (val === undefined) throw new Error("No value for mode " + mode.name);
        planned[mode.name] = { modeId: mode.modeId, value: val };
      }

      var out = { collection: it.collection, name: it.name, type: type, copyFrom: it.copyFrom || null,
        values: Object.keys(planned).reduce(function (o, k) { o[k] = planned[k].value; return o; }, {}) };
      if (!dryRun) {
        var v = figma.variables.createVariable(it.name, coll, type);
        if (src) v.scopes = src.scopes.slice();
        if (Array.isArray(it.scopes)) v.scopes = it.scopes;
        if (typeof it.description === "string") v.description = it.description;
        for (var k in planned) v.setValueForMode(planned[k].modeId, planned[k].value);
        out.id = v.id;
        out.key = v.key;
        all.push(v);
      }
      results.push(out);
    } catch (e) {
      errors.push({ name: it && it.name, reason: errMsg(e) });
    }
  }
  return { dryRun: dryRun, requested: items.length, done: results.length, results: results, errors: errors };
}

async function renameVariables(params) {
  var items = (params && params.items) || [];
  var dryRun = !!(params && params.dryRun);
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Missing or empty items parameter");
  }

  var collections = await figma.variables.getLocalVariableCollectionsAsync();
  var variables = await figma.variables.getLocalVariablesAsync();
  var collectionById = {};
  collections.forEach(function (c) { collectionById[c.id] = c; });
  var byId = {};
  variables.forEach(function (v) { byId[v.id] = v; });

  var plan = [];
  var errors = [];
  items.forEach(function (item, index) {
    var newName = typeof item.newName === "string" ? item.newName.trim() : "";
    var target = null;
    if (item.variableId) {
      target = byId[item.variableId] || null;
    } else if (item.collection && item.name) {
      var matches = variables.filter(function (v) {
        var c = collectionById[v.variableCollectionId];
        return c && c.name === item.collection && v.name === item.name;
      });
      if (matches.length > 1) {
        errors.push({ index: index, item: item, error: "Ambiguous: " + matches.length + " variables match" });
        return;
      }
      target = matches[0] || null;
    }
    if (!target) {
      errors.push({ index: index, item: item, error: "Local variable not found" });
      return;
    }
    if (!newName) {
      errors.push({ index: index, item: item, error: "newName is empty" });
      return;
    }
    plan.push({ variable: target, newName: newName });
  });

  // 바꾼 뒤 이름 기준으로 컬렉션 안 충돌을 본다.
  var planned = {};
  plan.forEach(function (p) { planned[p.variable.id] = p.newName; });
  var finalNames = {};
  variables.forEach(function (v) {
    var name = planned[v.id] !== undefined ? planned[v.id] : v.name;
    var key = v.variableCollectionId + "\u0000" + name;
    (finalNames[key] = finalNames[key] || []).push(v.id);
  });

  var results = [];
  var unchanged = [];
  for (var i = 0; i < plan.length; i++) {
    var p = plan[i];
    var v = p.variable;
    var collection = collectionById[v.variableCollectionId];
    var collectionName = collection ? collection.name : null;
    if (v.name === p.newName) {
      unchanged.push({ id: v.id, collection: collectionName, name: v.name });
      continue;
    }
    var clash = finalNames[v.variableCollectionId + "\u0000" + p.newName] || [];
    if (clash.length > 1) {
      errors.push({
        variableId: v.id,
        collection: collectionName,
        name: v.name,
        newName: p.newName,
        error: "Name already used in this collection",
      });
      continue;
    }
    var previousName = v.name;
    if (!dryRun) {
      try {
        v.name = p.newName;
      } catch (error) {
        errors.push({ variableId: v.id, collection: collectionName, name: previousName, newName: p.newName, error: errMsg(error) });
        continue;
      }
    }
    results.push({ id: v.id, key: v.key, collection: collectionName, previousName: previousName, name: p.newName });
  }

  return {
    dryRun: dryRun,
    requested: items.length,
    renamed: results.length,
    unchanged: unchanged.length,
    failed: errors.length,
    results: results,
    unchangedItems: unchanged,
    errors: errors,
  };
}

// ── find_variable_usage (read-only) ─────────────────────────────────────────
// Lists main components (COMPONENT / COMPONENT_SET) whose own layers bind the
// given variables directly. Nested instances (the instance node itself, its
// layers and overrides) are skipped entirely. Paint styles bound to the variable are
// reported with source "style:<name>".
async function findVariableUsage(params) {
  params = params || {};
  var commandId = params.commandId || generateCommandId();
  var wantNames = params.variableNames || [];
  var wantIds = (params.variableIds || []).slice();

  var locals = await figma.variables.getLocalVariablesAsync();
  var idToName = {};
  locals.forEach(function (v) {
    if (wantNames.indexOf(v.name) !== -1 && wantIds.indexOf(v.id) === -1) wantIds.push(v.id);
  });
  for (var wi = 0; wi < wantIds.length; wi++) {
    var vv = await figma.variables.getVariableByIdAsync(wantIds[wi]);
    idToName[wantIds[wi]] = vv ? vv.name : wantIds[wi];
  }
  if (!wantIds.length) throw new Error("No variables matched " + JSON.stringify(wantNames));

  var pages = figma.root.children;
  var pageNames = pages.map(function (p) { return p.name; });
  function findPage(name) {
    if (!name) return -1;
    var i = pageNames.indexOf(name);
    if (i !== -1) return i;
    var t = name.trim();
    for (var k = 0; k < pageNames.length; k++) if (pageNames[k].trim() === t) return k;
    return -1;
  }
  var from = params.fromPage ? findPage(params.fromPage) : 0;
  var to = params.toPage ? findPage(params.toPage) : pages.length - 1;
  if (from === -1 || to === -1 || from > to) {
    return { error: "page range not found", fromIndex: from, toIndex: to, pages: pageNames };
  }
  var scanned = pages.slice(from, to + 1);

  var styleCache = {};
  async function styleHits(styleId) {
    if (!styleId || typeof styleId !== "string") return [];
    if (styleCache[styleId]) return styleCache[styleId];
    var out = [];
    try {
      var st = await figma.getStyleByIdAsync(styleId);
      if (st && st.paints) st.paints.forEach(function (p) {
        var a = p.boundVariables && p.boundVariables.color;
        if (a && idToName[a.id]) out.push({ id: a.id, style: st.name });
      });
    } catch (e) {}
    styleCache[styleId] = out;
    return out;
  }

  function aliasIds(val, out) {
    if (!val) return;
    if (Array.isArray(val)) { val.forEach(function (x) { aliasIds(x, out); }); return; }
    if (val.type === "VARIABLE_ALIAS" && val.id) out.push(val.id);
  }

  // Returns [{varId, field, source}] for one node; onlyFields limits to overridden fields.
  async function nodeHits(node, onlyFields) {
    var hits = [];
    var seen = {};
    function add(id, field, source) {
      if (!idToName[id]) return;
      var key = id + "|" + field + "|" + source;
      if (seen[key]) return;
      seen[key] = 1;
      hits.push({ varId: id, field: field, source: source });
    }
    function ok(f) { return !onlyFields || onlyFields.indexOf(f) !== -1; }
    var bv = node.boundVariables || {};
    Object.keys(bv).forEach(function (k) {
      var fieldBase = k === "textRangeFills" ? "fills" : k;
      if (!ok(fieldBase) && !ok(k)) return;
      var ids = []; aliasIds(bv[k], ids);
      ids.forEach(function (id) { add(id, k, "direct"); });
    });
    ["fills", "strokes"].forEach(function (f) {
      if (!ok(f)) return;
      var paints = node[f];
      if (!paints || paints === figma.mixed || !Array.isArray(paints)) return;
      paints.forEach(function (p) {
        var a = p.boundVariables && p.boundVariables.color;
        if (a) add(a.id, f, "direct");
        (p.gradientStops || []).forEach(function (gs) {
          var g = gs.boundVariables && gs.boundVariables.color;
          if (g) add(g.id, f + ".gradient", "direct");
        });
      });
    });
    if (ok("effects") && Array.isArray(node.effects)) {
      node.effects.forEach(function (ef) {
        var a = ef.boundVariables && ef.boundVariables.color;
        if (a) add(a.id, "effects", "direct");
      });
    }
    if (node.type === "TEXT" && ok("fills") && (node.fills === figma.mixed || node.fillStyleId === figma.mixed)) {
      try {
        var segs = node.getStyledTextSegments(["fills", "fillStyleId"]);
        for (var s = 0; s < segs.length; s++) {
          (segs[s].fills || []).forEach(function (p) {
            var a = p.boundVariables && p.boundVariables.color;
            if (a) add(a.id, "textRangeFills", "direct");
          });
          var sh = await styleHits(segs[s].fillStyleId);
          sh.forEach(function (h) { add(h.id, "textRangeFills", "style:" + h.style); });
        }
      } catch (e) {}
    }
    if (ok("fills") && typeof node.fillStyleId === "string") {
      (await styleHits(node.fillStyleId)).forEach(function (h) { add(h.id, "fills", "style:" + h.style); });
    }
    if (ok("strokes") && typeof node.strokeStyleId === "string") {
      (await styleHits(node.strokeStyleId)).forEach(function (h) { add(h.id, "strokes", "style:" + h.style); });
    }
    return hits;
  }

  var results = [];
  var unitCount = 0;

  async function scanComponent(comp, page, set) {
    unitCount++;
    var rec = {
      page: page.name,
      setId: set ? set.id : null,
      setName: set ? set.name : null,
      componentId: comp.id,
      componentName: comp.name,
      hits: [],
    };
    async function record(node, hs, source) {
      hs.forEach(function (h) {
        rec.hits.push({
          variable: idToName[h.varId],
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          field: h.field,
          source: source === "override" && h.source === "direct" ? "override" : (source === "override" ? "override+" + h.source : h.source),
        });
      });
    }
    async function walk(node) {
      // nested instance (node + its layers + overrides) belongs to another main component: skip entirely
      if (node.type === "INSTANCE" && node !== comp) return;
      await record(node, await nodeHits(node, null), "direct");
      if ("children" in node) {
        for (var c = 0; c < node.children.length; c++) {
          var ch = node.children[c];
          if (ch.type === "COMPONENT" || ch.type === "COMPONENT_SET") continue; // own unit
          await walk(ch);
        }
      }
    }
    await walk(comp);
    if (rec.hits.length) results.push(rec);
  }

  for (var pi = 0; pi < scanned.length; pi++) {
    var page = scanned[pi];
    await page.loadAsync();
    await sendProgressUpdate(commandId, "find_variable_usage", "in_progress",
      Math.round((pi / scanned.length) * 100), scanned.length, pi, "Scanning page " + page.name);
    var comps = page.findAllWithCriteria({ types: ["COMPONENT"] });
    for (var ci = 0; ci < comps.length; ci++) {
      var comp = comps[ci];
      var set = comp.parent && comp.parent.type === "COMPONENT_SET" ? comp.parent : null;
      await scanComponent(comp, page, set);
    }
  }

  return {
    variables: idToName,
    scannedPages: scanned.map(function (p) { return p.name; }),
    componentsScanned: unitCount,
    componentsWithHits: results.length,
    results: results,
  };
}


// ── E-37 리뷰 리스팅(UX 라이팅 수정 건 페이지) ─────────────────────────────
// 쓰기는 이름이 'UX 라이팅 수정 건'으로 시작하는 페이지(앞의 ↳·공백 무시)에만. 원본 프레임은 clone() 만 한다.
var REVIEW_PAGE_PREFIX = "UX 라이팅 수정 건";
function isReviewPageName(name) {
  return String(name || "").replace(/^[\s↳]+/, "").indexOf(REVIEW_PAGE_PREFIX) === 0;
}
function normText(s) { return String(s || "").replace(/[\u2028\u2029]/g, "\n").trim(); }
function hexToRgb(hex) {
  var h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
}
function insideNode(node, root) {
  for (var n = node; n; n = n.parent) if (n === root) return true;
  return false;
}
async function pageOf(node) {
  var p = node;
  while (p && p.type !== "PAGE") p = p.parent;
  if (p && p.loadAsync) await p.loadAsync();
  return p;
}

async function reviewPage(params) {
  var name = params.pageName;
  if (!isReviewPageName(name)) throw new Error("Refused: page name must start with '" + REVIEW_PAGE_PREFIX + "': " + name);
  var existing = figma.root.children.filter(function (p) { return p.name === name; });
  if (existing.length) throw new Error("Refused: a page named '" + name + "' already exists (" + existing[0].id + "). Nothing written.");
  if (params.dryRun) return { fileName: figma.root.name, dryRun: true, wouldCreate: name };
  var page = figma.createPage();
  page.name = name;
  return { fileName: figma.root.name, pageId: page.id, name: page.name };
}

async function resolvePaint(p) {
  var paint = { type: "SOLID", color: hexToRgb(p.color), opacity: p.opacity == null ? 1 : p.opacity };
  if (p.variable && p.variable.key) {
    try {
      var v = await figma.variables.importVariableByKeyAsync(p.variable.key);
      paint = figma.variables.setBoundVariableForPaint(paint, "color", v);
    } catch (e) { /* 값만 쓴다 */ }
  } else if (p.variable && p.variable.id) {
    var lv = await figma.variables.getVariableByIdAsync(p.variable.id);
    if (lv) paint = figma.variables.setBoundVariableForPaint(paint, "color", lv);
  }
  return paint;
}

async function addPinkFill(node, pink) {
  var paint = { type: "SOLID", color: hexToRgb(pink) };
  if (node.fills !== figma.mixed) { node.fills = node.fills.concat([paint]); return; }
  var segs = node.getStyledTextSegments(["fills"]);
  for (var i = 0; i < segs.length; i++) node.setRangeFills(segs[i].start, segs[i].end, segs[i].fills.concat([paint]));
}

async function writeText(node, text) {
  if (/[\u2028]/.test(node.characters)) text = text.replace(/\n/g, "\u2028");
  if (hasRichText(node)) { await setTextPreservingLinks(node, text); return; }
  await figma.loadFontAsync(node.fontName);
  await setCharacters(node, text);
}

async function makeBadge(spec, section) {
  var inst = null, how = null;
  try {
    var comp = await figma.importComponentByKeyAsync(spec.key);
    inst = comp.createInstance();
    var t = inst.findOne(function (n) { return n.type === "TEXT"; });
    if (t && normText(t.characters) !== spec.label) {
      await figma.loadFontAsync(t.fontName);
      t.characters = spec.label;
    }
    how = "key";
  } catch (e) {
    if (inst) { try { inst.remove(); } catch (e2) {} }
    inst = null;
  }
  if (!inst && spec.seedId) {
    var seed = await figma.getNodeByIdAsync(spec.seedId);
    if (!seed) throw new Error("Badge seed not found: " + spec.seedId);
    await pageOf(seed);
    inst = seed.clone();
    how = "seed";
  }
  if (!inst) throw new Error("Badge: neither key nor seed worked for " + spec.label);
  section.appendChild(inst);
  return { node: inst, how: how };
}

async function textNode(chars, style, color, width) {
  var t = figma.createText();
  await figma.loadFontAsync({ family: "SUIT", style: style });
  t.fontName = { family: "SUIT", style: style };
  t.characters = chars;
  t.fills = [{ type: "SOLID", color: hexToRgb(color) }];
  return t;
}

async function buildTable(spec, st) {
  var tb = figma.createFrame();
  tb.name = "Changed-Screens";
  tb.layoutMode = "VERTICAL"; tb.primaryAxisSizingMode = "AUTO"; tb.counterAxisSizingMode = "AUTO";
  tb.paddingTop = tb.paddingBottom = tb.paddingLeft = tb.paddingRight = st.padding;
  tb.itemSpacing = 16; tb.cornerRadius = st.radius;
  tb.fills = [{ type: "SOLID", color: hexToRgb(st.background) }];
  var title = await textNode(spec.title, "Bold", st.titleColor);
  title.fontSize = 20; title.lineHeight = { value: 30, unit: "PIXELS" }; title.name = spec.title;
  tb.appendChild(title);
  var table = figma.createFrame();
  table.name = "Container-Table"; table.layoutMode = "VERTICAL";
  table.primaryAxisSizingMode = "AUTO"; table.counterAxisSizingMode = "AUTO"; table.fills = [];
  tb.appendChild(table);
  async function row(cells, header) {
    var r = figma.createFrame();
    r.name = header ? "Container-Header" : "Container-Contents";
    r.layoutMode = "HORIZONTAL"; r.primaryAxisSizingMode = "AUTO"; r.counterAxisSizingMode = "AUTO"; r.fills = [];
    if (header) {
      r.strokes = [{ type: "SOLID", color: hexToRgb(st.headerBorder) }];
      r.strokeTopWeight = 0; r.strokeLeftWeight = 0; r.strokeRightWeight = 0; r.strokeBottomWeight = 1;
      r.strokeAlign = "INSIDE";
    }
    for (var i = 0; i < cells.length; i++) {
      var c = figma.createFrame();
      c.name = "Container-Description"; c.layoutMode = "HORIZONTAL"; c.fills = [];
      c.primaryAxisSizingMode = "FIXED"; c.counterAxisSizingMode = "AUTO";
      c.paddingTop = c.paddingBottom = c.paddingLeft = c.paddingRight = 12;
      c.resize(st.columns[i], 45);
      var t = await textNode(cells[i] || " ", header ? "Bold" : "Medium", header ? st.headerColor : st.bodyColor);
      t.fontSize = 14; t.lineHeight = { value: 21, unit: "PIXELS" };
      c.appendChild(t);
      t.layoutGrow = 1; t.textAutoResize = "HEIGHT";
      r.appendChild(c);
    }
    table.appendChild(r);
  }
  await row(spec.header, true);
  var rows = spec.rows.length ? spec.rows : [[spec.empty, " ", " "]];
  for (var k = 0; k < rows.length; k++) await row(rows[k], false);
  return tb;
}

async function reviewSection(params) {
  var page = await figma.getNodeByIdAsync(params.pageId);
  if (!params.dryRun) {
    if (!page || page.type !== "PAGE") throw new Error("Page not found: " + params.pageId);
    if (!isReviewPageName(page.name)) throw new Error("Refused: target page '" + page.name + "' is not a review page. Nothing written.");
    await page.loadAsync();
  }
  var L = params.layout;
  var asSrc = await figma.getNodeByIdAsync(params.asIs);
  if (!asSrc) throw new Error("Source not found: " + params.asIs);
  await pageOf(asSrc);
  var srcTexts = asSrc.type === "TEXT" ? [asSrc] : asSrc.findAllWithCriteria({ types: ["TEXT"] });
  var want = {};
  params.edits.forEach(function (e) { want[normText(e.before)] = e.after; });
  var hits = {};
  srcTexts.forEach(function (t) { var k = normText(t.characters); if (k in want) hits[k] = (hits[k] || 0) + 1; });
  var missing = params.edits.filter(function (e) { return !hits[normText(e.before)]; }).map(function (e) { return e.before; });
  var w = asSrc.width, h = asSrc.height;
  if (params.dryRun) {
    var n = 0; for (var k in hits) n += hits[k];
    var tableH = 24 * 2 + 30 + 16 + 45 * (1 + Math.max(1, params.table.rows.length));
    var tw = params.style.table.columns.reduce(function (a, b) { return a + b; }, 0) + 48;
    return { dryRun: true, name: params.name, width: L.pad + w + L.gap + w + L.gap + tw + L.pad,
             height: L.top + Math.max(h, tableH) + L.pad, changed: n, missing: missing };
  }
  var section = figma.createSection();
  page.appendChild(section);
  section.name = params.name;
  section.x = params.x; section.y = params.y;
  var fills = [];
  for (var f = 0; f < (params.style.sectionFills || []).length; f++) fills.push(await resolvePaint(params.style.sectionFills[f]));
  section.fills = fills;

  var asIs = asSrc.clone(); section.appendChild(asIs); asIs.x = L.pad; asIs.y = L.top;
  var toBe = asSrc.clone(); section.appendChild(toBe); toBe.x = L.pad + w + L.gap; toBe.y = L.top;
  var changed = 0, failed = [];
  var texts = toBe.type === "TEXT" ? [toBe] : toBe.findAllWithCriteria({ types: ["TEXT"] });
  for (var i = 0; i < texts.length; i++) {
    var t = texts[i], key = normText(t.characters);
    if (!(key in want)) continue;
    if (!insideNode(t, section)) throw new Error("Refused: text outside the new section");
    try { await writeText(t, want[key]); await addPinkFill(t, params.pink); changed++; }
    catch (e) { failed.push({ text: key, error: errMsg(e) }); }
  }
  var badges = [];
  var pairs = [[params.badges.neutral, asIs], [params.badges.positive, toBe]];
  for (var b = 0; b < pairs.length; b++) {
    var r = await makeBadge(pairs[b][0], section);
    r.node.x = pairs[b][1].x + (pairs[b][1].width - r.node.width) / 2;
    r.node.y = L.badgeY;
    badges.push(r.how);
  }
  var tb = await buildTable(params.table, params.style.table);
  section.appendChild(tb);
  tb.x = toBe.x + toBe.width + L.gap; tb.y = L.top;
  var right = tb.x + tb.width, bottom = Math.max(toBe.y + toBe.height, tb.y + tb.height);
  section.resizeWithoutConstraints(right + L.pad, bottom + L.pad);
  return { sectionId: section.id, name: section.name, width: section.width, height: section.height,
           asIsId: asIs.id, toBeId: toBe.id, changed: changed, missing: missing, failed: failed, badges: badges };
}

async function inspectPaints(params) {
  var node = await figma.getNodeByIdAsync(params.nodeId);
  if (!node) throw new Error("Node not found: " + params.nodeId);
  async function one(paints) {
    var out = [];
    if (!paints || paints === figma.mixed) return out;
    for (var i = 0; i < paints.length; i++) {
      var p = paints[i], o = { type: p.type, visible: p.visible !== false, opacity: p.opacity == null ? 1 : p.opacity };
      if (p.type === "SOLID") o.color = "#" + ["r", "g", "b"].map(function (c) { var x = Math.round(p.color[c] * 255).toString(16); return x.length < 2 ? "0" + x : x; }).join("");
      var bv = p.boundVariables && p.boundVariables.color;
      if (bv) {
        var v = await figma.variables.getVariableByIdAsync(bv.id);
        var col = v ? await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId) : null;
        o.variable = { id: bv.id, key: v ? v.key : null, name: v ? v.name : null, collection: col ? col.name : null, remote: v ? v.remote : null };
      }
      out.push(o);
    }
    return out;
  }
  return { id: node.id, name: node.name, type: node.type, fills: await one(node.fills), strokes: await one(node.strokes),
           width: node.width, height: node.height };
}
