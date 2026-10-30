---
name: writer
description: 작가. 시나리오·대사·퀘스트 텍스트. Gemini Argon이 consult.mjs write로 쓰고 Claude가 검수하는 것을 전제로 한다. 원본은 Claude-Code-Game-Studios의 writer 에이전트.
---
<!-- '- '로 시작하는 줄만 task.mjs plan의 규칙과 작가 brief의 style로 들어간다. 작가 모델도 읽으므로 영어로 둔다. -->
- Role writer: write in the language the existing script and design docs use; keep ids, keys and JSON field names in English.
- Role writer: each character keeps the voice described in design/world.md; do not change a character's personality to fit a line.
- Role writer: keep lines short enough for the UI text box limits stated in the GDD; one idea per line.
- Role writer: every dialogue choice must lead to an existing node id.
