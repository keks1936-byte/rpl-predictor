import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL = 'https://imjzkiwgkvrxafqweeei.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltanpraXdna3ZyeGFmcXdlZWVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTY4MTQsImV4cCI6MjEwMjEzMjgxNH0.Iii9aQqBAMBAk7ru5rD0VDpLXro6ZERSoBZgL0t2gbQ'
const BOT_USERNAME = 'fantasy_rpl_bot'

type TgUser = { id: number; username?: string }
type TgMessage = { message_id: number; chat: { id: number; type?: string }; from?: TgUser; text?: string }
type TgCallback = { id: string; from: TgUser; data?: string; message?: TgMessage }
type TgUpdate = { message?: TgMessage; callback_query?: TgCallback }
type Player = { id: string; name: string; sort_order: number; telegram_user_id: number|null; telegram_username?: string|null; is_admin: boolean }
type Round = { id: string; round_number: number; status: string; predictions_revealed?: boolean }
type Match = { id: string; round_id: string; home_team: string; away_team: string; home_score: number|null; away_score: number|null }
type Prediction = { match_id: string; player_id: string; home_score: number; away_score: number }
type BotSession = { telegram_user_id: number; flow: string; step: string; data: Record<string, any> }

const dbHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
function normalizeSecret(value: string) { return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) }

async function db<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...dbHeaders, ...(init?.headers || {}) },
    cache: 'no-store'
  })
  if (!res.ok) throw new Error(await res.text())
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

function outcome(h:number,a:number){ return Math.sign(h-a) }
function points(p:Prediction,m:Match){
  if(m.home_score===null||m.away_score===null) return 0
  if(p.home_score===m.home_score&&p.away_score===m.away_score) return 3
  return outcome(p.home_score,p.away_score)===outcome(m.home_score,m.away_score)?1:0
}

