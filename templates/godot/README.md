# Godot 본편 템플릿 (Godot 4.7)

웹 프로토타입에서 확인한 재미를 Godot 4.7로 만듭니다. 데이터(`data/*.json`), 대사 JSON, 애셋은 프로토타입과 **같은 파일**을 그대로 읽습니다.

## 설치

Godot 프로젝트는 게임 저장소 **루트**에 둡니다(`project.godot`가 루트). 그래야 `data/`·`assets/`가 `res://` 안에 들어옵니다. `prototype/`, `tools/`, `node_modules/`에는 `.gdignore`를 두어 Godot이 가져오지 않게 합니다.

```bash
node <hf-game-studio>/scripts/setup.mjs <저장소> --godot
```

애드온은 git 태그로 받아 `addons/`에 넣고 `project.godot`에 등록합니다(gdUnit4 v6.2.2, Dialogic 2.0-alpha-20, Aseprite Wizard v9.8.0-4, godot-ai v4.3.1). `addons/`는 커밋합니다. Dialogic이 에디터에서 켤 때 써 넣는 설정(`autoload/Dialogic`, `input/dialogic_default_action`: Enter·마우스 왼쪽·Space·X·패드 A)도 같이 씁니다. 파일로만 등록하면 그 단계가 빠져 게임 실행 중 `InputMap action "dialogic_default_action" doesn't exist`가 매 입력마다 찍히고, 헤드리스 검사는 입력이 없어 이를 못 보므로 `godot-check.mjs run`이 설정 유무를 따로 봅니다. 예전에 깐 저장소는 같은 명령을 다시 돌리면 설정이 들어갑니다. godot-ai는 에디터를 열 때 `uv`로 Python 서버를 띄우므로 [uv](https://docs.astral.sh/uv/)가 있어야 합니다.

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

- `syntax`의 `--check-only`는 자동 로드 싱글턴을 모릅니다. 코드에서 `Dialogic.start()` 대신 `get_node("/root/Dialogic").start()`처럼 씁니다.
- 같은 프로젝트를 에디터로 열어 둔 채 `test`를 돌리면 Godot이 종료하다 죽습니다(0xC0000005). 검사 도구가 gdUnit4가 찍은 결과를 쓰지만, verify 전에는 에디터를 닫는 편이 안전합니다.

대사를 바꿨으면 변환부터 합니다: `node tools/hfgs/dialogue-to-dtl.mjs data/dialogue/*.json --out-dir dialogue`. 화자 ID와 같은 이름의 Dialogic 캐릭터 파일(`.dch`)은 에디터에서 만듭니다(사람이 캐릭터 편집기로, 또는 리드가 godot-ai `resource_manage create`로). 에디터를 열면 Dialogic이 `project.godot`의 `dtl_directory`를 채우고 `.dtl.uid`를 만드니 대사 작업의 범위에 `project.godot`을 넣습니다.

## 플레이테스트

에디터가 godot-ai와 함께 떠 있으면 시나리오대로 게임을 돌려 라벨을 확인합니다. 화면 기준을 수용 검사로 만드는 용도입니다.

```bash
node tools/hfgs/godot-playtest.mjs test/playtest/accept.json --port 8000 --ws-port 9500
```

```json
{"name":"accept","steps":[
 {"click":"이야기하기"},
 {"dialogue":["보수부터 듣는다","받는다"]},
 {"expect":[{"GoldLabel":"금화 60","ResultLabel":{"match":"성공"}},{"GoldLabel":"금화 0","ResultLabel":{"match":"실패"}}]},
 {"shot":"end"}
]}
```

`expect`는 노드 이름별 글자이고, 배열이면 그중 하나가 맞으면 통과합니다(무작위 판정용). 스크린샷은 저장소 밖(`~/.hf-game-studio/playtest/`)에 남깁니다.

## 규칙

- 규칙 로직은 `scripts/rules/`의 static 함수에 두고 gdUnit4로 테스트합니다. 장면은 그리기와 입력만 합니다.
- 수치·문구·대사는 `data/`에서 읽습니다. 프로토타입과 Godot의 공식이 어긋나면 두 테스트 중 하나가 깨집니다.
- 애셋은 사람이 승인한 뒤에만 장면에 넣습니다. 스프라이트 애니메이션은 Aseprite Wizard의 자동 가져오기를 씁니다.
- 에디터 조작과 플레이테스트는 godot-ai MCP(4.3.1)로 합니다. 붙이는 법과 주의점은 hf-game-studio의 `SKILL.md` "Godot 에디터 조작과 플레이테스트" 항목에 있습니다.
