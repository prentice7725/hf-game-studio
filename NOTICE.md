# 출처 표기

## Claude-Code-Game-Studios

`roles/`의 역할 지시문과 `skills/gs-*`의 검토 스킬은 아래 프로젝트의 에이전트·스킬을 바탕으로 hf-game-studio에 맞게 줄이고 고쳐 쓴 것입니다.
원본의 협업 절차(질문 우선, 파일 쓰기 승인), 디렉터 게이트, 설정 해석 훅은 가져오지 않았습니다.

- 저장소: https://github.com/Donchitos/Claude-Code-Game-Studios
- 라이선스: MIT License, Copyright (c) 2026 Donchitos

| hf-game-studio | 원본 |
|---|---|
| roles/game-designer.md | .claude/agents/game-designer.md |
| roles/systems-designer.md | .claude/agents/systems-designer.md |
| roles/economy-designer.md | .claude/agents/economy-designer.md |
| roles/writer.md | .claude/agents/writer.md |
| roles/world-builder.md | .claude/agents/world-builder.md |
| roles/technical-artist.md | .claude/agents/technical-artist.md |
| roles/level-designer.md | .claude/agents/level-designer.md |
| roles/ui-programmer.md | .claude/agents/ui-programmer.md |
| roles/gameplay-programmer.md | .claude/agents/gameplay-programmer.md |
| skills/gs-balance-check | .claude/skills/balance-check |
| skills/gs-design-review | .claude/skills/design-review |
| skills/gs-scope-check | .claude/skills/scope-check |

## HyperFusion

`scripts/lib/`의 외부 CLI 호출 코드는 hyperfusion 0.30.0에서 옮겨 와 줄인 것입니다. 전문가 모델을 읽기 전용으로만 부르므로
구현 라운드, 쓰기 샌드박스, 재개(resume), 리스, 요청 전체 마스킹(maskTransport)은 가져오지 않았습니다.
`scripts/task.mjs`의 red-first(시작 전에 수용 검사가 실패하는지 확인)와 검사 기준 파일을 범위 밖에 두고 불변을 확인하는 규칙은
hyperfusion의 `acceptance.mjs`·`acceptance-integrity.mjs` 설계를 옮겨 온 것입니다. hyperfusion 자체는 더 쓰지 않습니다(v2 9단계).

- 저장소: https://github.com/prentice7725/hyperfusion
- 라이선스: MIT License, Copyright (c) 2026 prentice7725

| hf-game-studio | 원본 |
|---|---|
| scripts/lib/cli.mjs | scripts/adapters/common.mjs (probe, hasOption, extractResult, 읽기 전용 지시문, 비밀 경로) |
| scripts/lib/adapters/codex.mjs | scripts/adapters/codex.mjs, scripts/codex-sandbox.mjs (Windows 샌드박스 진단) |
| scripts/lib/adapters/agy.mjs | scripts/adapters/antigravity.mjs, scripts/adapters/agy-model.mjs |
| scripts/lib/adapters/grok.mjs | scripts/adapters/grok.mjs |
| scripts/lib/redaction.mjs | scripts/redaction.mjs |
| scripts/lib/env.mjs | scripts/worker-env.mjs |
| scripts/lib/platform.mjs | scripts/platform.mjs |