function botToken(){
  const token=process.env.TELEGRAM_BOT_TOKEN
  if(!token) throw new Error('TELEGRAM_BOT_TOKEN is missing')
  return token
}
async function tg(method:string,payload:Record<string,unknown>){
  const res=await fetch(`https://api.telegram.org/bot${botToken()}/${method}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
  })
  if(!res.ok) throw new Error(await res.text())
  return res.json()
}
async function send(chatId:number,text:string, extra:Record<string,unknown>={}) {
  return tg('sendMessage',{chat_id:chatId,text,parse_mode:'HTML',...extra})
}
async function edit(chatId:number,messageId:number,text:string,extra:Record<string,unknown>={}){
  return tg('editMessageText',{chat_id:chatId,message_id:messageId,text,parse_mode:'HTML',...extra})
}
async function answerCallback(id:string,text?:string){
  return tg('answerCallbackQuery',{callback_query_id:id,...(text?{text}:{})})
}

async function getPlayers(){
  return db<Player[]>('players?select=id,name,sort_order,telegram_user_id,telegram_username,is_admin&order=sort_order.asc')
}
async function getBoundPlayer(tgId:number){
  const players=await db<Player[]>(`players?select=id,name,sort_order,telegram_user_id,telegram_username,is_admin&telegram_user_id=eq.${tgId}&limit=1`)
  return players[0]
}
async function getOpenRound(){
  const rounds=await db<Round[]>('rounds?select=id,round_number,status,predictions_revealed&status=eq.open&order=round_number.asc&limit=1')
  return rounds[0]
}
async function getRoundMatches(roundId:string){
  return db<Match[]>(`matches?select=id,round_id,home_team,away_team,home_score,away_score&round_id=eq.${roundId}&order=created_at.asc`)
}
async function getPrediction(playerId:string,matchId:string){
  const rows=await db<Prediction[]>(`predictions?select=match_id,player_id,home_score,away_score&player_id=eq.${playerId}&match_id=eq.${matchId}&limit=1`)
  return rows[0]
}
async function upsertPrediction(playerId:string,matchId:string,home:number,away:number){
  await db('predictions?on_conflict=match_id,player_id',{
    method:'POST', headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},
    body:JSON.stringify({match_id:matchId,player_id:playerId,home_score:Math.max(0,home),away_score:Math.max(0,away)})
  })
}
async function bindPlayer(playerId:string,user:TgUser){
  await db('rpc/bind_telegram_player',{
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({p_player_id:playerId,p_telegram_user_id:user.id,p_telegram_username:user.username||null})
  })
}
async function getSession(tgId:number){
  const rows=await db<BotSession[]>(`bot_sessions?select=telegram_user_id,flow,step,data&telegram_user_id=eq.${tgId}&limit=1`)
  return rows[0]
}
async function setSession(tgId:number,flow:string,step:string,data:Record<string,any>){
  await db('bot_sessions?on_conflict=telegram_user_id',{
    method:'POST', headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},
    body:JSON.stringify({telegram_user_id:tgId,flow,step,data,updated_at:new Date().toISOString()})
  })
}
async function clearSession(tgId:number){
  await db(`bot_sessions?telegram_user_id=eq.${tgId}`,{method:'DELETE',headers:{Prefer:'return=minimal'}})
}
async function requireAdmin(tgId:number){
  const player=await getBoundPlayer(tgId)
  return player?.is_admin ? player : undefined
}

async function tableText(){
  const [players,matches,preds]=await Promise.all([
    getPlayers(),
    db<Match[]>('matches?select=id,round_id,home_team,away_team,home_score,away_score'),
    db<Prediction[]>('predictions?select=match_id,player_id,home_score,away_score')
  ])
  const rows=players.map(player=>{
    let total=0,exact=0
    for(const m of matches){
      if(m.home_score===null) continue
      const p=preds.find(x=>x.player_id===player.id&&x.match_id===m.id)
      if(!p) continue
      const n=points(p,m); total+=n; if(n===3) exact++
    }
    return {name:player.name,total,exact}
  }).sort((a,b)=>b.total-a.total||b.exact-a.exact)
  return ['🏆 <b>Общий зачёт</b>','',...rows.map((r,i)=>`${i+1}. <b>${r.name}</b> — ${r.total} очк. 🎯 ${r.exact}`)].join('\n')
}

async function roundText(){
  const round=await getOpenRound()
  if(!round) return 'Сейчас нет открытого тура.'
  const matches=await getRoundMatches(round.id)
  return [`⚽ <b>Тур ${round.round_number}</b>`,'',...matches.map((m,i)=>`${i+1}. ${m.home_team} — ${m.away_team}`),'','/predict — сделать прогноз в личке с ботом','/status — кто уже сдал'].join('\n')
}

async function statusText(){
  const round=await getOpenRound()
  if(!round) return 'Сейчас нет открытого тура.'
  const [players,matches,preds]=await Promise.all([
    getPlayers(),
    getRoundMatches(round.id),
    db<Prediction[]>('predictions?select=match_id,player_id,home_score,away_score')
  ])
  const ids=new Set(matches.map(m=>m.id))
  const lines=players.map(p=>{
    const count=preds.filter(x=>x.player_id===p.id&&ids.has(x.match_id)).length
    return `${count===matches.length?'✅':'⏳'} <b>${p.name}</b> — ${count}/${matches.length}`
  })
  return [`📋 <b>Тур ${round.round_number} · прогнозы</b>`,'',...lines,'',round.predictions_revealed?'🔓 Прогнозы раскрыты':'🔒 Счета скрыты до раскрытия'].join('\n')
}

async function predictionsText(){
  const round=await getOpenRound()
  if(!round) return 'Сейчас нет открытого тура.'
  if(!round.predictions_revealed) return '🔒 Прогнозы пока скрыты. После дедлайна администратор раскроет их командой /reveal.'
  const [players,matches,preds]=await Promise.all([
    getPlayers(),getRoundMatches(round.id),db<Prediction[]>('predictions?select=match_id,player_id,home_score,away_score')
  ])
  const blocks:string[]=[`🔓 <b>Прогнозы · Тур ${round.round_number}</b>`]
  for(const m of matches){
    blocks.push('',`⚽ <b>${m.home_team} — ${m.away_team}</b>`)
    for(const p of players){
      const pr=preds.find(x=>x.player_id===p.id&&x.match_id===m.id)
      blocks.push(`${p.name}: <b>${pr?`${pr.home_score}:${pr.away_score}`:'—'}</b>`)
    }
  }
  return blocks.join('\n')
}

async function showBind(chatId:number){
  const players=await getPlayers()
  const available=players.filter(p=>!p.telegram_user_id)
  if(!available.length){ await send(chatId,'Все участники уже привязаны. Если это ошибка — напиши администратору лиги.'); return }
  await send(chatId,'👤 <b>Кто ты?</b>\n\nНужно выбрать один раз — дальше бот будет узнавать тебя автоматически.',{
    reply_markup:{inline_keyboard:available.map(p=>[{text:p.name,callback_data:`bind:${p.id}`}])}
  })
}

async function predictionView(player:Player,index:number){
  const round=await getOpenRound()
  if(!round) return {text:'Сейчас нет открытого тура.',markup:{inline_keyboard:[] as unknown[]}}
  if(round.predictions_revealed) return {text:'🔒 Приём прогнозов на этот тур завершён.',markup:{inline_keyboard:[] as unknown[]}}
  const matches=await getRoundMatches(round.id)
  if(index<0) index=0
  if(index>=matches.length) index=matches.length-1
  const match=matches[index]
  const pred=await getPrediction(player.id,match.id)
  const home=pred?.home_score??0, away=pred?.away_score??0
  const rows:any[]=[
    [{text:'−',callback_data:`sc:${index}:h:-`},{text:`${match.home_team}: ${home}`,callback_data:'noop'},{text:'+',callback_data:`sc:${index}:h:+`}],
    [{text:'−',callback_data:`sc:${index}:a:-`},{text:`${match.away_team}: ${away}`,callback_data:'noop'},{text:'+',callback_data:`sc:${index}:a:+`}]
  ]
  const nav:any[]=[]
  if(index>0) nav.push({text:'← Назад',callback_data:`go:${index-1}`})
  if(index<matches.length-1) nav.push({text:'Далее →',callback_data:`go:${index+1}`})
  else nav.push({text:'✅ Готово',callback_data:'done'})
  rows.push(nav)
  return {text:`🔮 <b>Тур ${round.round_number} · ${player.name}</b>\n\nМатч ${index+1} из ${matches.length}\n<b>${match.home_team} — ${match.away_team}</b>\n\nТекущий прогноз: <b>${home}:${away}</b>`,markup:{inline_keyboard:rows}}
}

async function ensureAllPredictions(player:Player){
  const round=await getOpenRound(); if(!round||round.predictions_revealed) return
  const matches=await getRoundMatches(round.id)
  for(const m of matches){
    const p=await getPrediction(player.id,m.id)
    if(!p) await upsertPrediction(player.id,m.id,0,0)
  }
}

async function summaryText(player:Player){
  const round=await getOpenRound(); if(!round) return 'Сейчас нет открытого тура.'
  const matches=await getRoundMatches(round.id); const lines=[]
  for(const m of matches){ const p=await getPrediction(player.id,m.id); lines.push(`${m.home_team} — ${m.away_team}: <b>${p?.home_score??0}:${p?.away_score??0}</b>`) }
  return [`✅ <b>${player.name}, прогнозы на Тур ${round.round_number} сохранены</b>`,'',...lines,'','До раскрытия их можно изменить через /predict.'].join('\n')
}
async function handlePredict(chatId:number,user:TgUser){
  const player=await getBoundPlayer(user.id)
  if(!player){ await showBind(chatId); return }
  const round=await getOpenRound()
  if(round?.predictions_revealed){ await send(chatId,'🔒 Приём прогнозов на этот тур уже завершён.'); return }
  const view=await predictionView(player,0); await send(chatId,view.text,{reply_markup:view.markup})
}

async function startNewRound(chatId:number,user:TgUser){
  if(!await requireAdmin(user.id)){ await send(chatId,'⛔ Эта команда доступна только администратору лиги.'); return }
  const rounds=await db<Round[]>('rounds?select=id,round_number,status&order=round_number.desc&limit=1')
  const next=(rounds[0]?.round_number||0)+1
  await setSession(user.id,'newround','home_1',{round_number:next,matches:[]})
  await send(chatId,`🛠 <b>Создаём Тур ${next}</b>\n\nМатч 1 из 3. Введи название <b>хозяев</b>:`)
}
async function handleNewRoundText(chatId:number,user:TgUser,text:string,session:BotSession){
  const data=session.data||{}; const matches:Array<{home:string;away:string}>=data.matches||[]
  const m=session.step.match(/^(home|away)_(\d)$/); if(!m) return false
  const side=m[1], idx=Number(m[2])
  if(side==='home'){
    data.pending_home=text.trim(); await setSession(user.id,'newround',`away_${idx}`,data)
    await send(chatId,`Матч ${idx}: <b>${text.trim()}</b> — ?\n\nТеперь введи <b>гостей</b>:`); return true
  }
  const home=String(data.pending_home||'').trim(); matches.push({home,away:text.trim()}); data.matches=matches; delete data.pending_home
  if(idx<3){ await setSession(user.id,'newround',`home_${idx+1}`,data); await send(chatId,`✅ ${home} — ${text.trim()}\n\nМатч ${idx+1} из 3. Введи <b>хозяев</b>:`); return true }
  await setSession(user.id,'newround','confirm',data)
  const lines=matches.map((x,i)=>`${i+1}. ${x.home} — ${x.away}`)
  await send(chatId,[`📋 <b>Тур ${data.round_number}</b>`,'',...lines,'','Сохранить эти матчи как следующий тур?'].join('\n'),{
    reply_markup:{inline_keyboard:[[{text:'✅ Сохранить тур',callback_data:'admin:save_round'}],[{text:'❌ Отмена',callback_data:'admin:cancel'}]]}
  }); return true
}
async function saveUpcomingRound(user:TgUser){
  const session=await getSession(user.id); if(!session||session.flow!=='newround'||session.step!=='confirm') throw new Error('No round draft')
  const data=session.data; const league=await db<{id:string}[]>('leagues?select=id&order=created_at.asc&limit=1')
  const created=await db<Round[]>('rounds',{
    method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},
    body:JSON.stringify({league_id:league[0].id,round_number:data.round_number,status:'upcoming'})
  })
  const round=created[0]
  await db('matches',{
    method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},
    body:JSON.stringify((data.matches||[]).map((m:any)=>({round_id:round.id,home_team:m.home,away_team:m.away})))
  })
  await clearSession(user.id); return round
}
async function openRound(roundId:string){
  await db('rounds?status=eq.open',{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({status:'locked'})})
  await db(`rounds?id=eq.${roundId}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({status:'open',predictions_revealed:false})})
}

