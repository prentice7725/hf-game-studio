# 글로 부탁하던 규칙을 기계 검사로 (설계 초안)

상태: 초안. 구현도 실측도 하지 않았다.

## 왜 필요한가

작업 종류(`game-kinds.json`)의 `rules`에는 이런 문장이 있다.

- "Rules logic lives in plain functions with unit tests; the scene only renders and forwards input."
- "Scenes read game state from scripts/ and never compute rules themselves."
- "Keep formulas identical to the web prototype's rules."

이 규칙들은 글이다. Claude가 어겨도 `verify`는 통과하고, 어겼는지는 리뷰어 모델이 diff를 읽어 찾거나 사람이 나중에 발견한다. 리뷰어를 한 번 부를 때마다 다른 구독의 한도를 쓰고, 지적을 처분하는 데 Claude의 토큰이 든다.

기계가 확인할 수 있는 규칙은 `verify`가 직접 확인하게 내린다. 네 가지를 더한다.

| 번호 | 항목 | 바꾸는 것 |
|---|---|---|
| M1 | 정적 검사 | 타입 검사 같은 "언제나 통과해야 하는 검사"를 수용 검사와 따로 받는다 |
| M2 | 구조 검사 | 규칙 코드가 화면 코드나 난수를 쓰지 못하게 하는 검사 도구 |
| M3 | 공식 일치 검사 | 프로토타입과 Godot의 공식이 같은 숫자를 내는지를 같은 사례 파일로 확인한다 |
| M4 | 화면 증거 | 화면을 바꾸는 작업은 화면 검사 없이는 시작하지 못한다 |

M2는 M1 위에 얹힌다. M3와 M4는 따로 넣을 수 있다.

hyperfusion의 정적 검사 관문(`references/static-gate.md`, 0.35.0)과 같은 생각이다. 여기는 구현자가 Claude 자신이고 컨트롤러가 훨씬 작으므로, 그쪽의 감독 실행기나 재지시 흐름은 가져오지 않는다.

---

## M1 정적 검사

### 수용 검사와 무엇이 다른가

수용 검사는 **먼저 실패해야** 받는다(red-first). 이 작업이 바꾸는 것을 확인하는 검사이기 때문이다. 타입 검사나 구조 검사는 반대다. 작업과 상관없이 언제나 통과해야 하므로 시작 전에도 통과한다. 지금 이런 검사를 `acceptance_commands`에 넣으면 `start`가 "처음부터 통과하는 검사는 작업 결과를 가르지 못함"이라고 경고하고, 그것 하나뿐이면 `ACCEPTANCE_ALREADY_GREEN`으로 거절한다.

그래서 칸을 나눈다.

| | 수용 검사 | 정적 검사 |
|---|---|---|
| 작업 파일 필드 | `acceptance_commands` | `static_commands` |
| `start`에서 | 하나 이상 실패해야 한다 | 모두 통과해야 한다 |
| 수용 기준과의 연결 | `acceptance_map` | 없다 |
| `verify`에서 | 모두 통과해야 한다 | 모두 통과해야 한다 |

### 작업 파일

```json
{
  "static_commands": ["npm --prefix prototype run typecheck"],
  "static_config": ["prototype/tsconfig.json"]
}
```

- `static_commands`: 명령 문자열이나 인자 배열. `acceptance_commands`와 같은 형식이고 같은 실행기(`lib/checks.mjs`)로 셸 없이 돈다.
- `static_config`: 그 검사의 설정 파일. 아래 "설정을 고쳐 통과시키는 길 막기" 참고.
- 둘 다 없으면 지금과 똑같이 동작한다.

### 작업 종류가 자동으로 만드는 정적 검사

`game-kinds.json`의 종류에 `static` 항목을 더한다. 조건이 맞을 때만 만든다.

