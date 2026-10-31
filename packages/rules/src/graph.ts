/**
 * 의존관계 순환 검사 (4-3). 간선 [task, dependsOn] = "task 는 dependsOn 에 의존".
 * task → dependsOn 간선을 추가할 때, dependsOn 이 이미 (간접적으로) task 에 의존하면 순환.
 */
export type Edge = readonly [task: string, dependsOn: string];

export function wouldCreateCycle(edges: readonly Edge[], task: string, dependsOn: string): boolean {
  if (task === dependsOn) return true;
  const next = new Map<string, string[]>();
  for (const [a, b] of edges) {
    const list = next.get(a);
    if (list) list.push(b);
    else next.set(a, [b]);
  }
  const seen = new Set<string>();
  const stack = [dependsOn];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === task) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const n of next.get(cur) ?? []) stack.push(n);
  }
  return false;
}
