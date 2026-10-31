# hf-game-studio v2: 게임 개발 특화 설계

작성: 2026-10-30. 상태: 방향 결정됨(아래 "결정"). 세부 구현은 실행 순서대로 진행.

## 결정 (2026-10-30)

| 질문 | 결정 |
|---|---|
| hyperfusion 의존 | **의존을 끊고 좋은 부분만 가져온다.** 무엇을 가져올지는 "hyperfusion에서 가져올 것" 참고 |
| Godot 버전 | **4.7 이상으로 고정** (godot-ai MCP 요구 사항, Dialogic 2는 4.5 이상) |
| 대사 형식 | **엔진 중립 JSON이 원본이고, Dialogic 2 타임라인(`.dtl`)으로 변환한다.** 웹 프로토타입도 같은 JSON을 읽는다 |
| 웹 프로토타입 | **Phaser 4** (4.2.x, Vite + TypeScript) |

## 왜 바꾸나

hf-game-studio는 hyperfusion 위에 게임 작업 종류를 얹는 얇은 층으로 시작했다. hyperfusion의 원래 목적은 Claude 토큰을 아끼면서 다른 모델(Codex, Grok, Gemini)에게 일을 넘기는 것이었고, 일반 앱·웹 개발에 맞춰 커졌다. 그 결과 게임 작업에는 맞지 않는 부분이 생겼다.

- 작업 종류가 hyperfusion의 6종(code, ui, image-asset, tests, refactor, docs)에 묶여 효과음을 `image-asset`으로 우회해야 한다(PR 8).
- Claude 일꾼은 MCP를 쓸 수 없어(`--disallowedTools mcp__*`) 애셋 파이프라인과 Godot 에디터를 부를 수 없다.
- 리드 가드도 MCP를 읽기 전용 목록만 통과시킨다.

이제 Claude Max를 쓰므로 "Claude 토큰 아끼기"라는 전제가 이 프로젝트에서는 약해졌다. v2는 **Claude가 주도하고, 분야마다 잘하는 모델을 전문가로 부르는 스튜디오**로 방향을 바꾼다.

## 원칙

1. **Claude가 리드이자 주 구현자다.** 설계, 코드, 통합, 검수를 맡는다.
2. **전문가는 잘하는 일만 한다.**
   - 이미지 생성·편집: Claude는 할 수 없으므로 ComfyUI(로컬), Codex, Grok에 맡긴다.
   - 시나리오·대사·로어: Gemini Argon. 문장이 살아 있다. Claude는 용어집과 설정에 맞는지 검수하는 편집자를 맡는다.
   - 리뷰: 작성한 모델과 **다른 계열**이 한다. Claude가 쓴 코드는 Codex나 Gemini가, 다른 모델이 쓴 결과는 Claude가 본다.
3. **웹은 프로토타입, Godot은 본편이다.** 웹으로 재미를 빨리 확인하고 버린다. 실제 게임은 Godot 4.x로 만들고, 게임 성격에 따라 GDScript와 C# 중 고른다.
4. **엔진과 무관한 산출물이 원본이다.** 설계 문서, 데이터 JSON, 애셋 매니페스트, 애셋 파일은 웹에서 Godot으로 그대로 넘어간다.
5. **사람 승인은 그대로 둔다.** 그림과 소리는 사람이 보고 듣고 승인한다. 기계 검사는 규격만 본다.

## 구조: 저장소 셋, 역할 분명히

코드를 한 저장소로 합치지 않는다. hyperfusion은 아직 빠르게 바뀌고(0.30.0), asset-pipeline은 Python, ComfyUI, Aseprite, ffmpeg를 끌고 오는 무거운 스택이다. 대신 역할을 나눈다.

| 저장소 | 역할 | v2에서의 관계 |
|---|---|---|
| hf-game-studio | 게임 스튜디오의 두뇌: 작업 종류, 역할, 검사 도구, 흐름 | 중심. Claude Code 플러그인(스킬, 에이전트, 훅)으로 게임 저장소에 설치 |
| asset-pipeline | 애셋 공장: 이미지, 픽셀, 애니메이션, 효과음 | MCP 서버로 연결. 리드가 직접 호출 |
| hyperfusion | (의존 끊음, 9단계 완료) | 외부 CLI 어댑터·마스킹(`scripts/lib/`)과 수용 검사 무결성(`scripts/task.mjs`)만 옮겨 왔다 |
| Godot MCP(외부) | Godot 에디터·실행 제어 | MCP 서버로 연결 |