async function startResultFlow(chatId:number,user:TgUser){
  if(!await requireAdmin(user.id)){ await send(chatId,'⛔ Эта команда доступна только администратору лиги.'); return }
  const rounds=await db<Round[]>('rounds?select=id,round_number,status&status=in.(open,locked)&order=round_number.desc')
  if(!rounds.length){ await send(chatId,'Нет туров, для которых можно внести результаты.'); return }
  const keyboard=[] as any[]
  for(const r of rounds){
    const matches=await getRoundMatches(r.id)
    for(const m of matches.filter(x=>x.home_score===null)) keyboard.push([{text:`Т${r.round_number}: ${m.home_team} — ${m.away_team}`,callback_data:`admin:result:${m.id}`}])
  }
  if(!keyboard.length){ await send(chatId,'Все результаты уже внесены.'); return }
  await send(chatId,'🧾 <b>Какой матч завершился?</b>',{reply_markup:{inline_keyboard:keyboard}})
}
async function handleResultText(chatId:number,user:TgUser,text:string,session:BotSession){
  if(session.flow!=='result'||session.step!=='score') return false
  const m=text.trim().match(/^(\d+)\s*[:\-]\s*(\d+)$/)
  if(!m){ await send(chatId,'Не понял счёт. Пришли в формате <b>2:1</b>.'); return true }
  const home=Number(m[1]),away=Number(m[2]),matchId=String(session.data.match_id)
  await db(`matches?id=eq.${matchId}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({home_score:home,away_score:away})})
  const matchRows=await db<Match[]>(`matches?select=id,round_id,home_team,away_team,home_score,away_score&id=eq.${matchId}&limit=1`); const match=matchRows[0]
  const all=await getRoundMatches(match.round_id)
  if(all.every(x=>x.home_score!==null&&x.away_score!==null)) await db(`rounds?id=eq.${match.round_id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({status:'finished'})})
  await clearSession(user.id)
  await send(chatId,`✅ Результат сохранён: <b>${match.home_team} ${home}:${away} ${match.away_team}</b>\n\n/table — посмотреть обновлённый зачёт`)
  return true
}

