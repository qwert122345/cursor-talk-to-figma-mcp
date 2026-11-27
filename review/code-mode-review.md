# Code Mode 적용 검토 — 측정 보완판 (2026-11-27)

## 결론

| 항목 | 판단 | 근거 |
|---|---|---|
| **Code Mode** | **보류** | 읽기만 연달아 한 턴이 피그마 턴의 10.6%뿐이다 [측정]. 그 턴을 전부 합쳐도 다시 읽는 Messages 가 최대 −8.4% 줄어든다 [추정] (§3) |
| **세션 나누기** | **바로 적용하는 운영 규칙으로 채택.** 코드 변경 없음 | 시작 비용과 넘겨받기 비용을 빼고도 다시 읽는 Messages 가 −14~25% 줄어든다. 가운데 값은 약 −18% (§3.2) |
| **fields / summary 옵션** | **UX 라이팅 봇 완성 후 구현** | 다시 읽는 Messages −7~14%, 추가량 −6~12% [측정 기반] (§4) |

세션 나누기 운영 규칙(제안)
- 새 작업을 시작할 때, 즉 새 지시를 길게 적거나 붙여넣을 때는 새 세션을 연다.
- 이전 작업에서 이어 갈 내용은 2K 토큰 안쪽 요약으로 넘긴다.
- 같은 작업 안의 짧은 이어 말하기("응", "계속")에서는 끊지 않는다.

fields / summary 옵션 구현 범위
- **대상 명령**: get_nodes_info, get_node_info, get_variable_bindings, find_hidden_nodes, get_instance_properties, find_nodes_by_name, get_instance_census. get_document_info 는 줄일 게 없어 뺀다. 남길 필드의 근거는 §4 표다.
- **쓰기 명령**: reset_instance_overrides, unbind_variable 의 dryRun 결과에 summary 꼴을 넣는다.
- **제외**: 봇 명령 3개(**export_text_tree, build_review_listing, inspect_paints**)는 바꾸지 않는다.
- **순서**: 별도 브랜치 → `bun run build` → 플러그인 재실행·`/mcp` 재연결 → **main 에 합치기 전에 ux-writing-check 에서 회귀 테스트와 `/ux-check review` 를 실행한다.** protectedPageIds 거부, selfTestProtectNewPage 가 aborted 로 멈추는지, 원본 복제만 하는지를 확인한다 → `scripts/measure/` 로 다시 재서 이 문서와 비교한다.

확정된 설계(Code Mode 를 나중에 할 경우): 안전장치 유지(protectedPageIds, 봇 명령·파일 경로 명령·join_channel 제외), QuickJS, 1단계는 읽기 전용.

---

표기: **[측정]** 로그에서 직접 센 값 · **[측정·환산]** 측정한 계수로 글자 수를 토큰으로 바꾼 값 · **[추정]** 가정이 들어간 값(가정을 함께 적는다)

## 출처와 방법

- **로그**: 클로드 코드 세션 로그 중 TalkToFigma 를 부른 본 세션 20개(서브에이전트 제외). 모델: claude-opus-5-5 3,069회 · claude-fable-5-2 119회 [측정]
- **토큰 기준**: 이 환경에는 count_tokens 를 부를 API 자격증명이 없다. 대신 로그의 `usage` 를 쓴다(API 토크나이저가 센 값). 호출마다의 문맥 크기(`input + cache_read + cache_creation`) 차이를 회귀로 나눴다(문맥 증가분 2,489개, R²=0.966).

  | 계수 | 값 [측정] |
  |---|---|
  | 피그마 결과 | 0.516 토큰/자 |
  | 기타 도구 결과 | 0.644 토큰/자 |
  | 모델 출력 | 1.04 (생각 포함 출력이 모두 문맥에 남는다) |
  | 이미지 | 약 101 + 가로×세로/750 × 0.96 |
  | 도구 정의 | 0.43 토큰/자 (ToolSearch 갭 117개) |

- **스크립트**: `scripts/measure/` (실행 방법은 그 폴더의 README)
- **단가**: https://platform.claude.com/docs/en/about-claude/pricing.md (2026-11-26 확인)