## hyperfusion에서 가져올 것

hyperfusion은 Claude 토큰을 아끼려는 위임 엔진이라 라운드, 리스, 워크트리, 메모리, 자동 조종 같은 장치가 크다. v2는 Claude가 직접 구현하므로 이 장치들은 필요 없다. 아래만 옮겨 오고, 옮길 때 hf-game-studio 규모에 맞게 줄인다.

| 가져올 것 | hyperfusion 출처 | 왜 |
|---|---|---|
| 외부 CLI 어댑터: 모델 고정, 지원 플래그·인증 확인, 결과 JSON 스키마 고정 | `scripts/adapters/{codex,antigravity,agy-model,grok,common}.mjs` | Codex 리뷰, Argon 글쓰기를 안정적으로 부르는 핵심. Windows에서 agy 프롬프트 길이 문제 같은 현장 경험이 담겨 있다 |
| 교차 계열 리뷰 규칙: 리뷰어에게 작성자의 요약·주장·이전 판정을 주지 않고 diff, 파일, 검사 결과만 준다 | `review-plan.mjs`, `references/review-protocol.md` | 리뷰가 작성자의 결론에 끌려가지 않게 한다 |
| 지적별 처분: act, consider, noted, dismissed, contract_misread와 이유 | `review-plan.mjs`, `metrics` | 리뷰어별로 쓸모 있는 지적 비율을 볼 수 있다 |
| 수용 검사 무결성: 검사 기준 파일은 작업 범위 밖, 시작 전에 이미 통과하면 거절(red-first) | `acceptance-integrity.mjs`, `acceptance.mjs` | 검사를 느슨하게 고쳐 통과하는 길을 막는다. 지금 `brief.mjs`에도 일부 있다 |
| 비밀 읽기 차단, 출력 마스킹 | `bash-policy.mjs`(`secretReadDeny`), `redaction.mjs` | 외부 CLI에 키나 토큰이 새지 않게 한다 |

가져오지 않는 것: 라운드와 리스(`fusion-state`, `writer-lease`), 워크트리 관리, 메모리 시스템, 자동 조종, 사용량 계산, 팀 구성. 대량 병렬 구현이 꼭 필요해지면 그때 hyperfusion을 따로 쓴다.

## 전문가 호출

| 일 | 전문가 | 호출 방식 | Claude의 역할 |
|---|---|---|---|
| 이미지 생성 | ComfyUI(Anima, Krea2) | asset-pipeline MCP `asset_generate` | 프롬프트 작성, 후보 1차 선별(이미지는 볼 수 있음) |
| 참조 편집(표정·포즈 변형) | Codex imagegen, Grok imagine | asset-pipeline MCP, `workflow_id` 명시 | 참조와 결과 비교 |
| 픽셀 스프라이트·걷기 애니메이션 | ComfyUI + Aseprite | asset-pipeline MCP | Pixel Gate 결과 확인 |
| 효과음 | Stable Audio 3 | asset-pipeline MCP, SFX | 프롬프트 작성(소리는 들을 수 없음) |
| 시나리오·대사·로어 | Gemini Argon | `agy` CLI, 읽기 전용 | 용어집·세계관 일관성 검수 |
| 코드 리뷰 | Codex(또는 Gemini) | `codex exec` 읽기 전용 샌드박스 | 지적을 검증하고 반영 |

리드가 asset-pipeline을 직접 부르므로 MCP 차단 문제는 사라진다.

## 단계별 흐름

### 1. 컨셉
- GDD, 세계관, 용어집 초안: Claude가 구조를 잡고 Argon이 문장과 분위기를 쓴다.
- 아트 바이블과 무드: asset-pipeline으로 컨셉 이미지 후보를 만든다.

