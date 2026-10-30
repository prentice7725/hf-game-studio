---
name: hf-game-studio
description: HyperFusion 위에 올린 게임 개발 레이어. 게임 작업(GDD, 시나리오, 수치 데이터, 이미지 애셋, UI)을 게임 brief로 쓰고 hyperfusion brief로 컴파일해 일꾼(Grok, Gemini Argon, Sonnet 등)에게 맡긴다. 게임 기획·애셋·밸런스 작업이나 hf-game-studio 요청에 쓴다.
---
# hf-game-studio

이 스킬은 **hyperfusion을 대체하지 않는다.** 실행(일꾼 배치, 반려·교체, 스냅샷 검증, 리뷰, 마일스톤 게이트)은 전부 hyperfusion이 하고, 이 스킬은 그 앞단에서 게임 작업을 hyperfusion이 받는 형식으로 바꿔 준다. hyperfusion의 SKILL.md 원칙(리드는 코드를 만지지 않는다, 빈 반려 금지 등)이 그대로 적용된다.

`HFGS`는 이 디렉터리, `HF_SKILL`은 hyperfusion 디렉터리, `HF_REPO`는 게임 저장소다.

## 처음 한 번

1. `node $HFGS/scripts/setup.mjs $HF_REPO`: 게임용 `hyperfusion.config.json`, 검사 도구(`tools/hfgs/`), 설계 문서 뼈대(`design/`), 리드 스킬(`.claude/skills/gs-*`)을 깐다. 있는 파일은 덮어쓰지 않는다.
2. `node $HF_SKILL/scripts/setup-doctor.mjs $HF_REPO --smoke`: 일꾼 CLI가 실제로 도는지 본다. **Grok 이미지 생성은 hyperfusion 테스트로 검증되지 않았다.** 이미지 작업 전에 Grok으로 한 장을 실제 저장까지 해 보는 것을 사용자에게 권한다.
3. 사용자와 `design/glossary.md`, `design/world.md`, `design/gdd.md`, `design/art-bible.md`를 채운다. 이 문서들이 모든 모델이 읽는 단일 원본이다. 비어 있으면 일꾼마다 세계관을 지어낸다.

## 작업마다

1. **게임 brief 작성.** `game_kind`를 고른다(아래 표). hyperfusion brief 필드(`task_id`, `objective`, `scope.paths`, `success_criteria`, `acceptance_map` 등)에 게임 필드(`schema`, `expect`, `assets_manifest`, `screenshot`, `role`, `context_docs`, `context_sections`)를 더한 형식이다. 예시는 `$HFGS/examples/briefs/`.
2. **컴파일.** `BRIEF=$(node $HFGS/scripts/brief.mjs GAME-BRIEF.json --repo $HF_REPO)`. 컴파일된 brief는 저장소 밖 임시 폴더에 쓰이고 경로만 출력된다(저장소 안에 쓰지 않는다). 역할 지시문과 단일 원본 문서 안내가 `constraints`에, 게임용 수용 검사가 `acceptance_commands`에 들어간다. `HF_SKILL`이 설정되어 있으면 hyperfusion 자체 brief 검증도 돌린다. 경고(문서 없음, 수용 명령 없음, red-first)는 사용자에게 알린다.
3. **실행.** 이후는 hyperfusion 절차 그대로: `fusion-state.mjs init $HF_REPO "$BRIEF"` → begin → … → CLOSE.

## game_kind

| game_kind | hyperfusion task_kind | 역할 | 자동 수용 검사 | 기본 배치(프리셋) |
|---|---|---|---|---|
| gdd | docs | game-designer | 없음 | Gemini Argon → Sonnet |
| narrative | docs | writer | `schema` 있으면 스키마 | Gemini Argon → Sonnet |
| lore | docs | world-builder | 없음 | Gemini Argon → Sonnet |
| balance-data | code (medium) | systems-designer | 스키마(필수) | Sonnet → Grok |
| economy-data | code (medium) | economy-designer | 스키마(필수) | Sonnet → Grok |
| level | code | level-designer | `schema` 있으면 스키마 | 난이도별 |
| image-asset | image-asset | technical-artist | 매니페스트 규격(필수) | Grok → Luna |
| sfx | image-asset | sound-designer | 매니페스트 규격(필수), asset_pipeline 필수 | Luna |
| ui | ui | ui-programmer | `screenshot` 있으면 스크린샷 | Gemini Argon → Sonnet |
| gameplay-code / tests / refactor | code / tests / refactor | gameplay-programmer | 없음 | 난이도별 |

