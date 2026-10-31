import {describe, expect, it} from 'vitest';
import {DialoguePlayer} from './player';
import type {Dialogue} from '../data/types';

const doc: Dialogue = {
  id: 'contract-grain-cart', start: 'n1',
  nodes: [
    {id: 'n1', speaker: 'client', text: '곡물 수레를 호위해 주시오.', choices: [
      {text: '맡겠다', next: 'n2'},
      {text: '거절한다', next: 'n3'},
      {text: '보수를 올려라', next: 'n4', if: {var: 'reputation', op: '>=', value: 2}},
    ]},
    {id: 'n2', speaker: 'ash', text: '보수는 선금으로.', set: [{var: 'gold', op: '+=', value: 50}]},
    {id: 'n3', speaker: 'ash', text: '다른 사람을 찾아라.', next: 'n5'},
    {id: 'n4', speaker: 'client', text: '...좋소.', set: [{var: 'gold', op: '+=', value: 80}]},
    {id: 'n5', text: '의뢰인이 떠났다.'},
  ],
};

describe('DialoguePlayer', () => {
  it('start 노드에서 시작하고 선택으로 이동한다', () => {
    const p = new DialoguePlayer(doc);
    expect(p.current?.id).toBe('n1');
    p.choose(0);
    expect(p.current?.id).toBe('n2');
    expect(p.vars.get('gold')).toBe(50);
    p.advance();
    expect(p.ended).toBe(true);
  });
  it('조건이 거짓인 선택지는 숨기고 고르면 거절한다', () => {
    const p = new DialoguePlayer(doc);
    expect(p.choices().map(c => c.index)).toEqual([0, 1]);
    expect(() => p.choose(2)).toThrow(/hidden/);
    const rich = new DialoguePlayer(doc, {reputation: 3});
    expect(rich.choices().map(c => c.index)).toEqual([0, 1, 2]);
    rich.choose(2);
    expect(rich.vars.get('gold')).toBe(80);
  });
  it('선택지가 있는 노드에서 advance하면 거절하고, next를 따라 끝까지 간다', () => {
    const p = new DialoguePlayer(doc);
    expect(() => p.advance()).toThrow(/choose/);
    p.choose(1);
    p.advance();
    expect(p.current?.id).toBe('n5');
    expect(p.current?.speaker).toBeUndefined();
    p.advance();
    expect(p.ended).toBe(true);
    p.advance();
    expect(p.ended).toBe(true);
  });
  it('없는 노드를 가리키면 실패한다', () => {
    expect(() => new DialoguePlayer({...doc, start: 'zz'})).toThrow(/unknown node zz/);
  });
});
