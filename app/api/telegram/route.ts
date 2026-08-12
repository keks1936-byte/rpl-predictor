import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL='https://imjzkiwgkvrxafqweeei.supabase.co'
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltanpraXdna3ZyeGFmcXdlZWVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTY4MTQsImV4cCI6MjEwMjEzMjgxNH0.Iii9aQqBAMBAk7ru5rD0VDpLXro6ZERSoBZgL0t2gbQ'
const BOT_USERNAME='fantasy_rpl_bot'

type TgUser={id:number;username?:string}
type TgMessage={message_id:number;chat:{id:number;type?:string};from?:TgUser;text?:string}
type TgCallback={id:string;from:TgUser;data?:string;message?:TgMessage}
type TgUpdate={message?:TgMessage;callback_query?:TgCallback}
type Player={id:string;name:string;sort_order:number;telegram_user_id:number|null;telegram_username?:string|null;is_admin:boolean}
type Round={id:string;round_number:number;status:string;predictions_revealed?:boolean}
type Match={id:string;round_id:string;home_team:string;away_team:string;home_score:number|null;away_score:number|null}
type Prediction={match_id:string;player_id:string;home_score:number;away_score:number}
type BotSession={telegram_user_id:number;flow:string;step:string;data:Record<string,any>}

const dbHeaders={apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${SUPABASE_ANON_KEY}`}
const isPrivate=(m:TgMessage)=>m.chat.type==='private'
const normalizeSecret=(v:string)=>v.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,256)

async function db<T>(path:string,init?:RequestInit):Promise<T>{
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{...init,headers:{...dbHeaders,...(init?.headers||{})},cache:'no-store'})
  if(!r.ok) throw new Error(await r.text())
  if(r.status===204) return undefined as T
  const t=await r.text(); return (t?JSON.parse(t):undefined) as T
}
function token(){const t=process.env.TELEGRAM_BOT_TOKEN;if(!t)throw new Error('TELEGRAM_BOT_TOKEN missing');return t}
async function tg(method:string,payload:Record<string,unknown>){const r=await fetch(`https://api.telegram.org/bot${token()}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!r.ok)throw new Error(await r.text());return r.json()}
const send=(chatId:number,text:string,extra:Record<string,unknown>={})=>tg('sendMessage',{chat_id:chatId,text,parse_mode:'HTML',...extra})
const edit=(chatId:number,messageId:number,text:string,extra:Record<string,unknown>={})=>tg('editMessageText',{chat_id:chatId,message_id:messageId,text,parse_mode:'HTML',...extra})
const answer=(id:string,text?:string)=>tg('answerCallbackQuery',{callback_query_id:id,...(text?{text}:{})})

const players=()=>db<Player[]>('players?select=id,name,sort_order,telegram_user_id,telegram_username,is_admin&order=sort_order.asc')
async function playerByTg(id:number){return (await db<Player[]>(`players?select=id,name,sort_order,telegram_user_id,telegram_username,is_admin&telegram_user_id=eq.${id}&limit=1`))[0]}
async function openRound(){return (await db<Round[]>('rounds?select=id,round_number,status,predictions_revealed&status=eq.open&order=round_number.asc&limit=1'))[0]}
const roundMatches=(id:string)=>db<Match[]>(`matches?select=id,round_id,home_team,away_team,home_score,away_score&round_id=eq.${id}&order=created_at.asc`)
async function prediction(playerId:string,matchId:string){return (await db<Prediction[]>(`predictions?select=match_id,player_id,home_score,away_score&player_id=eq.${playerId}&match_id=eq.${matchId}&limit=1`))[0]}
async function upsertPrediction(playerId:string,matchId:string,h:number,a:number){await db('predictions?on_conflict=match_id,player_id',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({match_id:matchId,player_id:playerId,home_score:Math.max(0,h),away_score:Math.max(0,a)})})}
async function session(id:number){return (await db<BotSession[]>(`bot_sessions?select=telegram_user_id,flow,step,data&telegram_user_id=eq.${id}&limit=1`))[0]}
async function setSession(id:number,flow:string,step:string,data:Record<string,any>){await db('bot_sessions?on_conflict=telegram_user_id',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({telegram_user_id:id,flow,step,data,updated_at:new Date().toISOString()})})}
const clearSession=(id:number)=>db(`bot_sessions?telegram_user_id=eq.${id}`,{method:'DELETE',headers:{Prefer:'return=minimal'}})
async function admin(id:number){const p=await playerByTg(id);return p?.is_admin?p:undefined}

