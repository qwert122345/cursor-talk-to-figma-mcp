# 토큰 측정 스크립트

`review/code-mode-review.md` 의 숫자를 다시 내는 스크립트다. 클로드 코드 세션 로그(`~/.claude/projects/**/*.jsonl`)에서 TalkToFigma 를 부른 본 세션만 골라 읽는다. 서브에이전트 로그는 뺀다.

## 실행 (저장소 루트에서)

```bash
bun run build                          # dist/server.cjs 가 있어야 한다
cd scripts/measure
# 결과 폴더: 기본 ~/.cache/talk-to-figma-measure (0700, 파일 0600). 바꾸려면 MEASURE_OUT=<본인 소유 폴더>
node list.mjs ../../dist/server.cjs    # 도구 정의 96개 → tools.json
node extract.mjs                       # 세션 타임라인 → events.json
node calib.mjs                         # 토큰/글자 계수(usage 기반 회귀)
node compose.mjs                       # Messages 구성, 명령별 결과 토큰, 파일로 빠진 결과
node fields.mjs                        # 다음 턴에 쓴 필드 → fields.json
node sim.mjs                           # Code Mode 접기·거르기, fields 옵션, 세션 나누기
node breakdown.mjs                     # Messages 항목별 내역, 파일 다시 읽기, 세션 나누기 순감소
node segs.mjs && node rep.mjs          # 대표 구간 후보와 비교
```

## 주의

- `sim.mjs` 와 `breakdown.mjs` 는 첫 인자로 가정값을 JSON 으로 받는다. 예: `node breakdown.mjs '{"minLen":500,"summary":5000}'`
- 숫자가 문서와 다르면 로그가 늘어났기 때문이다. 세션이 추가되면 결과도 바뀐다.
- `breakdown.mjs` 의 R 총량(730.4M)은 문서 작성 당시의 값을 코드에 적어 둔 것이다. 로그가 바뀌면 `sim.mjs` 출력값으로 고친다.
- `rep.mjs` 는 문서에 쓴 구간을 세션 id 앞부분과 호출 순번으로 고른다.
- 결과 폴더에는 로그 원문이 들어 있다. 커밋하지 말고, 공유 `/tmp` 처럼 남이 쓸 수 있는 곳에 두지 않는다. 심볼릭 링크이거나 다른 사용자 소유인 폴더면 스크립트가 멈춘다.