## 1. 도구 정의

| 항목 | 값 | 근거 |
|---|---|---|
| 96개 정의 전체 | 84,202자 → **약 36K 토큰** (34~39K) | [측정·환산] tools/list 글자 수 × 0.43 |
| 도구 하나 평균 | 약 375 토큰 | [측정·환산] |
| 사용자 /context 값과 대조 | 9개 3.2K = 개당 356 → 일치 | [측정] |
| 이전 판의 25K | 3.3자/토큰을 가정한 틀린 추정이었다 | 폐기 |
| 세션당 불러온 피그마 도구 | 22개 [측정], 약 7K 토큰 [측정·환산] | |
| 피그마 턴당 캐시 읽기 | 평균 294K 토큰 | [측정] usage.cache_read |

## 2. Messages 구성 (토큰)

- **A (추가량)**: 세션 동안 대화에 붙은 토큰의 합 = 8.67M [측정]
- **R (다시 읽기량)**: 호출마다 그때의 Messages 크기를 더한 값 = 730M, 호출 3,192회, 호출당 평균 229K [측정]. 시스템 프롬프트와 도구 정의는 빼고 Messages 만 센다. 결과가 붙은 뒤 압축(10회 감지) 전까지 몇 번 읽혔는지를 곱한다.

### 2.1 항목별 내역 (A 기준)

| 항목 | 토큰 | A 중 | 근거 |
|---|---|---|---|
| 피그마 결과(텍스트) | 2,790K | 32.2% | [측정·환산] |
| 피그마 이미지 | 161K | 1.9% | [측정·환산] |
| 모델 출력 중 보이는 부분(텍스트·도구 입력) | 1,535K | 17.7% | [측정·환산] 글자 수 × 0.644 |
| 모델 출력 중 생각 | 1,038K | 12.0% | [측정] 출력 토큰 − 보이는 부분 |
| Bash 결과 중 파일로 빠진 피그마 결과 다시 읽기 | 287K | 3.3% | [측정·환산] §2.3 |
| Bash 결과(그 밖) | 969K | 11.2% | [측정·환산] |
| Read 결과 | 411K | 4.7% | [측정·환산] |
| 다른 도구 결과(WebSearch, 브라우저, Edit 등) | 77K | 0.9% | [측정·환산] |
| 도구 정의 로드(ToolSearch) | 169K | 2.0% | [측정] 로드만 있는 갭 124개의 Δ − 출력 |
| 스크린샷·이미지(피그마 밖 도구) | 0 | 0% | [측정] |
| 스킬 로드 | 0 | 0% | [측정] 이 20세션에서는 Skill 호출이 없었다 |
| 사용자 입력 | 952K | 11.0% | [측정 총량 · 추정 배분] |
| 시스템 알림·훅·명령 출력 | 133K | 1.5% | [측정 총량 · 추정 배분] |
| 압축 요약 | 143K | 1.7% | [측정 총량 · 추정 배분] |
| **합** | 8,665K | 100% | |

마지막 세 줄(1,228K)은 A 에서 위 항목을 뺀 나머지다. 이것을 사용자 쪽 텍스트 종류별 글자 수 비율로 나눴다.

피그마 결과는 이 표에서 34.1%다. compose.mjs 의 34.2%와 다른 것은 갭을 고르는 기준이 조금 달라서다.

### 2.2 결과가 큰 명령 — 읽기·쓰기를 나눠서

| | 읽기 상위 10 | 쓰기 상위 10 |
|---|---|---|
| 명령 | get_nodes_info, get_node_info, get_variable_bindings, export_node_as_image, find_hidden_nodes, get_instance_properties, find_nodes_by_name, get_instance_census, get_document_info, get_variable_modes | reset_instance_overrides, unbind_variable, bind_variable, clone_multiple_nodes, apply_text_styles, replace_variable_bindings, edit_component_property, set_multiple_text_contents, set_multiple_layout_sizing, delete_multiple_nodes |
| A 중 | **23.6%** | 6.1% |
| R 중 | **29.0%** | 8.9% |