function outcome(h:number,a:number){return Math.sign(h-a)}
function pts(p:Prediction,m:Match){if(m.home_score===null||m.away_score===null)return 0;if(p.home_score===m.home_score&&p.away_score===m.away_score)return 3;return outcome(p.home_score,p.away_score)===outcome(m.home_score,m.away_score)?1:0}

async function tableText(){
  const [ps,ms,prs]=await Promise.all([players(),db<Match[]>('matches?select=id,round_id,home_team,away_team,home_score,away_score'),db<Prediction[]>('predictions?select=match_id,player_id,home_score,away_score')])
  const rows=ps.map(p=>{let total=0,exact=0;for(const m of ms){if(m.home_score===null)continue;const pr=prs.find(x=>x.player_id===p.id&&x.match_id===m.id);if(!pr)continue;const n=pts(pr,m);total+=n;if(n===3)exact++}return{name:p.name,total,exact}}).sort((a,b)=>b.total-a.total||b.exact-a.exact)
  return ['🏆 <b>Общий зачёт</b>','',...rows.map((r,i)=>`${i+1}. <b>${r.name}</b> — ${r.total} очк. 🎯 ${r.exact}`)].join('\n')
}
async function roundText(){const r=await openRound();if(!r)return'Сейчас нет открытого тура.';const ms=await roundMatches(r.id);return[`⚽ <b>Тур ${r.round_number}</b>`,'',...ms.map((m,i)=>`${i+1}. ${m.home_team} — ${m.away_team}`)].join('\n')}
async function statusText(){
  const r=await openRound();if(!r)return'Сейчас нет открытого тура.'
  const [ps,ms,prs]=await Promise.all([players(),roundMatches(r.id),db<Prediction[]>('predictions?select=match_id,player_id,home_score,away_score')]);const ids=new Set(ms.map(m=>m.id))
  const bits=ps.map(p=>{const n=prs.filter(x=>x.player_id===p.id&&ids.has(x.match_id)).length;return`${n===ms.length?'✅':'⏳'} ${p.name} ${n}/${ms.length}`})
  return `📋 <b>Тур ${r.round_number}</b> · ${bits.join(' · ')}\n${r.predictions_revealed?'🔓 Прогнозы раскрыты':'🔒 Счета скрыты'}`
}
async function predictionsText(){
  const r=await openRound();if(!r)return'Сейчас нет открытого тура.';if(!r.predictions_revealed)return'🔒 Прогнозы пока скрыты.'
  const [ps,ms,prs]=await Promise.all([players(),roundMatches(r.id),db<Prediction[]>('predictions?select=match_id,player_id,home_score,away_score')]);const out=[`🔓 <b>Прогнозы · Тур ${r.round_number}</b>`]
  for(const m of ms){out.push('',`⚽ <b>${m.home_team} — ${m.away_team}</b>`);for(const p of ps){const pr=prs.find(x=>x.player_id===p.id&&x.match_id===m.id);out.push(`${p.name}: <b>${pr?`${pr.home_score}:${pr.away_score}`:'—'}</b>`)}}
  return out.join('\n')
}

