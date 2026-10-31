# Godot 본편 템플릿 (Godot 4.7)

웹 프로토타입에서 확인한 재미를 Godot 4.7로 만듭니다. 데이터(`data/*.json`), 대사 JSON, 애셋은 프로토타입과 **같은 파일**을 그대로 읽습니다.

## 설치

Godot 프로젝트는 게임 저장소 **루트**에 둡니다(`project.godot`가 루트). 그래야 `data/`·`assets/`가 `res://` 안에 들어옵니다. `prototype/`, `tools/`, `node_modules/`에는 `.gdignore`를 두어 Godot이 가져오지 않게 합니다.

```bash
node <hf-game-studio>/scripts/setup.mjs <저장소> --godot
```

애드온은 git 태그로 받아 `addons/`에 넣고 `project.godot`에 등록합니다(gdUnit4 v6.2.2, Dialogic 2.0-alpha-20, Aseprite Wizard v9.8.0-4). `addons/`는 커밋합니다.

```bash
node tools/hfgs/godot-addons.mjs .
```

Godot 실행 파일은 [GitHub 릴리스](https://github.com/godotengine/godot/releases/tag/4.7.2-stable)에서 받아 `GODOT_BIN` 환경변수로 가리킵니다. 검사 도구가 씁니다.

## 구조

```text
project.godot              Godot 4.7, GL Compatibility 렌더러(헤드리스·xvfb 스크린샷용)
scenes/main.tscn           시작 장면
scripts/main.gd            데이터를 읽어 계약 게시판을 글자로 표시. 부팅 검사용 HFGS_READY 로그
scripts/data/data_loader.gd    data/*.json 읽기
scripts/rules/contract_rules.gd 계약 성공 확률(프로토타입의 contract.ts와 같은 식)
test/**/*_test.gd          gdUnit4 테스트. Dialogic 스모크는 애드온이 없으면 건너뜀
dialogue/                  대사 JSON의 변환물(.dtl). tools/hfgs/dialogue-to-dtl.mjs가 만들고 직접 고치지 않음
addons/                    godot-addons.mjs가 채움
```

## 검사

```bash
node tools/hfgs/godot-check.mjs syntax     # --import 후 scripts/·test/의 .gd를 --check-only
node tools/hfgs/godot-check.mjs test       # gdUnit4 (종료 코드 0 성공, 100 실패, 101 경고)
node tools/hfgs/godot-check.mjs run        # 헤드리스로 시작 장면을 띄워 스크립트 오류와 HFGS_READY 확인
node tools/hfgs/godot-check.mjs shot       # 창을 띄워(리눅스는 xvfb-run) Movie Maker로 프레임 PNG를 shots/에 남김
node tools/hfgs/godot-check.mjs all        # syntax + test + run
```

대사를 바꿨으면 변환부터 합니다: `node tools/hfgs/dialogue-to-dtl.mjs data/dialogue/*.json --out-dir dialogue`. 화자 ID와 같은 이름의 Dialogic 캐릭터 파일(`.dch`)은 에디터에서 만듭니다.

## 규칙

- 규칙 로직은 `scripts/rules/`의 static 함수에 두고 gdUnit4로 테스트합니다. 장면은 그리기와 입력만 합니다.
- 수치·문구·대사는 `data/`에서 읽습니다. 프로토타입과 Godot의 공식이 어긋나면 두 테스트 중 하나가 깨집니다.
- 애셋은 사람이 승인한 뒤에만 장면에 넣습니다. 스프라이트 애니메이션은 Aseprite Wizard의 자동 가져오기를 씁니다.
- Godot MCP(에디터 제어)는 설계 문서 8단계에서 평가합니다. 그전까지 에디터 작업은 사람이 합니다.
