import Phaser from 'phaser';
import type {Contract, Mercenary} from '../data/types';
import {percent, successChance} from '../rules/contract';

// 캔버스에는 게임 화면만 그린다. 목록·대사는 DOM 패널(ui/hud.ts)이 맡는다.
export class ContractBoardScene extends Phaser.Scene {
  private merc?: Mercenary;
  private title!: Phaser.GameObjects.Text;
  private detail!: Phaser.GameObjects.Text;

  constructor() { super('ContractBoard'); }

  init(data: {merc?: Mercenary}): void { this.merc = data.merc; }

  create(): void {
    const {width, height} = this.scale;
    this.add.rectangle(width / 2, height / 2, width, height, 0x2d2a3a);
    // 용병 자리: 초상화 애셋이 승인되면 this.load.image로 바꾼다. 승인 전에는 자리만 둔다.
    this.add.rectangle(200, height / 2, 220, 300, 0x4a4660).setStrokeStyle(4, 0xffd26a);
    this.add.text(200, height / 2 + 170, this.merc?.name ?? '용병 없음', {fontSize: '28px', color: '#e8e4d8'}).setOrigin(0.5);
    this.title = this.add.text(420, 120, '계약을 고르세요', {fontSize: '36px', color: '#ffd26a'});
    this.detail = this.add.text(420, 190, '', {fontSize: '24px', color: '#e8e4d8', wordWrap: {width: width - 460}});
  }

  showContract(c: Contract): void {
    this.title.setText(c.title);
    const chance = this.merc ? `성공 확률 ${percent(successChance(this.merc, c))}` : '용병이 없어 확률을 계산할 수 없음';
    this.detail.setText(`난이도 ${c.difficulty} · 보수 ${c.reward} · ${c.days}일\n검사 능력치: ${c.check}\n${chance}`);
  }
}
