# CLAUDE.md

Claude Code 가 이 저장소에서 작업할 때 참고하는 안내다.

## 개요

Claude Code 와 피그마를 잇는 MCP(Model Context Protocol) 서버. 세 부분이 이어져 동작한다.

```
Claude Code ←(stdio)→ MCP 서버 ←(WebSocket)→ 중계 서버 ←(WebSocket)→ 피그마 플러그인
```

## 명령

```bash
bun install      # 의존성 설치
bun run build    # MCP 서버 빌드 (tsup → dist/)
bun run dev      # 감시 모드 빌드
bun socket       # WebSocket 중계 서버 (포트 3055, 127.0.0.1 만). 저장소 밖에선 talk-to-figma-socket
bun setup        # 설치 + 빌드 + .mcp.json 작성 + ~/.local/bin/talk-to-figma-socket 링크
node --check src/figma_plugin/code.js   # 플러그인 문법 확인
```

테스트 스위트·린터는 없다. `test-ds-commands.mjs` 는 플러그인 일부 명령을 가짜 figma 객체로 돌려 보는 하네스다.

## 구조

### MCP 서버 (`src/talk_to_figma_mcp/server.ts`)
`@modelcontextprotocol/sdk` 로 도구(90여 개)와 작업 안내 프롬프트를 정의한다. Claude Code 와는 stdio, 중계 서버와는 `ws` 로 통신한다. 요청마다 UUID 를 붙여 `pendingRequests` 에 넣고, 플러그인 응답이 오면 끝낸다. 도구를 추가할 땐 `FigmaCommand` 유니언과 `server.tool` 등록을 함께 고친다.

### 중계 서버 (`src/socket.ts`)
Bun WebSocket 서버(포트 3055, `PORT` 환경변수로 변경). 채널 단위로 MCP 서버와 플러그인을 잇는다. `join` 으로 채널에 들어가고, 메시지는 같은 채널에만 전달된다.

### 피그마 플러그인 (`src/figma_plugin/`)
피그마 안에서 돈다. `code.js` 가 디스패처로 명령을 처리하는 본체, `ui.html` 이 연결 창, `manifest.json` 이 권한(dynamic-page, teamlibrary, localhost). **빌드하지 않는다** — `code.js` 가 그대로 실행 파일이다.

## 지켜야 할 것

- **반영 순서**: `code.js` 수정 → 피그마에서 플러그인 재실행(채널 ID 가 바뀜). `server.ts` 수정 → `bun run build` → Claude Code `/mcp` 재연결 → 새 채널로 `join_channel`
- **`dist/`**: `.gitignore` 에 있지만 추적 중이다. 커밋할 땐 `git add -f dist`
  - `src/talk_to_figma_mcp/` 를 바꾼 커밋에는 **같은 커밋에** `bun run build` 한 dist 를 넣는다(커밋된 dist 가 소스보다 뒤처지지 않게)
  - 합치기·리베이스에서 dist 가 충돌하면 **손으로 고치지 않는다.** 합친 소스로 `bun run build` 를 다시 돌려 그 결과를 넣는다
- **`.mcp.json`**: 사람마다 경로가 다르니 커밋하지 않는다
- **dynamic-page**: 다른 페이지 노드는 `getNodeByIdAsync`, 전 페이지 순회는 `loadAllPagesAsync` 가 필요하다(무거우니 꼭 필요할 때만)
- **색**: 피그마는 RGBA 0–1. 도구도 0–1 을 받고 표시할 땐 HEX 로 바꾼다
- **로그**: 전부 stderr. stdout 은 MCP 프로토콜 전용
- **시간 제한**: 명령마다 기본 30초. 플러그인이 진행 상황을 보내면 연장된다. 100개가 넘는 작업은 나눠서 진행 상황을 보낸다
- **검증**: 도구 파라미터는 Zod 스키마로 검증한다
- **실패 보고**: 쓰기 도구는 한 항목이 실패해도 나머지를 계속하고, 결과에 `failed`·`skipped`·`errors` 로 남긴다. catch 안에서는 `error.message` 대신 `errMsg(error)` 를 쓴다(피그마는 Error 가 아닌 값을 던지기도 한다)
