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

1. **게임 brief 작성.** `game_kind`를 고른다(아래 표). hyperfusion brief 필드(`task_id`, `objective`, `scope.paths`, `success_criteria`, `acceptance_map` 등)에 게임 필드(`schema`, `assets_manifest`, `screenshot`, `role`, `context_docs`)를 더한 형식이다. 예시는 `$HFGS/examples/briefs/`.
2. **컴파일.** `node $HFGS/scripts/brief.mjs GAME-BRIEF.json --repo $HF_REPO --out BRIEF.json`. 역할 지시문과 단일 원본 문서 안내가 `constraints`에, 게임용 수용 검사가 `acceptance_commands`에 들어간다. `HF_SKILL`이 설정되어 있으면 hyperfusion 자체 brief 검증도 돌린다. 경고(문서 없음, 수용 명령 없음)는 사용자에게 알린다.
3. **실행.** 이후는 hyperfusion 절차 그대로: `fusion-state.mjs init $HF_REPO BRIEF.json` → begin → … → CLOSE.

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
| ui | ui | ui-programmer | `screenshot` 있으면 스크린샷 | Gemini Argon → Sonnet |
| gameplay-code / tests / refactor | code / tests / refactor | gameplay-programmer | 없음 | 난이도별 |

hyperfusion의 task_kind는 6종으로 고정이라 지표(실적)는 task_kind 단위로 쌓인다. 예를 들어 gdd·narrative·lore는 모두 docs 실적으로 합쳐진다.

## 규칙

- **검사 기준은 범위 밖에.** `schema`, `assets_manifest`는 `scope.paths`에 넣을 수 없다(컴파일러가 거절). 일꾼이 기준을 느슨하게 고쳐 통과하는 길을 막는다.
- **이미지는 사람 승인까지.** 매니페스트 검사는 크기·투명도·용량만 본다. 화풍 일관성은 리드 리뷰와 사용자 승인으로 본다. 승인 전 애셋은 아틀라스에 넣지 않는다.
- **오디오는 일꾼이 없다.** 오디오를 생성하는 일꾼이 없으므로 오디오는 사양서(gdd)로만 다룬다.
- **게이트는 hyperfusion 것 하나.** 원본 템플릿(Claude-Code-Game-Studios)의 디렉터 게이트·GDD 섹션 강제는 가져오지 않았다. 승인·체크포인트는 hyperfusion 프로젝트(`project.mjs`)로만 한다.
- **작게 시작.** 첫 프로젝트는 `$HFGS/examples/PLAN.json`처럼 용병 1명 + 계약 1개 + 화면 1개 크기로 한 마일스톤만 돌린다.

## 검토 스킬

setup이 게임 저장소에 까는 리드용 스킬이다. 리드나 리뷰 단계에서 직접 쓴다(일꾼에게 넘기지 않는다).

- `/gs-balance-check <데이터 파일>`: 수치 이상치, 지배 전략, 자원 흐름 점검
- `/gs-design-review <문서>`: GDD 섹션이 구현 가능한 규칙인지 점검
- `/gs-scope-check`: 마일스톤 계획이 범위를 넘는지 점검
