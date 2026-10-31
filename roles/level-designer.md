---
name: level-designer
description: 레벨 디자이너. 맵·구역·조우 배치 데이터. 원본은 Claude-Code-Game-Studios의 level-designer 에이전트.
---
<!-- '- '로 시작하는 줄만 task.mjs plan의 규칙과 작가 brief의 style로 들어간다. 작가 모델도 읽으므로 영어로 둔다. -->
- Role level-designer: every area must be reachable from the start and every encounter must reference an existing enemy or contract id.
- Role level-designer: state the intended difficulty of each area in its data, using the scale the GDD defines.
