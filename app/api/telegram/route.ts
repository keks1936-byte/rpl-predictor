import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL = 'https://imjzkiwgkvrxafqweeei.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltanpraXdna3ZyeGFmcXdlZWVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTY4MTQsImV4cCI6MjEwMjEzMjgxNH0.Iii9aQqBAMBAk7ru5rD0VDpLXro6ZERSoBZgL0t2gbQ'
const BOT_USERNAME = 'fantasy_rpl_bot'

type TgUser = { id:number; username?:string }
type TgMessage = { message_id:number; chat:{ id:number; type?:string }; from?:TgUser; text?:string }
type TgCallback = { id:string; from:TgUser; data?:string; message?:TgMessage }
type TgUpdate = { message?:TgMessage; callback_query?:TgCallback }
type Player = { id:string; name:string; sort_order:number; telegram_user_id:number|null; telegram_username?:string|null; is_admin:boolean }
type Round = { id:string; round_number:number; status:string; predictions_revealed?:boolean; deadline_at?:string|null; summary_sent_at?:string|null }
type Match = { id:string; round_id:string; home_team:string; away_team:string; home_score:number|null; away_score:number|null }
type Prediction = { match_id:string; player_id:string; home_score:number; away_score:number }
type BotSession = { telegram_user_id:number; flow:string; step:string; data:Record<string,any> }
type Standing = { player:Player; total:number; exact:number; correct:number; forecasts:number }

const dbHeaders = { apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${SUPABASE_ANON_KEY}` }
const isPrivate = (m:TgMessage) => m.chat.type === 'private'
const isGroup = (m:TgMessage) => m.chat.type === 'group' || m.chat.type === 'supergroup'
const normalizeSecret = (v:string) => v.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,256)

async function db<T>(path:string, init?:RequestInit):Promise<T>{
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers:{ ...dbHeaders, ...(init?.headers||{}) }, cache:'no-store' })
  if(!r.ok) throw new Error(await r.text())
  if(r.status===204) return undefined as T
  const t=await r.text()
  return (t?JSON.parse(t):undefined) as T
}
function token(){ const t=process.env.TELEGRAM_BOT_TOKEN; if(!t) throw new Error('TELEGRAM_BOT_TOKEN missing'); return t }
async function tg(method:string,payload:Record<string,unknown>){
  const r=await fetch(`https://api.telegram.org/bot${token()}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
  if(!r.ok) throw new Error(await r.text())
  return r.json()
}
const send=(chatId:number,text:string,extra:Record<string,unknown>={})=>tg('sendMessage',{chat_id:chatId,text,parse_mode:'HTML',...extra})
const edit=(chatId:number,messageId:number,text:string,extra:Record<string,unknown>={})=>tg('editMessageText',{chat_id:chatId,message_id:messageId,text,parse_mode:'HTML',...extra})
const answer=(id:string,text?:string)=>tg('answerCallbackQuery',{callback_query_id:id,...(text?{text}:{})})

const players=()=>db<Player[]>('players?select=id,name,sort_order,telegram_user_id,telegram_username,is_admin&order=sort_order.asc')
async function playerByTg(id:number){ return (await db<Player[]>(`players?select=id,name,sort_order,telegram_user_id,telegram_username,is_admin&telegram_user_id=eq.${id}&limit=1`))[0] }
async function openRound(){ return (await db<Round[]>('rounds?select=id,round_number,status,predictions_revealed,deadline_at,summary_sent_at&status=eq.open&order=round_number.asc&limit=1'))[0] }
const roundMatches=(id:string)=>db<Match[]>(`matches?select=id,round_id,home_team,away_team,home_score,away_score&round_id=eq.${id}&order=created_at.asc`)
async function prediction(playerId:string,matchId:string){ return (await db<Prediction[]>(`predictions?select=match_id,player_id,home_score,away_score&player_id=eq.${playerId}&match_id=eq.${matchId}&limit=1`))[0] }
async function upsertPrediction(playerId:string,matchId:string,h:number,a:number){ await db('predictions?on_conflict=match_id,player_id',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({match_id:matchId,player_id:playerId,home_score:Math.max(0,h),away_score:Math.max(0,a)})}) }
async function session(id:number){ return (await db<BotSession[]>(`bot_sessions?select=telegram_user_id,flow,step,data&telegram_user_id=eq.${id}&limit=1`))[0] }
async function setSession(id:number,flow:string,step:string,data:Record<string,any>){ await db('bot_sessions?on_conflict=telegram_user_id',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({telegram_user_id:id,flow,step,data,updated_at:new Date().toISOString()})}) }
const clearSession=(id:number)=>db(`bot_sessions?telegram_user_id=eq.${id}`,{method:'DELETE',headers:{Prefer:'return=minimal'}})
async function admin(id:number){ const p=await playerByTg(id); return p?.is_admin?p:undefined }

