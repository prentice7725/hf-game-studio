# 용어집

hf-game-studio 코드와 문서가 쓰는 말. 게임 세계의 용어는 각 게임 저장소의 `design/glossary.md`에 있다.

**수용 검사 (acceptance check)**: 작업이 수용 기준을 지켰는지 기계로 확인하는 명령 하나. 명령 문자열이거나 인자 배열이다. task.mjs가 작업 종류에 따라 자동으로 만드는 검사는 인자 배열이고, 작업 파일의 `acceptance_commands`에는 둘 다 적을 수 있다. `scripts/lib/checks.mjs`가 표현·표시·실행을 맡는다.
_피할 말_: 테스트(gdUnit4·Vitest 같은 테스트 묶음과 헷갈림), 명령(문자열만 떠올리게 함).

**검사 표시 (check display)**: 수용 검사의 이름. 문자열 검사는 그 문자열, 배열 검사는 인자를 `quote`로 이어 붙인 것이다. `acceptance_map`, 수용 기준 판정, 리뷰 결과가 이 문자열로 검사를 가리킨다.

**수용 기준 (success criterion)**: 작업 파일의 `success_criteria` 한 줄. `AC1:`처럼 ID로 시작한다. 수용 검사가 걸리지 않은 기준은 리드와 리뷰어가 직접 본다.

**red-first**: start가 손대기 전 트리에서 수용 검사를 돌려 적어도 하나는 실패하는지 확인하는 것. 모두 통과하면 그 검사는 결과를 가르지 못한다.

**검사 기준 파일 (criteria file)**: 스키마·매니페스트·용어집·참조 이미지처럼 수용 검사가 기준으로 삼는 파일. 작업 범위 밖에 두고, verify에서 바뀌지 않았는지 본다.

**작업 기록 (task record)**: `HFGS_HOME/tasks/<task_id>.json`. start의 기준선, verify 결과와 그때의 plan·리뷰 기준 커밋을 담는다. `consult.mjs review --task`가 이것을 읽는다.