전체 상위 10개는 피그마 결과의 74.5%, A 의 25.5%, R 의 32.6%다 [측정·환산].

**쓰기 명령 결과가 큰 이유** [측정]: 노드마다 상세 목록을 돌려준다.
- reset_instance_overrides 는 인스턴스마다 `results[]` 를 돌려준다.
- unbind_variable 은 노드마다 `unbound[]` 를 돌려준다.
- 큰 결과는 대부분 dryRun 미리보기다. reset 68회 중 18회, unbind 26회 중 21회가 dryRun 이었다.

### 2.3 파일로 빠진 결과 101건

크기 상한을 넘은 결과는 잘리지 않았다. 클로드 코드가 결과를 파일로 저장하고, 대화에는 원래 크기가 적힌 안내문과 미리보기만 남겼다. 이전 판의 "48K자에서 잘림"은 틀렸다.

| 항목 | 값 |
|---|---|
| 파일로 빠진 결과 | **101건** [측정]: get_node_info 25 · get_instance_census 24 · get_nodes_info 13 · get_local_variables 8 · get_local_components 5 · find_hidden_nodes 5 · get_instance_properties 5 · get_variable_bindings 4 · reset_instance_overrides 4 · find_nodes_by_name 3 · find_variable_usage 3 · scan_text_nodes 1 · unbind_variable 1 |
| 원래 크기 합 (안내문에 적힌 크기, 주요 명령만) | 약 17.6M자 [측정] |
| 그 파일을 다시 읽은 호출 | **Read 0건, Bash(jq·grep 등) 184건**. 101개 중 80개 파일을 읽었다 [측정] |
| 다시 읽은 토큰 | **287K** [측정·환산] |
| 피그마 몫(A 중) | 결과만 34.1% → 다시 읽기를 넣으면 **37.4%** |

## 3. 세 방식 비교 — 다시 읽는 Messages(R) 감소

| 방식 | R 감소 | A 변화 | 구분 | 계산 방법 |
|---|---|---|---|---|
| Code Mode 읽기 전용 · 턴 합치기 | 10%: −0.8% · 40%: −3.4% · 70%: −5.9% · **100%: −8.4%** | −0.4% ~ −3.7% | [추정] | 합칠 수 있는 턴 155개는 [측정]. 각 턴이 사라지면 그 턴의 Messages 를 읽지 않는다. 스크립트 1개 = 250 출력. 중간 결과의 30%는 남김. 실패율 20%면 턴 1개, 오류 300, 스크립트 250 이 더 든다 |
| Code Mode 읽기 전용 · 큰 결과 거르기 | −10.3% | −10.7% | [추정] | 2,000자 이상 읽기 결과 316건이 "이번 턴 필드만"(§4) 비율로 줄어든다. 건마다 스크립트 250 과 실패 20%를 뺀다. fields 옵션과 겹친다 |
| **fields 옵션** | **−6.9% ~ −13.9%** | −6.1% ~ −11.9% | [측정 기반] | §4 |
| **세션 나누기 (순)** | **−14% ~ −25%** | +0.9% (넘겨받기 요약) | 경계·첫 턴은 [측정], 넘겨받기는 [추정] | §3.2 |

**Code Mode 추정 주석**: 위 Code Mode 값에는 search_commands 로 명령을 찾는 턴이 빠져 있다. 재시도도 실패율 20%에서 한 번만 넣었다. §5 대표 작업은 재시도와 검색을 둘 다 뺐다. **실제 효과는 이 값들보다 작다.**

합칠 수 있는 턴 수 [측정]
- 스크립트로 부를 수 있는 읽기 명령만 쓴 턴이 이어진 묶음: 94개
- 하나로 합칠 수 있는 턴: 155개 = 피그마 턴 1,459의 **10.6%**
- 그중 앞 결과의 노드 id 를 다음 입력에 쓴 것: 50개. 나머지 105개는 지금도 한 턴에 병렬로 부를 수 있었다.
- 이전 판에서 쓴 "40%"는 근거가 없는 가정이었다.

