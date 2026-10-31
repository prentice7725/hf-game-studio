import type {Contract, Mercenary} from '../data/types';

// GDD "수치와 공식"의 contract_success_chance.
// GDD가 TBD인 동안의 기본식이다: 검사 능력치가 (난이도 + 2)와 같으면 50%, 1 차이마다 10%씩, 5%~95%로 자른다.
// GDD가 정해지면 이 함수 하나만 바꾸고, 수치는 데이터(data/*.json)에서 읽는다. 화면 코드는 이 함수를 부르기만 한다.
export const MIN_CHANCE = 0.05;
export const MAX_CHANCE = 0.95;
export function successChance(merc: Mercenary, contract: Contract): number {
  const stat = merc.stats[contract.check];
  const raw = 0.5 + (stat - (contract.difficulty + 2)) * 0.1;
  return Math.min(MAX_CHANCE, Math.max(MIN_CHANCE, Math.round(raw * 100) / 100));
}

// roll은 [0, 1) 난수. 분리해 두어 테스트에서 난수를 고정할 수 있다.
export function resolveContract(chance: number, roll: number): 'success' | 'failure' {
  if (roll < 0 || roll >= 1) throw new RangeError(`roll must be in [0, 1): ${roll}`);
  return roll < chance ? 'success' : 'failure';
}

export const percent = (chance: number) => `${Math.round(chance * 100)}%`;