async function bindPrompt(chatId:number){const ps=(await players()).filter(p=>!p.telegram_user_id);if(!ps.length){await send(chatId,'Все участники уже привязаны.');return}await send(chatId,'👤 <b>Кто ты?</b>\nВыбери один раз:',{reply_markup:{inline_keyboard:ps.map(p=>[{text:p.name,callback_data:`bind:${p.id}`}])}})}
async function bindPlayer(id:string,u:TgUser){await db('rpc/bind_telegram_player',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_player_id:id,p_telegram_user_id:u.id,p_telegram_username:u.username||null})})}

async function predictionView(p:Player,index:number){
  const r=await openRound();if(!r)return{text:'Сейчас нет открытого тура.',markup:{inline_keyboard:[]}};if(r.predictions_revealed)return{text:'🔒 Приём прогнозов завершён.',markup:{inline_keyboard:[]}}
  const ms=await roundMatches(r.id);index=Math.max(0,Math.min(index,ms.length-1));const m=ms[index],pr=await prediction(p.id,m.id),h=pr?.home_score??0,a=pr?.away_score??0
  const rows:any[]=[
    [{text:'−',callback_data:`sc:${index}:h:-`},{text:`${m.home_team}: ${h}`,callback_data:'noop'},{text:'+',callback_data:`sc:${index}:h:+`}],
    [{text:'−',callback_data:`sc:${index}:a:-`},{text:`${m.away_team}: ${a}`,callback_data:'noop'},{text:'+',callback_data:`sc:${index}:a:+`}]
  ];const nav:any[]=[];if(index>0)nav.push({text:'← Назад',callback_data:`go:${index-1}`});if(index<ms.length-1)nav.push({text:'Далее →',callback_data:`go:${index+1}`});else nav.push({text:'✅ Готово',callback_data:'done'});rows.push(nav)
  return{text:`🔮 <b>Тур ${r.round_number} · ${p.name}</b>\n\nМатч ${index+1} из ${ms.length}\n<b>${m.home_team} — ${m.away_team}</b>\n\nТекущий прогноз: <b>${h}:${a}</b>`,markup:{inline_keyboard:rows}}
}
async function ensureAll(p:Player){const r=await openRound();if(!r||r.predictions_revealed)return;for(const m of await roundMatches(r.id)){if(!await prediction(p.id,m.id))await upsertPrediction(p.id,m.id,0,0)}}
async function summary(p:Player){const r=await openRound();if(!r)return'Нет открытого тура.';const lines=[];for(const m of await roundMatches(r.id)){const pr=await prediction(p.id,m.id);lines.push(`${m.home_team} — ${m.away_team}: <b>${pr?.home_score??0}:${pr?.away_score??0}</b>`)}return[`✅ <b>${p.name}, прогнозы на Тур ${r.round_number} сохранены</b>`,'',...lines,'','До раскрытия их можно изменить через /predict.'].join('\n')}
async function handlePredict(chatId:number,u:TgUser){const p=await playerByTg(u.id);if(!p){await bindPrompt(chatId);return}const v=await predictionView(p,0);await send(chatId,v.text,{reply_markup:v.markup})}

