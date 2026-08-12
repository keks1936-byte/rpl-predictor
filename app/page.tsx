'use client'

import { useEffect, useMemo, useState } from 'react'
import { calculatePoints, Score } from '../lib/scoring'

const players = ['Кирилл', 'Саша', 'Стас', 'Дима'] as const
type Player = typeof players[number]
type Tab = 'round' | 'predictions' | 'table'
type Match = { id: string; home: string; away: string; result?: Score; predictions?: Partial<Record<Player, Score>> }
type Round = { number: number; matches: Match[] }
type Predictions = Record<Player, Record<string, Score>>
type Results = Record<string, Score>

const rounds: Round[] = [
  {
    number: 1,
    matches: [
      { id: 'r1m1', home: 'Спартак', away: 'Родина', result: { home: 3, away: 0 }, predictions: { Кирилл:{home:3,away:1}, Саша:{home:0,away:1}, Стас:{home:2,away:0}, Дима:{home:3,away:0} } },
      { id: 'r1m2', home: 'Локомотив', away: 'Ахмат', result: { home: 1, away: 1 }, predictions: { Кирилл:{home:1,away:1}, Саша:{home:3,away:1}, Стас:{home:1,away:1}, Дима:{home:2,away:1} } },
      { id: 'r1m3', home: 'Рубин', away: 'Краснодар', result: { home: 1, away: 3 }, predictions: { Кирилл:{home:1,away:1}, Саша:{home:1,away:1}, Стас:{home:1,away:2}, Дима:{home:0,away:1} } }
    ]
  },
  {
    number: 2,
    matches: [
      { id: 'r2m1', home: 'Динамо Мх', away: 'Локомотив', result: { home: 2, away: 1 }, predictions: { Кирилл:{home:1,away:1}, Саша:{home:1,away:2}, Стас:{home:0,away:2}, Дима:{home:0,away:1} } },
      { id: 'r2m2', home: 'Балтика', away: 'Динамо', result: { home: 2, away: 1 }, predictions: { Кирилл:{home:1,away:2}, Саша:{home:1,away:1}, Стас:{home:0,away:1}, Дима:{home:0,away:0} } },
      { id: 'r2m3', home: 'Ахмат', away: 'Спартак', result: { home: 1, away: 2 }, predictions: { Кирилл:{home:1,away:1}, Саша:{home:2,away:1}, Стас:{home:1,away:3}, Дима:{home:0,away:1} } }
    ]
  },
  {
    number: 3,
    matches: [
      { id: 'r3m1', home: 'Локомотив', away: 'Акрон', result: { home: 0, away: 0 }, predictions: { Кирилл:{home:1,away:0}, Саша:{home:3,away:0}, Стас:{home:2,away:1}, Дима:{home:2,away:0} } },
      { id: 'r3m2', home: 'ЦСКА', away: 'Ростов', result: { home: 0, away: 0 }, predictions: { Кирилл:{home:1,away:1}, Саша:{home:1,away:1}, Стас:{home:2,away:2}, Дима:{home:2,away:0} } },
      { id: 'r3m3', home: 'Спартак', away: 'Краснодар', result: { home: 1, away: 2 }, predictions: { Кирилл:{home:2,away:2}, Саша:{home:2,away:3}, Стас:{home:1,away:0}, Дима:{home:1,away:1} } }
    ]
  },
  {
    number: 4,
    matches: [
      { id: 'r4m1', home: 'Локомотив', away: 'Спартак' },
      { id: 'r4m2', home: 'Динамо', away: 'ЦСКА' },
      { id: 'r4m3', home: 'Краснодар', away: 'Зенит' }
    ]
  }
]

const emptyPredictions = (): Predictions => Object.fromEntries(players.map(p => [p, {}])) as Predictions

