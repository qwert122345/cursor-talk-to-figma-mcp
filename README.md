# Talk to Figma MCP

This project implements a Model Context Protocol (MCP) integration between AI agent (Cursor, Claude Code) and Figma, allowing AI agent to communicate with Figma for reading designs and modifying them programmatically.

https://github.com/user-attachments/assets/129a14d2-ed73-470f-9a4c-2240b2a4885c

## Project Structure

- `src/talk_to_figma_mcp/` - TypeScript MCP server for Figma integration
- `src/cursor_mcp_plugin/` - Figma plugin for communicating with Cursor
- `src/socket.ts` - WebSocket server that facilitates communication between the MCP server and Figma plugin

## How to use

1. Install Bun if you haven't already:

```bash
curl -fsSL https://bun.sh/install | bash
```

2. Run setup, this will also install MCP in your Cursor's active project

```bash
bun setup
```

3. Start the Websocket server

```bash
bun socket
```

4. **NEW** Install Figma plugin from [Figma community page](https://www.figma.com/community/plugin/1485687494525374295/cursor-talk-to-figma-mcp-plugin) or [install locally](#figma-plugin)

## Quick Video Tutorial

[Video Link](https://www.linkedin.com/posts/sonnylazuardi_just-wanted-to-share-my-latest-experiment-activity-7307821553654657024-yrh8)

## Design Automation Example

**Bulk text content replacement**

Thanks to [@dusskapark](https://github.com/dusskapark) for contributing the bulk text replacement feature. Here is the [demo video](https://www.youtube.com/watch?v=j05gGT3xfCs).

**Instance Override Propagation**
Another contribution from [@dusskapark](https://github.com/dusskapark)
Propagate component instance overrides from a source instance to multiple target instances with a single command. This feature dramatically reduces repetitive design work when working with component instances that need similar customizations. Check out our [demo video](https://youtu.be/uvuT8LByroI).

## Manual Setup and Installation

### MCP Server: Integration with Cursor

Add the server to your Cursor MCP configuration in `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "TalkToFigma": {
      "command": "bunx",
      "args": ["cursor-talk-to-figma-mcp@latest"]
    }
  }
}
```

### WebSocket Server

Start the WebSocket server:

```bash
bun socket
```

### Figma Plugin

1. In Figma, go to Plugins > Development > New Plugin
2. Choose "Link existing plugin"
3. Select the `src/cursor_mcp_plugin/manifest.json` file
4. The plugin should now be available in your Figma development plugins

## Windows + WSL Guide

1. Install bun via powershell

```bash
powershell -c "irm bun.sh/install.ps1|iex"
```

2. Uncomment the hostname `0.0.0.0` in `src/socket.ts`

```typescript
// uncomment this to allow connections in windows wsl
hostname: "0.0.0.0",
```

3. Start the websocket

```bash
bun socket
```

## Usage

1. Start the WebSocket server
2. Install the MCP server in Cursor
3. Open Figma and run the Cursor MCP Plugin
4. Connect the plugin to the WebSocket server by joining a channel using `join_channel`
5. Use Cursor to communicate with Figma using the MCP tools

## Local Development Setup

To develop, update your mcp config to direct to your local directory.

```json
{
  "mcpServers": {
    "TalkToFigma": {
      "command": "bun",
      "args": ["/path-to-repo/src/talk_to_figma_mcp/server.ts"]
    }
  }
}
```

## MCP Tools

전체 **64개**. 아래 표로 훑고, 정확한 파라미터는 툴 설명(각 툴의 description)을 본다.

**범례**
- **구분** — `R` 읽기 전용 / `W` 파일을 바꾼다
- ⚠️ — **전 페이지를 메모리에 상주시킨다**(`loadAllPagesAsync` 또는 전 페이지 `loadAsync`).
  피그마는 평소 보고 있는 페이지만 올리는데(dynamic-page), 이 커맨드를 한 번이라도 부르면
  전 페이지가 올라오고 세션이 끝날 때까지 안 내려간다. 세션당 한 번으로 아끼고,
  이후엔 `nodeId` 로 범위를 좁힌 커맨드를 쓴다.
  ★ 큰 파일에서 이 계열을 여러 번 돌린 뒤 **편집(드래그·삭제)이 굼떠지는 일이 있었고,
  파일 탭을 닫았다 다시 여니 해결됐다**(2026-09-07). 상주가 원인인지까지는 확인하지 못했지만
  해법은 그것이다 — 데스크톱 앱에서 `Cmd+R` 은 안 먹으니 **탭을 닫고 파일을 다시 연다.**

### 조사 — 문서 · 선택 · 노드

| 커맨드 | 하는 일 | 구분 | |
|---|---|:--:|:--:|
| `get_document_info` | 현재 문서 정보. **현재 페이지 하나만** 준다 | R | |
| `get_selection` | 현재 선택 상태 | R | |
| `read_my_design` | 현재 선택의 상세 노드 정보(파라미터 없이) | R | |
| `get_node_info` | 노드 하나의 상세. ⚠️ REST 덤프라 `visible`·`opacity`·`clipsContent`·variant 는 **안 준다** | R | |
| `get_nodes_info` | 여러 노드를 한 번에 | R | |
| `scan_nodes_by_types` | 하위에서 특정 타입 노드를 전부 찾는다. **이름으로는 못 거른다** | R | |
| `scan_text_nodes` | 하위 텍스트 노드 스캔 | R | |
| `find_nodes_by_name` | **이름으로** 노드를 전수 조회. `types`·`parentTypes` 로 좁히고 `idsOnly` 로 id 배열만 | R | ⚠️ |
| `find_hidden_nodes` | **"왜 안 보이는지"를 짚는다** — 눈 꺼짐 / 조상 꺼짐 / opacity 0 / 크기 0 / 클리핑. `includeFaded` 로 **불투명도를 읽는 유일한 수단** | R | ⚠️ |
| `get_hyperlinks` | 텍스트 하이퍼링크(URL·NODE) 목록 | R | ⚠️ |
| `set_focus` | 노드 하나 선택 + 뷰포트 이동 | W | |
| `set_selections` | 여러 노드 선택 + 뷰포트 이동. 노드가 있는 페이지로 자동 전환 | W | |

### 디자인시스템 감사

| 커맨드 | 하는 일 | 구분 | |
|---|---|:--:|:--:|
| `get_variable_bindings` | **하드코딩 탐지의 본체.** 값별 히스토그램 + 컴포넌트/변이별 롤업. `byVariable` 로 "이 변수를 누가 쓰나" 역조회, `byTextStyle` 로 텍스트 스타일 사용처 역조회 | R | ⚠️ |
| `select_hardcoded` | 같은 탐지를 하되 **그 자리에서 선택**한다. 사람이 눈으로 볼 때 | W | ⚠️ |
| `get_layout_audit` | 컴포넌트별 오토레이아웃 · HUG/FILL/FIXED · 실제 padding·itemSpacing · 그림자 · 공유 스타일 바인딩 | R | ⚠️ |
| `get_grid_usage` | 그리드 스타일이 실제로 쓰이는지 역조회. **`gridStyleId`·`layoutGrids` 를 주는 유일한 커맨드** | R | ⚠️ |
| `get_instance_census` | 메인 컴포넌트별 인스턴스 수. 라이브러리/로컬 분리. **고아 판정은 key 로 한다** | R | ⚠️ |

### 컴포넌트 · 인스턴스

| 커맨드 | 하는 일 | 구분 | |
|---|---|:--:|:--:|
| `get_local_components` | 로컬 컴포넌트·세트 전부. name·type·**key**·**description**·documentationLinks·page·parent·**변이 축**. `checkPublished` 로 발행 상태(느림) | R | ⚠️ |
| `get_component_properties` | **`componentPropertyDefinitions`** — 위 커맨드가 안 주는 **BOOLEAN·TEXT·INSTANCE_SWAP** 프로퍼티. `nodeIds` 또는 `pageName` | R | `pageName` 사용 시 ⚠️ |
| `create_component_instance` | 컴포넌트 인스턴스 생성. **`.` 접두사 컴포넌트는 실패한다**(발행 자산이 아님) | W | |
| `get_instance_overrides` | 인스턴스에서 오버라이드 추출 | R | |
| `set_instance_overrides` | 추출한 오버라이드를 대상 인스턴스에 적용 | W | |
| `swap_instances_by_key` | 인스턴스의 메인 컴포넌트를 **key 로 교체**(고아 재바인딩). `.` 접두사엔 `viaNodeId` 필수 | W | ⚠️ |
| `detach_instances` | 하위 인스턴스를 분리. 중첩까지 닿도록 여러 패스 | W | |
| `rename_variant_property` | 변이 속성 **키** 개명. 인스턴스 선택값 이관까지 책임진다. ⚠️ **값 개명·순서 변경은 이걸로 안 된다** | W | |

### 변수 · 스타일

| 커맨드 | 하는 일 | 구분 | |
|---|---|:--:|:--:|
| `get_local_variables` | 변수 컬렉션·변수 전부(모드·scope·모드별 값·alias 해석·색은 HEX). **`key` 포함** | R | |
| `get_styles` | 로컬 스타일. ⚠️ 텍스트 스타일은 `fontSize`·`fontName` 만 — **행간·자간은 안 준다** | R | |
| `bind_variable` | 여러 노드의 한 속성을 변수에 **일괄 바인딩**(하드코딩 수정). 이미 묶인 건 `skipped`. **`dryRun` 이 "지금 묶여 있나"의 판별기** | W | |
| `unbind_variable` | 위의 반대. 값은 남고 **렌더는 안 바뀐다**. `strokeWeight` 는 per-side 네 필드까지 훑는다. 색(`fills`)은 아직 안 받는다. ★ **stroke paint 가 없는 노드의 굵기 바인딩은 피그마 UI 에 안 떠서 손으로 못 지운다 — 이게 유일한 수단** | W | |
| `unbind_styles` | 공유 **스타일** 바인딩 해제(값 유지). ⚠️ **변수엔 안 듣는다.** 되돌릴 수 없으니 `dryRun` 먼저 | W | ⚠️ |

### 생성

| 커맨드 | 하는 일 | 구분 |
|---|---|:--:|
| `create_rectangle` | 사각형 | W |
| `create_frame` | 프레임 | W |
| `create_section` | 섹션(캔버스 그룹) | W |
| `create_text` | 텍스트. `fontFamily`·`fontStyle` 지정 가능(안 주면 조용히 Inter), `width` 로 줄바꿈 | W |

### 편집 — 텍스트

| 커맨드 | 하는 일 | 구분 |
|---|---|:--:|
| `set_text_content` | 텍스트 노드 하나 | W |
| `set_multiple_text_contents` | 여러 개 일괄. ⚠️ **한 번에 5개까지**가 안전하다 | W |

### 편집 — 오토레이아웃 · 배치

| 커맨드 | 하는 일 | 구분 |
|---|---|:--:|
| `set_layout_mode` | 레이아웃 모드·wrap (NONE/HORIZONTAL/VERTICAL) | W |
| `set_padding` | 오토레이아웃 패딩 | W |
| `set_axis_align` | 주축·교차축 정렬 | W |
| `set_layout_sizing` | 사이징 (FIXED/HUG/FILL). **TEXT 노드도 받는다** | W |
| `set_multiple_layout_sizing` | 위를 여러 노드에 일괄 | W |
| `set_item_spacing` | 자식 간 간격 | W |
| `move_node` | 위치 이동 | W |
| `resize_node` | 크기 변경. ⚠️ width·height 를 둘 다 요구해 **HUG 축이 FIXED 로 바뀐다** | W |
| `set_parent` | 다른 부모로 이동(절대 위치 보존) | W |

### 편집 — 스타일링

| 커맨드 | 하는 일 | 구분 |
|---|---|:--:|
| `set_fill_color` | 채우기 색 (RGBA) | W |
| `set_stroke_color` | 선 색·굵기 | W |
| `set_corner_radius` | 모서리 반경(코너별 지정 가능) | W |
| `set_image_fill` | 로컬 경로·URL·base64 이미지로 채우기 | W |
| `set_multiple_opacity` | 여러 노드 불투명도(0–1). ⚠️ **쓰기라 현재값이 날아간다** — 읽으려면 `find_hidden_nodes({includeFaded})` | W |

### 편집 — 복제 · 삭제 · 이름

| 커맨드 | 하는 일 | 구분 |
|---|---|:--:|
| `clone_node` | 노드 복제 | W |
| `clone_multiple_nodes` | 여러 개 복제 + `parentId`·`index`·`name` 지정. 클론 안 TEXT 목록도 반환. ⚠️ 무거운 페이지에선 **10개 이하로** | W |
| `delete_node` | 삭제 | W |
| `delete_multiple_nodes` | 일괄 삭제. **50개씩 끊는 게 안전** | W |
| `rename_node` | 이름 변경 | W |
| `rename_multiple_nodes` | 일괄 이름 변경 | W |

### 주석 · 프로토타입

| 커맨드 | 하는 일 | 구분 |
|---|---|:--:|
| `get_annotations` | 주석 조회 | R |
| `set_annotation` | 주석 생성·수정(마크다운) | W |
| `set_multiple_annotations` | 주석 일괄 | W |
| `get_reactions` | 프로토타입 리액션 조회(하이라이트 애니메이션 포함) | R |
| `set_default_connector` | FigJam 커넥터를 기본 스타일로 지정 (`create_connections` 전에 필수) | W |
| `create_connections` | 노드 사이 커넥터 생성 | W |

### 내보내기 · 연결

| 커맨드 | 하는 일 | 구분 |
|---|---|:--:|
| `export_node_as_image` | PNG/JPG/SVG/PDF 로 내보내기(현재 base64 텍스트 반환) | R |
| `join_channel` | 채널 접속. **모든 작업 전에 먼저** | — |

### MCP Prompts

The MCP server includes several helper prompts to guide you through complex design tasks:

- `design_strategy` - Best practices for working with Figma designs
- `read_design_strategy` - Best practices for reading Figma designs
- `text_replacement_strategy` - Systematic approach for replacing text in Figma designs
- `annotation_conversion_strategy` - Strategy for converting manual annotations to Figma's native annotations
- `swap_overrides_instances` - Strategy for transferring overrides between component instances in Figma
- `reaction_to_connector_strategy` - Strategy for converting Figma prototype reactions to connector lines using the output of 'get_reactions', and guiding the use 'create_connections' in sequence

## Development

### Building the Figma Plugin

1. Navigate to the Figma plugin directory:

   ```
   cd src/cursor_mcp_plugin
   ```

2. Edit code.js and ui.html

## Best Practices

When working with the Figma MCP:

1. Always join a channel before sending commands
2. Get document overview using `get_document_info` first
3. Check current selection with `get_selection` before modifications
4. Use appropriate creation tools based on needs:
   - `create_frame` for containers
   - `create_rectangle` for basic shapes
   - `create_text` for text elements
5. Verify changes using `get_node_info`
6. Use component instances when possible for consistency
7. Handle errors appropriately as all commands can throw exceptions
8. For large designs:
   - Use chunking parameters in `scan_text_nodes`
   - Monitor progress through WebSocket updates
   - Implement appropriate error handling
9. For text operations:
   - Use batch operations when possible
   - Consider structural relationships
   - Verify changes with targeted exports
10. For converting legacy annotations:
    - Scan text nodes to identify numbered markers and descriptions
    - Use `scan_nodes_by_types` to find UI elements that annotations refer to
    - Match markers with their target elements using path, name, or proximity
    - Categorize annotations appropriately with `get_annotations`
    - Create native annotations with `set_multiple_annotations` in batches
    - Verify all annotations are properly linked to their targets
    - Delete legacy annotation nodes after successful conversion
11. Visualize prototype noodles as FigJam connectors:

- Use `get_reactions` to extract prototype flows,
- set a default connector with `set_default_connector`,
- and generate connector lines with `create_connections` for clear visual flow mapping.

## License

MIT