| kind | 자동 정적 검사 | 조건 |
|---|---|---|
| web-prototype | `npm --prefix prototype run typecheck` | `prototype/package.json`에 `typecheck` 스크립트가 있을 때 |
| web-prototype, code, godot-code, godot-scene | `node tools/hfgs/check-structure.mjs design/structure.json` (M2) | `design/structure.json`이 있을 때 |

Godot의 문법 검사는 지금처럼 `godot-check.mjs all` 안에 둔다. 테스트·부팅과 묶여 있고 red-first에 쓰이므로 건드리지 않는다.

작업 파일에 `"static_commands": []`를 적으면 자동 정적 검사를 끈다. 이유를 `static_off`에 적어야 한다(예: "템플릿을 아직 깔지 않은 저장소").

### start

수용 검사보다 먼저 돌린다.

| 결과 | 처리 |
|---|---|
| 모두 통과 | 시작 기록의 `static_baseline`에 결과를 남기고 수용 검사로 넘어간다 |
| 하나라도 exit 1 | `STATIC_BASELINE_FAILING`으로 거절한다. 실패 출력의 끝을 보여 준다 |
| exit 0·1이 아님 | `STATIC_BROKEN`으로 거절한다(검사를 돌릴 수 없음. `ACCEPTANCE_BROKEN`과 같은 뜻) |
| 명령이 파일을 바꿈 | `STATIC_DIRTY`로 거절한다(`--fix` 같은 자동 수정 명령) |

원래부터 위반이 있는 저장소는 먼저 그 위반을 고치는 작업을 따로 하거나, 명령의 대상을 통과하는 폴더로 좁힌다. "원래 있던 위반은 눈감고 새 위반만 잡기"는 넣지 않는다.

### check와 verify

- 정적 검사를 수용 검사보다 먼저 돌린다. 정적 검사가 실패해도 수용 검사는 돌려 결과를 함께 보여 준다.
- 정적 검사가 하나라도 실패하면 `verify`는 통과가 아니다. 리뷰 명령을 출력하지 않는다.
- 출력에서 두 종류를 나눠 보여 준다(`정적 검사 1/2 통과`, `수용 검사 3/3 통과`).
- 리뷰어에게 넘기는 검사 결과(`consult.mjs review`)에 정적 검사 결과도 넣는다. 리뷰어가 타입 오류를 다시 찾지 않게 하기 위해서다.
- AC 표(`acTable`)에는 넣지 않는다.

### 설정을 고쳐 통과시키는 길 막기

타입 검사의 엄격도나 구조 규칙은 저장소 안 파일에 있다. 그 파일을 느슨하게 고치면 검사는 통과한다.

이미 있는 장치를 쓴다. 스키마와 애셋 매니페스트는 **검사 기준 파일**로 다뤄져서 `scope.paths`에 둘 수 없고, `start` 때 해시를 기록해 `verify`에서 바뀌었으면 실패한다(`criteriaFiles`). `static_config`와 자동 정적 검사의 설정 파일(`design/structure.json`, `prototype/tsconfig.json`)을 이 목록에 더한다.

설정을 고쳐야 하면 지금의 규칙대로 별도 작업으로 한다.

줄 단위 예외(`// @ts-ignore`, `// @ts-expect-error`)는 `check-structure.mjs`의 금지 패턴으로 잡을 수 있다(M2).

---

## M2 구조 검사 도구 (`tools/check-structure.mjs`)

### 무엇을 잡는가

"규칙은 순수 함수에, 화면은 그리기만"을 기계가 확인한다. 규칙 폴더의 파일이 화면 코드를 가져오거나 난수·시계를 직접 쓰면 실패한다.

난수와 시계를 막는 데는 까닭이 하나 더 있다. 규칙 함수가 순수해야 M3의 공식 일치 검사와 실험 사다리의 시뮬레이션이 같은 입력에서 같은 답을 낸다.

### 설정 (`design/structure.json`)

