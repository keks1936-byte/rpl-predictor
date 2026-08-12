import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL = 'https://imjzkiwgkvrxafqweeei.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltanpraXdna3ZyeGFmcXdlZWVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTY4MTQsImV4cCI6MjEwMjEzMjgxNH0.Iii9aQqBAMBAk7ru5rD0VDpLXro6ZERSoBZgL0t2gbQ'

type TgUser = { id: number; username?: string }
type TgMessage = { message_id: number; chat: { id: number }; from?: TgUser; text?: string }
type TgCallback = { id: string; from: TgUser; data?: string; message?: TgMessage }
type TgUpdate = { message?: TgMessage; callback_query?: TgCallback }
type Player = { id: string; name: string; sort_order: number; telegram_user_id: number|null; telegram_username?: string|null }
type Round = { id: string; round_number: number; status: string }
type Match = { id: string; round_id: string; home_team: string; away_team: string; home_score: number|null; away_score: number|null }
type Prediction = { match_id: string; player_id: string; home_score: number; away_score: number }

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
  return db<Player[]>('players?select=id,name,sort_order,telegram_user_id,telegram_username&order=sort_order.asc')
}

async function getBoundPlayer(tgId:number){
  const players=await db<Player[]>(`players?select=id,name,sort_order,telegram_user_id,telegram_username&telegram_user_id=eq.${tgId}&limit=1`)
  return players[0]
}

async function getOpenRound(){
  const rounds=await db<Round[]>('rounds?select=id,round_number,status&status=eq.open&order=round_number.asc&limit=1')
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
    method:'POST',
    headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},
    body:JSON.stringify({match_id:matchId,player_id:playerId,home_score:Math.max(0,home),away_score:Math.max(0,away)})
  })
}

async function bindPlayer(playerId:string,user:TgUser){
  await db('rpc/bind_telegram_player',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({p_player_id:playerId,p_telegram_user_id:user.id,p_telegram_username:user.username||null})
  })
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
  return [`⚽ <b>Тур ${round.round_number}</b>`,'',...matches.map((m,i)=>`${i+1}. ${m.home_team} — ${m.away_team}`),'','/predict — сделать прогноз прямо здесь'].join('\n')
}

async function showBind(chatId:number){
  const players=await getPlayers()
  const available=players.filter(p=>!p.telegram_user_id)
  if(!available.length){
    await send(chatId,'Все участники уже привязаны. Если это ошибка — напиши администратору лиги.')
    return
  }
  await send(chatId,'👤 <b>Кто ты?</b>\n\nНужно выбрать один раз — дальше бот будет узнавать тебя автоматически.',{
    reply_markup:{inline_keyboard:available.map(p=>[{text:p.name,callback_data:`bind:${p.id}`}])}
  })
}

async function predictionView(player:Player,index:number){
  const round=await getOpenRound()
  if(!round) return {text:'Сейчас нет открытого тура.',markup:{inline_keyboard:[] as unknown[]}}
  const matches=await getRoundMatches(round.id)
  if(index<0) index=0
  if(index>=matches.length) index=matches.length-1
  const match=matches[index]
  const pred=await getPrediction(player.id,match.id)
  const home=pred?.home_score??0
  const away=pred?.away_score??0
  const rows:any[]=[
    [{text:'−',callback_data:`sc:${index}:h:-`},{text:`${match.home_team}: ${home}`,callback_data:'noop'},{text:'+',callback_data:`sc:${index}:h:+`}],
    [{text:'−',callback_data:`sc:${index}:a:-`},{text:`${match.away_team}: ${away}`,callback_data:'noop'},{text:'+',callback_data:`sc:${index}:a:+`}]
  ]
  const nav:any[]=[]
  if(index>0) nav.push({text:'← Назад',callback_data:`go:${index-1}`})
  if(index<matches.length-1) nav.push({text:'Далее →',callback_data:`go:${index+1}`})
  else nav.push({text:'✅ Готово',callback_data:'done'})
  rows.push(nav)
  return {
    text:`🔮 <b>Тур ${round.round_number} · ${player.name}</b>\n\nМатч ${index+1} из ${matches.length}\n<b>${match.home_team} — ${match.away_team}</b>\n\nТекущий прогноз: <b>${home}:${away}</b>`,
    markup:{inline_keyboard:rows}
  }
}

