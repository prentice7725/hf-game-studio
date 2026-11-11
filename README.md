# hf-game-studio

[English](README.en.md) · [日本語](README.ja.md)

**Claude Code로 게임을 만들 때 쓰는 스킬입니다.** Claude가 기획과 코드를 직접 맡고, 다른 AI는 잘하는 일에만 부릅니다.

| 일 | 맡는 쪽 |
|---|---|
| 기획, 코드, 수치, 검수 | Claude |
| 시나리오, 대사 | Gemini (Argon) |
| 이미지, 효과음 | [asset-pipeline](https://github.com/prentice7725/asset-pipeline) (ComfyUI 등) |
| 코드 리뷰 | 다른 회사 모델 (기본 Codex) |

다른 AI는 파일을 고치지 못하고 결과만 돌려줍니다. 그림과 소리는 사람이 보고 들어야 채택됩니다.

## 왜 쓰나

AI에게 게임을 맡기면 두 가지가 자주 무너집니다.

1. **"됐습니다"를 믿을 수 없습니다.** 그래서 작업마다 **기계가 돌리는 검사**를 먼저 정하고, 그 검사가 통과해야 끝난 것으로 봅니다.
2. **만들고 나서야 재미없다는 걸 압니다.** 그래서 큰 것을 만들기 전에 **작은 실험**으로 "이 선택이 정말 결과를 바꾸는가"부터 확인합니다(v3, 시험 중).

## 설치

필요한 것: Node.js 24 이상, Git, Claude Code. 다른 AI는 쓸 것만 깔면 됩니다(`codex`, `agy`, asset-pipeline).

```bash
git clone https://github.com/prentice7725/hf-game-studio.git ~/.claude/skills/hf-game-studio
```

게임 저장소에 깔기:

```bash
node ~/.claude/skills/hf-game-studio/scripts/setup.mjs <게임 저장소>
```

설계 문서 뼈대(`design/`), 검사 도구(`tools/hfgs/`), 보조 스킬(`.claude/skills/gs-*`)이 생깁니다. 있는 파일은 덮어쓰지 않습니다.

- 웹 프로토타입(Phaser 4)도 깔려면 `--phaser`
- Godot 4.7 본편도 깔려면 `--godot`

## 쓰는 법

게임 저장소에서 Claude Code를 열고 말로 시키면 됩니다. 예:

- "용병 데이터 첫 항목 만들어 줘"
- "계약 게시판 화면 프로토타입 만들어 줘"
- "주인공 초상화 후보 세 장 뽑아 줘"

Claude가 알아서 아래 순서를 밟습니다.

```text
작업 정의 → 검사가 먼저 실패하는지 확인 → 구현 → 검사 통과 확인 → 다른 AI가 리뷰 → (그림·소리는) 사람이 승인
```

### 실험 (v3, 시험 중)

| 스킬 | 하는 일 |
|---|---|
| `/gs-inspect` | 설계 문서와 코드를 대조해 어긋난 곳과 다음에 확인할 질문을 냄 |
| `/gs-research` | 비슷한 게임이 그 문제를 어떻게 풀었는지 출처와 함께 조사 |
| `/gs-experiment` | 질문 하나를 실험 카드로: 가설, 틀렸다고 볼 조건, 측정을 만들기 전에 적음 |

실험은 싼 것부터 합니다. 시뮬레이션으로 답이 나오면 화면을 만들지 않습니다.

```text
시뮬레이션 → 웹 프로토타입 → Godot 본편
```

## 지켜지는 규칙

- **검사는 먼저 실패해야 합니다.** 손대기 전에 이미 통과하는 검사는 아무것도 확인하지 못하므로 받지 않습니다.
- **검사 기준은 못 고칩니다.** 스키마, 애셋 규격, 용어집을 작업 도중 바꾸면 실패합니다.
- **정한 범위 밖 파일을 고치면 실패합니다.**
- **리뷰어는 작성자의 설명을 받지 않습니다.** 바뀐 코드와 검사 결과만 보고 판정합니다.
- **실험의 문턱은 만들기 전에 적고, 결과를 보고 바꾸지 않습니다.**

## 더 읽을 것

- [docs/reference.md](docs/reference.md): 파일 구성, 작업 파일 필드, 작업 종류, 애셋·Godot 절차, 주의할 점
- [SKILL.md](SKILL.md): Claude가 따르는 절차
- [docs/design/game-studio-v2.md](docs/design/game-studio-v2.md), [game-studio-v3.md](docs/design/game-studio-v3.md): 설계 배경과 실측 기록

## 테스트

```bash
npm test
```

## 라이선스

MIT. 가져온 부분의 출처는 [NOTICE.md](NOTICE.md)에 있습니다.
