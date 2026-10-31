import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';

// 데이터는 게임 저장소 루트의 data/ 하나다. Godot도 같은 파일을 읽는다.
// Vite의 publicDir로 서빙해 코드에서 'mercenaries.json', 'dialogue/<id>.json'처럼 상대 경로로 받는다.
// base './'라 dist/index.html을 어느 경로에 두어도 열린다(빌드 때 data/가 dist/로 복사된다).
export default defineConfig({
  base: './',
  publicDir: fileURLToPath(new URL('../data', import.meta.url)),
  server: {port: 5173, strictPort: true},
  build: {outDir: 'dist', emptyOutDir: true},
  // 규칙 로직은 엔진과 분리된 순수 함수라 node 환경에서 테스트한다. 화면은 Playwright 스크린샷(tools/hfgs/screenshot.mjs)으로 본다.
  test: {environment: 'node', include: ['src/**/*.test.ts']},
});
