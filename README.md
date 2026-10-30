# hf-game-studio

**[HyperFusion](https://github.com/prentice7725/hyperfusion) 위에 올리는 멀티 모델 게임 개발 레이어입니다.**
게임 작업을 각 모델이 잘하는 쪽에 나눠 맡깁니다. 시나리오·대사·UI는 Gemini Argon(Antigravity), 이미지 애셋은 Grok, 수치 데이터와 핵심 구현은 Sonnet이 맡고, 리드(Opus)가 계획·반려·최종 판정을 합니다.

두 프로젝트를 섞은 포크가 아니라 **레이어로 쌓은 구조**입니다.

| 층 | 담당 | 출처 |
|---|---|---|
| 실행 엔진 | 일꾼 배치, 반려·교체, 스냅샷 검증, 리뷰, 마일스톤 게이트 | hyperfusion (설치된 것을 그대로 사용, 이 저장소에는 없음) |
| 게임 레이어 | 게임 작업 종류, 역할 지시문, 단일 원본 문서, 게임용 수용 검사, 리드 검토 스킬 | 이 저장소 (역할·스킬은 [Claude-Code-Game-Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) 기반) |

hyperfusion이 업데이트되면 그대로 반영되고, 두 저장소가 서로 꼬이지 않습니다.

## 구성

```text
SKILL.md                   리드용 메인 스킬(/hf-game-studio)
game-kinds.json            게임 작업 종류 → hyperfusion task_kind 매핑, 역할, 수용 검사
presets/
  hyperfusion.config.json  게임용 hyperfusion 설정 프리셋
roles/*.md                 역할 지시문(일꾼 brief의 constraints로 들어감)
scripts/
  brief.mjs                게임 brief → hyperfusion brief 컴파일러
  setup.mjs                게임 저장소에 레이어 설치
tools/                     게임 저장소의 tools/hfgs/로 복사되는 수용 검사 도구
  validate-data.mjs        JSON 데이터 스키마 검사(대사 그래프 참조 검사 포함)
  check-assets.mjs         PNG 크기·투명도·용량 검사
  screenshot.mjs           화면을 띄워 선택자·문구·콘솔 오류 확인 + 스크린샷
templates/design/          단일 원본 문서 뼈대(용어집, 세계관, GDD, 아트 바이블, 애셋 매니페스트, 스키마)
skills/gs-*                게임 저장소에 설치되는 리드 검토 스킬(밸런스, 설계, 범위)
examples/                  첫 마일스톤 PLAN.json과 게임 brief 예시
```

## 왜 task_kind를 늘리지 않고 매핑하나

hyperfusion의 `task_kind`는 `code, ui, image-asset, tests, refactor, docs` 6종이 코드(`executor-config.mjs`, `contracts.mjs`)에 고정되어 있어, `gdd`나 `narrative` 같은 새 종류를 설정에 넣으면 검증에서 거절됩니다. 그래서 hyperfusion은 고치지 않고, 게임 작업 종류를 `game-kinds.json`에서 6종 중 하나로 내려 보냅니다.

| game_kind | task_kind | 역할 | 자동 수용 검사 | 1순위 일꾼(프리셋) |
|---|---|---|---|---|
| gdd | docs | game-designer | - | Antigravity (Gemini Argon) |
| narrative | docs | writer | 스키마(`schema` 있을 때) | Antigravity (Gemini Argon) |
| lore | docs | world-builder | - | Antigravity (Gemini Argon) |
| balance-data | code / medium | systems-designer | 스키마(필수) | Sonnet |
| economy-data | code / medium | economy-designer | 스키마(필수) | Sonnet |
| level | code | level-designer | 스키마(`schema` 있을 때) | 난이도별 |
| image-asset | image-asset | technical-artist | 매니페스트 규격(필수) | Grok |
| ui | ui | ui-programmer | 스크린샷(`screenshot` 있을 때) | Antigravity (Gemini Argon) |
| gameplay-code, tests, refactor | 같은 이름 | gameplay-programmer | - | 난이도별 |

한계: 실적(라우팅 학습)은 task_kind 단위로 쌓입니다. gdd·narrative·lore는 모두 docs 실적으로 합쳐집니다.

## 설치

필요한 것: hyperfusion 설치(Node.js 24+, 첫 커밋이 있는 Git 저장소, 일꾼 CLI 하나 이상).

```bash
git clone https://github.com/prentice7725/hyperfusion.git ~/.claude/skills/hyperfusion
```

```bash
git clone https://github.com/prentice7725/hf-game-studio.git ~/.claude/skills/hf-game-studio
```

게임 저장소에 레이어를 깝니다. 이미 있는 파일은 덮어쓰지 않습니다.

```bash
node ~/.claude/skills/hf-game-studio/scripts/setup.mjs <게임 저장소>
```

일꾼 CLI가 실제로 도는지 확인합니다.

```bash
node ~/.claude/skills/hyperfusion/scripts/setup-doctor.mjs <게임 저장소> --smoke
```

검사 도구나 스킬만 새 버전으로 바꾸려면 `--force`를 붙입니다. 설정(`hyperfusion.config.json`)과 설계 문서(`design/`)는 `--force`에도 덮어쓰지 않습니다.

## 사용 흐름

1. **단일 원본 문서 채우기.** `design/glossary.md`, `world.md`, `gdd.md`, `art-bible.md`를 먼저 채웁니다. 모든 모델이 이 문서를 읽습니다. 비어 있으면 모델마다 세계관과 수치를 따로 지어냅니다.
2. **결과물 형식 정하기.** 데이터는 `design/schemas/*.schema.json`, 이미지는 `design/asset-manifest.json`에 형식을 먼저 적습니다. 이 파일들이 컨트롤러의 수용 검사 기준이 됩니다.
3. **프로젝트 계획.** `examples/PLAN.json`처럼 작게(용병 1명 + 계약 1개 + 화면 1개) 한 마일스톤을 hyperfusion `project.mjs propose`로 올리고 승인합니다.
4. **작업마다 게임 brief 작성 → 컴파일 → hyperfusion 실행.**

```bash
BRIEF=$(HF_SKILL=~/.claude/skills/hyperfusion node ~/.claude/skills/hf-game-studio/scripts/brief.mjs merc-data.json --repo .)
```

```bash
node ~/.claude/skills/hyperfusion/scripts/fusion-state.mjs init . "$BRIEF"
```

컴파일된 brief는 기본으로 **저장소 밖** 임시 폴더(`<tmp>/hfgs-briefs/<task_id>.json`, `HFGS_BRIEF_DIR`로 변경)에 쓰고 그 경로만 출력합니다. 저장소 안에 쓰면 추적되지 않는 파일이 hyperfusion의 변경 목록에 섞이기 때문입니다. `--out`으로 위치를 정할 수 있고(저장소 안이면 경고), `--stdout`이면 JSON을 그대로 출력합니다.

`HF_SKILL`을 주면 컴파일 결과가 설치된 hyperfusion의 brief 검증까지 통과하는지 확인합니다.

### 게임 brief

hyperfusion brief 필드에 게임 필드를 더한 형식입니다.

```json
{
  "task_id": "M1-T1-merc-data",
  "game_kind": "balance-data",
  "objective": "Create the first mercenary, Ash, in data/mercenaries.json ...",
  "scope": {"paths": ["data/mercenaries.json"]},
  "schema": "design/schemas/mercenaries.schema.json",
  "success_criteria": ["AC1: data/mercenaries.json validates against the schema ..."],
  "acceptance_map": {"AC1": ["@auto"]}
}
```

| 필드 | 뜻 |
|---|---|
| `game_kind` | 위 표의 게임 작업 종류 |
| `role` | 역할 덮어쓰기. `null`이면 역할 지시문을 넣지 않음 |
| `context_docs` | 일꾼이 먼저 읽을 단일 원본 문서. 기본은 `design/` 네 문서 중 있는 것 |
| `context_sections` | 문서별로 읽을 섹션 제목. `{"design/gdd.md": ["규칙", "수치와 공식"]}`. 아래 "설계 문서 읽기" 참고 |
| `schema`, `data_files` | 데이터 스키마 검사. `data_files`를 생략하면 `scope.paths`의 `.json` |
| `expect` | 바뀌어야 할 값. `{"/mercenaries/[id=ash]/hire_cost": 120}`처럼 경로와 JSON 값. `[키=값]`은 그 필드가 같은 원소를 고름 |
| `assets_manifest`, `asset_files` | 애셋 규격 검사. `asset_files`를 생략하면 `scope.paths`의 `.png` |
| `screenshot` | `url`·`file`·`electron` 중 하나와 `selector`(필수), `serve`, `expect_text`, `name`(선택). 로컬 서버 주소면 `serve`(서버 실행 명령) 필수 |
| `acceptance_map`의 `"@auto"` | 자동으로 만든 수용 명령 전부 |

컴파일러가 하는 일:

- `game_kind`를 hyperfusion `task_kind`(와 기본 난이도)로 바꿉니다.
- 종류별 제약, 역할 지시문, 단일 원본 문서 안내를 `constraints`에 넣습니다. 일꾼 간 통신 언어가 영어라 지시문은 영어입니다.
- `schema`(+ `expect`), `assets_manifest`, `screenshot`으로 `acceptance_commands`를 만듭니다.
- 이미 있는 파일을 형식 검사만으로 고치는 작업이면 경고합니다(아래 red-first).
- 검사 기준 파일(`schema`, `assets_manifest`)이 `scope.paths`에 있으면 거절합니다. 일꾼이 기준을 느슨하게 고쳐 통과하는 것을 막기 위해서입니다.

### 설계 문서 읽기: 섹션 단위로

모든 일꾼이 매 작업마다 설계 문서를 통째로 읽으면 문서가 커질수록 토큰이 빠르게 늘어납니다. 원본 템플릿에서는 GDD 하나가 1.7MB(약 45만 토큰)까지 커져 주간 한도를 3일 만에 다 쓴 사례가 있습니다([#136](https://github.com/Donchitos/Claude-Code-Game-Studios/issues/136)). Claude Code의 Read는 한 번에 약 2.5만 토큰까지라, 큰 문서는 읽기가 실패해 나눠 다시 읽느라 비용이 두 배쯤 듭니다([#64](https://github.com/Donchitos/Claude-Code-Game-Studios/issues/64)). 여러 일꾼이 돌고 반려 때마다 다시 읽는 hyperfusion에서는 이 비용이 더 커집니다.

그래서 컴파일러는 문서마다 읽는 방식을 정해 일꾼에게 지시합니다.

| 문서 | 일꾼 지시 |
|---|---|
| `context_sections`에 섹션을 적은 문서 | 그 섹션의 줄 범위만 읽음(컴파일 시점의 범위를 brief에 적어 줌) |
| 섹션을 안 적은 40KB 이하 문서 | 통째로 읽음 |
| 섹션을 안 적은 40KB 초과 문서 | 제목만 `grep`으로 보고 필요한 섹션만 읽음. 통째 읽기 금지(컴파일 시 경고) |

```json
"context_sections": {"design/gdd.md": ["규칙", "수치와 공식"]}
```

섹션은 다음에 오는 같은 단계 이상의 제목 직전까지이고, 하위 섹션을 포함합니다. 없는 섹션 이름을 적으면 있는 제목 목록과 함께 거절합니다. 리드용 `gs-*` 검토 스킬도 같은 방식으로 섹션만 읽습니다.

### red-first: 이미 있는 파일을 고치는 작업

hyperfusion은 일꾼이 손대기 전에 수용 검사를 한 번 돌려 **실패하는지** 확인하고, 모두 통과하면 `ACCEPTANCE_ALREADY_GREEN`으로 작업을 시작하지 않습니다. 맞는 결과와 엉터리 결과를 가르지 못하는 검사이기 때문입니다.

- 새 파일을 만드는 작업은 파일이 없어 검사가 실패하므로 그대로 됩니다.
- 이미 있는 데이터를 고치는 작업은 스키마 검사가 처음부터 통과합니다. `expect`에 바뀔 값을 적으면 수정 전에는 실패하고 수정 후에 통과하는 검사가 됩니다.

```json
"expect": {"/mercenaries/[id=ash]/hire_cost": 120}
```

- 이미 있는 이미지를 다시 만드는 작업은 매니페스트 검사가 처음부터 통과합니다. 크기를 바꾸는 경우가 아니면 다른 검사를 `acceptance_commands`에 넣거나, hyperfusion의 `acceptance_baseline_green`에 이유를 적습니다.

### UI 스크린샷과 개발 서버

hyperfusion은 일꾼 프로세스가 **모두 끝난 뒤에** 수용 검사를 돌립니다. 일꾼이 띄운 개발 서버는 그때 이미 꺼져 있습니다(남아 있으면 종료 확인에서 막힙니다). 그래서 서버 주소를 찍을 때는 `serve`에 서버 실행 명령을 적어 검사 도구가 직접 띄우게 합니다.

```json
"screenshot": {"serve": "npm run dev", "url": "http://localhost:5173", "selector": "#contract-board", "expect_text": "곡물 수레 호위"}
```

검사 도구는 서버를 띄우고, 주소가 응답할 때까지 기다렸다가(기본 60초) 찍은 뒤 서버를 자식·손자 프로세스까지 종료합니다. 빌드 결과물을 바로 열 수 있으면 `"file": "dist/index.html"`이 더 단순합니다.

## 게이트와 프로세스

게이트는 hyperfusion 것 하나만 씁니다. 원본 게임 스튜디오 템플릿의 디렉터 게이트, GDD 섹션 강제, 질문 우선 협업 절차는 가져오지 않았습니다. 프로세스를 무겁게 할수록 결과가 나빠졌다는 원본 작성자의 실측이 있고, 모델을 여러 개 섞으면 그 오버헤드가 더 커지기 때문입니다.

## 주의

- **Grok 이미지 생성은 검증되지 않았습니다.** hyperfusion 테스트의 CLI는 가짜라 실제 이미지 생성과 저장은 확인되지 않았습니다. 애셋 작업 전에 Grok으로 이미지 한 장을 실제 저장까지 해 보세요.
- **asset-pipeline 연동.** [asset-pipeline](https://github.com/prentice7725/asset-pipeline)의 MCP 서버를 Codex(`~/.codex/config.toml`의 `[mcp_servers.asset_pipeline]`)에 등록해 두면, image-asset brief에 `"asset_pipeline": {"project_id": "<게임 id>"}`를 넣어 Luna가 그 서버로 생성하게 할 수 있습니다(예: `examples/briefs/merc-portrait-pipeline.json`). 컴파일러가 생성 절차·재시도 금지·run_id 보고를 제약으로 넣고, `init ... --executor luna`로 배치하라고 경고합니다. Claude 일꾼은 hyperfusion이 MCP를 막고, Grok·Antigravity에는 이 서버가 없습니다. 결과는 asset-pipeline에서도 REVIEW_REQUIRED 후보이므로 사람 승인 규칙은 그대로입니다.
- **이미지는 사람 승인까지 필요합니다.** `check-assets.mjs`는 크기·투명도·용량만 봅니다. 화풍과 캐릭터 일관성은 리뷰와 사람 승인으로 확인하고, 승인 전에는 아틀라스에 넣지 않습니다.
- **Antigravity 모델 고정.** 프리셋은 `executors.antigravity.model`을 `gemini-4-argon`(+ `reasoning_effort: high` → `gemini-4-argon-high`)으로 둡니다. 설치된 `agy`가 `--model`을 지원하지 않거나 `agy models`에 그 모델이 없으면 hyperfusion이 Antigravity를 미설치로 보고 건너뜁니다. setup-doctor로 확인하세요.
- **오디오 생성 일꾼은 없습니다.** 오디오는 사양서(gdd)로만 다룹니다.
- **스팀 출시.** AI 생성 콘텐츠 공개 의무와 각 생성 서비스의 상업적 이용 조건을 확인하세요(`design/art-bible.md`에 기록란이 있습니다).
- **스크린샷 검사.** 대상 저장소에 Playwright가 있어야 합니다. 스크린샷은 저장소 밖(임시 폴더, `HFGS_SCREENSHOT_DIR`로 변경)에 저장합니다. 저장소 안에 쓰면 hyperfusion이 트리 변경으로 봅니다. 서버 종료는 Linux·macOS에서 프로세스 그룹 단위로 테스트했고, Windows(`taskkill /T`)는 테스트하지 않았습니다.

## 테스트

```bash
npm test
```

hyperfusion이 설치되어 있으면 실제 hyperfusion 검증(brief 계약, 설정)까지 같이 돌립니다.

```bash
HF_SKILL=~/.claude/skills/hyperfusion npm test
```

CI(`.github/workflows/test.yml`)는 main 푸시와 PR마다 최신 hyperfusion을 받아 위 명령과 같은 방식으로 돌립니다. hyperfusion이 바뀌어 이 레이어가 깨지면 여기서 드러납니다.

## 라이선스

MIT. 역할 지시문과 검토 스킬의 출처는 [NOTICE.md](NOTICE.md)에 있습니다.
