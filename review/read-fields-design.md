# 읽기 명령 결과 줄이기 옵션 (fields / summary / maxDepth) — 설계안

상태: 설계 검토 중. 구현 전.
근거 숫자: `review/code-mode` 브랜치의 `review/code-mode-review.md` §4 [측정]. 측정 스크립트는 같은 브랜치의 `scripts/measure/`.
세션 표기: 문서와 스크립트에 새로 넣는 세션은 S1, S2… 로 쓴다. 실제 세션 id 와의 대응표는 저장소 밖 개인 캐시 폴더에 둔다.

## 1. 대상 명령

| 명령 | 넣나 | 옵션 | 이유 |
|---|---|---|---|
| get_node_info | **넣음** | fields, maxDepth | 결과의 97%가 `children`. 다음 턴에 쓴 필드만 남기면 −59%(낙관) / −31%(보수). 파일로 빠진 결과 25건 |
| get_nodes_info | **넣음** | fields, maxDepth | −59% / −23%. 파일로 빠진 결과 13건. **봇이 `/ux-check listing` 시드 확인에 옵션 없이 부른다** |
| find_hidden_nodes | **넣음** | fields, summary | `findings[].path`·`detail` 이 크다. −45% / −37% |
| find_nodes_by_name | **넣음** | fields, summary | −69% / −21%. `idsOnly` 는 이미 있다 |
| get_instance_census | **넣음** | fields, summary | `components[].key` 가 크다. −82% / −60%. 파일로 빠진 결과 24건 |
| get_variable_bindings | **summary 만** | summary | 73건 중 65건이 개수만 봤다. 기존 `detail:false` 는 `findings` 만 빼고 가장 큰 `byVariable` 은 남긴다 |
| get_instance_properties | 뺌 | — | −20% / −3%. 모델이 읽는 것이 `properties` 그 자체. 공유 `jsonToolHandler` 를 써서 따로 떼야 한다 |
| get_document_info | 뺌 | — | 0% (거의 id·name·type). 봇의 허용 도구 |
| export_text_tree · build_review_listing · inspect_paints | **대상 아님** | — | 봇 명령. 바꾸지 않는다 |

## 2. 공유 코드 점검

TypeScript 파서로 `server.ts`·`code.js` 의 최상위 함수 호출 그래프를 만들었다. 각 명령의 진입 함수에서 닿는 함수를 모아 봇 명령 쪽과 비교했다. 중계 서버 `socket.ts` 는 명령을 가리지 않고 채널로 넘기기만 한다.

| 층 | 대상 명령이 쓰는 함수 | 봇 명령도 쓰나 | 이번에 |
|---|---|---|---|
| MCP 서버 | `sendCommandToFigma`, `connectToFigma`, `jsonResult`, `errorResult` | **예** | 손대지 않음 |
| MCP 서버 | `filterFigmaNode`, `rgbaToHex` | 아니오 (get_node(s)_info 전용) | 손대지 않음. 옵션 처리는 이 출력 **뒤에** |
| MCP 서버 | `jsonToolHandler` | 아니오 (다른 도구 여럿) | 손대지 않음 |
| MCP 서버 | 대상 6개의 `server.tool(...)` 등록 | 아니오 | **여기만 바꾼다** |
| 플러그인 | `getNodeInfo`, `getVariableBindings`, `findHiddenNodes`, `findNodesByName`, `getInstanceCensus` 와 하위 함수 | 아니오 | 손대지 않음 |
| 플러그인 | `errMsg` | **예** (review_section) | 손대지 않음 |
| 플러그인·중계 | 디스패처 `handleCommand`, `socket.ts` | 모든 명령 | 손대지 않음 |

결정: **옵션 처리는 MCP 서버의 대상 명령 등록 콜백 안에서만, 플러그인 결과를 받은 뒤에 한다.**
- 플러그인·중계 서버·공유 함수는 바꾸지 않는다.
- 플러그인에 보내는 파라미터 객체도 지금 그대로 두고, 새 옵션은 보내지 않는다.
- 플러그인→서버 구간은 지금처럼 전체 결과가 오간다. 줄어드는 것은 모델 문맥뿐이다.

## 3. 옵션 설계

### 3.1 기본값 = 현재 동작

```ts
if (fields === undefined && maxDepth === undefined && summary === undefined) {
  /* 지금 코드 그대로 — 바꾸지 않은 블록 */
}
```

옵션 처리는 새 파일 `readOptions.ts` 의 순수 함수로만 한다. 입력을 고치지 않고 새 객체를 만든다.

### 3.2 명령별 옵션

`id` 는 늘 남긴다. 구조를 담는 `children` / `findings` / `components` / `instances` 도 남긴다.