export default function HomePage() {
  const [tab, setTab] = useState<Tab>('round')
  const [roundNumber, setRoundNumber] = useState(4)
  const [player, setPlayer] = useState<Player>('Кирилл')
  const [predictions, setPredictions] = useState<Predictions>(emptyPredictions())
  const [results, setResults] = useState<Results>({})
  const [admin, setAdmin] = useState(false)

  useEffect(() => {
    const p = localStorage.getItem('rpl-predictions-v2')
    const r = localStorage.getItem('rpl-results-v2')
    if (p) setPredictions(JSON.parse(p))
    if (r) setResults(JSON.parse(r))
  }, [])

  useEffect(() => { localStorage.setItem('rpl-predictions-v2', JSON.stringify(predictions)) }, [predictions])
  useEffect(() => { localStorage.setItem('rpl-results-v2', JSON.stringify(results)) }, [results])

  const round = rounds.find(r => r.number === roundNumber)!
  const isCurrent = round.number === 4

  const getPrediction = (p: Player, match: Match) => isCurrent ? predictions[p][match.id] : match.predictions?.[p]
  const getResult = (match: Match) => isCurrent ? results[match.id] : match.result

  function setPrediction(matchId: string, side: 'home' | 'away', value: number) {
    if (!isCurrent) return
    setPredictions(prev => ({ ...prev, [player]: { ...prev[player], [matchId]: { home: prev[player][matchId]?.home ?? 0, away: prev[player][matchId]?.away ?? 0, [side]: Math.max(0, value) } } }))
  }

  function setResult(matchId: string, side: 'home' | 'away', value: number) {
    if (!isCurrent) return
    setResults(prev => ({ ...prev, [matchId]: { home: prev[matchId]?.home ?? 0, away: prev[matchId]?.away ?? 0, [side]: Math.max(0, value) } }))
  }

  const standings = useMemo(() => players.map(name => {
    let points = 0, exact = 0, outcomes = 0, made = 0
    rounds.forEach(r => r.matches.forEach(m => {
      const pred = r.number === 4 ? predictions[name][m.id] : m.predictions?.[name]
      const actual = r.number === 4 ? results[m.id] : m.result
      if (pred) made++
      if (pred && actual) {
        const pts = calculatePoints(pred, actual)
        points += pts
        if (pts === 3) exact++
        if (pts >= 1) outcomes++
      }
    }))
    return { name, points, exact, outcomes, made, average: made ? points / made : 0 }
  }).sort((a,b) => b.points - a.points || b.exact - a.exact || b.outcomes - a.outcomes), [predictions, results])

  const leader = standings[0]?.points ?? 0

  return <main>
    <header className="hero">
      <div><div className="eyebrow">⚽ Мини-лига прогнозов</div><h1>РПЛ Predictor</h1><p>Кирилл · Саша · Стас · Дима</p></div>
      <button className="ghost" onClick={() => setAdmin(v => !v)}>{admin ? 'Закрыть admin' : 'Admin'}</button>
    </header>

    <nav className="tabs">
      <button className={tab==='round'?'active':''} onClick={() => setTab('round')}>Тур</button>
      <button className={tab==='predictions'?'active':''} onClick={() => setTab('predictions')}>Прогнозы</button>
      <button className={tab==='table'?'active':''} onClick={() => setTab('table')}>Таблица</button>
    </nav>

    {tab !== 'table' && <div className="roundNav">
      <button onClick={() => setRoundNumber(n => Math.max(1,n-1))} disabled={roundNumber===1}>←</button>
      {[1,2,3,4].map(n => <button key={n} className={roundNumber===n?'active':''} onClick={() => setRoundNumber(n)}>Тур {n}</button>)}
      <button onClick={() => setRoundNumber(n => Math.min(4,n+1))} disabled={roundNumber===4}>→</button>
    </div>}

    {tab === 'round' && <section>
      <div className="sectionHead"><div><span>{isCurrent ? 'Текущий тур' : 'История'}</span><h2>Тур {round.number}</h2></div>{!isCurrent && <div className="locked">✓ завершён</div>}</div>
      {isCurrent && <div className="players">{players.map(p => <button key={p} className={player===p?'selected':''} onClick={() => setPlayer(p)}>{p}</button>)}</div>}
      <div className="cards">{round.matches.map(match => {
        const score = getPrediction(player, match) ?? { home: 0, away: 0 }
        const actual = getResult(match)
        return <article className="matchCard" key={match.id}>
          <div className="teams"><strong>{match.home}</strong><span>—</span><strong>{match.away}</strong></div>
          {isCurrent ? <div className="scoreControls">
            <div className="teamControl"><button onClick={() => setPrediction(match.id,'home',score.home-1)}>−</button><div className="score">{score.home}</div><button onClick={() => setPrediction(match.id,'home',score.home+1)}>+</button></div>
            <span className="colon">:</span>
            <div className="teamControl"><button onClick={() => setPrediction(match.id,'away',score.away-1)}>−</button><div className="score">{score.away}</div><button onClick={() => setPrediction(match.id,'away',score.away+1)}>+</button></div>
          </div> : <div className="historyScore"><span>{actual?.home}</span><b>:</b><span>{actual?.away}</span></div>}
          {!isCurrent && <div className="historyHint">Фактический счёт</div>}
          {admin && isCurrent && <div className="adminBox"><span>Факт</span><input type="number" min="0" value={actual?.home ?? 0} onChange={e => setResult(match.id,'home',Number(e.target.value))}/><b>:</b><input type="number" min="0" value={actual?.away ?? 0} onChange={e => setResult(match.id,'away',Number(e.target.value))}/></div>}
        </article>
      })}</div>
      {isCurrent && <button className="primary" onClick={() => alert(`Прогнозы ${player} сохранены`)}>Сохранить прогнозы</button>}
    </section>}

    {tab === 'predictions' && <section>
      <div className="sectionHead"><div><span>Все участники</span><h2>Прогнозы · Тур {round.number}</h2></div></div>
      <div className="matrix">{round.matches.map(match => {
        const actual = getResult(match)
        return <div className="matrixBlock" key={match.id}>
          <h3>{match.home} — {match.away}{actual && <em>{actual.home}:{actual.away}</em>}</h3>
          {players.map(p => {
            const pred = getPrediction(p, match)
            const pts = pred && actual ? calculatePoints(pred, actual) : null
            return <div className="matrixRow" key={p}><span>{p}</span><strong>{pred ? `${pred.home}:${pred.away}` : '—'}</strong><i className={pts===3?'p3':pts===1?'p1':'p0'}>{pts===null?'':`+${pts}`}</i></div>
          })}
        </div>})}</div>
    </section>}

    {tab === 'table' && <section>
      <div className="sectionHead"><div><span>После 3 завершённых туров</span><h2>Общий зачёт</h2></div></div>
      <div className="standings">
        <div className="tr head"><span>#</span><span>Участник</span><span>Очки</span><span>Точные</span><span>Исходы</span><span>Отст.</span></div>
        {standings.map((s, i) => <div className="tr" key={s.name}><span>{i+1}</span><strong>{s.name}</strong><b>{s.points}</b><span>{s.exact}</span><span>{s.outcomes}</span><span>{leader-s.points}</span></div>)}
      </div>
      <div className="summaryCards">{standings.map(s => <div className="summaryCard" key={s.name}><strong>{s.name}</strong><span>{s.made} прогнозов</span><b>{s.average.toFixed(2)} очка / прогноз</b></div>)}</div>
    </section>}
  </main>
}
