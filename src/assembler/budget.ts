export interface Budgetable { tokens: number; score: number }
export interface TrimResult<T> { retrieved: T[]; stack: T[]; over_budget: boolean; dropped_stack: number; dropped_retrieved: number }

function sum(xs: Budgetable[]): number { return xs.reduce((s, x) => s + x.tokens, 0); }

export function trimToBudget<T extends Budgetable>(fixedTokens: number, retrieved: T[], stack: T[], budget: number): TrimResult<T> {
  if (fixedTokens > budget) return { retrieved, stack, over_budget: true, dropped_stack: 0, dropped_retrieved: 0 };
  const keptStack = [...stack].sort((a, b) => b.score - a.score);
  const keptRetrieved = [...retrieved].sort((a, b) => b.score - a.score);
  let droppedStack = 0;
  let droppedRetrieved = 0;
  const total = () => fixedTokens + sum(keptRetrieved) + sum(keptStack);
  while (total() > budget && keptStack.length > 0) { keptStack.pop(); droppedStack++; }
  while (total() > budget && keptRetrieved.length > 0) { keptRetrieved.pop(); droppedRetrieved++; }
  const order = (orig: T[], kept: T[]) => orig.filter((x) => kept.includes(x));
  return { retrieved: order(retrieved, keptRetrieved), stack: order(stack, keptStack), over_budget: false, dropped_stack: droppedStack, dropped_retrieved: droppedRetrieved };
}
