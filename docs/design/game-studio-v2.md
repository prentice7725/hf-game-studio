# hf-game-studio v2: 게임 개발 특화 설계

작성: 2026-10-30. 상태: 제안(결정 전).

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
| hyperfusion | 외부 모델 병렬 실행 엔진 | **선택 의존.** 대량 병렬 구현이 필요할 때만 사용 |
| Godot MCP(외부) | Godot 에디터·실행 제어 | MCP 서버로 연결 |

hyperfusion에서 가져올 것은 코드보다 **외부 CLI를 안전하게 부르는 방법**이다. 모델 고정, 인증과 지원 플래그 확인, 읽기 전용 샌드박스, 결과 형식 고정이 여기에 해당한다. 이 부분은 hf-game-studio에 얇은 호출 스크립트로 둔다(아래 "전문가 호출").

## 전문가 호출

| 일 | 전문가 | 호출 방식 | Claude의 역할 |
|---|---|---|---|
| 이미지 생성 | ComfyUI(Anima, Krea2) | asset-pipeline MCP `asset_generate` | 프롬프트 작성, 후보 1차 선별(이미지는 볼 수 있음) |
| 참조 편집(표정·포즈 변형) | Codex imagegen, Grok imagine | asset-pipeline MCP, `workflow_id` 명시 | 참조와 결과 비교 |
| 픽셀 스프라이트·걷기 애니메이션 | ComfyUI + Aseprite | asset-pipeline MCP | Pixel Gate 결과 확인 |
| 효과음 | Stable Audio 3 | asset-pipeline MCP, SFX | 프롬프트 작성(소리는 들을 수 없음) |
| 시나리오·대사·로어 | Gemini Argon | `agy` CLI, 읽기 전용 | 용어집·세계관 일관성 검수 |
| 코드 리뷰 | Codex(또는 Gemini) | `codex exec` 읽기 전용 샌드박스 | 지적을 검증하고 반영 |
| 대량 병렬 구현 | hyperfusion 일꾼 | `fusion-state.mjs` | 범위 나누기, 통합 |

리드가 asset-pipeline을 직접 부르므로 hyperfusion의 MCP 차단은 문제가 되지 않는다. 단, hyperfusion 작업이 진행 중인 저장소에서는 리드 가드가 쓰기 MCP를 막을 수 있다. 애셋 생성은 hyperfusion 라운드 밖에서 한다.

## 단계별 흐름

### 1. 컨셉
- GDD, 세계관, 용어집 초안: Claude가 구조를 잡고 Argon이 문장과 분위기를 쓴다.
- 아트 바이블과 무드: asset-pipeline으로 컨셉 이미지 후보를 만든다.

### 2. 웹 프로토타입(버림)
- HTML/Canvas로 핵심 루프만 만든다. 기존 `screenshot.mjs`로 화면을 확인한다.
- 남기는 것: 재미 판정, 수치(데이터 JSON), 설계 문서 수정. 코드는 버린다.

### 3. Godot 본편
- 데이터 JSON과 애셋을 그대로 가져온다.
- 언어는 게임별로 정한다. 기본은 GDScript이고, 무거운 시뮬레이션이나 .NET 라이브러리가 필요하면 C#을 쓴다.

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

1차 평가 대상은 **hi-godot/godot-ai**, 가벼운 대안은 **Coding-Solo/godot-mcp**로 한다. 실제 프로젝트에서 한 장면을 만들고, 실행하고, 스크린샷을 찍고, 테스트를 돌려 본 뒤 고른다.

## 애셋을 Godot으로

- **정지 이미지(PNG):** 그대로 가져온다. 매니페스트의 크기·투명도 검사를 유지한다.
- **스프라이트 애니메이션:** asset-pipeline이 Aseprite로 내보내고, **Aseprite Wizard**(Godot 4.4 이상, 9.x)의 자동 가져오기로 SpriteFrames를 만든다.
- **효과음(WAV):** Godot이 바로 가져온다. 길이·채널·샘플레이트는 매니페스트로 검사한다(PR 8의 WAV 검사).

