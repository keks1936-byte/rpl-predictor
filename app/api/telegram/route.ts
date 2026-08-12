import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL = 'https://imjzkiwgkvrxafqweeei.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltanpraXdna3ZyeGFmcXdlZWVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTY4MTQsImV4cCI6MjEwMjEzMjgxNH0.Iii9aQqBAMBAk7ru5rD0VDpLXro6ZERSoBZgL0t2gbQ'
const APP_URL = 'https://rpl-predictor-r8sp.vercel.app'

type TgMessage = { chat: { id: number }; text?: string }
type TgUpdate = { message?: TgMessage }
type Player = { id: string; name: string; sort_order: number }
type Round = { id: string; round_number: number; status: string }
type Match = { id: string; round_id: string; home_team: string; away_team: string; home_score: number|null; away_score: number|null }
type Prediction = { match_id: string; player_id: string; home_score: number; away_score: number }

const dbHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
function normalizeSecret(value: string) { return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) }

async function db<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: dbHeaders, cache: 'no-store' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

function outcome(h:number,a:number){ return Math.sign(h-a) }
function points(p:Prediction,m:Match){
  if(m.home_score===null||m.away_score===null) return 0
  if(p.home_score===m.home_score&&p.away_score===m.away_score) return 3
  return outcome(p.home_score,p.away_score)===outcome(m.home_score,m.away_score)?1:0
}

async function send(chatId:number,text:string, extra:Record<string,unknown>={}) {
  const token=process.env.TELEGRAM_BOT_TOKEN
  if(!token) throw new Error('TELEGRAM_BOT_TOKEN is missing')
  const res=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text,parse_mode:'HTML',...extra})
  })
  if(!res.ok) throw new Error(await res.text())
}

async function tableText(){
  const [players,matches,preds]=await Promise.all([
    db<Player[]>('players?select=id,name,sort_order&order=sort_order.asc'),
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
  const rounds=await db<Round[]>('rounds?select=id,round_number,status&order=round_number.asc')
  const round=rounds.find(r=>r.status==='open')
  if(!round) return 'Сейчас нет открытого тура.'
  const matches=await db<Match[]>(`matches?select=id,round_id,home_team,away_team,home_score,away_score&round_id=eq.${round.id}&order=created_at.asc`)
  return [`⚽ <b>Тур ${round.round_number}</b>`,'',...matches.map((m,i)=>`${i+1}. ${m.home_team} — ${m.away_team}`),'',`Прогнозы: ${APP_URL}`].join('\n')
}

export async function GET(){ return NextResponse.json({ok:true,bot:'fantasy_rpl_bot'}) }

export async function POST(req:NextRequest){
  try{
    const rawSecret=process.env.TELEGRAM_WEBHOOK_SECRET
    const secret=rawSecret ? normalizeSecret(rawSecret) : ''
    if(secret && req.headers.get('x-telegram-bot-api-secret-token')!==secret) return new NextResponse('Unauthorized',{status:401})
    const update:TgUpdate=await req.json()
    const msg=update.message
    if(!msg?.text) return NextResponse.json({ok:true})
    const command=msg.text.trim().split(/\s+/)[0].split('@')[0].toLowerCase()
    if(command==='/start'||command==='/help'){
      await send(msg.chat.id,'⚽ <b>РПЛ Predictor</b>\n\n/table — общий зачёт\n/round — матчи текущего тура\n/predict — сделать прогноз\n\nТочный счёт = 3 очка, правильный исход = 1.')
    } else if(command==='/table'){
      await send(msg.chat.id,await tableText())
    } else if(command==='/round'){
      await send(msg.chat.id,await roundText())
    } else if(command==='/predict'){
      await send(msg.chat.id,'🔮 <b>Сделать прогноз</b>\n\nОткрой сайт, выбери своё имя и выставь три счёта:',{reply_markup:{inline_keyboard:[[{text:'Открыть прогнозы',url:APP_URL}]]}})
    }
    return NextResponse.json({ok:true})
  }catch(e){ console.error(e); return NextResponse.json({ok:false},{status:500}) }
}