```json
{
  "version": 1,
  "layers": [
    {
      "name": "prototype-rules",
      "files": ["prototype/src/rules/**/*.ts"],
      "exclude": ["**/*.test.ts"],
      "forbid_imports": ["phaser", "prototype/src/scenes/**", "prototype/src/ui/**"],
      "forbid_patterns": [
        {"pattern": "Math\\.random\\(", "why": "난수는 인자로 받는다"},
        {"pattern": "Date\\.now\\(|new Date\\(", "why": "시각은 인자로 받는다"},
        {"pattern": "@ts-ignore|@ts-expect-error", "why": "타입 오류는 고친다"}
      ]
    },
    {
      "name": "godot-rules",
      "files": ["scripts/rules/**/*.gd"],
      "forbid_patterns": [
        {"pattern": "^extends\\s+(Node|Control|CanvasItem)", "why": "규칙은 장면 노드가 아니다"},
        {"pattern": "get_node\\(|\\$[A-Za-z\"]", "why": "규칙은 장면 트리를 읽지 않는다"},
        {"pattern": "\\brandf\\(|\\brandi\\(|\\brandf_range\\(|\\brandi_range\\(", "why": "난수는 인자로 받는다"},
        {"pattern": "res://scenes/", "why": "규칙은 장면을 불러오지 않는다"}
      ]
    }
  ]
}
```

- `files`, `exclude`, `forbid_imports`의 경로 패턴은 저장소 루트 기준이다. 상대 경로 import는 파일 위치에서 풀어 저장소 경로로 바꾼 뒤 비교한다.
- `forbid_imports`는 TypeScript·JavaScript에만 쓴다. `import … from '…'`, `import '…'`, `import('…')`, `export … from '…'`를 본다. 패키지 이름(`phaser`)은 이름과 그 하위 경로(`phaser/…`)에 맞는다.
- `forbid_patterns`는 줄 단위 정규식이다. 언어를 가리지 않는다.
- 주석만 있는 줄(`//`, `#`, `##`로 시작)은 `forbid_patterns`에서 건너뛴다. `@ts-ignore`처럼 주석 안에 있어야 뜻이 있는 패턴은 `"in_comments": true`를 붙인다.

### 동작

```bash
node tools/hfgs/check-structure.mjs design/structure.json
```

- 위반마다 `파일:줄: [층 이름] 이유`를 출력한다.
- 종료 코드는 다른 검사 도구와 같다: 0 통과, 1 위반 있음, 2 검사를 돌릴 수 없음(설정 파일 없음, 형식 오류, 정규식 오류).
- 층의 `files`에 맞는 파일이 하나도 없으면 통과로 치고 경고를 낸다(아직 그 폴더를 만들지 않은 저장소).
- 의존성이 없다. Node 표준 모듈만 쓴다.

### 템플릿

- `templates/design/structure.json`: 위 두 층을 기본으로 넣는다. `setup`이 `design/`에 깔고, 설계 문서와 같이 `--force`에도 덮어쓰지 않는다.
- 템플릿의 규칙 코드(`contract.ts`, `contract_rules.gd`)는 지금도 이 규칙을 지킨다. 난수를 `roll` 인자로 받는다.

### 한계

- 정규식 검사라 우회할 수 있다(`const r = Math; r.random()`). 실수를 잡는 장치이지 속임수를 막는 장치가 아니다. 리뷰는 그대로 필요하다.
- "수치를 코드에 박지 말 것"은 넣지 않는다. 어느 숫자가 데이터에서 와야 하는 숫자인지 기계가 알 수 없다.
- GDScript의 `preload`·`load` 경로는 `forbid_patterns`로만 잡는다. import 그래프를 따라가지 않는다.

ESLint를 쓰지 않는 까닭: 템플릿에 의존성과 설정이 더 붙고, Godot 쪽에는 같은 도구가 없다. 게임이 ESLint를 쓰고 싶으면 `static_commands`에 그 명령을 적으면 된다.

---

## M3 공식 일치 검사

### 풀려는 문제

