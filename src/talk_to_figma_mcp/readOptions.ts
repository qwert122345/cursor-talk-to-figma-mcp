// 읽기 명령 결과 줄이기 옵션(fields / summary / maxDepth).
// 플러그인이 돌려준 결과를 서버에서 받은 뒤에만 쓴다. 입력은 고치지 않고 새 객체를 만든다.
// 옵션이 하나도 없을 때는 이 파일을 부르지 않는다 — 결과가 지금과 글자 하나 다르지 않게(server.ts 참고).

/** 객체·배열이 아닌 값 */
function isScalar(v: unknown): boolean {
  return v === null || typeof v !== "object";
}

/** 최상위의 스칼라 값(개수·이름·hasMore 등)만 원래 순서대로 */
function scalarsOf(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) if (isScalar(obj[k])) out[k] = obj[k];
  return out;
}

// ── get_node_info · get_nodes_info ─────────────────────────────────────────────

/** filterFigmaNode 가 내는 필드 중 고를 수 있는 것(id 는 늘 남고, children 은 maxDepth 로 다룬다) */
export const NODE_FIELDS = [
  "name",
  "type",
  "fills",
  "strokes",
  "cornerRadius",
  "absoluteBoundingBox",
  "characters",
  "style",
] as const;

/**
 * filterFigmaNode 결과 노드 하나를 줄인다.
 * - fields: 주면 id 와 그 필드만 남긴다(모든 깊이). 없으면 필드는 그대로.
 * - maxDepth: 주면 그 깊이에서 children 을 떼고 childCount 를 붙인다. 0 = 노드 자신만.
 */
export function projectNode(
  node: any,
  fields: readonly string[] | undefined,
  maxDepth: number | undefined,
  depth = 0
): any {
  if (node === null || typeof node !== "object") return node;
  const keep = fields ? new Set<string>(["id", ...fields]) : null;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(node)) {
    if (k === "children") continue;
    if (!keep || keep.has(k)) out[k] = node[k];
  }
  if (Array.isArray(node.children)) {
    if (maxDepth !== undefined && depth >= maxDepth) {
      out.childCount = node.children.length;
    } else {
      out.children = node.children.map((c: any) => projectNode(c, fields, maxDepth, depth + 1));
    }
  }
  return out;
}

// ── 목록을 돌려주는 명령: 항목마다 필드 고르기 ─────────────────────────────────

/** 항목마다 id 와 고른 필드만(원래 키 순서) */
export function projectItems(items: unknown, fields: readonly string[]): unknown {
  if (!Array.isArray(items)) return items;
  const keep = new Set<string>(["id", ...fields]);
  return items.map((it: any) => {
    if (it === null || typeof it !== "object") return it;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(it)) if (keep.has(k)) out[k] = it[k];
    return out;
  });
}

/** result 의 listKey 배열만 줄이고 나머지 키는 그대로 */
function withProjectedList(result: any, listKey: string, fields: readonly string[]): any {
  if (result === null || typeof result !== "object" || !(listKey in result)) return result;
  return { ...result, [listKey]: projectItems(result[listKey], fields) };
}

// find_hidden_nodes
export const HIDDEN_FIELDS = ["name", "type", "page", "path", "reasons", "detail"] as const;
export function projectHidden(result: any, fields: readonly string[]): any {
  return withProjectedList(result, "findings", fields);
}
export function summarizeHidden(result: any): any {
  if (result === null || typeof result !== "object") return result;
  const out: Record<string, unknown> = { summary: true, ...scalarsOf(result) };
  if (result.byReason !== undefined) out.byReason = result.byReason;
  return out;
}

// find_nodes_by_name
export const BYNAME_FIELDS = ["name", "type", "page", "path", "parentId", "parentType", "component", "variant"] as const;
export function projectByName(result: any, fields: readonly string[]): any {
  return withProjectedList(result, "findings", fields);
}
export function summarizeByName(result: any): any {
  if (result === null || typeof result !== "object") return result;
  const out: Record<string, unknown> = { summary: true, ...scalarsOf(result) };
  if (result.byType !== undefined) out.byType = result.byType;
  return out;
}

// get_instance_census
export const CENSUS_FIELDS = [
  "key",
  "componentName",
  "componentSetName",
  "source",
  "count",
  "instances.name",
  "instances.page",
  "instances.path",
] as const;
/** components[] 는 접두사 없는 필드, instances[] 는 'instances.' 필드로 고른다(둘 다 id 는 남음) */
export function projectCensus(result: any, fields: readonly string[]): any {
  if (result === null || typeof result !== "object") return result;
  const comp = fields.filter((f) => !f.startsWith("instances."));
  const inst = fields.filter((f) => f.startsWith("instances.")).map((f) => f.slice("instances.".length));
  const out = { ...result };
  if ("components" in out) out.components = projectItems(out.components, comp);
  if ("instances" in out) out.instances = projectItems(out.instances, inst);
  return out;
}
export const CENSUS_TOP = 20;
export function summarizeCensus(result: any): any {
  if (result === null || typeof result !== "object") return result;
  const out: Record<string, unknown> = { summary: true, ...scalarsOf(result) };
  if (Array.isArray(result.components)) {
    out.topComponents = [...result.components]
      .sort((a: any, b: any) => (b?.count ?? 0) - (a?.count ?? 0))
      .slice(0, CENSUS_TOP)
      .map((c: any) => ({ componentName: c?.componentName, count: c?.count, source: c?.source }));
  }
  return out;
}

// get_variable_bindings
export function summarizeBindings(result: any): any {
  if (result === null || typeof result !== "object") return result;
  const out: Record<string, unknown> = { summary: true, ...scalarsOf(result) };
  for (const k of ["byProperty", "byValue", "byTextStyle"]) if (result[k] !== undefined) out[k] = result[k];
  if (result.byVariable && typeof result.byVariable === "object") {
    const byVar: Record<string, unknown> = {};
    for (const [name, v] of Object.entries(result.byVariable as Record<string, any>)) byVar[name] = v?.total;
    out.byVariable = byVar;
  }
  return out;
}