hyperfusion의 task_kind는 6종으로 고정이라 지표(실적)는 task_kind 단위로 쌓인다. 예를 들어 gdd·narrative·lore는 모두 docs 실적으로 합쳐진다.

## 규칙

- **설계 문서는 섹션으로.** 작업에 필요한 GDD·세계관 섹션을 `context_sections`에 적는다(`{"design/gdd.md": ["수치와 공식"]}`). 컴파일러가 줄 범위를 찾아 일꾼에게 그 범위만 읽게 한다. 40KB가 넘는 문서는 섹션을 안 적어도 통째로 읽지 말라는 지시가 들어가지만, 일꾼이 제목을 찾는 수고가 남으므로 적는 편이 낫다. 리드 자신도 문서를 통째로 읽지 않는다.

- **이미 있는 파일을 고칠 때는 `expect`.** 형식 검사는 처음부터 통과해 hyperfusion이 `ACCEPTANCE_ALREADY_GREEN`으로 거절한다. 데이터는 `expect`에 바뀔 값을 적고, 이미지는 바뀐 점을 확인하는 검사를 따로 넣는다.
- **로컬 서버 스크린샷은 `serve`.** 수용 검사는 일꾼 프로세스가 끝난 뒤 돌기 때문에 일꾼이 띄운 서버에 기대면 항상 실패한다. 서버 실행 명령을 `screenshot.serve`에 적어 검사 도구가 띄우고 종료하게 한다(없으면 컴파일러가 거절).

- **검사 기준은 범위 밖에.** `schema`, `assets_manifest`는 `scope.paths`에 넣을 수 없다(컴파일러가 거절). 일꾼이 기준을 느슨하게 고쳐 통과하는 길을 막는다.
- **asset-pipeline으로 이미지·효과음 만들기.** image-asset·sfx brief에 `"asset_pipeline": {"project_id": "<게임 id>", "output_class": "<NONPIXEL_IMAGE|PIXEL_STATIC|SFX>"}`를 넣으면(SFX는 `duration_seconds` 가능) 일꾼이 asset_pipeline MCP 도구(`asset_build_brief` → `asset_route` → `asset_generate` → `asset_inspect_run`)로만 생성하고, 상태가 `STARTING`·`RUNNING`을 벗어날 때까지 같은 세션에서 기다리며, 재시도·우회 없이 실패하면 needs_decision으로 멈추고, run_id와 리뷰 상태를 보고한다. 이 MCP를 쓸 수 있는 일꾼은 Codex 설정에 asset_pipeline이 등록된 Luna뿐이라 `fusion-state.mjs init $HF_REPO "$BRIEF" --executor luna`로 고정한다. 참조 이미지 편집(표정·포즈 변형 등)은 ComfyUI 워크플로가 모두 text-to-image라 CLI provider로만 되므로 `"workflow_id": "codex_imagegen"`(또는 `grok_imagine`)와 `"reference_image": "<저장소 기준 경로>"`를 함께 적는다. 참조 이미지는 `scope.paths` 밖에 둔다. 리드는 작업 밖에서 `asset_capabilities`로 준비 상태를 먼저 볼 수 있다.
- **이미지는 사람 승인까지.** 매니페스트 검사는 크기·투명도·용량만 본다. 화풍 일관성은 리드 리뷰와 사용자 승인으로 본다. 승인 전 애셋은 아틀라스에 넣지 않는다.
- **오디오는 효과음만.** 효과음(sfx)은 asset-pipeline을 쓰는 Luna만 만들 수 있어 asset_pipeline이 필수다. 음악·음성은 생성 일꾼이 없으므로 사양서(gdd)로만 다룬다. 효과음도 사람이 들어 보고 승인한다.
- **대사는 JSON이 원본, Dialogic은 변환물.** 대사는 `design/schemas/dialogue.schema.json` 형식으로 쓴다. 화자(`speaker`)와 등장·퇴장 인물은 용어집 ID(Dialogic 캐릭터 파일 이름과 같음)이고, 화자가 없으면 서술이다. 노드의 `enter`는 대사 앞, `exit`는 대사 뒤에 나오고, `exit`는 선택지와 함께 쓸 수 없다. 대사에는 Dialogic 문법 기호(`[ ] { } < >`, 선택지는 `|`도)를 쓰지 않는다. `node tools/hfgs/dialogue-to-dtl.mjs <대사.json> --check`가 스키마, 그래프 규칙, 용어집에 없는 인물을 검사하고, `--check` 없이 돌리면 `<id>.dtl`을 만든다. .dtl은 직접 고치지 않는다. narrative brief에는 이 `--check` 명령을 `acceptance_commands`에 넣는다. Argon에게 쓰게 할 때는 `consult.mjs write`에 `"format": "json"`과 스키마 경로를 `structure`로 준다.
- **게이트는 hyperfusion 것 하나.** 원본 템플릿(Claude-Code-Game-Studios)의 디렉터 게이트·GDD 섹션 강제는 가져오지 않았다. 승인·체크포인트는 hyperfusion 프로젝트(`project.mjs`)로만 한다.
- **작게 시작.** 첫 프로젝트는 `$HFGS/examples/PLAN.json`처럼 용병 1명 + 계약 1개 + 화면 1개 크기로 한 마일스톤만 돌린다.

