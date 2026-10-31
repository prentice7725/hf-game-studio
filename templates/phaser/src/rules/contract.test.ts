import {describe, expect, it} from 'vitest';
import {MAX_CHANCE, MIN_CHANCE, percent, resolveContract, successChance} from './contract';
import type {Contract, Mercenary} from '../data/types';

const merc = (might: number): Mercenary => ({id: 'ash', name: '애쉬', hire_cost: 100, stats: {might, wits: 5, grit: 5}});
const contract = (difficulty: number): Contract => ({id: 'c', title: '계약', difficulty, reward: 10, days: 3, check: 'might'});

describe('successChance', () => {
  it('검사 능력치가 난이도+2와 같으면 50%', () => {
    expect(successChance(merc(5), contract(3))).toBe(0.5);
  });
  it('능력치 1 차이마다 10%', () => {
    expect(successChance(merc(6), contract(3))).toBe(0.6);
    expect(successChance(merc(3), contract(3))).toBe(0.3);
  });
  it('5%와 95%로 자른다', () => {
    expect(successChance(merc(1), contract(5))).toBe(MIN_CHANCE);
    expect(successChance(merc(10), contract(1))).toBe(MAX_CHANCE);
  });
});

describe('resolveContract', () => {
  it('난수가 확률보다 작으면 성공', () => {
    expect(resolveContract(0.5, 0.49)).toBe('success');
    expect(resolveContract(0.5, 0.5)).toBe('failure');
  });
  it('난수 범위를 벗어나면 거절', () => {
    expect(() => resolveContract(0.5, 1)).toThrow(RangeError);
  });
});

it('percent', () => {
  expect(percent(0.456)).toBe('46%');
});
