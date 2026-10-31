# hf-game-studio

**멀티 모델 게임 개발 스튜디오입니다.** Claude가 리드이자 주 구현자이고, 분야마다 잘하는 모델을 읽기 전용 전문가로 부릅니다.

| 일 | 누가 | 어떻게 |
|---|---|---|
| 설계, 코드, 수치 데이터, 통합, 검수 | Claude | 직접 |
| 시나리오, 대사, 로어 | Gemini Argon | `consult.mjs write`로 쓰고 Claude가 용어집·세계관에 맞는지 검수 |
| 이미지, 효과음 | [asset-pipeline](https://github.com/prentice7725/asset-pipeline) (ComfyUI, Codex, Grok, Stable Audio) | Claude가 MCP로 호출, 사람이 보고 들어 승인 |
| 코드 리뷰 | 작성자와 다른 계열 모델(기본 Codex) | `consult.mjs review`: 작성자의 주장 없이 diff와 검사 결과만 보고 판정 |

Claude가 직접 구현하므로 일꾼 배치·라운드·리스 같은 위임 장치는 없습니다. 대신 **기계적 수용 검사**(스키마, 애셋 규격, 대사 변환, 스크린샷)와 그 검사를 믿을 수 있게 하는 두 규칙(red-first, 검사 기준 파일은 범위 밖)이 작업의 뼈대입니다. 결정 배경은 [docs/design/game-studio-v2.md](docs/design/game-studio-v2.md)에 있습니다.

> 이 저장소는 [hyperfusion](https://github.com/prentice7725/hyperfusion) 위에 게임 작업 종류를 얹는 층으로 시작했습니다(v1). 2026-10-30에 의존을 끊고 좋은 부분(외부 CLI 어댑터, 교차 계열 리뷰, 수용 검사 무결성, 비밀값 마스킹)만 옮겨 왔습니다. 출처는 [NOTICE.md](NOTICE.md)에 있습니다.

## 구성

```text
SKILL.md                   리드(Claude)용 메인 스킬: 작업 절차와 규칙
game-kinds.json            게임 작업 종류: 만드는 쪽, 역할, 자동 수용 검사, 규칙
roles/*.md                 역할 규칙(리드가 따르고, 글 작업은 작가 brief의 style로 들어감)
scripts/
  task.mjs                 작업 컨트롤러: plan(검증·읽을 문서·규칙·검사), start(red-first·작업 전 기록),
                           check(검사만), verify(검사·범위·기준 파일 불변 + 리뷰 명령)
  consult.mjs              다른 계열 전문가 호출: review, write(Argon), dispose, stats
  setup.mjs                게임 저장소에 설치
  lib/                     외부 모델 CLI를 읽기 전용 전문가로 부르는 공통 부분(hyperfusion에서 옮겨 옴)
    cli.mjs                플래그 확인, 결과 JSON 꺼내기, 읽기 전용 지시문, 호출(invoke)
    adapters/              codex(리뷰, 기본 Sol), agy(글쓰기·리뷰, 기본 Gemini Argon high), grok(리뷰)
    checks.mjs             수용 검사 명령 실행(task.mjs와 consult.mjs가 같이 씀)
    redaction.mjs          보내는 프롬프트의 비밀값·개인정보 가리기
    env.mjs, platform.mjs  CLI에 넘길 환경변수 제한, 실행 파일 찾기와 Windows 명령줄 길이
tools/                     게임 저장소의 tools/hfgs/로 복사되는 수용 검사 도구
  validate-data.mjs        JSON 데이터 스키마 검사(--expect로 바뀔 값 확인)
  check-assets.mjs         PNG 크기·투명도·용량, WAV 길이·채널·샘플레이트·용량 검사
  dialogue-to-dtl.mjs      대사 JSON(엔진 중립 원본) → Dialogic 2 타임라인(.dtl) 변환, --check는 검사만
  screenshot.mjs           화면을 띄워 선택자·문구·콘솔 오류 확인 + 스크린샷(--serve로 서버 띄우고 종료)
  godot-addons.mjs         Godot 애드온을 고정 git 태그로 받아 addons/에 넣고 project.godot에 등록
  godot-check.mjs          Godot 검사: syntax(--check-only), test(gdUnit4), run(헤드리스 부팅), shot(xvfb 스크린샷)
templates/design/          단일 원본 문서 뼈대(용어집, 세계관, GDD, 아트 바이블, 애셋 매니페스트, 스키마)
templates/phaser/          웹 프로토타입 템플릿(Phaser 4 + Vite + TypeScript + Vitest). setup --phaser로 prototype/에 깐다
templates/godot/           Godot 4.7 본편 템플릿(gdUnit4, Dialogic 2, Aseprite Wizard). setup --godot으로 저장소 루트에 깐다
skills/gs-*                게임 저장소에 설치되는 리드 검토 스킬(밸런스, 설계, 범위)
examples/                  첫 마일스톤(milestone-1.md)과 작업 파일 예시(tasks/)
docs/design/               설계 문서
```

## 설치

필요한 것: Node.js 24 이상, 첫 커밋이 있는 Git 저장소. 전문가는 쓸 것만: `codex`(리뷰), `agy`(Argon 글쓰기), asset-pipeline MCP(이미지·효과음), Playwright(스크린샷 검사를 쓰는 저장소에 `npm i -D playwright`).

```bash
git clone https://github.com/prentice7725/hf-game-studio.git ~/.claude/skills/hf-game-studio
```

```bash
node ~/.claude/skills/hf-game-studio/scripts/setup.mjs <게임 저장소>
```

게임 저장소에 검사 도구(`tools/hfgs/`), 설계 문서 뼈대(`design/`), 리드 검토 스킬(`.claude/skills/gs-*`)이 깔립니다. 이미 있는 파일은 덮어쓰지 않습니다. 검사 도구와 스킬만 새 버전으로 바꾸려면 `--force`를 붙입니다. 설계 문서는 `--force`에도 덮어쓰지 않습니다.

웹 프로토타입을 시작할 때는 `--phaser`(또는 `--phaser=폴더`)를 붙입니다. `prototype/`에 [Phaser 4 템플릿](templates/phaser/README.md)이 깔리고, 그 안에서 `npm install`을 합니다. 스크린샷 검사에는 저장소 루트에 Playwright가 필요합니다.

```bash
node ~/.claude/skills/hf-game-studio/scripts/setup.mjs <게임 저장소> --phaser
```

Godot 본편을 시작할 때는 `--godot`을 붙입니다. [Godot 4.7 템플릿](templates/godot/README.md)이 저장소 **루트**에 깔리고(`project.godot`가 루트여야 `data/`·`assets/`가 `res://` 안에 들어옵니다), `prototype/`·`tools/`에는 `.gdignore`가 생깁니다. 애드온은 `node tools/hfgs/godot-addons.mjs .`로 받고, Godot 실행 파일은 `GODOT_BIN`으로 가리킵니다.

```bash
node ~/.claude/skills/hf-game-studio/scripts/setup.mjs <게임 저장소> --godot
```

## 작업 흐름

```text
작업 파일 작성 → task.mjs start (red-first, 작업 전 기록)
  → 구현: Claude 직접 | consult.mjs write (Argon) | asset-pipeline MCP (Claude가 호출)
  → task.mjs verify (검사 통과 + 범위 안 + 기준 파일 불변)
  → consult.mjs review (다른 계열) → dispose → 고칠 것이 있으면 다시 verify
  → 그림·소리는 사람이 승인
```

```bash
node ~/.claude/skills/hf-game-studio/scripts/task.mjs start tasks/merc-data.json --repo .
```

```bash
node ~/.claude/skills/hf-game-studio/scripts/task.mjs verify tasks/merc-data.json --repo .
```

verify가 통과하면 리뷰 명령(`consult.mjs review --base <시작 커밋> --criteria ... --check ...`)을 채워서 출력합니다. 작업 상태는 `~/.hf-game-studio/tasks/<task_id>.json`(`HFGS_HOME`으로 변경)에 남고, 게임 저장소 안에는 쓰지 않습니다.

### 작업 파일

```json
{
  "task_id": "M1-T1-merc-data",
  "kind": "balance-data",
  "objective": "Create the first mercenary, Ash, in data/mercenaries.json ...",
  "scope": {"paths": ["data/mercenaries.json"]},
  "schema": "design/schemas/mercenaries.schema.json",
  "context_sections": {"design/gdd.md": ["규칙", "수치와 공식"]},
  "success_criteria": ["AC1: data/mercenaries.json validates against the schema ...", "AC2: ..."],
  "acceptance_map": {"AC1": ["@auto"]}
}
```

| 필드 | 뜻 |
|---|---|
| `kind` | 아래 표의 작업 종류 |
| `task_id`, `objective`, `scope.paths`, `success_criteria` | 필수. 수용 기준은 `AC1: ...`처럼 ID로 시작 |
| `acceptance_commands`, `acceptance_map` | 직접 적는 검사 명령과 기준↔명령 연결. `"@auto"`는 자동으로 만든 검사 전부 |
| `allow_out_of_scope` | 범위 밖이지만 바뀌어도 되는 파일 |
| `baseline_green` | 처음부터 검사가 통과하는 게 맞는 이유(리팩터 등). 적으면 red-first를 건너뜀 |
| `role` | 역할 덮어쓰기. `null`이면 역할 규칙을 넣지 않음 |
| `context_docs`, `context_sections` | 읽을 단일 원본 문서와 섹션. 기본은 `design/` 네 문서 중 있는 것 |
| `schema`, `data_files`, `expect` | 데이터 스키마 검사. `expect`는 바뀌어야 할 값 `{"/mercenaries/[id=ash]/hire_cost": 120}` |
| `glossary` | narrative 전용. 대사 검사의 용어집(기본 `design/glossary.md`) |
| `assets_manifest`, `asset_files` | 애셋 규격 검사. `asset_files`를 생략하면 `scope.paths`의 PNG·WAV |
| `asset_pipeline` | `project_id`, `output_class`, `duration_seconds`(SFX), `workflow_id`·`reference_image`(art-edit) |
| `screenshot` | `url`·`file`·`electron` 중 하나와 `selector`(필수), `serve`, `expect_text`, `name`. 로컬 서버 주소면 `serve` 필수 |

### 작업 종류

| kind | 만드는 쪽 | 자동 수용 검사 | 필수 입력 |
|---|---|---|---|
| gdd, lore | Claude 구조 + Argon 문장 | 없음 | |
| narrative | Argon 쓰고 Claude 검수 | `dialogue-to-dtl.mjs --check`(스키마·그래프 규칙·용어집 인물·Dialogic 변환) | `schema` |
| balance-data, economy-data | Claude | 스키마(+`expect`) | `schema` |
| level | Claude | 스키마(`schema` 있을 때) | |
| art-image | asset-pipeline | PNG 매니페스트 | `assets_manifest`, `asset_pipeline` |
| art-edit | asset-pipeline(Codex·Grok CLI provider) | PNG 매니페스트 | 위 + `reference_image`, `workflow_id` |
| sfx | asset-pipeline | WAV 매니페스트 | `assets_manifest`, `asset_pipeline` |
| web-prototype | Claude (Phaser 4) | 스크린샷(`screenshot` 있을 때) | |
| code | Claude | `acceptance_commands`의 테스트 | |

### 웹 프로토타입(Phaser 4)

재미를 빨리 확인하고 **버리는** 프로토타입입니다. 데이터(`data/*.json`)와 대사 JSON은 Godot 본편과 같은 파일을 읽습니다(Vite `publicDir`가 `../data`). 규칙 로직은 `src/rules/`의 순수 함수에 두고 Vitest로 테스트하며, 목록·대사 같은 글자 UI는 캔버스 옆 DOM 패널(`#hud`)에 그려 스크린샷 검사가 글자를 읽을 수 있게 합니다. 엔진 중립 대사 JSON의 작은 재생기(`src/dialogue/player.ts`, 조건·변수 포함)도 들어 있습니다. 자세한 것은 [templates/phaser/README.md](templates/phaser/README.md).

web-prototype 작업 파일은 `screenshot: {"serve": "npm --prefix prototype run dev", "url": "http://localhost:5173", "selector": "#hud", "expect_text": "<계약 제목>"}`와 `acceptance_commands: ["npm --prefix prototype test"]`로 검사합니다(예: `examples/tasks/contract-board-ui.json`).

### Godot 본편(4.7)

프로토타입에서 확인한 재미를 Godot으로 만듭니다. 데이터·대사 JSON·애셋은 프로토타입과 같은 파일이고, 규칙 공식(`scripts/rules/contract_rules.gd`)은 프로토타입의 `contract.ts`와 같은 숫자를 내야 합니다(두 테스트가 같은 경우를 봅니다). 대사는 `tools/hfgs/dialogue-to-dtl.mjs ... --out-dir dialogue`로 `.dtl`을 만들어 Dialogic 2가 읽습니다. 자세한 것은 [templates/godot/README.md](templates/godot/README.md).

| 검사 | 명령 | 하는 일 |
|---|---|---|
| 문법 | `godot-check.mjs syntax` | `--import`로 클래스 캐시를 만든 뒤 `scripts/`·`test/`의 `.gd`를 `--check-only`로 파싱 |
| 테스트 | `godot-check.mjs test` | gdUnit4 CLI(헤드리스). 종료 코드 0 성공, 100 실패, 101 경고 |
| 부팅 | `godot-check.mjs run` | 헤드리스로 시작 장면을 띄워 스크립트 오류와 `HFGS_READY` 로그 확인 |
| 화면 | `godot-check.mjs shot` | 창을 띄워(리눅스는 xvfb-run) Movie Maker로 프레임 PNG. 사람이 봄 |

godot-code·godot-scene 작업은 `godot-check.mjs all`(문법+테스트+부팅)이 자동 수용 검사입니다(예: `examples/tasks/contract-rules-godot.json`). Dialogic 2는 아직 alpha(2.0-alpha-20)라 버전을 고정했습니다.

## 검사를 믿을 수 있게 하는 규칙

- **red-first.** `start`는 손대기 전 트리에서 수용 검사를 돌려 적어도 하나는 실패해야 넘어갑니다. 모두 통과하면 `ACCEPTANCE_ALREADY_GREEN`으로 거절합니다. 그 검사는 맞는 결과와 엉터리 결과를 가르지 못하기 때문입니다. 새 파일을 만드는 작업은 파일이 없어 자연히 실패합니다. 이미 있는 데이터를 고치는 작업은 `expect`에 바뀔 값을 적으면 수정 전에는 실패하고 수정 후에 통과하는 검사가 됩니다. 처음부터 통과하는 게 맞으면(리팩터) `baseline_green`에 이유를 적습니다.
- **검사 기준은 범위 밖.** 스키마, 애셋 매니페스트, 대사 검사의 용어집, 참조 이미지는 `scope.paths`에 둘 수 없고(plan이 거절), `start` 때 해시를 기록해 `verify`에서 바뀌었으면 실패합니다. 기준을 느슨하게 고쳐 통과시키는 길을 막습니다.
- **범위 검사.** `verify`는 작업 전과 비교해 바뀐 파일이 `scope.paths`(또는 `allow_out_of_scope`) 안에 있어야 통과합니다. 작업 전부터 바뀌어 있던 파일은 내용이 더 바뀌었을 때만 이 작업의 변경으로 봅니다.
- **섹션 단위 읽기.** 설계 문서가 커질수록 통째로 읽는 비용이 빠르게 늘고, Read 한도(약 2.5만 토큰)를 넘으면 실패합니다(원본 템플릿 [#64](https://github.com/Donchitos/Claude-Code-Game-Studios/issues/64), [#136](https://github.com/Donchitos/Claude-Code-Game-Studios/issues/136)). `context_sections`에 섹션을 적으면 plan이 줄 범위를 찾아 그 범위만 읽게 하고, 40KB가 넘는 문서는 섹션을 안 적어도 통째로 읽지 않게 합니다. 작가 brief에도 같은 지시가 들어갑니다.
- **리뷰어는 결론을 받지 않습니다.** `consult.mjs review`는 작성자의 요약·테스트 주장을 리뷰어에게 주지 않고, diff·바뀐 파일·스크립트가 직접 돌린 검사 결과만 줍니다. 호출 전후 작업 트리를 비교해 전문가가 파일을 바꿨으면 답을 버립니다.

## 주의

- **asset-pipeline은 실제 모델로 검증되지 않았습니다.** 이미지·효과음이 실제로 저장까지 되는지 첫 작업 전에 `asset_capabilities`로 준비 상태를 보고 한 건 돌려 보세요. `PIXEL_STATIC`은 asset-pipeline이 색을 자동으로 줄이지 않아 Pixel Gate에서 FAILED로 끝나기 쉽습니다(plan이 경고).
- **그림과 소리는 사람 승인까지.** `check-assets.mjs`는 크기·투명도·용량·길이·채널만 봅니다. 화풍·캐릭터 일관성과 소리 품질은 사람이 보고 들어 승인합니다. 승인 전 애셋은 아틀라스나 장면에 넣지 않습니다.
- **스크린샷 검사.** 대상 저장소에 Playwright가 있어야 합니다. 스크린샷은 저장소 밖(임시 폴더, `HFGS_SCREENSHOT_DIR`로 변경)에 저장합니다. 서버 종료는 Linux·macOS에서 프로세스 그룹 단위로 테스트했고, Windows(`taskkill /T`)는 테스트하지 않았습니다.
- **agy 모델.** 기본 작가는 `gemini-4-argon`(high)입니다. `agy models` 목록에 없는 모델은 실행 전에 막습니다(agy는 모르는 모델을 받으면 조용히 기본 모델로 돕니다).
- **스팀 출시.** AI 생성 콘텐츠 공개 의무와 각 생성 서비스의 상업적 이용 조건을 확인하세요(`design/art-bible.md`에 기록란이 있습니다).
- **v1에서 설치한 `hyperfusion.config.json`**이 게임 저장소에 남아 있으면 setup이 알려 줍니다. hyperfusion을 따로 쓰지 않으면 지워도 됩니다.

## 테스트

```bash
npm test
```

`start`·`verify` 테스트는 임시 git 저장소를 만들어 실제로 커밋하고 비교합니다. Godot 검사 도구는 가짜 Godot 실행 파일로 명령 구성과 종료 코드 처리를 테스트합니다. CI는 Node 24에서 돌고, 별도 잡 둘이 템플릿을 실제로 검증합니다: `phaser-template`(npm install·Vitest·tsc·빌드·Playwright 스크린샷)과 `godot-template`(Godot 4.7.2 다운로드·애드온 설치·문법·gdUnit4·헤드리스 부팅·xvfb 스크린샷). Phaser·Vite·Godot 새 버전에서 템플릿이 깨지면 거기서 드러납니다.

## 라이선스

MIT. 역할 규칙·검토 스킬(Claude-Code-Game-Studios)과 CLI 어댑터·마스킹·수용 검사 무결성(hyperfusion)의 출처는 [NOTICE.md](NOTICE.md)에 있습니다.
