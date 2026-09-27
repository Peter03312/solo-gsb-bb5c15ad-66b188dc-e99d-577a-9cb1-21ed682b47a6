import type {
  Constraint,
  DiffEdge,
  SequenceQueryResult,
  SequenceVerdict,
  TimeObservation,
  TEvent,
} from '../types'
import { buildSystem, feasiblePotentials, findNegativeCycle, shortestFrom } from './graph'

/**
 * 先后关系问询：查询「B 至少比 A 晚 k 分钟」（tB − tA ≥ k，k 为非负整数分钟，A ≠ B）。
 *
 * 在原案卷（全部事件 + 启用证词 + 全部观测；调用方传入原始约束数组，
 * 不含修复预览的临时停用）的统一差分系统上：
 *
 * 1. 最紧区间：与冗余证词审计同一组最短路推导——
 *      dMax = dist(A → B)（tB − tA 的最小上界）
 *      dMin = −dist(B → A)
 *    不可达的一侧按无界处理（null 表示 −∞ / +∞）；区间值可以为负；
 * 2. 分支判定：把断言与其整数分钟否定分别作为一条差分边加入同一系统——
 *      断言  tB − tA ≥ k   ⇒  tA − tB ≤ −k   ⇒  边 B → A，权 −k
 *      否定  tB − tA ≤ k−1 ⇒  边 A → B，权 k−1
 *    （全部边权为整数时系统存在实数解即存在整数解，故「tB − tA < k」在整数分钟
 *    语义下等价于「tB − tA ≤ k−1」），各自做一次负环检测判定可行性；
 * 3. 可行赋值：每个可行分支取该系统的一组可行势（超级源点 Bellman-Ford，
 *    结果确定），平移到 t0 = 0 得到全部事件的分钟偏移——它同时满足全部启用
 *    证词、全部观测与该分支断言，是一份确定性的可行示例（不逐分钟枚举）。
 *
 * 结论：断言可行且否定不可行 → 必然成立；两者均可行 → 可能但非必然；
 * 断言不可行 → 不可能成立（此时否定分支必然可行：原系统可满足，
 * 其每个可行解都满足 tB − tA ≤ k−1）。
 *
 * 案卷矛盾（负环）时返回 null：最短路推导与分支判定都以无负环为前提，问询暂停。
 * 输入非法（k 不是非负整数、A 与 B 相同或引用已删除事件）同样返回 null。
 *
 * 本函数为纯计算：不修改案卷数据，也不写入任何本地存储。
 */
export function querySequence(
  events: TEvent[],
  constraints: Constraint[],
  observations: TimeObservation[],
  aId: string,
  bId: string,
  k: number,
): SequenceQueryResult | null {
  if (!Number.isSafeInteger(k) || k < 0 || aId === bId) return null
  const sys = buildSystem(events, constraints, observations)
  const { n, edges, indexOf, originIdx, baseISO } = sys
  const a = indexOf.get(aId)
  const b = indexOf.get(bId)
  if (a === undefined || b === undefined) return null
  const m = n + 1

  // 案卷矛盾：问询暂停（最短路区间与分支可行性都以无负环为前提）
  if (findNegativeCycle(m, edges)) return null

  // —— tB − tA 的最紧区间（与冗余证词审计同一组最短路推导）——
  const upperAB = shortestFrom(a, m, edges)[b] // tB − tA ≤ upperAB
  const upperBA = shortestFrom(b, m, edges)[a] // tA − tB ≤ upperBA
  const dMax = Number.isFinite(upperAB) ? upperAB : null
  const dMin = Number.isFinite(upperBA) ? -upperBA : null

  // —— 断言 / 否定分支边（合成边仅存在于本函数内的局部边集，不进入任何展示组件）——
  const assertEdge: DiffEdge = { u: b, v: a, w: -k, kind: 'constraint', bound: 'lower' }
  const negateEdge: DiffEdge = { u: a, v: b, w: k - 1, kind: 'constraint', bound: 'upper' }

  const assertPot = feasiblePotentials(m, [...edges, assertEdge])
  const negatePot = feasiblePotentials(m, [...edges, negateEdge])
  const assertFeasible = assertPot !== null
  const negateFeasible = negatePot !== null

  const verdict: SequenceVerdict = !assertFeasible
    ? 'impossible'
    : !negateFeasible
      ? 'necessary'
      : 'possible'

  // 可行势平移到 t0 = 0：各事件相对时间原点的分钟偏移（全整数，确定性）
  const toOffsets = (h: number[] | null): number[] | null =>
    h === null ? null : events.map((_, i) => h[i] - h[originIdx])

  return {
    aIdx: a,
    bIdx: b,
    k,
    dMin,
    dMax,
    assertFeasible,
    negateFeasible,
    verdict,
    assertAssignment: toOffsets(assertPot),
    negateAssignment: toOffsets(negatePot),
    baseISO,
  }
}