| 명령 | fields | summary | maxDepth |
|---|---|---|---|
| get_node_info · get_nodes_info | `name, type, fills, strokes, cornerRadius, absoluteBoundingBox, characters, style`. 모든 깊이에 적용 | — | 기본 없음 = 끝까지(지금과 같음). `0` = 노드 자신만. 잘린 노드에 `childCount` (옵션을 줬을 때만) |
| find_hidden_nodes | findings[]: `name, type, page, path, reasons, detail` | `scannedNodes, totalFindings, byReason, nameFilter` | — |
| find_nodes_by_name | findings[]: `name, type, page, path, parentId, parentType, component, variant` | `name, exact, scannedNodes, totalFindings, byType` | — |
| get_instance_census | components[]: `key, componentName, componentSetName, source, count` · `instances.name, instances.page, instances.path` | 총계(`totalInstances, libraryInstances, localInstances, uniqueComponents, unresolvedInstances, matchedInstances`) + 개수 상위 20개 `[componentName, count, source]` | — |
| get_variable_bindings | — | `scannedNodes, totalFindings`, `byProperty`·`byValue`·`byTextStyle` 그대로, `byVariable` 은 `{이름: total}` | — |

### 3.3 잘못된 값 거부

| 입력 | 방법 | 결과 |
|---|---|---|
| 목록에 없는 필드, 빈 배열 | `z.array(z.enum([...])).min(1)` | 핸들러 전에 검증 오류(허용 값 목록 포함). 플러그인 호출 없음 |
| `maxDepth` 음수·소수·21 이상 | `z.number().int().min(0).max(20)` | 같음 |
| `summary` + `fields`, `summary` + `idsOnly`, `summary` + `detail:true` | 등록 콜백 첫 줄에서 검사 | `errorResult("Refused: …")`, 플러그인 호출 없음 |
| **모르는 옵션 이름**(`field` 오타 등) | **strict 로 거부할 수 있다** (아래) | 검증 오류 `unrecognized_keys` |

**strict 확인 결과** (SDK 1.13.1)
- `server.tool()` 은 받은 모양을 늘 `z.object(shape)` 로 감싼다. 기본은 모르는 키를 조용히 버리는 것이다.
- `server.tool()` 이 돌려주는 등록 객체의 `inputSchema` 를 `inputSchema.strict()` 로 바꾸면, 그 도구만 모르는 키를 거부한다. 메모리 안 MCP 연결로 시험했다.
  - 오타 키 `field` → `unrecognized_keys` 오류
  - 정상 호출 → 그대로
  - `tools/list` 의 스키마 JSON → strict 전과 **같음** (원래 `additionalProperties: false`)
- 바뀌는 것: 지금까지 조용히 버려지던 모르는 키가 오류가 된다. 지난 20세션의 대상 명령 호출 515건 중 모르는 키를 넘긴 호출은 **0건** [측정].
- 주의: SDK 의 등록 객체 필드에 기대는 방식이다. `update()` 를 부르면 다시 느슨해진다(이 저장소는 `update()` 를 쓰지 않는다). SDK 를 올릴 때 다시 확인한다.
- 적용 범위: 대상 6개 명령만. 다른 도구의 등록은 바꾸지 않는다.

### 3.4 기존 안전장치

- `protectedPageIds`(build_review_listing): 그 등록 콜백과 플러그인 `reviewPage`·`reviewSection` 을 건드리지 않으므로 그대로다. 서버·플러그인 두 겹 거부도 그대로다.
- 원본 복제만 허용, 새 페이지 이름 확인, `expectFileName`: 같은 이유로 그대로다.
- 대상 명령은 모두 읽기라 쓰기 경로가 생기지 않는다.

## 4. dist

- 지금 main 작업 폴더의 `dist/`(커밋 안 됨, 4개 파일)는 커밋된 main 소스를 다시 빌드한 결과와 **바이트 단위로 같다**(소스맵 포함).
- 돌고 있는 MCP 서버는 이 dist 로 떠 있다.
- 커밋된 dist 는 8ffc4e8 빌드라 뒤 커밋(f882488 배지 useKey, 3ad3535 protectedPageIds 서버 거부, 84d38dc selfTestProtectNewPage)이 빠져 있다. 커밋된 dist 만 쓰면 서버 쪽 `protectedPageIds` 거부가 없다.
- 제안:
  1. main 에서 **소스 변경 없이 dist 만** 다시 빌드한 커밋을 먼저 만든다. 내용은 지금 작업 폴더 dist 와 같다.
  2. `feat/read-fields` 를 그 커밋 위로 올린다.
  3. 브랜치에서는 소스를 바꾼 커밋마다 `bun run build` 로 dist 를 같이 커밋한다.
  4. 합칠 때 dist 충돌은 손으로 고치지 않는다. 합친 소스로 다시 빌드한 결과를 쓴다.
- 1번은 사람이 정한 뒤에 한다.

## 5. 봇 회귀 기준선과 비교

### 5.1 격리