### 3.2 세션 나누기 다시 계산

**작업 경계** [측정]
- 사용자가 직접 쓴 입력 중 **200자 이상**인 것(붙여넣은 지시문 포함)을 새 작업 시작으로 봤다.
- 시스템 알림, 명령 출력, 압축 요약은 경계로 치지 않는다.
- 결과: 20세션 → 59구간, 새 세션 39개.
- 비교용으로 500자 이상 기준도 계산했다: 39구간, 새 세션 19개.

| 단계 | R 변화 | 근거 |
|---|---|---|
| 총감소 (새 구간마다 Messages 를 0에서 다시 시작) | −226.7M (**−31.0%**) | [측정] 로그 재계산 |
| 새 세션 시작: 도구 다시 불러오기(그 세션에서 ToolSearch 로 불러온 정의 + join_channel)가 구간의 매 호출에 붙음 | +26.5M (+3.6%) | [측정] ToolSearch 갭 토큰 |
| 새 세션 시작: 시스템 프롬프트·도구·CLAUDE.md 프리픽스 캐시 쓰기 | 새 세션마다 평균 33K. 1회 읽기로 치면 +0.2%, 단가 가중(1시간 캐시 쓰기 $8 = 읽기 $0.20 의 40배)이면 +6.8% | [측정] 첫 턴 문맥 중앙값 50.2K(44.8~57.3K), 캐시 쓰기 중앙값 30.7K |
| 넘겨받기 (가벼움): 요약 2K + 파일 다시 읽기 5K + 피그마 상태 다시 읽기 3K = 10K 가 구간 매 호출에 붙음 | +15.6M (+2.1%) | [추정] |
| 넘겨받기 (무거움): 5K + 15K + 10K = 30K | +46.9M (+6.4%) | [추정] |

| 순감소 | 넘겨받기 가벼움 | 넘겨받기 무거움 |
|---|---|---|
| 캐시 쓰기를 1회 읽기로 계산 | **−25.1%** | −20.8% |
| 캐시 쓰기를 단가 40배로 계산 | −18.3% | **−14.0%** |
| (참고) 500자 이상 경계, 가벼움 | −8.3% / −4.8% | |

판단: 경계를 200자로 잡으면 순감소는 −14~25%이고 가운데 값은 약 −18%다. 세 방식 중 가장 크고, 코드를 바꾸지 않아도 된다. 다만 경계를 드물게 잡을수록(500자) 효과가 빠르게 준다. **자주, 작업 단위로 끊는 것이 중요하다.**

## 4. fields / summary 옵션 — 범위가 나온 기준

방법 [측정]
- 대상: 읽기 결과 중 2,000자 이상이고 JSON 인 것 314건, 16개 명령.
- 결과 바로 다음 턴(모델의 텍스트와 도구 입력)에 실제로 나온 값을 찾고, 그 값의 키를 "쓴 필드"로 셌다. 문자열은 3자 이상, 숫자는 100 이상이거나 소수인 값만 센다.
- 결과를 쓴 필드와 항상 남기는 `id`·`name`·`type` 만 남기도록 줄이고 크기를 쟀다. 구조를 담는 객체·배열은 안에 남은 값이 있으면 유지했다.

두 기준
- **낙관 (−13.9%)**: 호출마다 그 호출의 다음 턴에 쓴 필드만 남긴다. 호출마다 `fields` 를 맞춤으로 고른다고 본 것이다.
- **보수 (−6.9%)**: 명령마다 모든 호출에서 쓴 필드의 합집합을 고정으로 남긴다. 명령별 기본 `fields` 를 정해 둔다고 본 것이다.
- 2,000자 미만 결과는 그대로 둔다. R 감소 = 줄어든 토큰 × 그 뒤 압축 전까지 읽힌 호출 수.