async function rememberGroupChat(m:TgMessage){
  if(!isGroup(m)) return
  await db('bot_chats?is_primary=eq.true',{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({is_primary:false,updated_at:new Date().toISOString()})})
  await db('bot_chats?on_conflict=chat_id',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({chat_id:m.chat.id,chat_type:m.chat.type||'group',is_primary:true,updated_at:new Date().toISOString()})})
}
async function primaryGroupChat(){ return (await db<{chat_id:number}[]>('bot_chats?select=chat_id&is_primary=eq.true&limit=1'))[0]?.chat_id }

function deadlineText(v?:string|null){
  if(!v) return 'не задан'
  return new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(v))+' МСК'
}
function parseMoscowDeadline(text:string){
  const m=text.trim().match(/^(\d{1,2})[.\/]?(\d{1,2})(?:[.\/]?(\d{4}))?\s+(\d{1,2})[:.](\d{2})$/)
  if(!m) return null
  const now=new Date(), year=m[3]?Number(m[3]):Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Moscow',year:'numeric'}).format(now))
  const d=Number(m[1]),mo=Number(m[2]),h=Number(m[4]),mi=Number(m[5])
  if(mo<1||mo>12||d<1||d>31||h>23||mi>59) return null
  const iso=new Date(Date.UTC(year,mo-1,d,h-3,mi))
  return isNaN(iso.getTime())?null:iso.toISOString()
}
function outcome(h:number,a:number){ return Math.sign(h-a) }
function pts(p:Prediction,m:Match){
  if(m.home_score===null||m.away_score===null) return 0
  if(p.home_score===m.home_score&&p.away_score===m.away_score) return 3
  return outcome(p.home_score,p.away_score)===outcome(m.home_score,m.away_score)?1:0
}
function outcomeLabel(value:number,m:Match){ return value>0?`победу ${m.home_team}`:value<0?`победу ${m.away_team}`:'ничью' }
function consensusLine(m:Match,ps:Player[],prs:Prediction[]){
  const picks=ps.map(p=>({p,pr:prs.find(x=>x.player_id===p.id&&x.match_id===m.id)})).filter((x):x is {p:Player;pr:Prediction}=>Boolean(x.pr))
  if(picks.length<2) return ''
  const groups=new Map<number,typeof picks>()
  for(const pick of picks){const k=outcome(pick.pr.home_score,pick.pr.away_score);groups.set(k,[...(groups.get(k)||[]),pick])}
  const ranked=[...groups.entries()].sort((a,b)=>b[1].length-a[1].length)
  const [topOutcome,topPicks]=ranked[0]
  if(topPicks.length===picks.length) return `📊 Все ${picks.length}/${picks.length} ждут ${outcomeLabel(topOutcome,m)}.`
  const uniqueTop=ranked.length===1||topPicks.length>(ranked[1]?.[1].length||0)
  const base=uniqueTop&&topPicks.length>=2?`📊 ${topPicks.length}/${picks.length} ждут ${outcomeLabel(topOutcome,m)}.`:''
  if(topPicks.length===picks.length-1&&ranked.length===2&&ranked[1][1].length===1){
    const outsider=ranked[1][1][0]
    const outsiderOutcome=outcome(outsider.pr.home_score,outsider.pr.away_score)
    return `${base}${base?' ':''}🧍 ${outsider.p.name} единственный ставит на ${outcomeLabel(outsiderOutcome,m)}.`
  }
  return base
}