async function startNewRound(chatId:number,u:TgUser){if(!await admin(u.id)){await send(chatId,'⛔ Только для администратора.');return}const rs=await db<Round[]>('rounds?select=id,round_number,status&order=round_number.desc&limit=1');const n=(rs[0]?.round_number||0)+1;await setSession(u.id,'newround','home_1',{round_number:n,matches:[]});await send(chatId,`🛠 <b>Создаём Тур ${n}</b>\n\nМатч 1 из 3. Введи <b>хозяев</b>:`)}
async function handleNewRoundText(chatId:number,u:TgUser,text:string,s:BotSession){const d=s.data||{},ms:Array<{home:string;away:string}>=d.matches||[];const mm=s.step.match(/^(home|away)_(\d)$/);if(!mm)return false;const side=mm[1],i=Number(mm[2]);if(side==='home'){d.pending_home=text.trim();await setSession(u.id,'newround',`away_${i}`,d);await send(chatId,`Матч ${i}: <b>${text.trim()}</b> — ?\nТеперь гости:`);return true}const home=String(d.pending_home||'').trim();ms.push({home,away:text.trim()});d.matches=ms;delete d.pending_home;if(i<3){await setSession(u.id,'newround',`home_${i+1}`,d);await send(chatId,`✅ ${home} — ${text.trim()}\n\nМатч ${i+1} из 3. Хозяева:`);return true}await setSession(u.id,'newround','confirm',d);await send(chatId,[`📋 <b>Тур ${d.round_number}</b>`,'',...ms.map((x,j)=>`${j+1}. ${x.home} — ${x.away}`)].join('\n'),{reply_markup:{inline_keyboard:[[{text:'✅ Сохранить тур',callback_data:'admin:save_round'}],[{text:'❌ Отмена',callback_data:'admin:cancel'}]]}});return true}
async function saveUpcoming(u:TgUser){const s=await session(u.id);if(!s||s.flow!=='newround'||s.step!=='confirm')throw new Error('No draft');const league=(await db<{id:string}[]>('leagues?select=id&order=created_at.asc&limit=1'))[0];const rs=await db<Round[]>('rounds',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({league_id:league.id,round_number:s.data.round_number,status:'upcoming',predictions_revealed:false})});const r=rs[0];await db('matches',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify((s.data.matches||[]).map((m:any)=>({round_id:r.id,home_team:m.home,away_team:m.away})))});await clearSession(u.id);return r}