asset-pipeline에 남은 빈틈은 다음과 같다. 이건 asset-pipeline 쪽에서 고쳐야 한다.
- `PIXEL_STATIC`은 색을 자동으로 줄이지 않아, 생성물이 Pixel Gate(32색)에서 FAILED가 된다(실측 17,951색).
- `PIXEL_ANIMATION`은 검토된 걷기 동작만 지원한다. idle과 attack은 아직 없다.

## 게임 작업 종류(자체 등록)

hyperfusion의 6종에 묶이지 않고 hf-game-studio가 직접 정의한다.

| 종류 | 담당 | 검사 |
|---|---|---|
| gdd, lore | Claude 구조 + Argon 문장 | 용어집 일관성 검수 |
| narrative(대사) | Argon | 스키마 + 용어집 |
| balance-data, economy-data | Claude | JSON 스키마 |
| art-image, art-edit | asset-pipeline | 매니페스트 + 사람 승인 |
| sprite, sprite-animation | asset-pipeline + Aseprite | Pixel Gate + 사람 승인 |
| sfx | asset-pipeline | WAV 매니페스트 + 사람 청취 |
| web-prototype | Claude | 스크린샷 |
| godot-scene, godot-code | Claude (+ Godot MCP) | 문법 검사 + gdUnit4 + 스크린샷 |
| review | 다른 계열 모델 | 지적 목록 |

## 참고할 외부 프로젝트

- **Claude-Code-Game-Studios** (Donchitos): 원본 템플릿. 질문 → 선택지 → 결정 → 초안 → 승인으로 이어지는 협업 절차와 엔진 전문가 에이전트(Godot specialist 등).
- **GodotPrompter** (jame581): Godot 4.x용 스킬 59개와 에이전트 9개. GDScript와 C# 모두 다룬다. 테스트 스킬(GUT, gdUnit4)이 있다. 직접 쓰기보다 설치해서 쓰는 쪽을 검토한다.
- **everything-game-dev-code**: 엔진 중립 표준과 엔진별 확장을 나누는 구조. 웹과 Godot을 오가는 우리 흐름과 맞는다.

## 실행 순서

1. **PR 8 정리:** WAV 검사와 폴링 지시문 수정은 v2에서도 쓴다. 머지한다.
2. **전문가 호출 스크립트:** `scripts/consult.mjs`에 `review`(codex 읽기 전용)와 `write`(agy Argon)를 만든다. hyperfusion 어댑터의 플래그와 인증 확인 방식을 참고한다.
3. **애셋 스크립트:** 매니페스트 항목(프롬프트, 종류, 길이)을 읽어 asset-pipeline MCP를 직접 부르는 `scripts/assets.mjs`를 만든다. 후보 여러 개 생성을 지원한다.
4. **Godot 템플릿:** `templates/godot/`에 project.godot, gdUnit4, Aseprite Wizard 설정, 검사 스크립트(문법, 테스트, 스크린샷)를 둔다.
5. **Godot MCP 평가:** godot-ai와 Coding-Solo를 실제 프로젝트에 붙여 비교한다.
6. **작업 종류 재정의:** `game-kinds.json`을 hyperfusion task_kind에서 떼어 내고, hyperfusion으로 보낼 때만 매핑한다.
7. **asset-pipeline 개선 요청:** 픽셀 색 줄이기, idle·attack 애니메이션.

## 열린 질문

- hyperfusion 의존을 완전히 끊을지, 병렬 구현용으로 남길지. 지금 제안은 선택 의존이다.
- Godot 4.7 이상으로 고정할지. godot-ai를 쓰려면 4.7 이상이 필요하다.
- 시나리오 산출물 형식. Godot 대화 플러그인(Dialogic 등)에 맞출지, 엔진 중립 JSON으로 둘지.
- 웹 프로토타입 기술. 지금처럼 순수 HTML/Canvas로 갈지, Phaser 같은 엔진을 쓸지.
