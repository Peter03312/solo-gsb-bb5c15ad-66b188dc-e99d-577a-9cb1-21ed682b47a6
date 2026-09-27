import type {
  Constraint,
  DiffEdge,
  OrderingAssignment,
  OrderingBranch,
  OrderingQueryResult,
  TimeObservation,
  TEvent,
} from '../types'
import { analyze, buildSystem, feasiblePotentials, shortestFrom } from './graph'

/**
 * 附加断言边的合成来源 id（仅内部标识；问询边不写入案卷，也不进入任何持久化）。
 */
const QUERY_EDGE_ID = '__ordering_query__'

/**
 * 先后关系问询：给定两个不同事件 A、B 与非负整数 k，判定
 *
 *     P：t_B − t_A ≥ k（B 至少比 A 晚 k 分钟）
 *
 * 接入原案卷的全部事件、启用证词（相对约束）与全部绝对时间观测，
 * **不采用修复预览的临时停用结果**（面板直接接收 state 中的原始约束数组）。
 *
 * t_B − t_A 的最紧可行区间 [lower, upper]（允许负数；null 表示 ±∞）：
 *   upper = A → B 的最短路（t_B − t_A ≤ d 的最紧上界）
 *   lower = −(B → A 的最短路)（t_A − t_B ≤ d ⇒ t_B − t_A ≥ −d 的最紧下界）
 *
 * 断言与否定各作为一条差分边并入同一系统做负环检测（可行势）：
 *   P：t_B − t_A ≥ k  ⇔  t_A − t_B ≤ −k  ⇔  B → A，权 −k
 *   ¬P：t_B − t_A < k （整数分钟下即 ≤ k−1）⇔  A → B，权 k−1
 * k = 0 时 ¬P 要求 t_B − t_A ≤ −1（B 至少早 A 1 分钟），并非天然不可行；
 * 是否可行仍由原案卷决定（无约束时正例可取同时、反例可取 B 早于 A）。
 *
 * 每个可行分支用超级源点 Bellman-Ford 取一组可行势，并平移为「全部事件相对
 * 时间原点的整数分钟偏移」：有观测时 t0 锚定 baseISO，即绝对时刻；无观测时
 * t0 是自由平移的内部原点，额外给出归一化到 t_A = 0 的相对分钟用于展示。
 *
 * 纯计算：不修改案卷数据，也不写入任何本地存储。
 * 案卷矛盾（原系统含负环）时返回 null：最短路与可行势均无意义，问询暂停。
 */
export function queryOrdering(
  events: TEvent[],
  constraints: Constraint[],
  observations: TimeObservation[],
  aIdx: number,
  bIdx: number,
  k: number,
): OrderingQueryResult | null {
  // 原案卷先做一次统一分析：矛盾时暂停，baseISO/连通性供结果展示
  const base = analyze(events, constraints, observations)
  if (!base.satisfiable) return null
  if (aIdx < 0 || bIdx < 0 || aIdx >= events.length || bIdx >= events.length || aIdx === bIdx) {
    return null
  }

  const sys = buildSystem(events, constraints, observations)
  const { n, edges, originIdx } = sys
  const m = n + 1

  // —— t_B − t_A 的最紧可行区间 ——
  const fwd = shortestFrom(aIdx, m, edges)[bIdx]
  const back = shortestFrom(bIdx, m, edges)[aIdx]
  const upper = Number.isFinite(fwd) ? fwd : null
  const lower = Number.isFinite(back) ? -back : null

  /** 问询附加边（不写回案卷边集，每次按分支现取） */
  const queryEdge = (u: number, v: number, w: number): DiffEdge => ({
    u,
    v,
    w,
    kind: 'constraint',
    constraintId: QUERY_EDGE_ID,
    bound: 'upper',
  })

  /** 在原边集上并入一条断言边，可行时返回一份全部事件的时间赋值 */
  const branchWitness = (extra: DiffEdge[], inequality: string): OrderingBranch | null => {
    const pot = feasiblePotentials(m, [...edges, ...extra])
    if (pot === null) return null
    const offsets = pot.slice(0, n).map((v) => v - pot[originIdx])
    const relativeToA = offsets.map((v) => v - offsets[aIdx])
    const assignment: OrderingAssignment = {
      offsets,
      relativeToA,
      diffMin: relativeToA[bIdx],
    }
    return { addedInequality: inequality, assignment }
  }

  // P：t_B − t_A ≥ k（附加边 B → A，权 −k）
  const positive = branchWitness(
    [queryEdge(bIdx, aIdx, -k)],
    `t_B − t_A ≥ ${k}（附加差分边 B → A，权 −${k}，即 t_A − t_B ≤ −${k}）`,
  )
  // ¬P：整数分钟下 t_B − t_A ≤ k−1（附加边 A → B，权 k−1）
  const negative = branchWitness(
    [queryEdge(aIdx, bIdx, k - 1)],
    `t_B − t_A ≤ ${k - 1}（断言的否定；整数分钟下即 t_B − t_A < ${k}，附加边 A → B，权 ${k - 1}）`,
  )

  const verdict =
    positive !== null && negative !== null
      ? 'possible'
      : positive !== null
        ? 'necessary'
        : 'impossible'

  const connected = events.map((_, i) => {
    const w = base.windows.get(i)
    return !!w && w.status !== 'disconnected'
  })

  return {
    aIdx,
    bIdx,
    k,
    lower,
    upper,
    verdict,
    positive,
    negative,
    baseISO: base.baseISO,
    connected,
  }
}