async function notifyPlayers(r:Round){
  const [ps,ms]=await Promise.all([players(),roundMatches(r.id)]);let sent=0,skipped=0
  const text=[`⚽ <b>Открыт Тур ${r.round_number}</b>`,'',...ms.map((m,i)=>`${i+1}. ${m.home_team} — ${m.away_team}`),'','Прогнозы скрыты до раскрытия.'].join('\n')
  for(const p of ps){if(!p.telegram_user_id){skipped++;continue}try{await send(p.telegram_user_id,text,{reply_markup:{inline_keyboard:[[{text:'🔮 Сделать прогноз',callback_data:'go:0'}]]}});sent++}catch{skipped++}}
  return{sent,skipped}
}
async function activateRound(id:string){await db('rounds?status=eq.open',{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({status:'locked'})});await db(`rounds?id=eq.${id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({status:'open',predictions_revealed:false})});const r=(await db<Round[]>(`rounds?select=id,round_number,status,predictions_revealed&id=eq.${id}&limit=1`))[0];const delivery=await notifyPlayers(r);return{r,delivery}}

async function startResult(chatId:number,u:TgUser){if(!await admin(u.id)){await send(chatId,'⛔ Только для администратора.');return}const rs=await db<Round[]>('rounds?select=id,round_number,status&status=in.(open,locked)&order=round_number.desc');const kb:any[]=[];for(const r of rs){for(const m of (await roundMatches(r.id)).filter(x=>x.home_score===null))kb.push([{text:`Т${r.round_number}: ${m.home_team} — ${m.away_team}`,callback_data:`admin:result:${m.id}`}])}await send(chatId,kb.length?'🧾 <b>Какой матч завершился?</b>':'Все результаты уже внесены.',kb.length?{reply_markup:{inline_keyboard:kb}}:{})}
async function handleResultText(chatId:number,u:TgUser,text:string,s:BotSession){if(s.flow!=='result'||s.step!=='score')return false;const mm=text.trim().match(/^(\d+)\s*[:\-]\s*(\d+)$/);if(!mm){await send(chatId,'Пришли счёт в формате <b>2:1</b>.');return true}const h=Number(mm[1]),a=Number(mm[2]),id=String(s.data.match_id);await db(`matches?id=eq.${id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({home_score:h,away_score:a})});const m=(await db<Match[]>(`matches?select=id,round_id,home_team,away_team,home_score,away_score&id=eq.${id}&limit=1`))[0];const all=await roundMatches(m.round_id);if(all.every(x=>x.home_score!==null&&x.away_score!==null))await db(`rounds?id=eq.${m.round_id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({status:'finished'})});await clearSession(u.id);await send(chatId,`✅ ${m.home_team} <b>${h}:${a}</b> ${m.away_team}`);return true}

async function handleCallback(q:TgCallback){
  const d=q.data||'',m=q.message;if(!m){await answer(q.id);return}
  if(d==='noop'){await answer(q.id);return}
  if(d==='status:refresh'){await answer(q.id);await edit(m.chat.id,m.message_id,await statusText(),{reply_markup:{inline_keyboard:[[{text:'🔄 Обновить',callback_data:'status:refresh'}]]}});return}
  if(d.startsWith('bind:')){try{await bindPlayer(d.slice(5),q.from);const p=await playerByTg(q.from.id);await answer(q.id,`Ты — ${p?.name}`);if(p){const v=await predictionView(p,0);await edit(m.chat.id,m.message_id,v.text,{reply_markup:v.markup})}}catch{await answer(q.id,'Имя уже занято')}return}
  if(d==='admin:cancel'){await clearSession(q.from.id);await answer(q.id,'Отменено');await edit(m.chat.id,m.message_id,'❌ Отменено.');return}
  if(d==='admin:save_round'){if(!await admin(q.from.id)){await answer(q.id,'Нет доступа');return}const r=await saveUpcoming(q.from);const ms=await roundMatches(r.id);await answer(q.id,'Сохранено');await edit(m.chat.id,m.message_id,[`✅ <b>Тур ${r.round_number} сохранён</b>`,'',...ms.map((x,i)=>`${i+1}. ${x.home_team} — ${x.away_team}`)].join('\n'),{reply_markup:{inline_keyboard:[[{text:`▶️ Открыть Тур ${r.round_number}`,callback_data:`admin:open:${r.id}`}]]}});return}
  if(d.startsWith('admin:open:')){if(!await admin(q.from.id)){await answer(q.id,'Нет доступа');return}const {r,delivery}=await activateRound(d.slice('admin:open:'.length));await answer(q.id,'Тур открыт');await edit(m.chat.id,m.message_id,`▶️ <b>Тур ${r.round_number} открыт</b>\n\n📨 Отправлено в личку: ${delivery.sent}\n⚠️ Не доставлено: ${delivery.skipped}`);return}
  if(d.startsWith('admin:result:')){if(!await admin(q.from.id)){await answer(q.id,'Нет доступа');return}const id=d.slice('admin:result:'.length),x=(await db<Match[]>(`matches?select=id,round_id,home_team,away_team,home_score,away_score&id=eq.${id}&limit=1`))[0];await setSession(q.from.id,'result','score',{match_id:id});await answer(q.id);await edit(m.chat.id,m.message_id,`🧾 <b>${x.home_team} — ${x.away_team}</b>\nПришли счёт, например <b>2:1</b>`);return}
  if(d==='admin:reveal'){if(!await admin(q.from.id)){await answer(q.id,'Нет доступа');return}const r=await openRound();if(!r){await answer(q.id,'Нет тура');return}await db(`rounds?id=eq.${r.id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({predictions_revealed:true})});await answer(q.id,'Раскрыто');await edit(m.chat.id,m.message_id,await predictionsText());return}
  const p=await playerByTg(q.from.id);if(!p){await answer(q.id,'Сначала открой бота в личке и выбери имя');return}
  if(d.startsWith('sc:')){const [,ii,side,dir]=d.split(':');const i=Number(ii),r=await openRound();if(!r||r.predictions_revealed){await answer(q.id,'Приём закрыт');return}const ms=await roundMatches(r.id),x=ms[i];if(!x){await answer(q.id);return}const pr=await prediction(p.id,x.id);let h=pr?.home_score??0,a=pr?.away_score??0,delta=dir==='+'?1:-1;if(side==='h')h=Math.max(0,h+delta);else a=Math.max(0,a+delta);await upsertPrediction(p.id,x.id,h,a);const v=await predictionView(p,i);await answer(q.id);await edit(m.chat.id,m.message_id,v.text,{reply_markup:v.markup});return}
  if(d.startsWith('go:')){const v=await predictionView(p,Number(d.slice(3)));await answer(q.id);await edit(m.chat.id,m.message_id,v.text,{reply_markup:v.markup});return}
  if(d==='done'){await ensureAll(p);await answer(q.id,'Сохранено');await edit(m.chat.id,m.message_id,await summary(p),{reply_markup:{inline_keyboard:[[{text:'✏️ Изменить',callback_data:'go:0'}]]}});return}
  await answer(q.id)
}