function calculateStandings(ps:Player[],ms:Match[],prs:Prediction[],excludeRoundId?:string):Standing[]{
  return ps.map(p=>{
    let total=0,exact=0,correct=0,forecasts=0
    for(const m of ms){
      if(excludeRoundId&&m.round_id===excludeRoundId) continue
      if(m.home_score===null||m.away_score===null) continue
      const pr=prs.find(x=>x.player_id===p.id&&x.match_id===m.id)
      if(!pr) continue
      forecasts++
      const n=pts(pr,m);total+=n
      if(n===3) exact++
      if(n>0) correct++
    }
    return {player:p,total,exact,correct,forecasts}
  }).sort((a,b)=>b.total-a.total||b.exact-a.exact||a.player.sort_order-b.player.sort_order)
}
async function standingsRows(){
  const [ps,ms,prs]=await Promise.all([players(),db<Match[]>('matches?select=id,round_id,home_team,away_team,home_score,away_score'),db<Prediction[]>('predictions?select=match_id,player_id,home_score,away_score')])
  return calculateStandings(ps,ms,prs)
}
async function tableText(){
  const rows=await standingsRows()
  return ['🏆 <b>Общий зачёт</b>','',...rows.map((r,i)=>`${i+1}. <b>${r.player.name}</b> — ${r.total} очк. 🎯 ${r.exact}`)].join('\n')
}
async function roundText(){
  const r=await openRound(); if(!r) return 'Сейчас нет открытого тура.'
  const ms=await roundMatches(r.id)
  return [`⚽ <b>Тур ${r.round_number}</b>`,'',...ms.map((m,i)=>`${i+1}. ${m.home_team} — ${m.away_team}`),'',`⏰ Дедлайн: <b>${deadlineText(r.deadline_at)}</b>`].join('\n')
}
async function statusText(isAdminUser=false){
  const r=await openRound(); if(!r) return 'Сейчас нет открытого тура.'
  const [ps,ms,prs]=await Promise.all([players(),roundMatches(r.id),db<Prediction[]>('predictions?select=match_id,player_id,home_score,away_score')])
  const ids=new Set(ms.map(m=>m.id))
  const lines=ps.map(p=>{const n=prs.filter(x=>x.player_id===p.id&&ids.has(x.match_id)).length;return `${n===ms.length?'✅':'⏳'} ${p.name} — ${n}/${ms.length}`})
  const results=ms.filter(m=>m.home_score!==null&&m.away_score!==null).length
  const base=[`📋 <b>Тур ${r.round_number}</b>`,'',...lines,'',`⏰ ${deadlineText(r.deadline_at)}`,r.predictions_revealed?'🔓 Прогнозы раскрыты':'🔒 Счета скрыты']
  if(isAdminUser) base.push(`🧾 Результаты: ${results}/${ms.length}`)
  return base.join('\n')
}
async function predictionsText(){
  const r=await openRound(); if(!r) return 'Сейчас нет открытого тура.'
  if(!r.predictions_revealed) return '🔒 Прогнозы пока скрыты.'
  const [ps,ms,prs]=await Promise.all([players(),roundMatches(r.id),db<Prediction[]>('predictions?select=match_id,player_id,home_score,away_score')])
  const out=[`🔓 <b>Прогнозы · Тур ${r.round_number}</b>`]
  for(const m of ms){
    const forecastLine=ps.map(p=>{const pr=prs.find(x=>x.player_id===p.id&&x.match_id===m.id);return `${p.name} <b>${pr?`${pr.home_score}:${pr.away_score}`:'—'}</b>`}).join(' · ')
    out.push('',`⚽ <b>${m.home_team} — ${m.away_team}</b>`,forecastLine)
    const consensus=consensusLine(m,ps,prs);if(consensus)out.push(consensus)
  }
  return out.join('\n')
}
async function statsText(p:Player){
  const [rounds,allMatches,prs]=await Promise.all([db<Round[]>('rounds?select=id,round_number,status,predictions_revealed,deadline_at,summary_sent_at&order=round_number.asc'),db<Match[]>('matches?select=id,round_id,home_team,away_team,home_score,away_score'),db<Prediction[]>('predictions?select=match_id,player_id,home_score,away_score')])
  let total=0,exact=0,correct=0,forecasts=0,wins=0
  const ps=await players()
  for(const m of allMatches){if(m.home_score===null||m.away_score===null)continue;const pr=prs.find(x=>x.player_id===p.id&&x.match_id===m.id);if(!pr)continue;forecasts++;const n=pts(pr,m);total+=n;if(n===3)exact++;if(n>0)correct++}
  for(const r of rounds.filter(x=>x.status==='finished')){
    const ms=allMatches.filter(m=>m.round_id===r.id&&m.home_score!==null&&m.away_score!==null);if(!ms.length)continue
    const scores=ps.map(pl=>({id:pl.id,score:ms.reduce((s,m)=>{const pr=prs.find(x=>x.player_id===pl.id&&x.match_id===m.id);return s+(pr?pts(pr,m):0)},0)}))
    const best=Math.max(...scores.map(x=>x.score));if(scores.find(x=>x.id===p.id)?.score===best)wins++
  }
  const avg=forecasts?total/forecasts:0
  return [`📊 <b>${p.name} · статистика</b>`,'',`Очки: <b>${total}</b>`,`🎯 Точных счетов: <b>${exact}</b>`,`✅ Угаданных исходов: <b>${correct}</b>`,`🥇 Побед в турах: <b>${wins}</b>`,`Прогнозов: ${forecasts}`,`Среднее: <b>${avg.toFixed(2)}</b> очка / прогноз`].join('\n')
}
async function roundSummaryText(roundId:string){
  const r=(await db<Round[]>(`rounds?select=id,round_number,status,predictions_revealed,deadline_at,summary_sent_at&id=eq.${roundId}&limit=1`))[0]
  const [ps,ms,prs,allMatches]=await Promise.all([players(),roundMatches(roundId),db<Prediction[]>('predictions?select=match_id,player_id,home_score,away_score'),db<Match[]>('matches?select=id,round_id,home_team,away_team,home_score,away_score')])
  const rows=ps.map(p=>{let score=0,exact=0;for(const m of ms){const pr=prs.find(x=>x.player_id===p.id&&x.match_id===m.id);if(!pr)continue;const n=pts(pr,m);score+=n;if(n===3)exact++}return{p,score,exact}}).sort((a,b)=>b.score-a.score||b.exact-a.exact||a.p.sort_order-b.p.sort_order)
  const best=rows[0]?.score??0
  const winners=rows.filter(x=>x.score===best).map(x=>x.p.name)
  const overall=calculateStandings(ps,allMatches,prs)
  const previous=calculateStandings(ps,allMatches,prs,roundId)
  const prevPositions=new Map(previous.map((x,i)=>[x.player.id,i+1]))
  const hadPreviousResults=allMatches.some(m=>m.round_id!==roundId&&m.home_score!==null&&m.away_score!==null)
  const movement=(playerId:string,newPos:number)=>{
    if(!hadPreviousResults)return'→'
    const oldPos=prevPositions.get(playerId)??newPos
    if(oldPos>newPos)return`↑${oldPos-newPos}`
    if(oldPos<newPos)return`↓${newPos-oldPos}`
    return'→'
  }
  const resultLines=ms.map(m=>`⚽ ${m.home_team} <b>${m.home_score}:${m.away_score}</b> ${m.away_team}`)
  return [`🏁 <b>Тур ${r.round_number} завершён</b>`,'',...resultLines,'',`${winners.length>1?'🤝 Победители тура':'🥇 Победитель тура'}: <b>${winners.join(' · ')}</b> — ${best} очк.`,'',...rows.map((x,i)=>`${i+1}. ${x.p.name} — <b>+${x.score}</b>${x.exact?` · 🎯${x.exact}`:''}`),'','🏆 <b>Общий зачёт</b>',...overall.map((x,i)=>`${i+1}. ${movement(x.player.id,i+1)} <b>${x.player.name}</b> — ${x.total}`)].join('\n')
}
async function publishRoundSummary(roundId:string,currentChat:number){
  const r=(await db<Round[]>(`rounds?select=id,round_number,status,predictions_revealed,deadline_at,summary_sent_at&id=eq.${roundId}&limit=1`))[0]
  if(r?.summary_sent_at)return
  const text=await roundSummaryText(roundId),group=await primaryGroupChat()
  if(group&&group!==currentChat){try{await send(group,text)}catch{}}
  await send(currentChat,text)
  await db(`rounds?id=eq.${roundId}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({summary_sent_at:new Date().toISOString()})})
}

async function bindPrompt(chatId:number){const ps=(await players()).filter(p=>!p.telegram_user_id);if(!ps.length){await send(chatId,'Все участники уже привязаны.');return}await send(chatId,'👤 <b>Кто ты?</b>\nВыбери один раз:',{reply_markup:{inline_keyboard:ps.map(p=>[{text:p.name,callback_data:`bind:${p.id}`}])}})}
async function bindPlayer(id:string,u:TgUser){await db('rpc/bind_telegram_player',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_player_id:id,p_telegram_user_id:u.id,p_telegram_username:u.username||null})})}
async function predictionView(p:Player,index:number){
  const r=await openRound();if(!r)return{text:'Сейчас нет открытого тура.',markup:{inline_keyboard:[]}}
  if(r.predictions_revealed||(r.deadline_at&&new Date(r.deadline_at)<=new Date()))return{text:'🔒 Приём прогнозов завершён.',markup:{inline_keyboard:[]}}
  const ms=await roundMatches(r.id);index=Math.max(0,Math.min(index,ms.length-1));const m=ms[index],pr=await prediction(p.id,m.id),h=pr?.home_score??0,a=pr?.away_score??0
  const rows:any[]=[[{text:'−',callback_data:`sc:${index}:h:-`},{text:`${m.home_team}: ${h}`,callback_data:'noop'},{text:'+',callback_data:`sc:${index}:h:+`}],[{text:'−',callback_data:`sc:${index}:a:-`},{text:`${m.away_team}: ${a}`,callback_data:'noop'},{text:'+',callback_data:`sc:${index}:a:+`}]],nav:any[]=[]
  if(index>0)nav.push({text:'← Назад',callback_data:`go:${index-1}`});if(index<ms.length-1)nav.push({text:'Далее →',callback_data:`go:${index+1}`});else nav.push({text:'✅ Готово',callback_data:'done'});rows.push(nav)
  return{text:`🔮 <b>Тур ${r.round_number} · ${p.name}</b>\n⏰ ${deadlineText(r.deadline_at)}\n\nМатч ${index+1} из ${ms.length}\n<b>${m.home_team} — ${m.away_team}</b>\n\nТекущий прогноз: <b>${h}:${a}</b>`,markup:{inline_keyboard:rows}}
}
async function ensureAll(p:Player){const r=await openRound();if(!r||r.predictions_revealed)return;for(const m of await roundMatches(r.id)){if(!await prediction(p.id,m.id))await upsertPrediction(p.id,m.id,0,0)}}
async function summary(p:Player){const r=await openRound();if(!r)return'Нет открытого тура.';const lines=[];for(const m of await roundMatches(r.id)){const pr=await prediction(p.id,m.id);lines.push(`${m.home_team} — ${m.away_team}: <b>${pr?.home_score??0}:${pr?.away_score??0}</b>`)}return[`✅ <b>${p.name}, прогнозы на Тур ${r.round_number} сохранены</b>`,'',...lines,'',`⏰ Изменения до ${deadlineText(r.deadline_at)}`].join('\n')}
async function handlePredict(chatId:number,u:TgUser){const p=await playerByTg(u.id);if(!p){await bindPrompt(chatId);return}const v=await predictionView(p,0);await send(chatId,v.text,{reply_markup:v.markup})}

async function startNewRound(chatId:number,u:TgUser){if(!await admin(u.id)){await send(chatId,'⛔ Только для администратора.');return}const rs=await db<Round[]>('rounds?select=id,round_number,status&order=round_number.desc&limit=1'),n=(rs[0]?.round_number||0)+1;await setSession(u.id,'newround','home_1',{round_number:n,matches:[]});await send(chatId,`🛠 <b>Создаём Тур ${n}</b>\n\nМатч 1 из 3. Введи <b>хозяев</b>:`)}
async function handleNewRoundText(chatId:number,u:TgUser,text:string,s:BotSession){
  const d=s.data||{},ms:Array<{home:string;away:string}>=d.matches||[]
  if(s.step==='deadline'){const deadline=parseMoscowDeadline(text);if(!deadline||new Date(deadline)<=new Date()){await send(chatId,'Не понял дату или она уже прошла. Пришли в формате <b>15.08 17:00</b> (московское время).');return true}d.deadline_at=deadline;await setSession(u.id,'newround','confirm',d);await send(chatId,[`📋 <b>Тур ${d.round_number}</b>`,'',...ms.map((x,j)=>`${j+1}. ${x.home} — ${x.away}`),'',`⏰ Дедлайн: <b>${deadlineText(deadline)}</b>`].join('\n'),{reply_markup:{inline_keyboard:[[{text:'✅ Сохранить тур',callback_data:'admin:save_round'}],[{text:'❌ Отмена',callback_data:'admin:cancel'}]]}});return true}
  const mm=s.step.match(/^(home|away)_(\d)$/);if(!mm)return false;const side=mm[1],i=Number(mm[2])
  if(side==='home'){d.pending_home=text.trim();await setSession(u.id,'newround',`away_${i}`,d);await send(chatId,`Матч ${i}: <b>${text.trim()}</b> — ?\nТеперь гости:`);return true}
  const home=String(d.pending_home||'').trim();ms.push({home,away:text.trim()});d.matches=ms;delete d.pending_home
  if(i<3){await setSession(u.id,'newround',`home_${i+1}`,d);await send(chatId,`✅ ${home} — ${text.trim()}\n\nМатч ${i+1} из 3. Хозяева:`);return true}
  await setSession(u.id,'newround','deadline',d);await send(chatId,[`✅ ${home} — ${text.trim()}`,'','⏰ <b>Теперь дедлайн тура</b>','Пришли дату и время по Москве, например: <b>15.08 17:00</b>'].join('\n'));return true
}
async function saveUpcoming(u:TgUser){const s=await session(u.id);if(!s||s.flow!=='newround'||s.step!=='confirm')throw new Error('No draft');const league=(await db<{id:string}[]>('leagues?select=id&order=created_at.asc&limit=1'))[0],rs=await db<Round[]>('rounds',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({league_id:league.id,round_number:s.data.round_number,status:'upcoming',predictions_revealed:false,deadline_at:s.data.deadline_at})}),r=rs[0];await db('matches',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify((s.data.matches||[]).map((m:any)=>({round_id:r.id,home_team:m.home,away_team:m.away})))});await clearSession(u.id);return r}
async function notifyPlayers(r:Round){const[ps,ms]=await Promise.all([players(),roundMatches(r.id)]);let sent=0,skipped=0;const text=[`⚽ <b>Открыт Тур ${r.round_number}</b>`,'',...ms.map((m,i)=>`${i+1}. ${m.home_team} — ${m.away_team}`),'',`⏰ Дедлайн: <b>${deadlineText(r.deadline_at)}</b>`,'🔒 Прогнозы скрыты до дедлайна.'].join('\n');for(const p of ps){if(!p.telegram_user_id){skipped++;continue}try{await send(p.telegram_user_id,text,{reply_markup:{inline_keyboard:[[{text:'🔮 Сделать прогноз',callback_data:'go:0'}]]}});sent++}catch{skipped++}}return{sent,skipped}}
async function activateRound(id:string){await db('rounds?status=eq.open',{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({status:'locked'})});await db(`rounds?id=eq.${id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({status:'open',predictions_revealed:false})});const r=(await db<Round[]>(`rounds?select=id,round_number,status,predictions_revealed,deadline_at,summary_sent_at&id=eq.${id}&limit=1`))[0],delivery=await notifyPlayers(r);return{r,delivery}}

