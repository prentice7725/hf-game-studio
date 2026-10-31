---
name: hf-game-studio
description: 멀티 모델 게임 개발 스튜디오. Claude가 리드이자 주 구현자이고, Gemini Argon(시나리오·대사·로어), asset-pipeline MCP(이미지·효과음), 다른 계열 모델(코드 리뷰)을 읽기 전용 전문가로 부른다. 게임 기획·대사·애셋·밸런스·프로토타입 작업이나 hf-game-studio 요청에 쓴다.
---
# hf-game-studio

**Claude가 리드이자 주 구현자다.** 설계, 코드, 통합, 검수를 맡는다. 전문가 모델은 잘하는 일만 읽기 전용으로 한다: 글은 Gemini Argon, 이미지·효과음은 asset-pipeline, 리뷰는 작성자와 다른 계열. 결정과 배경은 [docs/design/game-studio-v2.md](docs/design/game-studio-v2.md)에 있다.

`HFGS`는 이 디렉터리, `REPO`는 게임 저장소다. 설계 문서는 통째로 읽지 않는다(아래 "문서 읽기").

## 처음 한 번

1. `node $HFGS/scripts/setup.mjs $REPO`: 검사 도구(`tools/hfgs/`), 설계 문서 뼈대(`design/`), 리드 검토 스킬(`.claude/skills/gs-*`)을 깐다. 있는 파일은 덮어쓰지 않는다. 웹 프로토타입 단계면 `--phaser`를 붙여 `prototype/`에 Phaser 4 템플릿을 깔고 그 안에서 `npm install`을 한다(스크린샷 검사용 Playwright는 저장소 루트에 `npm i -D playwright && npx playwright install chromium`). Godot 본편 단계면 `--godot`을 붙여 루트에 Godot 4.7 템플릿을 깔고, `node tools/hfgs/godot-addons.mjs .`로 애드온(gdUnit4, Dialogic 2, Aseprite Wizard)을 받고, `GODOT_BIN`을 Godot 4.7 실행 파일로 둔다.
2. 사용자와 `design/glossary.md`, `design/world.md`, `design/gdd.md`, `design/art-bible.md`를 채운다. 모든 모델이 읽는 단일 원본이다. 비어 있으면 모델마다 세계관과 수치를 지어낸다. 결과물 형식은 `design/schemas/*.schema.json`과 `design/asset-manifest.json`에 먼저 적는다. 이 파일들이 수용 검사의 기준이 된다.
3. 전문가가 준비됐는지 본다: `codex`(리뷰)·`agy`(Argon 글쓰기)가 설치·로그인되어 있는지, asset-pipeline MCP가 Claude Code에 등록되어 있는지(`asset_capabilities`로 확인).
4. 마일스톤은 `$HFGS/examples/milestone-1.md`처럼 작게(용병 1명 + 계약 1개 + 화면 1개) 작업 목록으로 적고 사용자 승인을 받는다. 게이트는 이것 하나다.

## 작업마다

