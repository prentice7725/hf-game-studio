// design/schemas/*.schema.json과 같은 모양. 스키마가 바뀌면 여기도 맞춘다(검사는 tools/hfgs/validate-data.mjs가 한다).
export type Stat = 'might' | 'wits' | 'grit';

export interface Mercenary {
  id: string;
  name: string;
  hire_cost: number;
  stats: Record<Stat, number>;
  portrait?: string;
}
export interface MercenaryFile { version: number; mercenaries: Mercenary[]; }

export interface Contract {
  id: string;
  title: string;
  difficulty: number;
  reward: number;
  days: number;
  check: Stat;
  intro_dialogue?: string;
}
export interface ContractFile { version: number; contracts: Contract[]; }

export type Value = number | boolean | string;
export interface Condition { var: string; op: '==' | '!=' | '>' | '>=' | '<' | '<='; value: Value; }
export interface Assignment { var: string; op: '=' | '+=' | '-=' | '*=' | '/='; value: Value; }
export interface Choice { text: string; next: string; if?: Condition; }
export interface DialogueNode {
  id: string;
  speaker?: string;
  portrait?: string;
  text: string;
  enter?: {character: string; portrait?: string; position?: string}[];
  exit?: string[];
  set?: Assignment[];
  next?: string;
  choices?: Choice[];
}
export interface Dialogue { id: string; start: string; nodes: DialogueNode[]; }
