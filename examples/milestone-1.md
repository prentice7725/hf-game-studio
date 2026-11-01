# 마일스톤 1: 한 바퀴

용병 1명 + 계약 1개 + 화면 1개로 hf-game-studio를 한 바퀴 돌려 본다. 작업은 아래 순서로 하나씩 `task.mjs start → 구현 → verify → consult review`를 거친다.

**목표:** 용병 Ash가 곡물 수레 호위 계약을 받아(받기 버튼) 판정을 거쳐 길드 장부에 보수가 들어오는 것을 보는 데까지. 계약 목록과 성공 확률 표시는 Phaser 템플릿이 이미 하므로 7번 작업은 GDD "계약 해결"을 구현한다.

| 순서 | 작업 파일 | 종류 | 만드는 쪽 | 검사 |
|---|---|---|---|---|
| 1 | `tasks/merc-data.json` | balance-data | Claude | 스키마 |
| 2 | `tasks/contract-data.json` | balance-data | Claude | 스키마 |
| 3 | `tasks/contract-intro-dialogue.json` | narrative | Argon이 쓰고 Claude가 검수 | 대사 변환 `--check` |
| 4 | `tasks/merc-portrait-pipeline.json` | art-image | asset-pipeline(Claude가 MCP 호출) | 매니페스트 + 사람 승인 |
| 5 | `tasks/merc-portrait-variant.json` | art-edit | asset-pipeline, `codex_imagegen` | 매니페스트 + 사람 승인 |
| 6 | `tasks/sword-swing-sfx.json` | sfx | asset-pipeline | WAV 매니페스트 + 사람 청취 |
| 7 | `tasks/contract-board-ui.json` | web-prototype | Claude (Phaser) | 스크린샷 + Vitest |

**체크포인트(사용자가 확인):**
- `data/*.json`이 모두 스키마 검사를 통과
- 초상화와 효과음이 매니페스트 규격을 통과하고 사람이 보고 들어 승인
- 계약 화면 스크린샷에서 계약 제목, 성공 확률, 받기 결과(성공/실패)와 금화 합계가 보임

**위험:**
- asset-pipeline이 실제로 이미지·효과음을 저장까지 하는지 미검증(먼저 `asset_capabilities`로 준비 상태 확인)
- 계약 해결 공식이 GDD에 아직 TBD(1번 작업 전에 "수치와 공식" 섹션을 채울 것). 2번 계약 데이터는 1번 용병 데이터와 함께 이 공식으로 50%가 나오게 맞춘다
- 시작 금화가 GDD에 TBD(7번 작업 전에 정하지 않으면 0으로 시작)

**열린 질문:** 성공 확률을 화면에 숫자로 보여 줄지, 등급(높음/보통/낮음)으로 보여 줄지?