export async function GET(){return NextResponse.json({ok:true,bot:BOT_USERNAME,mode:'private-round-notifications'})}
export async function POST(req:NextRequest){
  try{
    const raw=process.env.TELEGRAM_WEBHOOK_SECRET,s=raw?normalizeSecret(raw):'';if(s&&req.headers.get('x-telegram-bot-api-secret-token')!==s)return new NextResponse('Unauthorized',{status:401})
    const u:TgUpdate=await req.json();if(u.callback_query){await handleCallback(u.callback_query);return NextResponse.json({ok:true})}
    const m=u.message;if(!m?.text)return NextResponse.json({ok:true});const parts=m.text.trim().split(/\s+/),cmd=parts[0].split('@')[0].toLowerCase()
    if((cmd==='/start'||cmd==='/help')&&m.from){if(isPrivate(m)&&parts[1]==='predict'){await handlePredict(m.chat.id,m.from);return NextResponse.json({ok:true})}const a=await admin(m.from.id);await send(m.chat.id,'⚽ <b>РПЛ Predictor</b>\n\n/table — зачёт\n/round — матчи тура\n/status — кто сдал\n/predict — прогноз'+(a?'\n\n🛠 /newround · /result · /reveal':''));return NextResponse.json({ok:true})}
    if(cmd==='/table')await send(m.chat.id,await tableText())
    else if(cmd==='/round')await send(m.chat.id,await roundText())
    else if(cmd==='/status')await send(m.chat.id,await statusText(),{reply_markup:{inline_keyboard:[[{text:'🔄 Обновить',callback_data:'status:refresh'}]]}})
    else if(cmd==='/predictions')await send(m.chat.id,await predictionsText())
    else if(cmd==='/predict'&&m.from){if(isPrivate(m))await handlePredict(m.chat.id,m.from);else await send(m.chat.id,'🔒 Прогноз — в личке',{reply_markup:{inline_keyboard:[[{text:'🔮 Открыть бота',url:`https://t.me/${BOT_USERNAME}?start=predict`}]]}})}
    else if(cmd==='/newround'&&m.from)await startNewRound(m.chat.id,m.from)
    else if(cmd==='/result'&&m.from)await startResult(m.chat.id,m.from)
    else if(cmd==='/reveal'&&m.from){if(!await admin(m.from.id))await send(m.chat.id,'⛔ Только для администратора.');else await send(m.chat.id,'🔓 Раскрыть прогнозы и закрыть приём?',{reply_markup:{inline_keyboard:[[{text:'✅ Раскрыть',callback_data:'admin:reveal'}]]}})}
    else if(m.from){const s=await session(m.from.id);if(s?.flow==='newround'&&await handleNewRoundText(m.chat.id,m.from,m.text,s))return NextResponse.json({ok:true});if(s?.flow==='result'&&await handleResultText(m.chat.id,m.from,m.text,s))return NextResponse.json({ok:true})}
    return NextResponse.json({ok:true})
  }catch(e){console.error(e);return NextResponse.json({ok:false},{status:500})}
}