1. **작업 파일 작성.** `kind`를 고르고(아래 표) `task_id`, `objective`, `scope.paths`, `success_criteria`(AC1, AC2…), 종류별 검사 입력(`schema`, `assets_manifest`, `screenshot`, `asset_pipeline`), `acceptance_map`(`"@auto"`는 자동 검사 전부), 읽을 문서 섹션(`context_sections`)을 적는다. 예시는 `$HFGS/examples/tasks/`. 작업 파일은 게임 저장소 밖(예: `~/.hf-game-studio/` 아래)이나 `.gitignore`된 곳에 둔다.
2. **시작.** `node $HFGS/scripts/task.mjs start TASK.json --repo $REPO`. 작업 파일을 검증하고, 읽을 문서·규칙·검사 명령을 보여 주고, **red-first**를 한다: 손대기 전 트리에서 수용 검사를 돌려 적어도 하나는 실패해야 한다. 모두 통과하면 `ACCEPTANCE_ALREADY_GREEN`으로 거절한다(그 검사는 맞는 결과와 엉터리 결과를 가르지 못한다). 이미 있는 데이터를 고치는 작업은 `expect`에 바뀔 값을 적고, 처음부터 통과하는 게 맞으면(리팩터) `baseline_green`에 이유를 적는다. 작업 전 트리 상태와 검사 기준 파일의 해시가 `~/.hf-game-studio/tasks/`에 기록된다.
3. **구현.** 담당(`owner`)에 따라 다르다.
   - `claude`: 리드가 직접 구현한다. plan의 읽기 지시대로 문서 섹션만 읽고, 규칙을 따른다.
   - 글(`writer: argon`): plan이 보여 주는 작가 brief를 파일로 저장해 `node $HFGS/scripts/consult.mjs write BRIEF.json --repo $REPO`로 Argon에게 맡긴다. 결과 글은 표준 출력으로, 새 용어(`new_terms`)와 작가 메모는 표준 오류로 나온다. 리드가 용어집·세계관과 맞는지 검수한 뒤 범위 안 파일로 쓴다. 새 용어는 사용자에게 물어 용어집에 넣을지 정한다(용어집은 검사 기준이라 이 작업 범위에서 고치지 않는다).
   - `asset-pipeline`: `node $HFGS/scripts/assets.mjs generate TASK.json --repo $REPO [--candidates N] [--seed S]`. 이 스크립트가 asset_pipeline MCP 서버를 직접 띄워 plan의 규칙대로 돈다(`asset_build_brief` → `asset_route` → `asset_generate` → `asset_inspect_run`, `STARTING`·`RUNNING`을 벗어날 때까지 기다리기, 실패하면 재시도 없이 멈춤). 프롬프트는 매니페스트 항목의 `prompt`에서 읽는다. 후보와 규격 검사 결과는 `~/.hf-game-studio/assets/<task_id>/`에, run_id·상태·검토 상태는 작업 노트 `<task_id>.json`에 남는다. 사용자가 후보를 보고(들고) 고르면 `assets.mjs pick TASK.json <번호> --approved --repo $REPO`로 매니페스트 경로에 옮긴다. `--approved`는 사용자의 승인을 뜻하므로 리드가 혼자 붙이지 않는다. 스크립트가 없는 환경에서만 리드가 MCP 도구를 같은 순서로 직접 부른다.
   - 작업 도중 검사만 돌려 보려면 `task.mjs check TASK.json --repo $REPO`.
4. **검증.** `node $HFGS/scripts/task.mjs verify TASK.json --repo $REPO`. 수용 검사가 모두 통과하고, 변경이 `scope.paths`(또는 `allow_out_of_scope`) 안에 있고, 검사 기준 파일(스키마·매니페스트·용어집·참조 이미지)이 바뀌지 않았으면 통과한다. 명령이 걸리지 않은 수용 기준은 "직접 확인"으로 표시되니 리드가 눈으로 보고 리뷰어에게도 맡긴다.
5. **리뷰.** verify가 출력하는 `consult.mjs review ...` 명령을 그대로 돌린다. 리뷰어(기본 Codex)는 작성자의 요약·주장 없이 diff, 바뀐 파일, 스크립트가 직접 돌린 검사 결과만 본다. 지적마다 `consult.mjs dispose <보고서> F1=act "F2=dismissed:이유"`로 처분을 남기고, act는 고쳐서 다시 verify → review. Argon이 쓴 글은 `--author agy --author-model gemini-4-argon-high`로 적는다(Claude가 다른 계열이므로 리드가 직접 보거나 `--reviewer codex`).
6. **사람 승인.** 그림과 소리는 사용자가 보고 듣고 승인한다. 승인 전 애셋은 아틀라스나 장면에 넣지 않는다.

커밋·푸시는 사용자가 시킬 때만 한다.

## 작업 종류(kind)

