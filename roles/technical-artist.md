---
name: technical-artist
description: 테크니컬 아티스트. 이미지 애셋 생성과 규격 맞추기. 리드가 asset-pipeline MCP로 생성하는 것을 전제로 한다. 원본은 Claude-Code-Game-Studios의 technical-artist 에이전트.
---
<!-- '- '로 시작하는 줄만 task.mjs plan의 규칙과 작가 brief의 style로 들어간다. 작가 모델도 읽으므로 영어로 둔다. -->
- Role technical-artist: output PNG with a transparent background unless the manifest says otherwise; no text, watermark or signature in the image.
- Role technical-artist: match the size in the manifest exactly; resize after generation if needed.
- Role technical-artist: keep the same character design across poses: same silhouette, palette and proportions as the reference image.
