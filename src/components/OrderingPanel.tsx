import { useEffect, useState } from 'react'
import type {
  Constraint,
  OrderingAssignment,
  OrderingBranch,
  OrderingQueryResult,
  TimeObservation,
  TEvent,
} from '../types'
import { queryOrdering } from '../lib/ordering'
import { formatAt, formatFullDateTime } from '../lib/format'

interface Props {
  events: TEvent[]
  /** 原案卷约束（启用与否由问询库自行过滤）；刻意不接收修复预览的临时停用结果 */
  constraints: Constraint[]
  observations: TimeObservation[]
  /** 原案卷是否可满足（不含修复预览）；矛盾时面板暂停问询 */
  satisfiable: boolean
}

/** 解析非负整数分钟输入；空串与其余输入一律无效 */
function parseK(text: string): number | null {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return Number.isSafeInteger(n) ? n : null
}

/** 区间端点格式化：null 端为 −∞ / +∞；有界端带符号分钟（0 显示为 0） */
function formatBound(v: number | null, side: 'lower' | 'upper'): string {
  if (v === null) return side === 'lower' ? '−∞' : '+∞'
  if (v === 0) return '0'
  return `${v > 0 ? '+' : '−'}${Math.abs(v)} 分钟`
}

const VERDICT_META: Record<
  OrderingQueryResult['verdict'],
  { cls: string; icon: string; title: string; desc: string }
> = {
  necessary: {
    cls: 'ok',
    icon: '✅',
    title: '必然成立',
    desc: '断言在满足全部启用证词与全部观测的每一种时间安排中都成立（其否定并入差分系统后出现负环，不可行）。',
  },
  possible: {
    cls: 'warn',
    icon: '❓',
    title: '可能但非必然',
    desc: '断言与其否定在全案卷下均可行：下面同时给出满足断言的正例与违反断言的反例，各为一份满足全案卷的全部事件时间赋值。',
  },
  impossible: {
    cls: 'danger',
    icon: '⛔',
    title: '不可能成立',
    desc: '断言在任何满足全案卷的时间安排中都不成立（断言并入差分系统后出现负环，不可行）；其否定必然成立。',
  },
}

/** 一次已完成的问询：结果与产生它的案卷引用、查询参数绑定，用于失配时清除 */
interface OrderingRun {
  events: TEvent[]
  constraints: Constraint[]
  observations: TimeObservation[]
  aId: string
  bId: string
  k: number
  result: OrderingQueryResult
}

/**
 * 单个可行分支的见证赋值表：有观测时显示绝对时间，无观测时以 A=0 显示相对分钟。
 * 与任何观测不连通的事件无法定位绝对时刻，明确标注；其分量内的可行偏移仍列出。
 */