## 전문가 호출(consult)

다른 계열 모델을 읽기 전용 전문가로 부른다. 전문가는 파일을 고치지 않고 결과를 JSON으로 돌려주며, 파일은 리드가 쓴다. 호출 전후로 작업 트리(추적되지 않은 파일 내용 포함)를 비교해 바뀌었으면 답을 버린다. 보고서는 `~/.hf-game-studio/reviews/`(HFGS_HOME으로 변경)에 남는다.

- **리뷰:** `node $HFGS/scripts/consult.mjs review --base main --criteria "AC1: ..." --check "npm test"`. 기본 리뷰어는 Codex(Sol)이고 `--reviewer agy|grok`로 바꾼다. 리뷰어에게는 작성자의 요약·주장을 주지 않고 diff, 새 파일 목록, 스크립트가 직접 돌린 `--check` 결과만 준다. 작성자와 같은 계열의 리뷰어는 거절한다. 리드가 아닌 모델이 쓴 변경이면 `--author codex|agy|grok`, agy가 썼으면 `--author-model`까지 적는다. pass면 종료 코드 0, 아니면 1이다. 줄 번호 있는 blocker·major 지적이 없는 redo는 권고로만 본다.
- **처분:** 리뷰 지적마다 `consult.mjs dispose <보고서> F1=act "F2=dismissed:이유"`로 처분을 남긴다(act, consider, noted, dismissed, contract_misread). 기각과 계약 오독에는 이유가 필요하다. `consult.mjs stats`가 리뷰어별로 쓸모 있는 지적 비율을 보여 준다.
- **글쓰기:** `consult.mjs write <write-brief.json> --repo <게임 저장소>`. 기본 작가는 Gemini Argon(high)이다. brief에는 `task`(필수), `kind`, `language`(기본 ko), `format`(markdown|json), `length`, `style`, `context_docs`, `context_sections`를 적는다. 결과 글은 표준 출력으로, 새 용어(`new_terms`)와 작가 메모는 표준 오류로 나온다. 새 용어는 용어집에 넣을지 리드가 정한다. agy는 한 번에 2분 정도 걸린다.
- **작업 트리 비교의 한계:** 추적 파일은 git status와 diff로만 비교한다(큰 애셋을 매번 해시하지 않으려고). assume-unchanged나 clean 필터로 git이 숨기는 변경은 잡지 못한다. 실수로 쓴 것을 잡는 장치이지 의도적 우회를 막는 장치가 아니다.
- **MCP:** Codex는 사용자 설정의 MCP 서버(asset_pipeline 등)를 모두 끄고 부른다. agy는 실행 단위로 끌 수 없어 켜진 서버를 경고한다. 쓰기 도구가 있는 서버는 `agy mcp disable`로 꺼 두는 편이 안전하다.

## 검토 스킬

setup이 게임 저장소에 까는 리드용 스킬이다. 리드나 리뷰 단계에서 직접 쓴다(일꾼에게 넘기지 않는다).

- `/gs-balance-check <데이터 파일>`: 수치 이상치, 지배 전략, 자원 흐름 점검
- `/gs-design-review <문서>`: GDD 섹션이 구현 가능한 규칙인지 점검
- `/gs-scope-check`: 마일스톤 계획이 범위를 넘는지 점검
