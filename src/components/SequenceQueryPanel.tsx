import { useEffect, useState } from 'react'
import type {
  Constraint,
  SequenceQueryResult,
  SequenceVerdict,
  TimeObservation,
  TEvent,
} from '../types'
import { querySequence } from '../lib/query'
import { formatAt, formatBound, formatFullDateTime } from '../lib/format'

interface Props {
  events: TEvent[]
  /** 原案卷证词（不采用修复预览的临时停用结果） */
  constraints: Constraint[]
  observations: TimeObservation[]
  /** 原案卷是否可满足；矛盾时问询暂停 */
  satisfiable: boolean
}

/** 解析 k 输入：非负整数（安全整数）才有效；空串与其余输入一律无效 */
function parseK(text: string): number | null {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return Number.isSafeInteger(n) ? n : null
}

/** 一次已完成的问询：结果与产生它的案卷引用、查询条件绑定，用于失配时清除 */
export interface QueryRun {
  events: TEvent[]
  constraints: Constraint[]
  observations: TimeObservation[]
  aId: string
  bId: string
  k: number
  result: SequenceQueryResult
}

/** 相对分钟的有符号展示：+12 / −5 / 0 */
function signed(v: number): string {
  if (v === 0) return '0'
  return v > 0 ? `+${v}` : `−${Math.abs(v)}`
}

const VERDICT_META: Record<SequenceVerdict, { cls: 'ok' | 'warn' | 'danger'; icon: string; label: string }> = {
  necessary: { cls: 'ok', icon: '✅', label: '必然成立' },
  possible: { cls: 'warn', icon: '⚠️', label: '可能但非必然' },
  impossible: { cls: 'danger', icon: '⛔', label: '不可能成立' },
}

