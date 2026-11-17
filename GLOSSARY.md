# 용어집

hf-game-studio 코드와 문서가 쓰는 말. 게임 세계의 용어는 각 게임 저장소의 `design/glossary.md`에 있다.

**수용 검사 (acceptance check)**: 작업이 수용 기준을 지켰는지 기계로 확인하는 명령 하나. 명령 문자열이거나 인자 배열이다. task.mjs가 작업 종류에 따라 자동으로 만드는 검사는 인자 배열이고, 작업 파일의 `acceptance_commands`에는 둘 다 적을 수 있다. `scripts/lib/checks.mjs`가 표현·표시·실행을 맡는다.
_피할 말_: 테스트(gdUnit4·Vitest 같은 테스트 묶음과 헷갈림), 명령(문자열만 떠올리게 함).

**검사 표시 (check display)**: 수용 검사의 이름. 문자열 검사는 그 문자열, 배열 검사는 인자를 `quote`로 이어 붙인 것이다. `acceptance_map`, 수용 기준 판정, 리뷰 결과가 이 문자열로 검사를 가리킨다.

**고장 난 검사 (broken check)**: exit 0·1이 아니게 끝난 수용 검사(2, 시간 초과, 실행 파일 없음 등). 작업 결과가 아니라 검사 자체를 돌릴 수 없다는 뜻이라 red-first의 실패로 치지 않고, start가 `ACCEPTANCE_BROKEN`으로 거절한다.
_피할 말_: 실패한 검사(exit 1은 결과가 틀린 것).

**수용 기준 (success criterion)**: 작업 파일의 `success_criteria` 한 줄. `AC1:`처럼 ID로 시작한다. 수용 검사가 걸리지 않은 기준은 리드와 리뷰어가 직접 본다.

**red-first**: start가 손대기 전 트리에서 수용 검사를 돌려 적어도 하나는 실패하는지 확인하는 것. 모두 통과하면 그 검사는 결과를 가르지 못한다. 고장 난 검사는 실패로 세지 않는다.

**정적 검사 (static check)**: 타입 검사·구조 검사처럼 작업과 상관없이 언제나 통과해야 하는 검사. 작업 파일의 `static_commands`와 작업 종류가 조건에 따라 자동으로 만드는 것(`game-kinds.json`의 `static`)이다. 수용 검사와 반대로 start 때 통과해야 하고(아니면 `STATIC_BASELINE_FAILING`·`STATIC_BROKEN`·`STATIC_DIRTY`), verify에서도 통과해야 한다. 수용 기준 판정에는 들어가지 않는다.
_피할 말_: 기준선 검사(red-first의 기준선과 헷갈림).

**구조 검사 (structure check)**: `tools/check-structure.mjs`가 `design/structure.json`대로 규칙 코드가 화면 코드·난수·시계를 쓰지 않는지 줄 단위로 보는 정적 검사.

**화면 검사 (visual check)**: 화면을 띄워 확인하는 수용 검사(`screenshot.mjs`, `godot-playtest.mjs`, `godot-check.mjs shot`). web-prototype·godot-scene 작업은 이것이 있거나 `no_visual_check`에 이유를 적어야 한다. verify가 통과하면 그 출력의 스크린샷 경로와 해시가 화면 증거(`verify.evidence`)로 남는다.

**검사 기준 파일 (criteria file)**: 스키마·매니페스트·용어집·참조 이미지·정적 검사의 설정 파일처럼 검사가 기준으로 삼는 파일. 작업 범위 밖에 두고, verify에서 바뀌지 않았는지 본다.

**작업 기록 (task record)**: `HFGS_HOME/tasks/<task_id>.json`. start의 기준선, verify 결과와 그때의 plan·리뷰 기준 커밋을 담는다. `consult.mjs review --task`가 이것을 읽는다.