function AssignmentTable({
  events,
  result,
  branch,
  kind,
}: {
  events: TEvent[]
  result: OrderingQueryResult
  branch: OrderingBranch
  kind: 'positive' | 'negative'
}) {
  const a: OrderingAssignment = branch.assignment
  const hasObs = result.baseISO !== null
  const aName = events[result.aIdx]?.name ?? 'A'
  const bName = events[result.bIdx]?.name ?? 'B'

  return (
    <div className={`ordering-branch ${kind}`}>
      <div className="ordering-branch-head">
        <strong>{kind === 'positive' ? '正例（断言成立）' : '反例（断言不成立）'}</strong>
        <code className="ordering-ineq">{branch.addedInequality}</code>
      </div>
      <div className="ordering-branch-diff">
        本赋值中 <strong>t_B − t_A = {a.diffMin >= 0 ? '+' : '−'}{Math.abs(a.diffMin)} 分钟</strong>
        （t_{bName} − t_{aName}），{kind === 'positive' ? '满足' : '违反'}「至少晚 {result.k} 分钟」。
      </div>
      <div className="table-wrap">
        <table className="ordering-table">
          <thead>
            <tr>
              <th>事件</th>
              {hasObs ? (
                <>
                  <th className="num">绝对时间（可行示例）</th>
                  <th className="num">相对 t₀ 偏移</th>
                </>
              ) : (
                <th className="num">相对 {aName} 的分钟（A = 0）</th>
              )}
              {hasObs && <th>备注</th>}
            </tr>
          </thead>
          <tbody>
            {events.map((ev, i) => {
              const isA = i === result.aIdx
              const isB = i === result.bIdx
              const connected = result.connected[i]
              return (
                <tr key={ev.id} className={`${isA ? 'is-a' : ''}${isB ? ' is-b' : ''}`}>
                  <td>
                    {ev.name}
                    {isA && <span className="badge ordering-badge">A</span>}
                    {isB && <span className="badge ordering-badge">B</span>}
                  </td>
                  {hasObs ? (
                    <>
                      <td className="num">
                        {connected ? (
                          formatAt(result.baseISO, a.offsets[i])
                        ) : (
                          <span className="cell-na">无法定时</span>
                        )}
                      </td>
                      <td className="num">
                        {a.offsets[i] >= 0 ? '+' : '−'}
                        {Math.abs(a.offsets[i])}
                      </td>
                    </>
                  ) : (
                    <td className="num">
                      {a.relativeToA[i] >= 0 ? '+' : '−'}
                      {Math.abs(a.relativeToA[i])}
                    </td>
                  )}
                  {hasObs && (
                    <td className="ordering-note">
                      {!connected ? (
                        <span className="ordering-unconnected">未与任何观测连通，绝对时刻不可定位；所示为其所在约束分量内的可行取值</span>
                      ) : isA ? (
                        <span>事件 A</span>
                      ) : isB ? (
                        <span>事件 B</span>
                      ) : null}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="ordering-example-note">
        ⓘ 仅为一份可行示例（由差分系统的可行势给出），用于证明该分支存在；不代表唯一解或边界取值。
        {hasObs && ` 绝对时间基准 t₀ = ${formatFullDateTime(result.baseISO)}（最早观测起点）。`}
      </div>
    </div>
  )
}

/** 问询结果视图：三值结论 + 最紧区间 + 每个可行分支的见证赋值 */
export function OrderingResultView({ run }: { run: OrderingRun }) {
  const { result } = run
  const nameById = new Map(run.events.map((e) => [e.id, e.name]))
  const nameOf = (id: string) => nameById.get(id) ?? '（已删除事件）'
  const aName = nameOf(run.aId)
  const bName = nameOf(run.bId)
  const meta = VERDICT_META[result.verdict]

  // 区间与 k 的位置关系（与三值结论互为印证）
  const positionNote = (() => {
    const { lower, upper, k } = result
    if (lower !== null && lower >= k)
      return `最紧区间下界 ${formatBound(lower, 'lower')} ≥ k = ${k}，故差必然不小于 ${k}。`
    if (upper !== null && upper < k)
      return `最紧区间上界 ${formatBound(upper, 'upper')} < k = ${k}，故差必然小于 ${k}。`
    return `最紧区间跨越阈值 k = ${k}（下界 < k 且上界 ≥ k，或对应端点无界），故差是否不小于 ${k} 两种安排都存在。`
  })()

  return (
    <div className="ordering-result">
      <div className={`schedule-note ${meta.cls}`}>
        <div className="ordering-verdict-title">
          {meta.icon} <strong>{meta.title}</strong>
          <span className="ordering-query-text">
            「{bName}」至少比「{aName}」晚 {result.k} 分钟
          </span>
        </div>
        <div>{meta.desc}</div>
      </div>

      <div className="ordering-interval-box">
        <div className="ordering-interval-title">t_{bName} − t_{aName} 的最紧可行区间</div>
        <code className="ordering-interval">
          [{formatBound(result.lower, 'lower')} , {formatBound(result.upper, 'upper')}]
        </code>
        <div className="ordering-interval-note">
          {positionNote} 区间端点由同一差分图上的最短路给出：上界 = A→B 最短路，
          下界 = −(B→A 最短路)；不可达的端点按无界处理。区间允许负数（B 可早于 A）。
        </div>
      </div>

      {result.positive && (
        <AssignmentTable events={run.events} result={result} branch={result.positive} kind="positive" />
      )}
      {result.negative && (
        <AssignmentTable events={run.events} result={result} branch={result.negative} kind="negative" />
      )}

      <div className="slack-readonly">
        问询结果只读：断言与否定仅作为临时附加差分边参与计算，不写入案卷或浏览器本地存储；
        案卷或查询（A / B / k）改变后结果自动清除。
      </div>
    </div>
  )
}

/**
 * 先后关系问询面板：选择两个不同事件 A、B 与非负整数 k，查询
 * 「B 至少比 A 晚 k 分钟」在原案卷（全部启用证词 + 全部观测，不含修复预览的
 * 临时停用结果）下必然成立 / 可能但非必然 / 不可能成立，给出 t_B − t_A 的
 * 最紧区间（允许负数与 ±∞）与各可行分支的一份全事件时间赋值。手动触发、
 * 结果只读；案卷矛盾时暂停；案卷或查询改变即清除旧结果。
 */
export default function OrderingPanel({ events, constraints, observations, satisfiable }: Props) {
  const [aId, setAId] = useState('')
  const [bId, setBId] = useState('')
  const [kText, setKText] = useState('0')
  const [run, setRun] = useState<OrderingRun | null>(null)

  // 事件列表变化后，把失效/缺省选择收敛到现存的不同事件
  useEffect(() => {
    if (events.length === 0) return
    setAId((cur) => (events.some((e) => e.id === cur) ? cur : events[0].id))
    setBId((cur) => {
      if (events.some((e) => e.id === cur)) return cur
      return events.length > 1 ? events[1].id : events[0].id
    })
  }, [events])

  // 保证 A ≠ B：事件不足两个时不允许查询
  useEffect(() => {
    if (aId === bId && events.length > 1) {
      const other = events.find((e) => e.id !== aId)
      if (other) setBId(other.id)
    }
  }, [aId, bId, events])

  const k = parseK(kText)
  const kInvalid = kText.trim() !== '' && k === null
  const canQuery = events.length >= 2 && aId && bId && aId !== bId && k !== null && satisfiable

  // 案卷或查询改变后清除旧结果（案卷不可变更新，引用比较即可发现变化）
  const stale =
    run !== null &&
    (run.events !== events ||
      run.constraints !== constraints ||
      run.observations !== observations ||
      run.aId !== aId ||
      run.bId !== bId ||
      run.k !== k)
  useEffect(() => {
    if (stale) setRun(null)
  }, [stale])
  const shown = stale ? null : run

  const runQuery = () => {
    if (!canQuery) return
    const aIdx = events.findIndex((e) => e.id === aId)
    const bIdx = events.findIndex((e) => e.id === bId)
    const result = queryOrdering(events, constraints, observations, aIdx, bIdx, k!)
    if (!result) return
    setRun({ events, constraints, observations, aId, bId, k: k!, result })
  }

  const activeCount = constraints.filter((c) => c.enabled).length

  return (
    <div className="panel ordering-panel">
      <h3>
        先后关系问询
        <span className="count">
          {activeCount} 条启用证词 · {observations.length} 条观测 · 结果只读 · 不采用修复预览的临时停用
        </span>
      </h3>

      <div className="slack-desc">
        选择两个<strong>不同事件 A、B</strong> 与非负整数 k，查询
        <strong>「B 至少比 A 晚 k 分钟」</strong>（t_B − t_A ≥ k）在原案卷下是
        <strong>必然成立、可能但非必然、还是不可能成立</strong>。断言与其否定
        （整数分钟下 t_B − t_A ≤ k−1）分别作为一条附加差分边并入同一张差分系统做负环检测；
        给出 t_B − t_A 的<strong>最紧区间</strong>（允许负数与 −∞ / +∞），
        并为每个可行分支展示一份满足<strong>全案卷</strong>的全部事件时间赋值：
        有观测时显示绝对时间，无观测时以 A = 0 显示相对分钟（仅为可行示例）。
      </div>

      {events.length < 2 ? (
        <div className="empty-hint">至少添加两个事件后，可进行先后关系问询。</div>
      ) : !satisfiable ? (
        <div className="schedule-note danger">
          ⛔ 案卷当前存在矛盾（差分系统含负环），先后关系问询已暂停：请先在上方查看矛盾链与修复建议。
          本面板只接入原案卷的启用证词与全部观测，不采用修复预览的临时停用结果。
        </div>
      ) : (
        <>
          <div className="add-row ordering-input-row">
            <label>
              事件 A
              <select value={aId} onChange={(e) => setAId(e.target.value)} aria-label="事件 A">
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              事件 B
              <select value={bId} onChange={(e) => setBId(e.target.value)} aria-label="事件 B">
                {events.map((e) => (
                  <option key={e.id} value={e.id} disabled={e.id === aId}>
                    {e.name}
                    {e.id === aId ? '（须与 A 不同）' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              k（分钟，非负整数）
              <input
                className={`num${kInvalid ? ' invalid' : ''}`}
                value={kText}
                onChange={(e) => setKText(e.target.value)}
                inputMode="numeric"
                placeholder="如 10"
                aria-label="k（分钟，非负整数）"
              />
            </label>
            <button className="primary" disabled={!canQuery} onClick={runQuery}>
              开始问询
            </button>
            {shown && <span className="slack-stale-hint">修改案卷或查询后结果自动清除</span>}
          </div>
          {kInvalid && (
            <div className="slack-error">k 必须是非负整数分钟（0、1、2 …），当前输入无法解析。</div>
          )}
          {shown && <OrderingResultView run={shown} />}
        </>
      )}
    </div>
  )
}