### 2. 웹 프로토타입(버림): Phaser 4
- Phaser 4(4.2.x) + Vite + TypeScript. 공식 생성기 `npm create @phaserjs/game@latest`로 시작한다.
- 핵심 루프만 만든다. 데이터 JSON, 애셋, 대사 JSON은 Godot과 같은 파일을 읽는다.
- 검사는 두 층이다.
  - 규칙 로직: 엔진과 분리해 Vitest로 단위 테스트한다.
  - 화면: Playwright로 부팅을 확인하고 스크린샷을 찍는다. 화면 비교가 흔들리지 않게 소프트웨어 GL(swiftshader), 고정 프레임, 움직이는 영역 가리기를 쓴다.
  - 기존 `screenshot.mjs`를 Phaser용으로 넓힌다.
- 남기는 것: 재미 판정, 수치(데이터 JSON), 대사, 설계 문서 수정. 코드는 버린다.

### 3. Godot 본편: 4.7 이상
- 데이터 JSON, 대사 JSON, 애셋을 그대로 가져온다.
- 언어는 게임별로 정한다. 기본은 GDScript이고, 무거운 시뮬레이션이나 .NET 라이브러리가 필요하면 C#을 쓴다.

## 대사: 엔진 중립 JSON → Dialogic

원본은 엔진 중립 JSON 하나다. Argon이 쓰고, Claude가 스키마와 용어집으로 검수한다.

- **스키마:** 화자, 표정(portrait), 대사, 선택지, 조건, 변수 설정, 점프와 라벨. Dialogic 2의 이벤트(text, join/leave, choice, condition, set, label/jump)에 1:1로 대응하는 범위만 쓴다. 여기서 벗어나는 기능은 넣지 않는다.
- **변환:** `tools/dialogue-to-dtl.mjs`(setup이 게임 저장소의 `tools/hfgs/`로 복사)가 JSON을 Dialogic 타임라인 텍스트(`.dtl`)로 만든다. `.dtl`은 사람이 읽을 수 있는 텍스트 형식이라 변환 결과를 바로 리뷰할 수 있다.
- **캐릭터:** 화자 ID는 Dialogic 캐릭터 파일(`.dch`) 이름과 같게 맞춘다. 캐릭터 파일은 Godot에서 만든다.
- **번역:** Dialogic의 CSV 번역 기능을 쓴다. 원본 JSON에는 대사 ID를 둬서 번역 키로 쓴다.
- **웹 프로토타입:** Phaser 쪽은 같은 JSON을 읽는 작은 재생기를 둔다. 프로토타입이 끝나면 버린다.
- **검사:** JSON 스키마 검사, 용어집에 없는 고유명사 검사, 변환한 `.dtl`을 Godot에서 `DialogicTimeline.from_text`로 읽어 보는 스모크 테스트.

## Godot 검증

리서치 결과를 정리하면 다음과 같다.