| kind | 만드는 쪽 | 역할 규칙 | 자동 수용 검사 | 필수 입력 |
|---|---|---|---|---|
| gdd | Claude 구조 + Argon 문장 | game-designer | 없음 | |
| lore | Claude 구조 + Argon 문장 | world-builder | 없음 | |
| narrative | Argon 쓰고 Claude 검수 | writer | `dialogue-to-dtl.mjs --check`(스키마·그래프·용어집 인물·Dialogic 변환) | `schema` |
| balance-data | Claude | systems-designer | 스키마(+`expect`) | `schema` |
| economy-data | Claude | economy-designer | 스키마(+`expect`) | `schema` |
| level | Claude | level-designer | 스키마(`schema` 있을 때) | |
| art-image | asset-pipeline | technical-artist | PNG 매니페스트 | `assets_manifest`, `asset_pipeline` |
| art-edit | asset-pipeline(CLI provider) | technical-artist | PNG 매니페스트 | 위 + `asset_pipeline.reference_image`, `workflow_id` |
| sfx | asset-pipeline | sound-designer | WAV 매니페스트 | `assets_manifest`, `asset_pipeline` |
| web-prototype | Claude (Phaser 4, `prototype/`) | ui-programmer | 스크린샷(`screenshot` 있을 때) + `acceptance_commands`의 Vitest | |
| code | Claude | gameplay-programmer | `acceptance_commands`의 테스트 | |
| godot-code | Claude (Godot 4.7, 루트) | gameplay-programmer | `godot-check.mjs all`(문법+gdUnit4+헤드리스 부팅, `GODOT_BIN` 필요) | |
| godot-scene | Claude (Godot 4.7) | ui-programmer | `godot-check.mjs all`; 화면은 `shot` 프레임을 사람이 봄 | |

## 규칙

- **검사 기준은 범위 밖에.** `schema`, `assets_manifest`, `glossary`(대사 검사의 용어집, 기본 `design/glossary.md`), `asset_pipeline.reference_image`는 `scope.paths`에 둘 수 없고(plan이 거절), verify에서 바뀌었으면 실패한다. 기준을 고쳐야 하면 사용자와 상의해 별도 작업으로 한다.
- **문서 읽기.** 작업에 필요한 GDD·세계관 섹션을 `context_sections`에 적는다(`{"design/gdd.md": ["수치와 공식"]}`). plan이 줄 범위를 찾아 그 범위만 읽게 하고, 작가 brief에도 같은 지시가 들어간다. 40KB가 넘는 문서는 섹션을 안 적어도 통째로 읽지 않는다. 리드도 `grep -n '^#'`로 제목을 보고 필요한 섹션만 읽는다.
- **로컬 서버 스크린샷은 `serve`.** 검사는 아무 때나 돌 수 있어야 하므로 떠 있는 서버에 기대지 않는다. `screenshot.serve`에 서버 실행 명령을 적어 검사 도구가 띄우고 종료하게 한다(없으면 plan이 거절). 빌드 결과물을 바로 열 수 있으면 `file`이 더 단순하다.
- **대사는 JSON이 원본, Dialogic은 변환물.** 대사는 `design/schemas/dialogue.schema.json` 형식이다. 화자와 등장·퇴장 인물은 용어집 ID(Dialogic 캐릭터 파일 이름과 같음)이고, 화자가 없으면 서술이다. `enter`는 대사 앞, `exit`는 대사 뒤이고 `exit`는 선택지와 함께 쓸 수 없다. 대사에 Dialogic 문법 기호(`[ ] { } < >`, 선택지는 `|`도)를 쓰지 않는다. `.dtl`은 `tools/hfgs/dialogue-to-dtl.mjs`로 만들고 직접 고치지 않는다.
- **asset-pipeline.** `asset_pipeline`에 `project_id`, `output_class`(`NONPIXEL_IMAGE`·`PIXEL_STATIC`·`SFX`), SFX는 `duration_seconds`를 적는다. 참조 편집(art-edit)은 ComfyUI 워크플로가 모두 text-to-image라 `workflow_id`(`codex_imagegen`·`grok_imagine`)와 `reference_image`를 함께 적는다. `PIXEL_STATIC`은 asset-pipeline이 색을 자동으로 줄이지 않아 Pixel Gate에서 FAILED로 끝나기 쉽다(plan이 경고). 결과는 asset-pipeline에서도 REVIEW_REQUIRED 후보이므로 사람 승인 규칙이 그대로다.
- **웹 프로토타입은 버린다.** `prototype/`(templates/phaser)에서 핵심 루프만 만든다. 규칙은 `src/rules/` 순수 함수 + Vitest, 글자 UI는 DOM 패널 `#hud`(스크린샷 검사가 읽음), 수치·대사는 `data/`에서 읽는다. 작업 파일의 검사는 `screenshot.serve: "npm --prefix prototype run dev"`, `selector: "#hud"`, `acceptance_commands: ["npm --prefix prototype test"]`. 남기는 것은 재미 판정, 데이터, 대사, 설계 수정이고 코드는 Godot으로 옮기지 않는다.
- **Godot 본편.** 규칙은 `scripts/rules/`의 static 함수 + gdUnit4이고 프로토타입의 공식과 같은 숫자를 내야 한다. 대사를 바꿨으면 `dialogue-to-dtl.mjs ... --out-dir dialogue`로 `.dtl`을 다시 만든다(`.dtl`은 고치지 않는다). 화자 ID와 같은 이름의 Dialogic 캐릭터(`.dch`)와 에디터 작업은 사람이 한다(Godot MCP는 8단계에서 평가). `godot-check.mjs shot`의 프레임은 사람이 보는 용도이고 픽셀 비교는 하지 않는다.
- **오디오는 효과음만.** 음악·음성 생성은 없으므로 사양서(gdd)로만 다룬다.
- **작게 시작.** 첫 마일스톤은 `examples/milestone-1.md` 크기로 한다. 원본 템플릿(Claude-Code-Game-Studios)의 디렉터 게이트·GDD 섹션 강제·질문 우선 절차는 가져오지 않았다. 프로세스가 무거울수록 결과가 나빠졌다는 실측이 있다.