async function startResult(chatId:number,u:TgUser){if(!await admin(u.id)){await send(chatId,'⛔ Только для администратора.');return}const rs=await db<Round[]>('rounds?select=id,round_number,status&status=in.(open,locked)&order=round_number.desc'),kb:any[]=[];for(const r of rs){for(const m of(await roundMatches(r.id)).filter(x=>x.home_score===null))kb.push([{text:`Т${r.round_number}: ${m.home_team} — ${m.away_team}`,callback_data:`admin:result:${m.id}`}])}await send(chatId,kb.length?'🧾 <b>Какой матч завершился?</b>':'Все результаты уже внесены.',kb.length?{reply_markup:{inline_keyboard:kb}}:{})}
async function handleResultText(chatId:number,u:TgUser,text:string,s:BotSession){if(s.flow!=='result'||s.step!=='score')return false;const mm=text.trim().match(/^(\d+)\s*[:\-]\s*(\d+)$/);if(!mm){await send(chatId,'Пришли счёт в формате <b>2:1</b>.');return true}const h=Number(mm[1]),a=Number(mm[2]),id=String(s.data.match_id);await db(`matches?id=eq.${id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({home_score:h,away_score:a})});const m=(await db<Match[]>(`matches?select=id,round_id,home_team,away_team,home_score,away_score&id=eq.${id}&limit=1`))[0],all=await roundMatches(m.round_id);const finished=all.every(x=>x.home_score!==null&&x.away_score!==null);if(finished)await db(`rounds?id=eq.${m.round_id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({status:'finished'})});await clearSession(u.id);await send(chatId,`✅ ${m.home_team} <b>${h}:${a}</b> ${m.away_team}`);if(finished)await publishRoundSummary(m.round_id,chatId);return true}

