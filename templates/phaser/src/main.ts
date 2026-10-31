import Phaser from 'phaser';
import {loadContracts, loadDialogue, loadMercenaries} from './data/load';
import {DialoguePlayer} from './dialogue/player';
import {ContractBoardScene} from './scenes/ContractBoardScene';
import {renderContracts, renderDialogue, setStatus} from './ui/hud';

// 흐름: 데이터 로드 → DOM 패널 그리기 → Phaser 시작. 데이터가 없어도 패널은 그려서 무엇이 빠졌는지 보이게 한다.
// 시작 페이지 주소의 ?seed=값 으로 Phaser 난수를 고정할 수 있다(스크린샷 비교용).
async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  setStatus('loading');
  const [mercs, contracts] = await Promise.all([
    loadMercenaries().catch(e => { console.warn(e); return {version: 0, mercenaries: []}; }),
    loadContracts().catch(e => { console.warn(e); return {version: 0, contracts: []}; }),
  ]);
  const merc = mercs.mercenaries[0];

  const game = new Phaser.Game({
    parent: 'game',
    width: 1280,
    height: 720,
    backgroundColor: '#1b1b22',
    seed: [params.get('seed') ?? 'hfgs'],
    scale: {mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH},
    scene: [],
  });
  game.scene.add('ContractBoard', ContractBoardScene, true, {merc});

  renderContracts(merc, contracts.contracts, c => {
    (game.scene.getScene('ContractBoard') as ContractBoardScene).showContract(c);
    if (c.intro_dialogue) {
      loadDialogue(c.intro_dialogue)
        .then(doc => renderDialogue(new DialoguePlayer(doc), () => setStatus('ready')))
        .catch(e => setStatus(`대사 로드 실패: ${e.message}`));
    }
  });
  setStatus(`ready · 용병 ${mercs.mercenaries.length} · 계약 ${contracts.contracts.length}`);
}

boot().catch(e => { console.error(e); setStatus(`boot failed: ${e.message}`); });