## 전문가 호출(consult)

다른 계열 모델을 읽기 전용 전문가로 부른다. 전문가는 파일을 고치지 않고 결과를 JSON으로 돌려주며, 파일은 리드가 쓴다. 호출 전후로 작업 트리(추적되지 않은 파일 내용 포함)를 비교해 바뀌었으면 답을 버린다. 보고서는 `~/.hf-game-studio/reviews/`(HFGS_HOME으로 변경)에 남는다.

- **리뷰:** `node $HFGS/scripts/consult.mjs review --repo $REPO --base <시작 커밋> --criteria "AC1: ..." --check "<검사 명령>"`. verify가 이 명령을 채워서 출력한다. 기본 리뷰어는 Codex(Sol)이고 `--reviewer agy|grok`로 바꾼다. 작성자와 같은 계열의 리뷰어는 거절한다. 리드가 아닌 모델이 쓴 변경이면 `--author codex|agy|grok`, agy가 썼으면 `--author-model`까지 적는다. pass면 종료 코드 0, 아니면 1. 줄 번호 있는 blocker·major 지적이 없는 redo는 권고로만 본다.
- **처분:** `consult.mjs dispose <보고서> F1=act "F2=dismissed:이유"`(act, consider, noted, dismissed, contract_misread). 기각과 계약 오독에는 이유가 필요하다. `consult.mjs stats`가 리뷰어별로 쓸모 있는 지적 비율을 보여 준다.
- **글쓰기:** `consult.mjs write <brief.json> --repo $REPO`. 기본 작가는 Gemini Argon(high). brief는 `task`(필수), `kind`, `language`(기본 ko), `format`(markdown|json), `length`, `style`, `structure`, `context_docs`, `context_sections`. `task.mjs plan`이 글 작업의 brief를 만들어 준다. agy는 한 번에 2분 정도 걸린다.
- **작업 트리 비교의 한계:** 추적 파일은 git status와 diff로만 비교한다. assume-unchanged나 clean 필터로 git이 숨기는 변경은 잡지 못한다. 실수를 잡는 장치이지 의도적 우회를 막는 장치가 아니다.
- **MCP:** Codex는 사용자 설정의 MCP 서버(asset_pipeline 등)를 모두 끄고 부른다. agy는 실행 단위로 끌 수 없어 켜진 서버를 경고한다. 쓰기 도구가 있는 서버는 `agy mcp disable`로 꺼 두는 편이 안전하다.

## 검토 스킬

setup이 게임 저장소에 까는 리드용 스킬이다. 읽기 전용이고 섹션 단위로 읽는다.

- `/gs-balance-check <데이터 파일>`: 수치 이상치, 지배 전략, 자원 흐름 점검
- `/gs-design-review <문서>`: GDD 섹션이 구현 가능한 규칙인지 점검
- `/gs-scope-check`: 마일스톤 작업 목록이 범위를 넘는지 점검