async function summaryText(player:Player){
  const round=await getOpenRound()
  if(!round) return 'Сейчас нет открытого тура.'
  const matches=await getRoundMatches(round.id)
  const lines=[]
  for(const m of matches){
    const p=await getPrediction(player.id,m.id)
    lines.push(`${m.home_team} — ${m.away_team}: <b>${p?.home_score??0}:${p?.away_score??0}</b>`)
  }
  return [`✅ <b>${player.name}, прогнозы на Тур ${round.round_number} сохранены</b>`,'',...lines,'','До дедлайна их можно изменить через /predict.'].join('\n')
}

async function handlePredict(chatId:number,user:TgUser){
  const player=await getBoundPlayer(user.id)
  if(!player){ await showBind(chatId); return }
  const view=await predictionView(player,0)
  await send(chatId,view.text,{reply_markup:view.markup})
}

async function handleCallback(q:TgCallback){
  const data=q.data||''
  const msg=q.message
  if(!msg){ await answerCallback(q.id); return }

  if(data==='noop'){ await answerCallback(q.id); return }

  if(data.startsWith('bind:')){
    try{
      await bindPlayer(data.slice(5),q.from)
      const player=await getBoundPlayer(q.from.id)
      await answerCallback(q.id,`Ты — ${player?.name}`)
      if(player){
        const view=await predictionView(player,0)
        await edit(msg.chat.id,msg.message_id,view.text,{reply_markup:view.markup})
      }
    }catch{
      await answerCallback(q.id,'Это имя уже привязано к другому аккаунту')
    }
    return
  }

  const player=await getBoundPlayer(q.from.id)
  if(!player){ await answerCallback(q.id,'Сначала используй /predict и выбери своё имя'); return }

  if(data.startsWith('sc:')){
    const [,idxRaw,side,dir]=data.split(':')
    const index=Number(idxRaw)
    const round=await getOpenRound()
    if(!round){ await answerCallback(q.id,'Тур закрыт'); return }
    const matches=await getRoundMatches(round.id)
    const match=matches[index]
    if(!match){ await answerCallback(q.id); return }
    const current=await getPrediction(player.id,match.id)
    let home=current?.home_score??0
    let away=current?.away_score??0
    const delta=dir==='+'?1:-1
    if(side==='h') home=Math.max(0,home+delta)
    else away=Math.max(0,away+delta)
    await upsertPrediction(player.id,match.id,home,away)
    const view=await predictionView(player,index)
    await answerCallback(q.id)
    await edit(msg.chat.id,msg.message_id,view.text,{reply_markup:view.markup})
    return
  }

  if(data.startsWith('go:')){
    const index=Number(data.slice(3))
    const view=await predictionView(player,index)
    await answerCallback(q.id)
    await edit(msg.chat.id,msg.message_id,view.text,{reply_markup:view.markup})
    return
  }

  if(data==='done'){
    await answerCallback(q.id,'Прогнозы сохранены')
    await edit(msg.chat.id,msg.message_id,await summaryText(player),{reply_markup:{inline_keyboard:[[{text:'✏️ Изменить',callback_data:'go:0'}]]}})
    return
  }

  await answerCallback(q.id)
}

export async function GET(){ return NextResponse.json({ok:true,bot:'fantasy_rpl_bot',mode:'telegram-native'}) }

export async function POST(req:NextRequest){
  try{
    const rawSecret=process.env.TELEGRAM_WEBHOOK_SECRET
    const secret=rawSecret ? normalizeSecret(rawSecret) : ''
    if(secret && req.headers.get('x-telegram-bot-api-secret-token')!==secret) return new NextResponse('Unauthorized',{status:401})
    const update:TgUpdate=await req.json()

    if(update.callback_query){ await handleCallback(update.callback_query); return NextResponse.json({ok:true}) }

    const msg=update.message
    if(!msg?.text) return NextResponse.json({ok:true})
    const command=msg.text.trim().split(/\s+/)[0].split('@')[0].toLowerCase()
    if(command==='/start'||command==='/help'){
      await send(msg.chat.id,'⚽ <b>РПЛ Predictor</b>\n\n/table — общий зачёт\n/round — матчи текущего тура\n/predict — сделать или изменить прогноз\n\nТочный счёт = 3 очка, правильный исход = 1.')
    } else if(command==='/table'){
      await send(msg.chat.id,await tableText())
    } else if(command==='/round'){
      await send(msg.chat.id,await roundText())
    } else if(command==='/predict' && msg.from){
      await handlePredict(msg.chat.id,msg.from)
    }
    return NextResponse.json({ok:true})
  }catch(e){ console.error(e); return NextResponse.json({ok:false},{status:500}) }
}