/** 单个可行分支的全事件赋值表（正例或反例） */
function BranchAssignment({ run, branch }: { run: QueryRun; branch: 'assert' | 'negate' }) {
  const { result } = run
  const offsets = branch === 'assert' ? result.assertAssignment : result.negateAssignment
  if (!offsets) return null
  const k = result.k
  const abs = result.baseISO !== null
  const d = offsets[result.bIdx] - offsets[result.aIdx]
  const title = branch === 'assert' ? `断言分支：tB − tA ≥ ${k}` : `否定分支：tB − tA ≤ ${k - 1}`
  return (
    <div className="query-branch">
      <div className="query-branch-head">
        <span className={`badge query-${branch}`}>{branch === 'assert' ? '正例' : '反例'}</span>
        <strong>{title}</strong>
        <span className="query-branch-d">
          本例 tB − tA = {signed(d)} 分钟（{branch === 'assert' ? `满足 ≥ ${k}` : `满足 ≤ ${k - 1}`}）
        </span>
      </div>
      <div className="query-branch-note">
        {abs
          ? '该分支加入统一差分系统后仍可满足；下表为一份满足全案卷（全部启用证词 + 全部观测 + 该分支断言）的绝对时间赋值，仅为可行示例：'
          : '该分支加入统一差分系统后仍可满足；下表为一份满足全案卷（全部启用证词 + 该分支断言）的相对分钟赋值，以 A = 0 显示，仅为可行示例（整体平移后仍满足全案卷）：'}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="windows query-assign">
          <thead>
            <tr>
              <th>事件</th>
              {abs ? (
                <>
                  <th className="num">绝对时刻</th>
                  <th className="num">相对基准偏移</th>
                </>
              ) : (
                <th className="num">相对分钟（A = 0）</th>
              )}
            </tr>
          </thead>
          <tbody>
            {run.events.map((ev, i) => (
              <tr key={ev.id}>
                <td>
                  {ev.name}
                  {i === result.aIdx && <span className="badge query-role">A</span>}
                  {i === result.bIdx && <span className="badge query-role">B</span>}
                </td>
                {abs ? (
                  <>
                    <td className="num">{formatAt(result.baseISO, offsets[i])}</td>
                    <td className="num">{signed(offsets[i])} 分钟</td>
                  </>
                ) : (
                  <td className="num">{signed(offsets[i] - offsets[result.aIdx])}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** 一次问询的结果视图（只读展示）：最紧区间 + 三分结论 + 各可行分支的全事件赋值 */
export function QueryResultView({ run }: { run: QueryRun }) {
  const { result } = run
  const nameOf = (idx: number) => run.events[idx]?.name ?? '（已删除事件）'
  const aName = nameOf(result.aIdx)
  const bName = nameOf(result.bIdx)
  const k = result.k
  const meta = VERDICT_META[result.verdict]

  const verdictDesc =
    result.verdict === 'necessary'
      ? `否定分支（tB − tA ≤ ${k - 1}）加入统一差分系统后出现矛盾：最紧下界 ${formatBound(result.dMin, 'min')} ≥ ${k}，全部满足全案卷的时间安排都有 tB − tA ≥ ${k}，不存在反例。`
      : result.verdict === 'impossible'
        ? `断言分支（tB − tA ≥ ${k}）加入统一差分系统后出现矛盾：最紧上界 ${formatBound(result.dMax, 'max')} ≤ ${k - 1}，任何满足全案卷的安排都有 tB − tA ≤ ${k - 1}，不存在正例。`
        : `断言与否定各自加入统一差分系统后均可行（${formatBound(result.dMin, 'min')} ≤ ${k - 1} 且 ${formatBound(result.dMax, 'max')} ≥ ${k}）：既存在满足 tB − tA ≥ ${k} 的安排（正例），也存在不满足的安排（反例）。`

  return (
    <div className="query-result">
      <div className="query-interval">
        问询：「<strong>{bName}</strong>」至少比「<strong>{aName}</strong>」晚 <strong>{k}</strong> 分钟
        （tB − tA ≥ {k}，整数分钟）。 tB − tA 的最紧区间：
        <code>
          [{formatBound(result.dMin, 'min')}, {formatBound(result.dMax, 'max')}] 分钟
        </code>
      </div>

      <div className={`schedule-note ${meta.cls}`}>
        {meta.icon} <strong>{meta.label}</strong>：{verdictDesc}
      </div>

      {result.assertFeasible ? (
        <BranchAssignment run={run} branch="assert" />
      ) : (
        <div className="query-branch-infeasible">
          正例不存在：断言分支（tB − tA ≥ {k}）加入统一差分系统后出现矛盾（负环）。
        </div>
      )}
      {result.negateFeasible ? (
        <BranchAssignment run={run} branch="negate" />
      ) : (
        <div className="query-branch-infeasible">
          反例不存在：否定分支（tB − tA ≤ {k - 1}）加入统一差分系统后出现矛盾（负环）。
        </div>
      )}

      <div className="query-readonly">
        问询结果只读：不写入案卷或浏览器本地存储；案卷或查询条件改变后结果自动清除。
      </div>
    </div>
  )
}

/**
 * 先后关系问询面板：选择两个不同事件 A、B 与非负整数 k，
 * 查询「B 至少比 A 晚 k 分钟」（tB − tA ≥ k，整数分钟）。
 * 基于原案卷（全部事件、启用证词与全部观测，不采用修复预览的临时停用结果）：
 * 给出 tB − tA 的最紧区间，把断言与其否定分别加入统一差分系统判定可行性，
 * 区分必然成立 / 可能但非必然 / 不可能成立，并为每个可行分支展示一份
 * 满足全案卷的全部事件时间赋值（可能但非必然时同时给出正例与反例）。
 * 手动触发、结果只读；案卷矛盾时暂停问询；案卷或查询条件改变后旧结果自动清除。
 */
export default function SequenceQueryPanel({ events, constraints, observations, satisfiable }: Props) {
  const [aId, setAId] = useState('')
  const [bId, setBId] = useState('')
  const [kText, setKText] = useState('10')
  const [run, setRun] = useState<QueryRun | null>(null)

  // 选择归一：引用了已删除事件时回落到前两个事件
  const a = events.some((e) => e.id === aId) ? aId : (events[0]?.id ?? '')
  const b = events.some((e) => e.id === bId) ? bId : (events[1]?.id ?? events[0]?.id ?? '')

  const k = parseK(kText)
  const kInvalid = kText.trim() !== '' && k === null
  const sameEvent = a !== '' && b !== '' && a === b
  const canQuery = satisfiable && events.length >= 2 && k !== null && !sameEvent

  // 案卷或查询条件改变后清除旧结果：案卷数据不可变更新，引用比较即可发现变化
  const stale =
    run !== null &&
    (run.events !== events ||
      run.constraints !== constraints ||
      run.observations !== observations ||
      run.aId !== a ||
      run.bId !== b ||
      run.k !== k)
  useEffect(() => {
    if (stale) setRun(null)
  }, [stale])
  const shown = stale ? null : run

  const activeCount = constraints.filter((c) => c.enabled).length

  const runQuery = () => {
    if (!canQuery || k === null) return
    const result = querySequence(events, constraints, observations, a, b, k)
    if (result) setRun({ events, constraints, observations, aId: a, bId: b, k, result })
  }

  return (
    <div className="panel query-panel">
      <h3>
        先后关系问询
        <span className="count">
          {events.length} 事件 · {activeCount} 条启用证词 · {observations.length} 条观测 · 结果只读
        </span>
      </h3>

      <div className="slack-desc">
        选择两个不同事件 A、B 与非负整数 k，按整数分钟查询「<strong>B 至少比 A 晚 k 分钟</strong>」
        （tB − tA ≥ k）。问询基于<strong>原案卷</strong>的全部事件、启用证词与全部观测
        （不采用修复预览的临时停用结果）：给出 tB − tA 的最紧区间（允许负数与 ±∞），
        并把<strong>断言与其否定分别加入统一差分系统</strong>判定可行性——
        区分必然成立 / 可能但非必然 / 不可能成立；每个可行分支展示一份满足全案卷的
        全部事件时间赋值（可能但非必然时同时给出正例与反例；有观测时显示绝对时间，
        无观测时以 A = 0 显示相对分钟，仅为可行示例）。
        分析只读，不写入案卷或本地存储；案卷或查询条件改变后旧结果自动清除。
      </div>

      {events.length < 2 ? (
        <div className="empty-hint">至少添加两个事件后，可进行先后关系问询。</div>
      ) : (
        <>
          <div className="add-row slack-input-row">
            <label>
              事件 A
              <select value={a} onChange={(e) => setAId(e.target.value)} aria-label="事件 A">
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              事件 B
              <select value={b} onChange={(e) => setBId(e.target.value)} aria-label="事件 B">
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
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
            {shown && <span className="slack-stale-hint">修改案卷或查询条件后结果自动清除</span>}
          </div>

          {sameEvent && <div className="slack-error">请选择两个不同的事件：当前 A 与 B 相同。</div>}
          {kInvalid && (
            <div className="slack-error">k 必须是非负整数分钟（0、1、2 …），当前输入无法解析。</div>
          )}

          {!satisfiable && (
            <div className="schedule-note danger query-paused">
              ⛔ 案卷存在矛盾（观测与证词不能同时成立）：先后关系问询已暂停。
              请先按上方矛盾链与修复建议处理，恢复可满足后再问询。
            </div>
          )}

          {shown && (
            <>
              <div className="query-base">
                {shown.result.baseISO === null
                  ? '无绝对时间观测：赋值以 A = 0 显示相对分钟（仅为可行示例）'
                  : `时间基准 t₀ = ${formatFullDateTime(shown.result.baseISO)}（最早观测起点；赋值为绝对时间）`}
              </div>
              <QueryResultView run={shown} />
            </>
          )}
        </>
      )}
    </div>
  )
}