프로토타입(`prototype/src/rules/*.ts`)과 Godot 본편(`scripts/rules/*.gd`)의 공식은 같은 숫자를 내야 한다. 지금은 두 테스트 파일에 같은 사례를 손으로 적어 맞춘다. 템플릿에는 사례가 다섯 개 있다. 공식을 고칠 때 한쪽 테스트만 고치면 어긋난 채로 통과한다.

### 사례 파일 하나를 양쪽이 읽는다

```text
test/parity/contract.json     ← 사례(입력과 기대값). 프로토타입이 만들고 저장소에 커밋한다
prototype/src/rules/parity.test.ts   ← 사례 파일을 읽어 TS 구현을 확인
test/rules/parity_test.gd            ← 같은 파일을 읽어 GDScript 구현을 확인
```

```json
{
  "version": 1,
  "function": "contract.successChance",
  "seed": 20261117,
  "cases": [
    {"args": [{"stats": {"might": 5}}, {"check": "might", "difficulty": 3}], "expect": 0.5},
    {"args": [{"stats": {"might": 9}}, {"check": "might", "difficulty": 1}], "expect": 0.95}
  ]
}
```

- **기준은 프로토타입이다.** 프로토타입에서 먼저 재미를 확인하고 Godot으로 옮기는 순서이므로, 사례의 기대값은 TS 구현이 낸 값이다.
- 손으로 적는 경계 사례(자르는 값, 0, 음수)와 씨앗으로 만든 무작위 사례를 함께 넣는다. 무작위 사례는 함수마다 200개를 기본으로 한다.
- 실수는 양쪽에서 허용 오차 0.001로 비교한다(지금 템플릿의 gdUnit 테스트와 같다).

### 만들기와 낡음 확인

```bash
npm --prefix prototype run parity          # 사례 파일을 다시 만든다
npm --prefix prototype run parity -- --check   # 만들어 보고 커밋된 파일과 다르면 실패
```

- 만드는 쪽은 프로토타입 안의 작은 스크립트다. 함수마다 "입력을 어떻게 뽑는가"를 적은 생성기를 등록하고(`prototype/src/rules/parity.ts`), 씨앗이 정해진 난수로 입력을 뽑아 TS 구현의 답을 적는다. 씨앗과 생성기가 같으면 파일이 바이트 단위로 같다.
- `--check`는 대사 변환의 `--compare`와 같은 생각이다. 공식을 고치고 사례 파일을 다시 만들지 않았으면 실패한다.
- Godot 쪽 테스트는 함수 이름(`contract.successChance`)을 GDScript의 호출 대상(`ContractRules.success_chance`)으로 잇는 표를 둔다. 표에 없는 함수의 사례 파일이 있으면 실패한다(옮기지 않은 공식).

### 작업에서 쓰는 법

- 공식을 고치는 web-prototype·code 작업: `acceptance_commands`에 프로토타입 테스트, `static_commands`에 `npm --prefix prototype run parity -- --check`를 넣는다. 사례 파일은 `scope.paths`에 넣는다(공식이 바뀌면 사례도 바뀐다).
- 같은 공식을 Godot으로 옮기는 godot-code 작업: 사례 파일을 **검사 기준 파일**로 건다(`criteria`에 더한다). 범위에 둘 수 없고 바뀌면 실패한다. Godot 쪽에서 사례를 고쳐 맞추는 길을 막는다. 수용 검사는 `godot-check.mjs all`이고, 옮기기 전에는 표에 함수가 없어 실패하므로 red-first가 선다.

### 불변식도 같은 입력으로 본다

무작위 입력을 이미 뽑으므로, 프로토타입의 사례 테스트에서 불변식을 함께 확인한다. 생성기를 등록할 때 함수로 적는다.

| 예 | 불변식 |
|---|---|
| `successChance` | 결과가 언제나 `MIN_CHANCE` 이상 `MAX_CHANCE` 이하다 |
| `successChance` | 다른 값이 같을 때 능력치가 오르면 확률이 내려가지 않는다 |
| 보상 계산 | 결과가 음수가 아니다 |