| 검사 | 방법 | 비고 |
|---|---|---|
| 문법 | `godot --headless --check-only --script <file>.gd` | 오토로드를 참조하는 스크립트는 실행해 봐야 한다 |
| 단위 테스트 | **gdUnit4** (GDScript와 C# 모두), GUT (GDScript 전용) | gdUnit4 CLI 종료 코드: 0 성공, 100 실패, 101 경고. GUT은 실패 시 1 |
| C# 테스트 | gdUnit4Net(`gdUnit4.api`, `gdUnit4.test.adapter`), `dotnet test` | .NET 8 또는 9 SDK 필요 |
| 화면 | 헤드리스는 렌더링이 없다. 창을 띄우는 OpenGL 렌더러로 SubViewport를 캡처하거나 Movie Maker(`--write-movie out.png --quit-after N`)로 프레임을 남긴다 | 시각 회귀 도구: godot-visual-regression, GDSnap, godot-vrt |
| 플레이테스트 | Godot MCP로 실행, 입력 전송, 스크린샷 | GameDevBench 보고에 따르면 스크린샷과 영상을 주면 에이전트 통과율이 올라간다(Codex 41.1% → 52.0%) |

두 언어를 모두 지원해야 하므로 **기본 테스트 프레임워크는 gdUnit4**로 한다.

## Godot MCP 후보

공식 서버는 없다(2026년 10월 기준). 모두 커뮤니티 프로젝트다.

| 후보 | 방식 | 장점 | 주의 |
|---|---|---|---|
| hi-godot/godot-ai | 에디터 애드온 + MCP | 120개 이상 도구, 스크린샷, 테스트 실행, C# 프로젝트 사용 후기 있음. MCP for Unity 제작진 | Godot 4.7 이상 |
| Coding-Solo/godot-mcp | 외부에서 Godot 실행 | 가장 가볍다(`npx`). 실행과 디버그 출력 | 에디터 실시간 편집은 약함 |
| tomyud1/godot-mcp (Godlink) | 에디터 애드온 + MCP | 입력 전송, 스크린샷, 배치 실행 취소 | 에디터 하나만 연결 |
| IvanMurzak/Godot-MCP | C# 애드온 + 클라우드 | C# 실행, 스크린샷 | 클라우드 연결 전제 |

Godot 4.7 이상으로 고정하므로 1차 평가 대상은 **hi-godot/godot-ai**, 가벼운 대안은 **Coding-Solo/godot-mcp**로 한다. 실제 프로젝트에서 한 장면을 만들고, 실행하고, 스크린샷을 찍고, 테스트를 돌려 본 뒤 고른다.

## 애셋을 Godot으로

- **정지 이미지(PNG):** 그대로 가져온다. 매니페스트의 크기·투명도 검사를 유지한다.
- **스프라이트 애니메이션:** asset-pipeline이 Aseprite로 내보내고, **Aseprite Wizard**(Godot 4.4 이상, 9.x)의 자동 가져오기로 SpriteFrames를 만든다.
- **효과음(WAV):** Godot이 바로 가져온다. 길이·채널·샘플레이트는 매니페스트로 검사한다(PR 8의 WAV 검사).

asset-pipeline에 남은 빈틈은 다음과 같다. 이건 asset-pipeline 쪽에서 고쳐야 한다.
- `PIXEL_STATIC`은 색을 자동으로 줄이지 않아, 생성물이 Pixel Gate(32색)에서 FAILED가 된다(실측 17,951색).
- `PIXEL_ANIMATION`은 검토된 걷기 동작만 지원한다. idle과 attack은 아직 없다.

## 게임 작업 종류(자체 등록)

`game-kinds.json`이 직접 정의한다(9단계에서 반영). 작업 흐름은 `task.mjs start → 구현 → verify → consult review`다.

| 종류 | 담당 | 검사 | 상태 |
|---|---|---|---|
| gdd, lore | Claude 구조 + Argon 문장 | 용어집 일관성 검수(리드) | 있음 |
| narrative(대사) | Argon 쓰고 Claude 검수 | `dialogue-to-dtl.mjs --check`(스키마 + 그래프 규칙 + 용어집 + `.dtl` 변환) | 있음 |
| balance-data, economy-data, level | Claude | JSON 스키마(+ `expect`) | 있음 |
| art-image, art-edit | asset-pipeline(리드가 MCP 호출) | 매니페스트 + 사람 승인 | 있음 |
| sfx | asset-pipeline | WAV 매니페스트 + 사람 청취 | 있음 |
| web-prototype | Claude (Phaser 4) | Playwright 스크린샷(+ `acceptance_commands`의 Vitest) | 있음(템플릿 `templates/phaser/`) |
| code | Claude | `acceptance_commands`의 테스트 | 있음 |
| sprite, sprite-animation | asset-pipeline + Aseprite | Pixel Gate + 사람 승인 | 5·10단계 뒤 |
| godot-scene, godot-code | Claude (+ Godot MCP) | 문법 검사 + gdUnit4 + 스크린샷 | 7단계 |
| review | 다른 계열 모델 | 지적 목록 | 있음(`consult.mjs review`, 작업 종류가 아니라 모든 작업의 마지막 단계) |

## 참고할 외부 프로젝트

- **Claude-Code-Game-Studios** (Donchitos): 원본 템플릿. 질문 → 선택지 → 결정 → 초안 → 승인으로 이어지는 협업 절차와 엔진 전문가 에이전트(Godot specialist 등).
- **GodotPrompter** (jame581): Godot 4.x용 스킬 59개와 에이전트 9개. GDScript와 C# 모두 다룬다. 테스트 스킬(GUT, gdUnit4)이 있다. 직접 쓰기보다 설치해서 쓰는 쪽을 검토한다.
- **everything-game-dev-code**: 엔진 중립 표준과 엔진별 확장을 나누는 구조. 웹과 Godot을 오가는 우리 흐름과 맞는다.

## 실행 순서

진행 표시는 PR이 main에 들어간 시점 기준이다.

1. ✅ (PR 8) **PR 8 정리:** WAV 검사와 폴링 지시문 수정은 v2에서도 쓴다. 머지한다.
2. ✅ (PR 10) **hyperfusion에서 옮겨 오기:** 외부 CLI 어댑터(codex, agy, grok), 비밀 차단과 마스킹을 `scripts/lib/`로 줄여 옮긴다.
3. ✅ (PR 11) **전문가 호출 스크립트:** `scripts/consult.mjs`에 `review`(codex 읽기 전용, 결론 없이 diff와 검사 결과만 전달, 지적별 처분)와 `write`(agy Argon)를 만든다.
4. ✅ (PR 12) **대사 파이프라인:** 대사 JSON 스키마, 용어집 검사, `dialogue-to-dtl.mjs` 변환기. narrative brief의 수용 검사는 이 `--check`로 자동 생성된다.
5. **애셋 스크립트:** 매니페스트 항목(프롬프트, 종류, 길이)을 읽어 asset-pipeline MCP를 직접 부르는 `scripts/assets.mjs`를 만든다. 후보 여러 개 생성을 지원한다.
6. ✅ **Phaser 템플릿:** `templates/phaser/`에 Phaser 4.2 + Vite 8 + TypeScript, Vitest(규칙·대사 재생기), 데이터·대사 JSON 로더, DOM 패널(`#hud`)을 둔다. `setup.mjs --phaser`로 `prototype/`에 깐다. 스크린샷은 기존 `tools/hfgs/screenshot.mjs --serve`로 찍고, 글자 확인은 캔버스 픽셀이 아니라 DOM 패널로 한다(Phaser 4는 WebGL 전용이라 헤드리스 SwiftShader에서 픽셀 비교가 흔들림). CI 잡 `phaser-template`이 실제 설치·테스트·빌드·스크린샷을 돌린다.
7. **Godot 템플릿:** `templates/godot/`에 Godot 4.7 project.godot, gdUnit4, Aseprite Wizard, Dialogic 2, 검사 스크립트(문법, 테스트, 스크린샷)를 둔다.
8. **Godot MCP 평가:** godot-ai와 Coding-Solo를 실제 프로젝트에 붙여 비교한다.
9. ✅ (5~8보다 앞당겨 진행) **hyperfusion 의존 제거:** `brief.mjs`(hyperfusion brief 변환)를 `task.mjs`(plan·start·check·verify)로 바꾸고, `game-kinds.json`에서 task_kind 매핑을 걷어 내 종류를 직접 정의하고, setup의 hyperfusion 프리셋과 CI의 hyperfusion 체크아웃을 지웠다. red-first와 검사 기준 파일 불변 규칙은 `task.mjs`에 남겼다. 두 경로를 함께 유지하는 기간이 길수록 문서·테스트 중복이 늘어 앞당겼다. `brief.mjs`의 hyperfusion brief 변환, `game-kinds.json`의 task_kind 매핑, setup의 hyperfusion 설정을 걷어 낸다. 작업 종류는 hf-game-studio가 직접 정의한다.
10. **asset-pipeline 개선 요청:** 픽셀 색 줄이기, idle·attack 애니메이션.

## 남은 확인 거리

- Phaser 쪽 에이전트 도구(Phaser Agent MCP)가 프로토타입에 쓸 만한지. 공식 사이트에 있다는 것만 확인했다. 템플릿은 공식 생성기(`npm create @phaserjs/game`) 대신 직접 짠 최소 구성이다(생성기 결과물이 Vite 8·TS 설정과 맞는지 확인하지 않았다).
- Dialogic 2 최신 릴리스가 Godot 4.7에서 문제없이 도는지. 문서상 요구 사항은 4.5 이상이다.
- 2단계에서 hyperfusion 코드를 옮길 때 라이선스와 출처 표기(같은 저자이지만 NOTICE에 남긴다).