async function handleCallback(q:TgCallback){
  const d=q.data||'',m=q.message;if(!m){await answer(q.id);return}
  if(d==='noop'){await answer(q.id);return}
  if(d==='status:refresh'){await answer(q.id);await edit(m.chat.id,m.message_id,await statusText(Boolean(await admin(q.from.id))),{reply_markup:{inline_keyboard:[[{text:'🔄 Обновить',callback_data:'status:refresh'}]]}});return}
  if(d.startsWith('bind:')){try{await bindPlayer(d.slice(5),q.from);const p=await playerByTg(q.from.id);await answer(q.id,`Ты — ${p?.name}`);if(p){const v=await predictionView(p,0);await edit(m.chat.id,m.message_id,v.text,{reply_markup:v.markup})}}catch{await answer(q.id,'Имя уже занято')}return}
  if(d==='admin:cancel'){await clearSession(q.from.id);await answer(q.id,'Отменено');await edit(m.chat.id,m.message_id,'❌ Отменено.');return}
  if(d==='admin:save_round'){if(!await admin(q.from.id)){await answer(q.id,'Нет доступа');return}const r=await saveUpcoming(q.from),ms=await roundMatches(r.id);await answer(q.id,'Сохранено');await edit(m.chat.id,m.message_id,[`✅ <b>Тур ${r.round_number} сохранён</b>`,'',...ms.map((x,i)=>`${i+1}. ${x.home_team} — ${x.away_team}`),'',`⏰ ${deadlineText(r.deadline_at)}`].join('\n'),{reply_markup:{inline_keyboard:[[{text:`▶️ Открыть Тур ${r.round_number}`,callback_data:`admin:open:${r.id}`}]]}});return}
  if(d.startsWith('admin:open:')){if(!await admin(q.from.id)){await answer(q.id,'Нет доступа');return}const{r,delivery}=await activateRound(d.slice('admin:open:'.length));await answer(q.id,'Тур открыт');await edit(m.chat.id,m.message_id,`▶️ <b>Тур ${r.round_number} открыт</b>\n⏰ ${deadlineText(r.deadline_at)}\n\n📨 Отправлено: ${delivery.sent}\n⚠️ Не доставлено: ${delivery.skipped}`);return}
  if(d.startsWith('admin:result:')){if(!await admin(q.from.id)){await answer(q.id,'Нет доступа');return}const id=d.slice('admin:result:'.length),x=(await db<Match[]>(`matches?select=id,round_id,home_team,away_team,home_score,away_score&id=eq.${id}&limit=1`))[0];await setSession(q.from.id,'result','score',{match_id:id});await answer(q.id);await edit(m.chat.id,m.message_id,`🧾 <b>${x.home_team} — ${x.away_team}</b>\nПришли счёт, например <b>2:1</b>`);return}
  if(d==='admin:reveal'){if(!await admin(q.from.id)){await answer(q.id,'Нет доступа');return}const r=await openRound();if(!r){await answer(q.id,'Нет тура');return}await db(`rounds?id=eq.${r.id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({predictions_revealed:true})});await answer(q.id,'Раскрыто');await edit(m.chat.id,m.message_id,await predictionsText());return}
  const p=await playerByTg(q.from.id);if(!p){await answer(q.id,'Сначала открой бота в личке и выбери имя');return}
  if(d.startsWith('sc:')){const[,ii,side,dir]=d.split(':'),i=Number(ii),r=await openRound();if(!r||r.predictions_revealed||(r.deadline_at&&new Date(r.deadline_at)<=new Date())){await answer(q.id,'Приём закрыт');return}const ms=await roundMatches(r.id),x=ms[i];if(!x){await answer(q.id);return}const pr=await prediction(p.id,x.id);let h=pr?.home_score??0,a=pr?.away_score??0,delta=dir==='+'?1:-1;if(side==='h')h=Math.max(0,h+delta);else a=Math.max(0,a+delta);await upsertPrediction(p.id,x.id,h,a);const v=await predictionView(p,i);await answer(q.id);await edit(m.chat.id,m.message_id,v.text,{reply_markup:v.markup});return}
  if(d.startsWith('go:')){const v=await predictionView(p,Number(d.slice(3)));await answer(q.id);await edit(m.chat.id,m.message_id,v.text,{reply_markup:v.markup});return}
  if(d==='done'){await ensureAll(p);await answer(q.id,'Сохранено');await edit(m.chat.id,m.message_id,await summary(p),{reply_markup:{inline_keyboard:[[{text:'✏️ Изменить',callback_data:'go:0'}]]}});return}
  await answer(q.id)
}

export async function GET(){return NextResponse.json({ok:true,bot:BOT_USERNAME,mode:'consensus-and-movement'})}
export async function POST(req:NextRequest){
  try{
    const raw=process.env.TELEGRAM_WEBHOOK_SECRET,s=raw?normalizeSecret(raw):''
    if(s&&req.headers.get('x-telegram-bot-api-secret-token')!==s)return new NextResponse('Unauthorized',{status:401})
    const u:TgUpdate=await req.json()
    if(u.callback_query){await handleCallback(u.callback_query);return NextResponse.json({ok:true})}
    const m=u.message;if(!m?.text)return NextResponse.json({ok:true})
    await rememberGroupChat(m)
    const parts=m.text.trim().split(/\s+/),cmd=parts[0].split('@')[0].toLowerCase()
    if((cmd==='/start'||cmd==='/help')&&m.from){if(isPrivate(m)&&parts[1]==='predict'){await handlePredict(m.chat.id,m.from);return NextResponse.json({ok:true})}const a=await admin(m.from.id);await send(m.chat.id,'⚽ <b>РПЛ Predictor</b>\n\n/table — зачёт\n/round — матчи тура\n/status — статус тура\n/stats — моя статистика\n/predict — прогноз'+(a?'\n\n🛠 /newround · /result · /reveal':''));return NextResponse.json({ok:true})}
    if(cmd==='/table')await send(m.chat.id,await tableText())
    else if(cmd==='/round')await send(m.chat.id,await roundText())
    else if(cmd==='/status')await send(m.chat.id,await statusText(Boolean(m.from&&await admin(m.from.id))),{reply_markup:{inline_keyboard:[[{text:'🔄 Обновить',callback_data:'status:refresh'}]]}})
    else if(cmd==='/stats'&&m.from){const p=await playerByTg(m.from.id);if(!p)await bindPrompt(m.chat.id);else await send(m.chat.id,await statsText(p))}
    else if(cmd==='/predictions')await send(m.chat.id,await predictionsText())
    else if(cmd==='/predict'&&m.from){if(isPrivate(m))await handlePredict(m.chat.id,m.from);else await send(m.chat.id,'🔒 Прогноз — в личке',{reply_markup:{inline_keyboard:[[{text:'🔮 Открыть бота',url:`https://t.me/${BOT_USERNAME}?start=predict`}]]}})}
    else if(cmd==='/newround'&&m.from)await startNewRound(m.chat.id,m.from)
    else if(cmd==='/result'&&m.from)await startResult(m.chat.id,m.from)
    else if(cmd==='/reveal'&&m.from){if(!await admin(m.from.id))await send(m.chat.id,'⛔ Только для администратора.');else await send(m.chat.id,'🔓 Раскрыть прогнозы и закрыть приём?',{reply_markup:{inline_keyboard:[[{text:'✅ Раскрыть',callback_data:'admin:reveal'}]]}})}
    else if(m.from){const ss=await session(m.from.id);if(ss?.flow==='newround'&&await handleNewRoundText(m.chat.id,m.from,m.text,ss))return NextResponse.json({ok:true});if(ss?.flow==='result'&&await handleResultText(m.chat.id,m.from,m.text,ss))return NextResponse.json({ok:true})}
    return NextResponse.json({ok:true})
  }catch(e){console.error(e);return NextResponse.json({ok:false},{status:500})}
}