불변식은 선택이다. 없어도 사례 파일은 만들어진다. 깨지면 프로토타입 테스트가 실패하고, 깨뜨린 입력을 출력한다.

### 한계

- 기준이 TS 구현이므로 TS 쪽이 틀리면 양쪽이 똑같이 틀린다. 공식이 GDD와 맞는지는 손으로 적는 경계 사례와 리뷰가 본다.
- 순수 함수만 다룬다. 상태를 가진 흐름(하루 진행, 계약 수락)은 플레이테스트 시나리오의 몫이다.
- 프로토타입을 버린 뒤에는 사례 파일이 고정된다. 그 뒤 공식을 바꾸려면 Godot 쪽에서 사례를 다시 만드는 길이 필요한데, 이 초안은 다루지 않는다.

---

## M4 화면 증거

### 풀려는 문제

web-prototype의 자동 수용 검사는 "`screenshot`이 있을 때"만 생긴다. 없으면 `plan`이 경고 한 줄을 내고 넘어간다. godot-scene의 화면 흐름 검사(`godot-playtest.mjs`)도 작업 파일에 적어야만 돈다. 화면을 바꾸는 작업이 화면을 한 번도 띄우지 않고 `verify`를 통과할 수 있다.

### 규칙

| kind | 있어야 하는 것 | 없으면 |
|---|---|---|
| web-prototype | `screenshot` | `plan`이 `VISUAL_CHECK_REQUIRED`로 거절 |
| godot-scene | `acceptance_commands`에 `godot-playtest.mjs` 또는 `godot-check.mjs shot` | 같다 |

화면이 바뀌지 않는 작업(규칙 함수만 고침)은 `"no_visual_check": "<이유>"`를 적어 건너뛴다. 이유는 시작 기록에 남고 리뷰어에게 넘어간다. `baseline_green`과 같은 방식이다.

`screenshot.expect_text`가 없거나 템플릿이 처음부터 그리는 글자면 red-first가 서지 않는다. 지금도 문서가 "작업이 새로 그리는 글자"를 적으라고 한다. 이 초안은 그 규칙을 바꾸지 않는다.

### 증거 남기기

- `verify`가 통과하면 스크린샷 파일의 경로와 SHA-256을 `state.verify.evidence`에 적는다. 스크린샷은 지금처럼 저장소 밖에 둔다.
- `verify`의 출력 끝에 경로를 보여 준다. "보이는 모양은 사람이 확인"하는 단계에서 사람이 그 파일을 바로 열 수 있다.
- 리뷰어 모델에게 이미지를 넘기지는 않는다. 리뷰어가 받는 것은 지금처럼 diff와 검사 결과다.

---

## 하지 않는 것

- 주석을 금지하는 규칙. 이 저장소와 템플릿의 주석은 "왜"를 적는 것이고, 기계 검사로 바꿀 수 없다.
- 검사를 통과하면 자동으로 커밋하거나 병합하는 일
- 원래 있던 위반을 눈감아 주는 기준선 파일
- 리뷰를 줄이는 일. 네 항목 모두 리뷰 앞에 서는 검사이고, 리뷰어를 부르는 조건은 그대로다

## 바뀌는 파일

| 파일 | 변경 |
|---|---|
| `scripts/task.mjs` | `static_commands`·`static_config`·`static_off`·`no_visual_check` 검증, 자동 정적 검사, `start`·`check`·`verify`의 정적 검사, 검사 기준 파일 확장, 증거 기록 |
| `scripts/consult.mjs` | 리뷰어에게 정적 검사 결과와 `no_visual_check` 이유 전달 |
| `game-kinds.json` | 종류별 `static`, 화면 검사 필수 표시 |
| `tools/check-structure.mjs` | 새 도구 |
| `templates/design/structure.json` | 새 템플릿 |
| `templates/phaser/` | `parity` 스크립트, `src/rules/parity.ts`, `parity.test.ts` |
| `templates/godot/` | `test/rules/parity_test.gd`, `test/parity/contract.json` |
| `scripts/setup.mjs` | `structure.json` 깔기 |
| `docs/reference.md`, `SKILL.md`, 템플릿 README 둘 | 설명 |
| `tests/` | `check-structure.test.mjs`, `task.test.mjs`에 정적 검사·화면 검사 사례 |