| 명령 | 건수 | 낙관 | 보수 | 보수 기준에서 남는 필드 (id·name·type 외) | 다음 턴에 값을 하나도 안 씀 |
|---|---|---|---|---|---|
| get_nodes_info | 56 | −59% | −23% | width, height, x, y, characters, fontFamily, fontStyle, fontWeight | 18 |
| get_node_info | 38 | −59% | −31% | characters, x, y, width, fontFamily, fontWeight | 12 |
| get_variable_bindings | 73 | −89% | −40% | styled, total, hardcoded, fills, fontFamily, limit, scannedNodes, page, component, paddingTop, paddingBottom 등 | 65 → 개수만 봄, **summary 꼴** |
| find_hidden_nodes | 17 | −45% | −37% | page, reasons, nameFilter, limit, returned, scannedNodes | 3 |
| get_instance_properties | 32 | −20% | −3% | value, options, component | 5 |
| find_nodes_by_name | 33 | −69% | −21% | parentId, parentType, page, path | 7 |
| get_instance_census | 10 | −82% | −60% | source, componentSetName, count, instancesFor, page | 1 |
| get_document_info | 13 | 0% | 0% | (id·name·type 가 거의 전부) | 3 |
| 그 밖 8개 (get_selection, get_component_properties, get_variable_modes, get_layout_audit, get_hyperlinks, get_styles, find_mode_usage, find_variable_usage) | 42 | | | | |
| **합계** | **314** | **−57%** | **−29%** | | |

한계: 생각(로그에 내용이 남지 않음)이나 사용자에게 한 요약에만 쓴 정보는 잡히지 않는다. 그래서 낙관 쪽은 줄어드는 양의 상한이다.

**이 옵션은 export_text_tree, inspect_paints, build_review_listing 에는 넣지 않는다**(UX 라이팅 봇이 쓰는 명령, 변경 금지).

## 5. 대표 작업 비교 (로그 재계산)

구간은 사용자 입력 하나부터 다음 입력 전까지다. 스크립트: `segs.mjs`, `rep.mjs`.

| 작업 (세션·시작 호출, 시작 문맥) | 지금 [측정] | Code Mode 읽기 전용 [추정] |
|---|---|---|
| 노드 정보 읽기 (8ccca539 #99, 85K) — get_selection → get_nodes_info | 턴 3 (피그마 2) · 호출 2 · 결과 687 | 턴 2 (−1) · 스크립트 1 (+250 출력) · 결과 687 |
| 화면 하나 문구 수정 (02f51d40 #523, 801K) — join+get_selection → reset(dry) → get_instance_properties+export → reset+get_nodes_info → set_multiple_text_contents+get_instance_properties → export×2 | 턴 7 (피그마 6) · 호출 11 · 결과 12.8K | 턴 7 (0) · 스크립트 4 (+1,000) · 결과 11.0K |
| 여러 단계 쓰기 (02f51d40 #128, 284K) — get_instance_properties+find → find → export×2+reset(dry) → reset → export×2+get_instance_properties | 턴 7 (피그마 5) · 호출 10 · 결과 20.6K | 턴 6 (−1) · 스크립트 2 (+500) · 결과 13.0K |

가정 [추정]
- 스크립트 하나에 250 출력.
- 2,000자 이상 읽기 결과는 §4 낙관 비율로 줄어든다.
- 읽기만 하는 턴이 이어지면 합친다. 쓰기, export_node_as_image, join_channel 이 섞인 턴은 그대로 둔다.
- 검색 턴과 재시도는 넣지 않았다.

문구 수정은 거의 모든 턴에 쓰기나 이미지 확인이 섞여 있어서 턴이 줄지 않는다. 여러 단계 쓰기의 결과 감소는 대부분 큰 읽기 결과를 거른 데서 나오고, 이건 fields 옵션으로도 얻을 수 있다.

## 6. 달러 (참고)

Opus 5.5 기준(가격표): 입력 $4, 5분 캐시 쓰기 $5, 1시간 캐시 쓰기 $8, 캐시 읽기 $0.20 (기본 입력의 0.05배), 출력 $20 (/M).
- "출력 1 = 캐시 읽기 100"은 Opus 5.5 에서만 맞고, Opus 4.7~5 는 50배다.
- R 1M 감소 ≈ $0.20.
