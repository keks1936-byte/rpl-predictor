'use client'

import { useEffect, useMemo, useState } from 'react'
import { calculatePoints, Score } from '../lib/scoring'

const players = ['Кирилл', 'Саша', 'Стас', 'Дима'] as const
const matches = [
  { id: 'm1', home: 'Локомотив', away: 'Спартак' },
  { id: 'm2', home: 'Динамо', away: 'ЦСКА' },
  { id: 'm3', home: 'Краснодар', away: 'Зенит' }
]

type Player = typeof players[number]
type Predictions = Record<Player, Record<string, Score>>
type Results = Record<string, Score>

const emptyPredictions = (): Predictions => Object.fromEntries(players.map(p => [p, {}])) as Predictions

export default function HomePage() {
  const [tab, setTab] = useState<'round' | 'predictions' | 'table'>('round')
  const [player, setPlayer] = useState<Player>('Кирилл')
  const [predictions, setPredictions] = useState<Predictions>(emptyPredictions())
  const [results, setResults] = useState<Results>({})
  const [admin, setAdmin] = useState(false)

  useEffect(() => {
    const p = localStorage.getItem('rpl-predictions')
    const r = localStorage.getItem('rpl-results')
    if (p) setPredictions(JSON.parse(p))
    if (r) setResults(JSON.parse(r))
  }, [])

  useEffect(() => {
    localStorage.setItem('rpl-predictions', JSON.stringify(predictions))
  }, [predictions])

  useEffect(() => {
    localStorage.setItem('rpl-results', JSON.stringify(results))
  }, [results])

  function setPrediction(matchId: string, side: 'home' | 'away', value: number) {
    setPredictions(prev => ({
      ...prev,
      [player]: {
        ...prev[player],
        [matchId]: {
          home: prev[player][matchId]?.home ?? 0,
          away: prev[player][matchId]?.away ?? 0,
          [side]: Math.max(0, value)
        }
      }
    }))
  }

  function setResult(matchId: string, side: 'home' | 'away', value: number) {
    setResults(prev => ({
      ...prev,
      [matchId]: {
        home: prev[matchId]?.home ?? 0,
        away: prev[matchId]?.away ?? 0,
        [side]: Math.max(0, value)
      }
    }))
  }

  const standings = useMemo(() => players.map(name => {
    let points = 0, exact = 0, outcomes = 0, made = 0
    matches.forEach(m => {
      const pred = predictions[name][m.id]
      const actual = results[m.id]
      if (pred) made++
      if (pred && actual) {
        const pts = calculatePoints(pred, actual)
        points += pts
        if (pts === 3) exact++
        if (pts >= 1) outcomes++
      }
    })
    return { name, points, exact, outcomes, made }
  }).sort((a,b) => b.points - a.points || b.exact - a.exact), [predictions, results])

  const leader = standings[0]?.points ?? 0

  return <main>
    <header className="hero">
      <div>
        <div className="eyebrow">⚽ Мини-лига прогнозов</div>
        <h1>РПЛ Predictor</h1>
        <p>Кирилл · Саша · Стас · Дима</p>
      </div>
      <button className="ghost" onClick={() => setAdmin(v => !v)}>{admin ? 'Закрыть admin' : 'Admin'}</button>
    </header>

    <nav className="tabs">
      <button className={tab==='round'?'active':''} onClick={() => setTab('round')}>Тур</button>
      <button className={tab==='predictions'?'active':''} onClick={() => setTab('predictions')}>Прогнозы</button>
      <button className={tab==='table'?'active':''} onClick={() => setTab('table')}>Таблица</button>
    </nav>

    {tab === 'round' && <section>
      <div className="sectionHead"><div><span>Текущий тур</span><h2>Тур 4</h2></div></div>
      <div className="players">{players.map(p => <button key={p} className={player===p?'selected':''} onClick={() => setPlayer(p)}>{p}</button>)}</div>
      <div className="cards">{matches.map(match => {
        const score = predictions[player][match.id] ?? { home: 0, away: 0 }
        const actual = results[match.id]
        return <article className="matchCard" key={match.id}>
          <div className="teams"><strong>{match.home}</strong><span>—</span><strong>{match.away}</strong></div>
          <div className="scoreRow">
            <button onClick={() => setPrediction(match.id,'home',score.home-1)}>−</button>
            <div className="score">{score.home}</div>
            <span>:</span>
            <div className="score">{score.away}</div>
            <button onClick={() => setPrediction(match.id,'away',score.away+1)}>+</button>
          </div>
          <div className="quick">
            <button onClick={() => setPrediction(match.id,'home',score.home+1)}>+ хозяева</button>
            <button onClick={() => setPrediction(match.id,'away',score.away-1)}>− гости</button>
          </div>
          {admin && <div className="adminBox">
            <span>Факт</span>
            <input type="number" min="0" value={actual?.home ?? 0} onChange={e => setResult(match.id,'home',Number(e.target.value))}/>
            <b>:</b>
            <input type="number" min="0" value={actual?.away ?? 0} onChange={e => setResult(match.id,'away',Number(e.target.value))}/>
          </div>}
        </article>
      })}</div>
      <button className="primary" onClick={() => alert(`Прогнозы ${player} сохранены`)}>Сохранить прогнозы</button>
    </section>}

    {tab === 'predictions' && <section>
      <div className="sectionHead"><div><span>Все участники</span><h2>Прогнозы тура</h2></div></div>
      <div className="matrix">
        {matches.map(match => <div className="matrixBlock" key={match.id}>
          <h3>{match.home} — {match.away}{results[match.id] && <em>{results[match.id].home}:{results[match.id].away}</em>}</h3>
          {players.map(p => {
            const pred = predictions[p][match.id]
            const pts = pred && results[match.id] ? calculatePoints(pred, results[match.id]) : null
            return <div className="matrixRow" key={p}><span>{p}</span><strong>{pred ? `${pred.home}:${pred.away}` : '—'}</strong><i className={pts===3?'p3':pts===1?'p1':'p0'}>{pts===null?'':`+${pts}`}</i></div>
          })}
        </div>)}
      </div>
    </section>}

    {tab === 'table' && <section>
      <div className="sectionHead"><div><span>После текущего тура</span><h2>Таблица</h2></div></div>
      <div className="standings">
        <div className="tr head"><span>#</span><span>Участник</span><span>Очки</span><span>Точные</span><span>Исходы</span><span>Отст.</span></div>
        {standings.map((s, i) => <div className="tr" key={s.name}>
          <span>{i+1}</span><strong>{s.name}</strong><b>{s.points}</b><span>{s.exact}</span><span>{s.outcomes}</span><span>{leader-s.points}</span>
        </div>)}
      </div>
    </section>}
  </main>
}
