#!/bin/bash
# 의존성 설치 → MCP 서버 빌드 → Claude Code 용 .mcp.json 작성(이 저장소의 dist/server.js 를 가리킨다).
# npm 의 원본 패키지(cursor-talk-to-figma-mcp@latest)에는 이 저장소에서 추가한 도구가 없으므로 쓰지 않는다.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bun install
bun run build

cat > .mcp.json <<EOF
{
  "mcpServers": {
    "TalkToFigma": {
      "command": "bun",
      "args": [
        "$ROOT/dist/server.js"
      ]
    }
  }
}
EOF
echo "✓ Claude Code MCP 설정을 .mcp.json 에 썼습니다 ($ROOT/dist/server.js)"
