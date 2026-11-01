# 웹 프로토타입 템플릿 (Phaser 4)

재미를 빨리 확인하고 **버리는** 프로토타입입니다. 남기는 것은 재미 판정, 수치(`data/*.json`), 대사(`data/dialogue/*.json`), 설계 문서 수정이고 코드는 버립니다. 본편은 Godot입니다.

## 설치

게임 저장소에 `node <hf-game-studio>/scripts/setup.mjs <저장소> --phaser`로 깔면 `prototype/`에 복사됩니다(이미 있는 파일은 건너뜀). 그다음:

```bash
cd prototype && npm install
```

스크린샷 검사(`npm run shot`, `tools/hfgs/screenshot.mjs`)에는 Playwright가 필요합니다. 게임 저장소 루트에서 한 번:

```bash
npm i -D playwright && npx playwright install chromium
```

## 구조

```text
index.html                 캔버스(#game) + DOM 패널(#hud). 글자 UI는 DOM에 그려 스크린샷 검사가 읽을 수 있게 한다
vite.config.ts             publicDir = ../data (Godot과 같은 데이터 파일), base './', Vitest 설정
src/main.ts                데이터 로드 → DOM 패널 → Phaser 시작. ?seed=값으로 난수 고정
src/data/types.ts          design/schemas/*.schema.json과 같은 모양의 타입
src/data/load.ts           data/*.json을 상대 경로로 fetch
src/rules/contract.ts      계약 성공 확률(GDD "수치와 공식"). 순수 함수, Vitest로 테스트
src/dialogue/player.ts     엔진 중립 대사 JSON 재생기(조건·변수 포함). 순수 로직, Vitest로 테스트
src/ui/hud.ts              DOM 패널: 계약 목록, 대사 상자
src/scenes/*.ts            Phaser 장면. 그리기만 하고 규칙은 rules/를 부른다
```

## 명령

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버(5173, 고정 포트) |
| `npm test` | Vitest(규칙·대사 재생기) |
| `npm run typecheck` | tsc |
| `npm run build` | `dist/`에 빌드(data/도 복사됨) |
| `npm run shot` | 서버를 띄워 `#hud`에 `ready`가 보이는지 확인하고 스크린샷 |

작업 파일(web-prototype)에서는 `screenshot: {"serve": "npm --prefix prototype run dev", "url": "http://localhost:5173", "selector": "#hud", "expect_text": "<작업이 새로 그리는 글자>"}`처럼 적고, 규칙 테스트는 `acceptance_commands`에 `npm --prefix prototype test`를 넣습니다. 이 템플릿은 계약 목록과 성공 확률을 이미 그리므로 `expect_text`에 계약 제목을 적으면 red-first가 처음부터 통과합니다. 첫 화면 작업은 템플릿에 없는 것, 예를 들어 GDD "계약 해결"(받기 버튼 → `rules/contract.ts`의 `resolveContract` 판정 → `rules/guild.ts` 장부에 보수 반영 → `#hud`에 결과와 금화 표시)을 시키고 `expect_text`는 `금화`로 둡니다(`examples/tasks/contract-board-ui.json`). `guild.ts`는 템플릿에 없습니다. 작업이 만듭니다.

## 규칙

- 규칙 로직은 `src/rules/`의 순수 함수에 두고 테스트합니다. 장면은 그리기와 입력 전달만 합니다.
- 수치·문구·대사는 `data/`에서 읽습니다. 코드에 복사하지 않습니다.
- Phaser 4는 WebGL 전용입니다. 헤드리스 Chromium(SwiftShader)에서도 돌지만, 캔버스 픽셀을 비교하는 검사는 흔들릴 수 있어 글자 확인은 DOM 패널로 합니다.
- 초상화·효과음은 사람이 승인한 뒤에만 `this.load`로 넣습니다.