## 테스트로 고정할 것

**M1**
- `static_commands`가 없고 자동 조건도 안 맞으면 기존 테스트가 그대로 통과한다.
- 시작 전에 실패하는 정적 검사, 돌릴 수 없는 정적 검사, 파일을 바꾸는 정적 검사는 각각의 코드로 `start`가 거절한다.
- 정적 검사만 있고 수용 검사가 처음부터 통과하면 여전히 `ACCEPTANCE_ALREADY_GREEN`이다(정적 검사가 red-first를 대신하지 않는다).
- `verify`에서 정적 검사가 실패하면 통과가 아니고 리뷰 명령이 나오지 않는다.
- `static_config`의 파일이 범위 안에 있으면 `plan`이 거절하고, 작업 중 바뀌면 `verify`가 실패한다.
- `"static_commands": []`에 `static_off`가 없으면 거절한다.

**M2**
- 금지한 import(패키지, 상대 경로, 동적 import, 다시 내보내기)를 각각 잡는다.
- 금지 패턴을 줄 번호와 함께 잡고, 주석 줄은 건너뛰며, `in_comments`가 있으면 주석도 본다.
- `exclude`에 맞는 파일은 보지 않는다.
- 설정 파일이 없거나 형식이 틀리거나 정규식이 틀리면 종료 코드 2다.
- 템플릿을 그대로 깐 저장소에서 통과한다.

**M3**
- 같은 씨앗으로 두 번 만들면 파일이 같다.
- 공식을 바꾸고 사례를 다시 만들지 않으면 `--check`가 실패한다.
- 불변식을 깨는 구현에서 프로토타입 테스트가 실패하고 입력을 출력한다.
- (Godot이 있는 환경에서만) GDScript 구현의 숫자 하나를 바꾸면 `parity_test.gd`가 실패한다.

**M4**
- `screenshot`이 없는 web-prototype 작업은 거절되고, `no_visual_check`에 이유가 있으면 통과한다.
- 화면 검사 명령이 없는 godot-scene 작업은 거절된다.
- `verify`가 통과하면 시작 기록에 증거 경로와 해시가 남는다.

## 받아들이는 조건

실측 전에는 절감을 주장하지 않는다. 게임 저장소 하나에서 마일스톤 하나를 이 검사들과 함께 돌리고 `docs/design/game-studio-v2.md`의 마찰 기록과 같은 방식으로 적는다.

- 리뷰어가 낸 지적 가운데 "규칙 코드가 화면을 건드림", "타입 오류", "공식이 어긋남" 종류가 줄었는가(`consult.mjs stats`의 처분 기록으로 센다).
- `verify`가 리뷰 전에 잡은 것이 몇 건인가.
- 검사 때문에 작업이 막힌 일(잘못 잡음, 설정을 고치려고 별도 작업을 연 횟수)이 몇 건인가. 이쪽이 더 많으면 규칙을 줄인다.

## 정할 것

1. M1의 자동 정적 검사를 기본으로 켤지. 초안은 조건이 맞으면 켠다. 기존 게임 저장소에서 타입 오류가 이미 있으면 다음 작업의 `start`가 막힌다.
2. M2의 기본 규칙에 `@ts-ignore` 금지를 넣을지.
3. M3의 무작위 사례 수(초안 200)와 사례 파일의 위치(초안 `test/parity/`).
4. M4를 거절로 할지 경고로 둘지. 초안은 거절이다.
5. 넣는 순서. 초안의 권장은 M1 → M2 → M4 → M3다. M3가 가장 크고 템플릿 양쪽을 고친다.