- 테스트 리뷰 회차는 ux-writing-check 의 **별도 git worktree**(저장소 밖)에서 만든다.
- `preflight` 의 `root` 가 그 worktree 를 가리키므로, `export_text_tree` 출력과 `rounds/<회차>` 가 그 worktree 안에만 생긴다. 실제 저장소의 `rounds/` 에는 아무것도 생기지 않는다.
- 판정 캐시(`cache/`)는 실제 저장소에서 복사한다. 같은 문구는 다시 판정하지 않는다.
- 회차 이름에 `-base`·`-branch` 같은 꼬리표를 붙여, 실수로 옮겨도 실제 회차와 구분되게 한다.

### 5.2 비교 항목

**반드시 같아야 하는 것** — 하나라도 다르면 합치지 않는다
1. **리뷰 페이지·파일 이름 확인**: `expectFileName` 통과. 덤프의 `fileName`·`page`·`root`.
2. **생성된 노드 구조**: `ui-dump-raw.json` 전체(`exportedAt` 제외). 텍스트 노드 id·글자·경로·위치·크기 설정·채우기, `topFrames`, `textCount`.
3. **검토 대상 노드 목록**: `to-be.json`(섹션·to-be 화면), `ui-texts.json`(점검 단위), `excluded.json`, `ui-dump.json`.
4. **스크립트 판정**: `lint.json`, `consistency.json`. 모델이 아니라 규칙이 낸 값이다.
5. **원본은 복제만**: 리뷰 페이지 덤프만으로는 확인할 수 없다. 합치기 전에 `/ux-check listing` 4단계의 `build_review_listing(dryRun: true)` 결과(섹션 수·changed·missing·원본 id)를 main 과 브랜치에서 비교한다. dryRun 은 쓰지 않는다. `selfTestProtectNewPage` 는 빈 페이지를 남기므로 사람이 정할 때만 돌린다.

**달라도 되는 것**
- 모델 판정과 문구 제안: `judge.json`, 그것이 들어간 `report.json`·`report.md`.

비교 도구: 회차 폴더의 1~4를 정규화(키 정렬, `exportedAt`·`round` 제외)해 해시로 만든 지문. 같은 페이지를 두 번 덤프해도 지문이 같은지 확인했다.

### 5.3 기준선 (main 1d073aa)

| 항목 | 값 |
|---|---|
| ux-writing-check `pytest -q tests` | 169 passed |
| `/ux-check review` | 페이지 이름 확인: 통과 · ① 바뀐 문구 위반 0 · ② 그대로 문구 위반 5 · ③ 일관성 0묶음. to-be 58섹션, 텍스트 1,138(바뀐 표시 177), 덤프 3,071 텍스트 |
| 지문 재현성 | 같은 페이지를 두 번 덤프 → 1~4 모두 같음 |

## 6. 바꿀 파일 (구현 단계)

| 파일 | 변경 |
|---|---|
| `src/talk_to_figma_mcp/readOptions.ts` | 새 파일. `projectNode`, `pruneDepth`, `projectFindings`, 명령별 `summarize*` |
| `src/talk_to_figma_mcp/server.ts` | 대상 6개 등록에 옵션 키 추가, 옵션이 있을 때만 `readOptions` 호출, 등록 객체 `inputSchema` 를 `.strict()` 로 |
| `dist/*` | `bun run build` 결과 (`git add -f dist`) |
| `scripts/read-options/unit.mjs` | 새 파일. 손으로 만든 가짜 결과로 순수 함수 시험 |
| `scripts/read-options/golden.mjs` | 새 파일. main 빌드와 브랜치 빌드(각각 저장소 밖 worktree)로 같은 노드를 불러 옵션 없음 결과를 바이트 비교 |
| 바꾸지 않음 | `src/figma_plugin/*`, `src/socket.ts`, 공유 함수, 봇 명령 3개의 등록 |

## 7. 검증 계획

1. **옵션 없음 = main**
   - 대상 6개를 고정 파라미터로 부른다. 봇의 `get_nodes_info(seeds)` 를 포함한다.
   - main → 브랜치 → main 순으로 돌려 바이트를 비교한다. 한 바이트라도 다르면 실패.
2. **옵션 동작**: `unit.mjs`, 그리고 golden 에서 옵션을 준 호출의 결과.
3. **줄어든 토큰 [측정]**
   - golden 에서 같은 노드의 옵션 없음·있음 결과 크기를 비교한다(글자 수 × 0.516).
   - 구현 뒤 실제 세션의 대표 작업 3개 유형을 `scripts/measure` 로 다시 잰다.
4. **봇 회귀**: 합치기 전에 격리 worktree 에서 `pytest` 와 `/ux-check review` 를 다시 돌린다.
   - 5.2 의 "반드시 같아야 하는 것" 1~5 를 기준선과 비교한다. **하나라도 다르면 합치지 않는다.**
   - "달라도 되는 것"은 차이를 기록만 한다.
