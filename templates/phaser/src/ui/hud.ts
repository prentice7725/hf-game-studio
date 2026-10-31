import type {Contract, Mercenary} from '../data/types';
import {percent, successChance} from '../rules/contract';
import {DialoguePlayer} from '../dialogue/player';

// #hud는 DOM 패널이다. 목록·대사 같은 글자 UI를 여기 그려 스크린샷 검사(--expect-text)가 읽을 수 있게 한다.
// 규칙 계산은 rules/에 두고 여기서는 부르기만 한다.
const hud = () => document.getElementById('hud') as HTMLElement;

export function setStatus(text: string): void {
  let p = hud().querySelector<HTMLElement>('.status');
  if (!p) { p = document.createElement('p'); p.className = 'status'; hud().prepend(p); }
  p.textContent = text;
}

export function renderContracts(merc: Mercenary | undefined, contracts: Contract[], onPick: (c: Contract) => void): void {
  const root = hud();
  root.querySelector('.contracts')?.remove();
  const box = document.createElement('section');
  box.className = 'contracts';
  box.innerHTML = `<h2>계약 게시판</h2>${merc ? `<p>용병: ${merc.name}</p>` : '<p>용병 데이터 없음</p>'}`;
  const ul = document.createElement('ul');
  for (const c of contracts) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.id = c.id;
    const chance = merc ? `<span class="chance">${percent(successChance(merc, c))}</span>` : '';
    li.innerHTML = `${chance}<strong>${c.title}</strong><br><small>난이도 ${c.difficulty} · 보수 ${c.reward} · ${c.days}일 · ${c.check}</small>`;
    li.addEventListener('click', () => {
      ul.querySelectorAll('li').forEach(x => x.removeAttribute('aria-selected'));
      li.setAttribute('aria-selected', 'true');
      onPick(c);
    });
    ul.append(li);
  }
  if (!contracts.length) ul.innerHTML = '<li>계약 데이터 없음</li>';
  box.append(ul);
  root.append(box);
}

export function renderDialogue(player: DialoguePlayer, onEnd: () => void): void {
  const root = hud();
  root.querySelector('#dialogue')?.remove();
  const box = document.createElement('section');
  box.id = 'dialogue';
  root.append(box);
  const draw = () => {
    const n = player.current;
    if (!n) { box.innerHTML = '<p>(대화 끝)</p>'; onEnd(); return; }
    box.innerHTML = `<p>${n.speaker ? `<span class="speaker">${n.speaker}</span>` : ''}${n.text}</p>`;
    const choices = player.choices();
    if (choices.length) {
      for (const {index, choice} of choices) {
        const b = document.createElement('button');
        b.textContent = choice.text;
        b.addEventListener('click', () => { player.choose(index); draw(); });
        box.append(b);
      }
    } else {
      const b = document.createElement('button');
      b.textContent = '다음';
      b.addEventListener('click', () => { player.advance(); draw(); });
      box.append(b);
    }
  };
  draw();
}