async function requestReveal(chatId:number,user:TgUser){
  if(!await requireAdmin(user.id)){ await send(chatId,'⛔ Эта команда доступна только администратору лиги.'); return }
  const round=await getOpenRound(); if(!round){ await send(chatId,'Нет открытого тура.'); return }
  if(round.predictions_revealed){ await send(chatId,'Прогнозы этого тура уже раскрыты.'); return }
  await send(chatId,`⚠️ <b>Раскрыть прогнозы Тура ${round.round_number}?</b>\n\nПосле этого участники больше не смогут менять счета.`,{
    reply_markup:{inline_keyboard:[[{text:'🔓 Да, раскрыть',callback_data:`admin:reveal:${round.id}`}],[{text:'Отмена',callback_data:'noop'}]]}
  })
}

async function handleCallback(q:TgCallback){
  const data=q.data||'', msg=q.message
  if(!msg){ await answerCallback(q.id); return }
  if(data==='noop'){ await answerCallback(q.id); return }

  if(data.startsWith('bind:')){
    try{ await bindPlayer(data.slice(5),q.from); const player=await getBoundPlayer(q.from.id); await answerCallback(q.id,`Ты — ${player?.name}`); if(player){const view=await predictionView(player,0); await edit(msg.chat.id,msg.message_id,view.text,{reply_markup:view.markup})} }
    catch{ await answerCallback(q.id,'Это имя уже привязано к другому аккаунту') }
    return
  }

  if(data==='admin:cancel'){ await clearSession(q.from.id); await answerCallback(q.id,'Отменено'); await edit(msg.chat.id,msg.message_id,'❌ Создание тура отменено.'); return }
  if(data==='admin:save_round'){
    if(!await requireAdmin(q.from.id)){ await answerCallback(q.id,'Нет доступа'); return }
    const round=await saveUpcomingRound(q.from); await answerCallback(q.id,'Тур сохранён')
    const matches=await getRoundMatches(round.id)
    await edit(msg.chat.id,msg.message_id,[`✅ <b>Тур ${round.round_number} сохранён как следующий</b>`,'',...matches.map((m,i)=>`${i+1}. ${m.home_team} — ${m.away_team}`),'','Текущий тур пока не изменён.'].join('\n'),{reply_markup:{inline_keyboard:[[{text:'▶️ Открыть Тур '+round.round_number,callback_data:`admin:open:${round.id}`}]]}}); return
  }
  if(data.startsWith('admin:open:')){
    if(!await requireAdmin(q.from.id)){ await answerCallback(q.id,'Нет доступа'); return }
    const roundId=data.slice('admin:open:'.length); await openRound(roundId); await answerCallback(q.id,'Тур открыт'); const rs=await db<Round[]>(`rounds?select=id,round_number,status&id=eq.${roundId}&limit=1`)
    await edit(msg.chat.id,msg.message_id,`▶️ <b>Тур ${rs[0]?.round_number} открыт!</b>\n\nТеперь /round и /predict показывают его.`); return
  }
  if(data.startsWith('admin:result:')){
    if(!await requireAdmin(q.from.id)){ await answerCallback(q.id,'Нет доступа'); return }
    const matchId=data.slice('admin:result:'.length); const rows=await db<Match[]>(`matches?select=id,round_id,home_team,away_team,home_score,away_score&id=eq.${matchId}&limit=1`); const match=rows[0]
    await setSession(q.from.id,'result','score',{match_id:matchId}); await answerCallback(q.id)
    await edit(msg.chat.id,msg.message_id,`🧾 <b>${match.home_team} — ${match.away_team}</b>\n\nПришли фактический счёт сообщением, например: <b>2:1</b>`); return
  }
  if(data.startsWith('admin:reveal:')){
    if(!await requireAdmin(q.from.id)){ await answerCallback(q.id,'Нет доступа'); return }
    const roundId=data.slice('admin:reveal:'.length)
    await db(`rounds?id=eq.${roundId}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({predictions_revealed:true})})
    await answerCallback(q.id,'Прогнозы раскрыты')
    await edit(msg.chat.id,msg.message_id,await predictionsText()); return
  }

  const player=await getBoundPlayer(q.from.id)
  if(!player){ await answerCallback(q.id,'Сначала открой /predict в личке и выбери своё имя'); return }
  if(data.startsWith('sc:')){
    const [,idxRaw,side,dir]=data.split(':'); const index=Number(idxRaw); const round=await getOpenRound(); if(!round){await answerCallback(q.id,'Тур закрыт');return}
    if(round.predictions_revealed){await answerCallback(q.id,'Приём прогнозов завершён');return}
    const matches=await getRoundMatches(round.id), match=matches[index]; if(!match){await answerCallback(q.id);return}
    const current=await getPrediction(player.id,match.id); let home=current?.home_score??0,away=current?.away_score??0; const delta=dir==='+'?1:-1
    if(side==='h')home=Math.max(0,home+delta);else away=Math.max(0,away+delta)
    await upsertPrediction(player.id,match.id,home,away); const view=await predictionView(player,index); await answerCallback(q.id); await edit(msg.chat.id,msg.message_id,view.text,{reply_markup:view.markup}); return
  }
  if(data.startsWith('go:')){ const view=await predictionView(player,Number(data.slice(3))); await answerCallback(q.id); await edit(msg.chat.id,msg.message_id,view.text,{reply_markup:view.markup}); return }
  if(data==='done'){
    const round=await getOpenRound(); if(round?.predictions_revealed){await answerCallback(q.id,'Приём прогнозов завершён');return}
    await ensureAllPredictions(player); await answerCallback(q.id,'Прогнозы сохранены'); await edit(msg.chat.id,msg.message_id,await summaryText(player),{reply_markup:{inline_keyboard:[[{text:'✏️ Изменить',callback_data:'go:0'}]]}}); return
  }
  await answerCallback(q.id)
}

export async function GET(){ return NextResponse.json({ok:true,bot:BOT_USERNAME,mode:'private-predictions'}) }

export async function POST(req:NextRequest){
  try{
    const rawSecret=process.env.TELEGRAM_WEBHOOK_SECRET, secret=rawSecret?normalizeSecret(rawSecret):''
    if(secret&&req.headers.get('x-telegram-bot-api-secret-token')!==secret) return new NextResponse('Unauthorized',{status:401})
    const update:TgUpdate=await req.json()
    if(update.callback_query){ await handleCallback(update.callback_query); return NextResponse.json({ok:true}) }
    const msg=update.message; if(!msg?.text) return NextResponse.json({ok:true})
    const parts=msg.text.trim().split(/\s+/)
    const command=parts[0].split('@')[0].toLowerCase()
    const arg=parts[1]?.toLowerCase()
    const isPrivate=msg.chat.type==='private'||msg.chat.type===undefined

    if(command==='/start'||command==='/help'){
      if(command==='/start'&&arg==='predict'&&msg.from&&isPrivate){ await handlePredict(msg.chat.id,msg.from); return NextResponse.json({ok:true}) }
      const admin=msg.from?await requireAdmin(msg.from.id):undefined
      await send(msg.chat.id,'⚽ <b>РПЛ Predictor</b>\n\n/table — общий зачёт\n/round — матчи текущего тура\n/status — кто уже сдал прогнозы\n/predictions — посмотреть счета после раскрытия\n/predict — сделать или изменить прогноз'+(admin?'\n\n🛠 <b>Админ</b>\n/newround — выбрать 3 матча следующего тура\n/result — внести фактический счёт\n/reveal — закрыть приём и раскрыть прогнозы':'')+'\n\nТочный счёт = 3 очка, правильный исход = 1.')
    } else if(command==='/table') await send(msg.chat.id,await tableText())
    else if(command==='/round') await send(msg.chat.id,await roundText())
    else if(command==='/status') await send(msg.chat.id,await statusText())
    else if(command==='/predictions') await send(msg.chat.id,await predictionsText())
    else if(command==='/predict'&&msg.from){
      if(!isPrivate){
        await send(msg.chat.id,'🔒 <b>Прогнозы делаются в личке с ботом</b>\n\nВ общем чате никто не увидит твои счета до раскрытия.',{
          reply_markup:{inline_keyboard:[[{text:'🔮 Сделать прогноз в личке',url:`https://t.me/${BOT_USERNAME}?start=predict`}]]}
        })
      } else await handlePredict(msg.chat.id,msg.from)
    }
    else if(command==='/newround'&&msg.from) await startNewRound(msg.chat.id,msg.from)
    else if(command==='/result'&&msg.from) await startResultFlow(msg.chat.id,msg.from)
    else if(command==='/reveal'&&msg.from) await requestReveal(msg.chat.id,msg.from)
    else if(msg.from){
      const session=await getSession(msg.from.id)
      if(session?.flow==='newround'&&await handleNewRoundText(msg.chat.id,msg.from,msg.text,session)) return NextResponse.json({ok:true})
      if(session?.flow==='result'&&await handleResultText(msg.chat.id,msg.from,msg.text,session)) return NextResponse.json({ok:true})
    }
    return NextResponse.json({ok:true})
  }catch(e){ console.error(e); return NextResponse.json({ok:false},{status:500}) }
}
