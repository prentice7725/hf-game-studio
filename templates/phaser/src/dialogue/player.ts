import type {Choice, Condition, Dialogue, DialogueNode, Value} from '../data/types';

// 엔진 중립 대사 JSON의 작은 재생기. Godot에서는 Dialogic이 같은 JSON의 변환물(.dtl)을 재생하므로
// 이 코드는 프로토타입과 함께 버린다. 조건(if)과 변수 설정(set)의 뜻은 Dialogic과 같게 맞춘다.
export class DialoguePlayer {
  private readonly nodes: Map<string, DialogueNode>;
  private cursor: DialogueNode | null;
  readonly vars: Map<string, Value>;

  constructor(private readonly doc: Dialogue, vars: Record<string, Value> = {}) {
    this.nodes = new Map(doc.nodes.map(n => [n.id, n]));
    this.vars = new Map(Object.entries(vars));
    this.cursor = this.enter(doc.start);
  }

  get ended(): boolean { return this.cursor === null; }
  get current(): DialogueNode | null { return this.cursor; }

  // 조건이 없거나 참인 선택지만 보여 준다. 원래 자리(index)를 함께 돌려 choose에 쓴다.
  choices(): {index: number; choice: Choice}[] {
    return (this.cursor?.choices ?? []).map((choice, index) => ({index, choice})).filter(c => !c.choice.if || this.test(c.choice.if));
  }

  // 선택지가 없는 노드에서 다음으로. 선택지가 있으면 choose를 써야 한다.
  advance(): void {
    if (!this.cursor) return;
    if (this.cursor.choices) throw new Error(`${this.cursor.id}: choose() a choice first`);
    this.cursor = this.cursor.next ? this.enter(this.cursor.next) : null;
  }

  choose(index: number): void {
    const choice = this.cursor?.choices?.[index];
    if (!choice) throw new Error(`${this.cursor?.id ?? '(ended)'}: no choice ${index}`);
    if (choice.if && !this.test(choice.if)) throw new Error(`${this.cursor!.id}: choice ${index} is hidden by its condition`);
    this.cursor = this.enter(choice.next);
  }

  private enter(id: string): DialogueNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`${this.doc.id}: unknown node ${id}`);
    for (const s of node.set ?? []) this.assign(s.var, s.op, s.value);
    return node;
  }

  private test(c: Condition): boolean {
    const v = this.vars.get(c.var);
    switch (c.op) {
      case '==': return v === c.value;
      case '!=': return v !== c.value;
      case '>': return Number(v) > Number(c.value);
      case '>=': return Number(v) >= Number(c.value);
      case '<': return Number(v) < Number(c.value);
      case '<=': return Number(v) <= Number(c.value);
    }
  }

  private assign(name: string, op: string, value: Value): void {
    if (op === '=') { this.vars.set(name, value); return; }
    const cur = Number(this.vars.get(name) ?? 0), v = Number(value);
    this.vars.set(name, op === '+=' ? cur + v : op === '-=' ? cur - v : op === '*=' ? cur * v : cur / v);
  }
}
