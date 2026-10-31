import type {ContractFile, Dialogue, MercenaryFile} from './types';

// 데이터 파일은 Vite publicDir(게임 저장소의 data/)에서 상대 경로로 받는다. base './'라 dist를 어디에 두어도 같다.
export async function loadJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}
export const loadMercenaries = () => loadJson<MercenaryFile>('mercenaries.json');
export const loadContracts = () => loadJson<ContractFile>('contracts.json');
export const loadDialogue = (id: string) => loadJson<Dialogue>(`dialogue/${id}.json`);
