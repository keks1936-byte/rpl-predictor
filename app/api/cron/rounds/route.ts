import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL='https://imjzkiwgkvrxafqweeei.supabase.co'
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltanpraXdna3ZyeGFmcXdlZWVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTY4MTQsImV4cCI6MjEwMjEzMjgxNH0.Iii9aQqBAMBAk7ru5rD0VDpLXro6ZERSoBZgL0t2gbQ'
const headers={apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${SUPABASE_ANON_KEY}`}
type Round={id:string;round_number:number;deadline_at:string;reminder_sent_at:string|null;reveal_sent_at:string|null;predictions_revealed:boolean}
type Player={id:string;name:string;telegram_user_id:number|null}
type Match={id:string;home_team:string;away_team:string}
type Prediction={match_id:string;player_id:string;home_score:number;away_score:number}
async function db<T>(path:string,init?:RequestInit):Promise<T>{const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{...init,headers:{...headers,...(init?.headers||{})},cache:'no-store'});if(!r.ok)throw new Error(await r.text());const t=await r.text();return(t?JSON.parse(t):undefined)as T}
function token(){const t=process.env.TELEGRAM_BOT_TOKEN;if(!t)throw new Error('TELEGRAM_BOT_TOKEN missing');return t}
async function send(chatId:number,text:string,extra:Record<string,unknown>={}){const r=await fetch(`https://api.telegram.org/bot${token()}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text,parse_mode:'HTML',...extra})});if(!r.ok)throw new Error(await r.text())}
function outcome(h:number,a:number){return Math.sign(h-a)}
function outcomeLabel(value:number,m:Match){return value>0?`победу ${m.home_team}`:value<0?`победу ${m.away_team}`:'ничью'}
function consensusLine(m:Match,ps:Player[],prs:Prediction[]){
 const picks=ps.map(p=>({p,pr:prs.find(x=>x.player_id===p.id&&x.match_id===m.id)})).filter((x):x is {p:Player;pr:Prediction}=>Boolean(x.pr));if(picks.length<2)return'';
 const groups=new Map<number,typeof picks>();for(const pick of picks){const k=outcome(pick.pr.home_score,pick.pr.away_score);groups.set(k,[...(groups.get(k)||[]),pick])}
 const ranked=[...groups.entries()].sort((a,b)=>b[1].length-a[1].length),[topOutcome,topPicks]=ranked[0];
 if(topPicks.length===picks.length)return`📊 Все ${picks.length}/${picks.length} ждут ${outcomeLabel(topOutcome,m)}.`;
 const uniqueTop=ranked.length===1||topPicks.length>(ranked[1]?.[1].length||0),base=uniqueTop&&topPicks.length>=2?`📊 ${topPicks.length}/${picks.length} ждут ${outcomeLabel(topOutcome,m)}.`:'';
 if(topPicks.length===picks.length-1&&ranked.length===2&&ranked[1][1].length===1){const outsider=ranked[1][1][0],o=outcome(outsider.pr.home_score,outsider.pr.away_score);return`${base}${base?' ':''}🧍 ${outsider.p.name} единственный ставит на ${outcomeLabel(o,m)}.`}return base
}
async function run(){
 const now=new Date();const rounds=await db<Round[]>('rounds?select=id,round_number,deadline_at,reminder_sent_at,reveal_sent_at,predictions_revealed&status=eq.open&deadline_at=not.is.null');
 const ps=await db<Player[]>('players?select=id,name,telegram_user_id&order=sort_order.asc');let reminded=0,revealed=0;
 for(const round of rounds){const deadline=new Date(round.deadline_at),left=deadline.getTime()-now.getTime();const ms=await db<Match[]>(`matches?select=id,home_team,away_team&round_id=eq.${round.id}&order=created_at.asc`);const ids=new Set(ms.map(m=>m.id));const prs=await db<Prediction[]>('predictions?select=match_id,player_id,home_score,away_score');
  if(left>0&&left<=60*60*1000&&!round.reminder_sent_at){for(const p of ps){if(!p.telegram_user_id)continue;const n=prs.filter(x=>x.player_id===p.id&&ids.has(x.match_id)).length;if(n<ms.length){try{await send(p.telegram_user_id,`⏰ <b>До дедлайна Тура ${round.round_number} меньше часа</b>\n\nТы сдал ${n}/${ms.length}. Не забудь прогноз!`,{reply_markup:{inline_keyboard:[[{text:'🔮 Сделать прогноз',callback_data:'go:0'}]]}})}catch{}}}await db(`rounds?id=eq.${round.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({reminder_sent_at:now.toISOString()})});reminded++}
  if(left<=0&&!round.predictions_revealed){await db(`rounds?id=eq.${round.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({predictions_revealed:true,reveal_sent_at:now.toISOString()})});const blocks=[`🔓 <b>Прогнозы раскрыты · Тур ${round.round_number}</b>`];for(const m of ms){const line=ps.map(p=>{const pr=prs.find(x=>x.player_id===p.id&&x.match_id===m.id);return`${p.name} <b>${pr?`${pr.home_score}:${pr.away_score}`:'—'}</b>`}).join(' · ');blocks.push('',`⚽ <b>${m.home_team} — ${m.away_team}</b>`,line);const consensus=consensusLine(m,ps,prs);if(consensus)blocks.push(consensus)}for(const p of ps){if(p.telegram_user_id){try{await send(p.telegram_user_id,blocks.join('\n'))}catch{}}}revealed++}
 }
 return{ok:true,reminded,revealed}
}
export async function GET(req:NextRequest){const auth=req.headers.get('authorization');const secret=process.env.CRON_SECRET;if(secret&&auth!==`Bearer ${secret}`)return new NextResponse('Unauthorized',{status:401});try{return NextResponse.json(await run())}catch(e){console.error(e);return NextResponse.json({ok:false},{status:500})}}
