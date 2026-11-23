# Talk to Figma MCP

Claude Code 에서 피그마를 읽고 고치게 해 주는 MCP 연동이다. 이 저장소는 원본 [cursor-talk-to-figma-mcp](https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp) 를 가져와 디자인시스템 정리용 도구를 크게 늘린 버전이다(원본 대비 도구가 많으니 **npm 패키지가 아니라 이 저장소를 빌드해서** 쓴다).

## 구성

```
Claude Code ←(stdio)→ MCP 서버 ←(WebSocket)→ 중계 서버 ←(WebSocket)→ 피그마 플러그인
```

- `src/talk_to_figma_mcp/server.ts` — MCP 서버. 도구를 정의하고 명령을 플러그인으로 보낸다. 빌드 결과는 `dist/server.js`
- `src/socket.ts` — WebSocket 중계 서버(포트 3055). 채널 단위로 MCP 서버와 플러그인을 이어 준다
- `src/figma_plugin/` — 피그마 플러그인. `code.js` 가 실제 동작(빌드 없이 그대로 실행), `ui.html` 이 연결 창

## 설치

1. [Bun](https://bun.sh) 설치

   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. 설치·빌드·등록을 한 번에

   ```bash
   bun setup
   ```

   의존성 설치 → `bun run build` → 저장소 루트에 `.mcp.json`(이 저장소의 `dist/server.js` 를 가리킴) 작성까지 한다. 아래 3번은 손으로 할 때의 같은 내용이다.

3. Claude Code 에 MCP 서버 등록 — **빌드한 로컬 파일을 가리킨다**

   ```bash
   claude mcp add TalkToFigma -- bun /절대경로/cursor-talk-to-figma-mcp/dist/server.js
   ```

   또는 저장소 루트의 `.mcp.json`:

   ```json
   {
     "mcpServers": {
       "TalkToFigma": {
         "command": "bun",
         "args": ["/절대경로/cursor-talk-to-figma-mcp/dist/server.js"]
       }
     }
   }
   ```

4. 피그마 플러그인 연결(최초 한 번)
   1. 피그마에서 플러그인 > 개발 > 매니페스트에서 플러그인 가져오기 (Plugins > Development > Import plugin from manifest…)
   2. `src/figma_plugin/manifest.json` 선택

## 사용

1. 중계 서버 실행

   ```bash
   bun socket
   ```

2. 작업할 **피그마 파일에서** 플러그인 실행 → 창에 나온 **채널 ID** 확인
3. Claude Code 에 채널 ID 를 알려 준다 → `join_channel` 로 접속
4. 이후 도구로 읽고 고친다

**알아 둘 것**
- 플러그인은 **실행한 파일 하나**에만 붙는다. 다른 파일을 작업하려면 그 파일에서 플러그인을 새로 실행하고 새 채널 ID 를 쓴다. 접속 직후 `get_document_info` 로 어느 파일인지 확인하는 습관이 안전하다.
- `code.js` 를 고쳤으면 **피그마에서 플러그인을 다시 실행**해야 반영된다(채널 ID 도 바뀐다).
- `server.ts` 를 고쳤으면 `bun run build` 후 Claude Code 에서 **`/mcp` → TalkToFigma 재연결**이 필요하다.
- 명령마다 기본 30초 제한이 있다(진행 상황을 보내는 명령은 그때마다 연장). 수백 개 화면을 한 번에 훑는 조회는 시간 초과가 날 수 있으니 범위를 좁힌다.

## MCP 도구

전체 **91개**(주석·프로토타입 6개는 이 저장소의 용도와 멀어 표에서 뺐다). 아래 표로 훑고, 정확한 파라미터는 툴 설명(각 툴의 description)을 본다.

**범례**
- **구분** — `R` 읽기 전용 / `W` 파일을 바꾼다
- ⚠️ — **전 페이지를 메모리에 상주시킨다**(`loadAllPagesAsync` 또는 전 페이지 `loadAsync`).
  피그마는 평소 보고 있는 페이지만 올리는데(dynamic-page), 이 커맨드를 한 번이라도 부르면
  전 페이지가 올라오고 세션이 끝날 때까지 안 내려간다. 세션당 한 번으로 아끼고,
  이후엔 `nodeId` 로 범위를 좁힌 커맨드를 쓴다.

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
| `get_instance_census` | 메인 컴포넌트별 인스턴스 수. 라이브러리/로컬 분리. **고아 판정은 key 로 한다**. `instancesFor` 로 특정 컴포넌트(세트 이름 가능)의 위치(id·페이지·경로) 목록 — 레이어 이름이 컴포넌트 이름과 다른 인스턴스를 찾는 유일한 수단. ⚠️ 화면이 많은 페이지(수백 개)에선 시간 초과가 날 수 있다 — 그땐 화면을 골라 `reset_instance_overrides({dryRun})` 로 최상위 인스턴스를 뽑는다 | R | ⚠️ |

### 컴포넌트 · 인스턴스

| 커맨드 | 하는 일 | 구분 | |
|---|---|:--:|:--:|
| `get_local_components` | 로컬 컴포넌트·세트 전부. name·type·**key**·**description**·documentationLinks·page·parent·**변이 축**. `checkPublished` 로 발행 상태(느림) | R | ⚠️ |
| `get_component_properties` | **`componentPropertyDefinitions`** — 위 커맨드가 안 주는 **BOOLEAN·TEXT·INSTANCE_SWAP** 프로퍼티. `nodeIds` 또는 `pageName` | R | `pageName` 사용 시 ⚠️ |
| `create_component_instance` | 컴포넌트 인스턴스 생성. **`.` 접두사 컴포넌트는 실패한다**(발행 자산이 아님) | W | |
| `get_instance_overrides` | 인스턴스에서 오버라이드 추출 | R | |
| `set_instance_overrides` | 추출한 오버라이드를 대상 인스턴스에 적용 | W | |
| `swap_instances_by_key` | 인스턴스의 메인 컴포넌트를 **key 로 교체**(고아 재바인딩). `.` 접두사엔 `viaNodeId` 필수. 교체 전 **절대 위치(ABSOLUTE)·constraint 를 기록했다가 되돌린다**(`positioningKept`) | W | ⚠️ |
| `get_instance_properties` | 인스턴스의 **현재 속성값**(VARIANT·BOOLEAN·TEXT·INSTANCE_SWAP) — `get_node_info` 가 안 주는 것. 중첩 인스턴스까지, variant 는 선택지, **속성에 걸린 토큰(변수)** 도 준다 | R | |
| `set_instance_properties` | 인스턴스 속성값 쓰기(중첩 id `I123:4;5:6` 가능). 값에 `{variableName}` 을 주면 **속성에 토큰을 건다**(예: `size` ← `variants/double`), 평범한 값을 주면 토큰이 풀린다 | W | |
| `reset_instance_overrides` | 인스턴스 **reset 후 원래 보이던 것을 되돌린다** — 속성값과 그 토큰, 교체된 컴포넌트, 표시 여부, 텍스트, 하위 크기, 인스턴스 자신의 위치·크기·constraint·필드 토큰(maxHeight 등). ⚠️ **색 토큰은 되돌리지 않고** `droppedColorTokens` 로 보고만 한다(되돌릴지는 컴포넌트마다 다름). 실패는 `stage` 와 함께 보고, 텍스트는 끝까지 재시도(`textUnrestored`), 확인이 필요한 건 `incomplete`. `dryRun` 먼저 | W | |
| `detach_instances` | 하위 인스턴스를 분리. 중첩까지 닿도록 여러 패스(`maxPasses`). ⚠️ 되돌릴 수 없다 — `dryRun` 먼저 | W | |
| `create_component_from_node` | 프레임 등을 그 자리에서 **컴포넌트로 변환**(Cmd+Opt+K). 원래 id 는 무효가 된다 | W | |
| `combine_as_variants` | 컴포넌트 여럿을 **variant 세트로 합치기**. 먼저 `type=table` 식으로 이름을 맞춰 둔다. 기존 인스턴스 연결 유지 | W | |
| `add_component_property` | 컴포넌트(또는 variant 세트)에 BOOLEAN·TEXT 속성 추가 + 하위 레이어 연결 | W | |
| `edit_component_property` | 비-variant 속성의 기본값 수정 또는 삭제. 삭제 시 연결돼 있던 레이어를 알려준다. VARIANT 기본값은 못 바꾼다. `dryRun` 먼저 | W | |
| `set_component_description` | COMPONENT·COMPONENT_SET **설명 쓰기** — 유일한 수단(`get_local_components` 는 읽기만) | W | |
| `rename_variant_property` | 변이 속성 **키** 개명. 인스턴스 선택값 이관까지 책임진다. ⚠️ **값 개명·순서 변경은 이걸로 안 된다** | W | |

### 변수 · 스타일

| 커맨드 | 하는 일 | 구분 | |
|---|---|:--:|:--:|
| `get_local_variables` | 변수 컬렉션·변수 전부(모드·scope·모드별 값·alias 해석·색은 HEX). **`key` 포함** | R | |
| `get_variable_modes` | 프레임의 **변수 모드 진단**(예: resolution 9-inch/11-inch) — 적용 모드와, 노드·직계 자식별 위치·크기·constraint·배치·사이징·필드/속성 토큰(해석값 포함). **해상도를 바꿨을 때 무엇이 따라가고 무엇이 고정인지** 볼 때 | R | |
| `set_variable_mode` | 노드가 쓰는 컬렉션 모드 전환(우측 패널에서 모드 고르기와 같음). 컬렉션·모드는 이름으로 | W | |
| `find_variable_usage` | 주어진 변수를 **자기 레이어에서** 쓰는 메인 컴포넌트 목록(칠·선·효과·텍스트 범위·숫자 필드·변수 걸린 페인트 스타일). 중첩 인스턴스는 건너뜀. `fromPage`/`toPage` 로 범위 | R | ⚠️ |
| `replace_variable_bindings` | 한 컬렉션(이름으로 매칭, 라이브러리 포함)의 바인딩을 **다른 변수로 일괄 재바인딩**. `matchBy` `alias`(가리키는 변수로) 또는 `value`(같은 값의 로컬 변수로) | W | ⚠️ |
| `rename_variables` | 로컬 변수 이름 **일괄 개명**(`variableId` 또는 `collection`+`name` → `newName`). id 로 묶여 있어 바인딩·alias 는 유지. 컬렉션 안 이름 충돌은 쓰지 않고 `errors`. `dryRun` 먼저 | W | |
| `apply_text_styles` | 텍스트 스타일 없는 TEXT 에 **같은 모양의 로컬 텍스트 스타일**을 건다(크기·폰트·줄 높이·자간 px 환산 일치). 후보 여럿이면 `prefer` 순, 없으면 `ambiguous`. 못 맞춘 조합은 `noMatchShapes`. 인스턴스 안은 기본 건너뜀. `dryRun` 먼저 | W | |
| `create_text_styles` | 로컬 **텍스트 스타일 만들기**. `copyFrom` = 기존 스타일 값·변수 바인딩 복사 후 항목 값으로 덮기, `bind` = 필드별 변수(id 또는 `variableCollection` 안 이름). `.`·`_` 시작 이름은 발행 안 됨. 같은 이름은 `update` 없으면 `errors`. `dryRun` 먼저 | W | |
| `set_hyperlink` | TEXT 글자 범위(`match` 또는 `start`/`end`, 없으면 전체)에 **링크**. 같은 파일 노드(`targetNodeId`) 또는 `url`. `underline` 으로 밑줄, `remove` 로 해제. `dryRun` 먼저 | W | |
| `create_variables` | 로컬 **변수 만들기**. `copyFrom`(같은 컬렉션) = 타입·scope·모드별 값(투명도 붙은 alias 포함) 복사 후 `values` 로 모드별 덮기 — `{hex}` · `{alias, aliasCollection?, opacity?}` · 숫자·문자열·불리언. 같은 이름은 `errors`. `dryRun` 먼저 | W | |
| `get_styles` | 로컬 스타일. ⚠️ 텍스트 스타일은 `fontSize`·`fontName` 만 — **행간·자간은 안 준다** | R | |
| `bind_variable` | 여러 노드의 한 속성을 변수에 **일괄 바인딩**(하드코딩 수정). 칠·선·모서리·간격·패딩·선 굵기, **width·height·min/max width·height**(예: 패널 width ← `size/panel`, maxHeight ← `max/panel`). `variableName` 은 로컬 → 활성 라이브러리 순으로 찾는다. 이미 묶인 건 `skipped`(색은 `overwrite`). **`dryRun` 이 "지금 묶여 있나"의 판별기** | W | |
| `unbind_variable` | 위의 반대. 값은 남고 **렌더는 안 바뀐다**. `strokeWeight` 는 per-side 네 필드까지 훑는다. 색(`fills`)은 아직 안 받는다. ★ **stroke paint 가 없는 노드의 굵기 바인딩은 피그마 UI 에 안 떠서 손으로 못 지운다 — 이게 유일한 수단** | W | |
| `unbind_styles` | 공유 **스타일** 바인딩 해제(값 유지). ⚠️ **변수엔 안 듣는다.** 되돌릴 수 없으니 `dryRun` 먼저 | W | ⚠️ |

### 생성

| 커맨드 | 하는 일 | 구분 |
|---|---|:--:|
| `create_rectangle` | 사각형 | W |
| `create_frame` | 프레임 | W |
| `create_section` | 섹션(캔버스 그룹) | W |
| `create_text` | 텍스트. `fontFamily`·`fontStyle` 지정 가능(안 주면 조용히 Inter), `width` 로 줄바꿈 | W |
| `create_vector_from_svg` | SVG(인라인 또는 `svgPath` 파일)를 **편집 가능한 벡터**로 가져오기. `flatten` 으로 하나로 합침 | W |

### 편집 — 텍스트

| 커맨드 | 하는 일 | 구분 |
|---|---|:--:|
| `set_text_content` | 텍스트 노드 하나 | W |
| `set_multiple_text_contents` | 여러 개 일괄. 안에서 5개씩 나눠 처리해서 **수십 개도 한 번에** 넘겨도 된다(78개 확인). 다른 인스턴스 안의 TEXT(중첩 id)도 된다 | W |
| `set_text_style` | 기존 TEXT 의 크기·글꼴·행간·자간·정렬만 바꾼다(다시 만들지 않음) | W |

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
| `set_constraints` | constraint(MIN·CENTER·MAX·STRETCH·SCALE), 프레임 `clipsContent`, **절대 위치(`positioning` ABSOLUTE/AUTO)와 x/y**. 오토레이아웃이 아닌 부모엔 ABSOLUTE 를 거부. 전후 값 보고, `dryRun` 은 읽기용. ★ 해상도 테스트에서 **겹쳐야 하는 레이어(지도·카펫·차량)는 같은 기준(CENTER/CENTER)** 이어야 같이 움직인다 | W |
| `set_size_constraints` | 오토레이아웃 프레임·자식의 min/max 너비·높이. `null` 로 해제 | W |
| `grid_layout` | GRID 오토레이아웃 셀 배치 읽기·쓰기. 자식의 행/열 인덱스는 읽기 전용이라 `op:"place"` 가 유일한 이동 수단 | W |

### 편집 — 스타일링

| 커맨드 | 하는 일 | 구분 |
|---|---|:--:|
| `set_fill_color` | 채우기 색 (RGBA) | W |
| `set_stroke_color` | 선 색·굵기 | W |
| `set_corner_radius` | 모서리 반경(코너별 지정 가능) | W |
| `set_image_fill` | 로컬 경로·URL·base64 이미지로 채우기 | W |
| `set_multiple_opacity` | 여러 노드 불투명도(0–1). ⚠️ **쓰기라 현재값이 날아간다** — 읽으려면 `find_hidden_nodes({includeFaded})` | W |
| `set_visible` | 여러 노드 보이기·숨기기(눈 아이콘). 숨긴 오토레이아웃 자식은 자리를 차지하지 않는다 | W |
| `clear_fills` | 채우기를 전부 제거(`fills = []`). `set_fill_color` 알파 0 은 투명 채우기가 남는다 | W |
| `set_stroke_style` | 선 join·정렬·cap·miter·대시. 날카로운 모서리 가시는 `strokeJoin` ROUND/BEVEL 로 | W |
| `get_vector_paths` | VECTOR 의 경로(SVG path)·칠·선. `get_node_info` 보다 훨씬 가볍다 | R |
| `set_vector_paths` | VECTOR 경로만 교체(칠·선·이름·순서 유지) | W |

### 편집 — 복제 · 삭제 · 이름

| 커맨드 | 하는 일 | 구분 |
|---|---|:--:|
| `clone_node` | 노드 복제 | W |
| `clone_multiple_nodes` | 여러 개 복제 + `parentId`·`index`·`name` 지정. 클론 안 TEXT 목록도 반환. ⚠️ 무거운 페이지에선 **10개 이하로** | W |
| `delete_node` | 삭제 | W |
| `delete_multiple_nodes` | 일괄 삭제. **50개씩 끊는 게 안전** | W |
| `rename_node` | 이름 변경 | W |
| `rename_multiple_nodes` | 일괄 이름 변경 | W |

### 내보내기 · 연결

| 커맨드 | 하는 일 | 구분 |
|---|---|:--:|
| `export_node_as_image` | PNG/JPG/SVG/PDF 로 내보내기(현재 base64 텍스트 반환) | R |
| `join_channel` | 채널 접속. **모든 작업 전에 먼저** | — |

## 개발

- 플러그인: `src/figma_plugin/code.js`·`ui.html` 을 직접 고친다(빌드 없음). 고친 뒤 `node --check src/figma_plugin/code.js` 로 문법 확인, 피그마에서 플러그인 재실행
- MCP 서버: `src/talk_to_figma_mcp/server.ts` 수정 → `bun run build`(감시 모드는 `bun run dev`) → Claude Code `/mcp` 재연결
- `dist/` 는 `.gitignore` 에 있지만 추적 중이라, 커밋할 땐 `git add -f dist`

## 작업 요령

1. 명령 전에 항상 `join_channel` 로 채널에 접속한다
2. `get_document_info` 로 지금 연결된 파일·페이지를 먼저 확인한다
3. 고치기 전에 `get_selection` 으로 선택 범위를 확인한다
4. 쓰기 도구는 `dryRun` 이 있으면 먼저 돌려 본다
5. 고친 뒤에는 `export_node_as_image` 로 전후를 눈으로 비교한다
6. 큰 작업은 나눠서 한다 — 인스턴스 reset 은 100개 안팎씩, 텍스트는 한 번에 수십 개까지
7. 모든 명령은 실패할 수 있으니 결과의 `failed`·`skipped`·`errors` 를 확인한다

## 라이선스

MIT
