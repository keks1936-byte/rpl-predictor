'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { calculatePoints, Score } from '../lib/scoring'

const SUPABASE_URL='https://imjzkiwgkvrxafqweeei.supabase.co'
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltanpraXdna3ZyeGFmcXdlZWVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTY4MTQsImV4cCI6MjEwMjEzMjgxNH0.Iii9aQqBAMBAk7ru5rD0VDpLXro6ZERSoBZgL0t2gbQ'
const headers={apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${SUPABASE_ANON_KEY}`}

type Tab='round'|'predictions'|'table'
type Player={id:string;name:string;sort_order:number}
type Round={id:string;round_number:number;status:'upcoming'|'open'|'locked'|'finished'}
type Match={id:string;round_id:string;home_team:string;away_team:string;home_score:number|null;away_score:number|null}
type PredictionRow={match_id:string;player_id:string;home_score:number;away_score:number}
type Drafts=Record<string,Score>

const fotmob=(id:number)=>`https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`
const logoByTeam:Record<string,string>={
  'локомотив':'https://logotyp.us/file/lokomotiv-moscow.svg',
  'локомотив москва':'https://logotyp.us/file/lokomotiv-moscow.svg',
  'локо':'https://logotyp.us/file/lokomotiv-moscow.svg',
  'зенит':'https://logotyp.us/file/zenit.svg',
  'динамо':'https://logotyp.us/file/dynamo.svg',
  'динамо москва':'https://logotyp.us/file/dynamo.svg',
  'динамо м':'https://logotyp.us/file/dynamo.svg',
  'оренбург':'https://logotyp.us/file/orenburg.svg',
  'краснодар':'https://logotyp.us/file/krasnodar.svg',
  'рубин':'https://logotyp.us/file/rubin-kazan.svg',
  'рубин казань':'https://logotyp.us/file/rubin-kazan.svg',
  'цска':'https://logotyp.us/file/cska-moscow.svg',
  'цска москва':'https://logotyp.us/file/cska-moscow.svg',
  'ростов':'https://logotyp.us/file/rostov.svg',
  'балтика':'https://assets.football-logos.cc/logos/russia/1500x1500/baltika.b4c4f0b4.png',
  'ахмат':fotmob(8708),
  'ахмат грозный':fotmob(8708),
  'крылья советов':fotmob(8709),
  'крылья':fotmob(8709),
  'крылья советов самара':fotmob(8709),
  'акрон':fotmob(1068364),
  'акрон тольятти':fotmob(1068364),
  'факел':fotmob(1692),
  'факел воронеж':fotmob(1692),
  'динамо махачкала':fotmob(1068353),
  'динамо мх':fotmob(1068353),
  'динамо (махачкала)':fotmob(1068353),
  'родина':fotmob(1066681),
  'родина москва':fotmob(1066681),
}
function teamKey(name:string){return name.toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim()}
function initials(name:string){return name.replace(/[()]/g,'').split(/\s+/).filter(Boolean).map(x=>x[0]).join('').slice(0,2).toUpperCase()}
function TeamBadge({name,size='normal'}:{name:string;size?:'small'|'normal'}){
  const key=teamKey(name)
  const src=logoByTeam[key]
  const [failed,setFailed]=useState(false)
  if(key==='спартак'||key==='спартак москва')return <span className={`teamEmoji ${size}`} role="img" aria-label="Спартак">🐷</span>
  if(!src||failed)return <span className={`teamFallback ${size}`}>{initials(name)}</span>
  return <img className={`teamLogo ${size}`} src={src} alt={`Логотип ${name}`} loading="lazy" onError={()=>setFailed(true)}/>
}
function TeamName({name,side}:{name:string;side:'home'|'away'}){
  return <div className={`teamName ${side}`}><TeamBadge name={name}/><strong>{name}</strong></div>
}

async function api<T>(path:string,init?:RequestInit):Promise<T>{const res=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{...init,headers:{...headers,...(init?.headers||{})}});const text=await res.text();if(!res.ok)throw new Error(text||`HTTP ${res.status}`);if(!text)return undefined as T;return JSON.parse(text)as T}

export default function HomePage(){
  const[tab,setTab]=useState<Tab>('round'),[players,setPlayers]=useState<Player[]>([]),[rounds,setRounds]=useState<Round[]>([]),[matches,setMatches]=useState<Match[]>([]),[predictionRows,setPredictionRows]=useState<PredictionRow[]>([])
  const[roundNumber,setRoundNumber]=useState(4),[playerId,setPlayerId]=useState(''),[drafts,setDrafts]=useState<Drafts>({}),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[message,setMessage]=useState('')

  const loadData=useCallback(async()=>{try{const[p,r,m,pr]=await Promise.all([api<Player[]>('players?select=id,name,sort_order&order=sort_order.asc'),api<Round[]>('rounds?select=id,round_number,status&order=round_number.asc'),api<Match[]>('matches?select=id,round_id,home_team,away_team,home_score,away_score&order=created_at.asc'),api<PredictionRow[]>('predictions?select=match_id,player_id,home_score,away_score')]);setPlayers(p);setRounds(r);setMatches(m);setPredictionRows(pr);const current=r.find(x=>x.status==='open')||r[r.length-1];if(current)setRoundNumber(current.round_number);if(!playerId&&p[0])setPlayerId(p[0].id)}catch(e){console.error(e);setMessage('Не удалось загрузить данные')}finally{setLoading(false)}},[playerId])
  useEffect(()=>{loadData()},[loadData])

  const selectedRound=rounds.find(r=>r.round_number===roundNumber),isCurrent=selectedRound?.status==='open',roundMatches=matches.filter(m=>m.round_id===selectedRound?.id),selectedPlayer=players.find(p=>p.id===playerId)
  useEffect(()=>{if(!playerId||!isCurrent)return;const next:Drafts={};for(const m of roundMatches){const row=predictionRows.find(p=>p.player_id===playerId&&p.match_id===m.id);next[m.id]=row?{home:row.home_score,away:row.away_score}:{home:0,away:0}}setDrafts(next)},[playerId,roundNumber,isCurrent,predictionRows,matches])

  const getPrediction=(pid:string,matchId:string):Score|undefined=>{if(isCurrent&&pid===playerId&&drafts[matchId])return drafts[matchId];const row=predictionRows.find(p=>p.player_id===pid&&p.match_id===matchId);return row?{home:row.home_score,away:row.away_score}:undefined}
  const getResult=(m:Match):Score|undefined=>m.home_score===null||m.away_score===null?undefined:{home:m.home_score,away:m.away_score}
  function changeScore(matchId:string,side:'home'|'away',delta:number){const current=drafts[matchId]||{home:0,away:0};setDrafts(prev=>({...prev,[matchId]:{...current,[side]:Math.max(0,current[side]+delta)}}))}
  async function savePredictions(){if(!isCurrent||!playerId)return;setSaving(true);setMessage('');try{const payload=roundMatches.map(m=>({match_id:m.id,player_id:playerId,home_score:drafts[m.id]?.home??0,away_score:drafts[m.id]?.away??0}));await api('predictions?on_conflict=match_id,player_id',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(payload)});setPredictionRows(await api<PredictionRow[]>('predictions?select=match_id,player_id,home_score,away_score'));setMessage(`✓ Прогнозы ${selectedPlayer?.name} сохранены в общей базе`)}catch(e){console.error(e);setMessage('Ошибка сохранения')}finally{setSaving(false)}}

  const standings=useMemo(()=>players.map(player=>{let points=0,exact=0,outcomes=0,made=0;for(const m of matches){const actual=getResult(m);if(!actual)continue;const row=predictionRows.find(p=>p.player_id===player.id&&p.match_id===m.id);if(!row)continue;made++;const pts=calculatePoints({home:row.home_score,away:row.away_score},actual);points+=pts;if(pts===3)exact++;if(pts>=1)outcomes++}return{...player,points,exact,outcomes,made,average:made?points/made:0}}).sort((a,b)=>b.points-a.points||b.exact-a.exact||b.outcomes-a.outcomes),[players,matches,predictionRows])
  const leader=standings[0]?.points??0,completedMatches=matches.filter(m=>getResult(m)).length
  if(loading)return <main><div className="sectionHead"><div><span>Подключаемся к базе</span><h2>РПЛ Predictor</h2></div></div></main>

  return <main>
    <header className="hero"><div><div className="eyebrow">⚽ Мини-лига прогнозов · Supabase live</div><h1>РПЛ Predictor</h1><p>{players.map(p=>p.name).join(' · ')}</p></div></header>
    <nav className="tabs"><button className={tab==='round'?'active':''} onClick={()=>setTab('round')}>Тур</button><button className={tab==='predictions'?'active':''} onClick={()=>setTab('predictions')}>Прогнозы</button><button className={tab==='table'?'active':''} onClick={()=>setTab('table')}>Таблица</button></nav>
    {tab!=='table'&&<div className="roundNav"><button className="arrow" onClick={()=>setRoundNumber(n=>Math.max(rounds[0]?.round_number||1,n-1))} disabled={roundNumber===rounds[0]?.round_number}>←</button>{rounds.map(r=><button key={r.id} className={roundNumber===r.round_number?'active':''} onClick={()=>setRoundNumber(r.round_number)}>{r.round_number}<span>тур</span></button>)}<button className="arrow" onClick={()=>setRoundNumber(n=>Math.min(rounds[rounds.length-1]?.round_number||n,n+1))} disabled={roundNumber===rounds[rounds.length-1]?.round_number}>→</button></div>}

    {tab==='round'&&selectedRound&&<section>
      <div className="sectionHead"><div><span>{isCurrent?'Текущий тур':'Завершённый тур'}</span><h2>Тур {selectedRound.round_number}</h2></div>{!isCurrent&&<div className="locked">✓ завершён</div>}</div>
      {isCurrent&&<div className="players">{players.map(p=><button key={p.id} className={playerId===p.id?'selected':''} onClick={()=>setPlayerId(p.id)}>{p.name}</button>)}</div>}
      <div className="cards">{roundMatches.map(match=>{const score=getPrediction(playerId,match.id)??{home:0,away:0},actual=getResult(match);return <article className="matchCard" key={match.id}>
        <div className="teams"><TeamName name={match.home_team} side="home"/><span>—</span><TeamName name={match.away_team} side="away"/></div>
        {isCurrent?<div className="scoreControls"><div className="teamControl"><button onClick={()=>changeScore(match.id,'home',-1)}>−</button><div className="score">{score.home}</div><button onClick={()=>changeScore(match.id,'home',1)}>+</button></div><span className="colon">:</span><div className="teamControl"><button onClick={()=>changeScore(match.id,'away',-1)}>−</button><div className="score">{score.away}</div><button onClick={()=>changeScore(match.id,'away',1)}>+</button></div></div>:<div className="historyScore"><span>{actual?.home}</span><b>:</b><span>{actual?.away}</span></div>}
        {!isCurrent&&<div className="historyHint">Фактический счёт</div>}
      </article>})}</div>
      {isCurrent&&<button className="primary" disabled={saving} onClick={savePredictions}>{saving?'Сохраняем…':`Сохранить прогнозы · ${selectedPlayer?.name||''}`}</button>}{message&&<div className="historyHint" style={{marginTop:10}}>{message}</div>}
    </section>}

    {tab==='predictions'&&selectedRound&&<section>
      <div className="sectionHead"><div><span>{isCurrent?'Текущий тур':'Завершённый тур'}</span><h2>Прогнозы · Тур {selectedRound.round_number}</h2></div></div>
      <div className="matrix">{roundMatches.map(match=>{const actual=getResult(match);return <div className="matrixBlock" key={match.id}><h3><span className="matrixTeams"><TeamBadge name={match.home_team} size="small"/>{match.home_team}<span>—</span><TeamBadge name={match.away_team} size="small"/>{match.away_team}</span>{actual&&<em>{actual.home}:{actual.away}</em>}</h3>{players.map(p=>{const pred=getPrediction(p.id,match.id),pts=pred&&actual?calculatePoints(pred,actual):null;return <div className="matrixRow" key={p.id}><span>{p.name}</span><strong>{pred?`${pred.home}:${pred.away}`:'—'}</strong><i className={pts===3?'p3':pts===1?'p1':'p0'}>{pts===null?'':`+${pts}`}</i></div>})}</div>})}</div>
    </section>}

    {tab==='table'&&<section><div className="sectionHead"><div><span>{completedMatches} завершённых матчей</span><h2>Общий зачёт</h2></div></div><div className="standings"><div className="tr head"><span>#</span><span>Участник</span><span>Очки</span><span>Точные</span><span>Исходы</span><span>Отст.</span></div>{standings.map((s,i)=><div className="tr" key={s.id}><span>{i+1}</span><strong>{s.name}</strong><b>{s.points}</b><span>{s.exact}</span><span>{s.outcomes}</span><span>{leader-s.points}</span></div>)}</div><div className="summaryCards">{standings.map(s=><div className="summaryCard" key={s.id}><strong>{s.name}</strong><span>{s.made} прогнозов</span><b>{s.average.toFixed(2)} очка / прогноз</b></div>)}</div></section>}
  </main>
}
