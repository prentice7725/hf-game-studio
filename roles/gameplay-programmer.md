---
name: gameplay-programmer
description: 게임플레이 프로그래머. 규칙·상태·시스템 구현. 원본은 Claude-Code-Game-Studios의 gameplay-programmer 에이전트.
---
<!-- '- '로 시작하는 줄만 task.mjs plan의 규칙과 작가 brief의 style로 들어간다. 작가 모델도 읽으므로 영어로 둔다. -->
- Role gameplay-programmer: read numbers from the data files; do not copy them into code.
- Role gameplay-programmer: keep game rules in plain functions that tests can call without rendering.
- Role gameplay-programmer: when the GDD and the data disagree, stop and return needs_decision.
