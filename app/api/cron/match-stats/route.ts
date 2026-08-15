import { NextResponse } from 'next/server'

const SUPABASE_URL='https://imjzkiwgkvrxafqweeei.supabase.co'
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltanpraXdna3ZyeGFmcXdlZWVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTY4MTQsImV4cCI6MjEwMjEzMjgxNH0.Iii9aQqBAMBAk7ru5rD0VDpLXro6ZERSoBZgL0t2gbQ'
const headers={apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${SUPABASE_ANON_KEY}`}

type Match={id:string;round_id:string;home_team:string;away_team:string;home_score:number;away_score:number;sports_stats_attempts:number|null}
type Round={round_number:number}
type Stats={xg?:[string,string];shots?:[string,string];onTarget?:[string,string];possession?:[string,string];corners?:[string,string];url:string}

async function db<T>(path:string,init?:RequestInit):Promise<T>{
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{...init,headers:{...headers,...(init?.headers||{})},cache:'no-store'})
  if(!r.ok)throw new Error(await r.text())
  const t=await r.text();return(t?JSON.parse(t):undefined)as T
}
function botToken(){const t=process.env.TELEGRAM_BOT_TOKEN;if(!t)throw new Error('TELEGRAM_BOT_TOKEN missing');return t}
async function send(chatId:number,text:string){const r=await fetch(`https://api.telegram.org/bot${botToken()}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true})});if(!r.ok)throw new Error(await r.text())}
async function primaryGroup(){return(await db<{chat_id:number}[]>('bot_chats?select=chat_id&is_primary=eq.true&limit=1'))[0]?.chat_id}

const aliases:Record<string,string>={
  'локомотив':'lokomotiv','локо':'lokomotiv','оренбург':'orenburg','зенит':'zenit','динамо':'dynamo','динамо москва':'dynamo',
  'балтика':'baltika','спартак':'spartak','краснодар':'krasnodar','цска':'cska','рубин':'rubin','ростов':'rostov','ахмат':'akhmat',
  'крылья советов':'krylia-sovetov','крылья':'krylia-sovetov','акрон':'akron','факел':'fakel','родина':'rodina',
  'динамо махачкала':'dinamo-mx','динамо мх':'dinamo-mx','пари нн':'nizhny-novgorod','нижний новгород':'nizhny-novgorod','сочи':'fc-sochi'
}
function norm(v:string){return v.toLowerCase().replace(/ё/g,'е').replace(/fc|фк/gi,'').replace(/[«»"']/g,'').replace(/\s+/g,' ').trim()}
function slug(v:string){return aliases[norm(v)]||norm(v).replace(/[^a-zа-я0-9]+/gi,'-')}
function decode(s:string){return s.replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&ndash;|&mdash;/g,'-')}
function visibleText(html:string){return decode(html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,'\n')).split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean)}
function pair(lines:string[],label:string){
  const i=lines.findIndex(x=>x.toLowerCase()===label.toLowerCase());if(i<0)return undefined
  const numeric=(x:string)=>/^\d+(?:[.,]\d+)?%?$/.test(x)
  let left:string|undefined,right:string|undefined
  for(let j=i-1;j>=Math.max(0,i-5);j--)if(numeric(lines[j])){left=lines[j].replace(',','.');break}
  for(let j=i+1;j<=Math.min(lines.length-1,i+5);j++)if(numeric(lines[j])){right=lines[j].replace(',','.');break}
  return left&&right?[left,right] as [string,string]:undefined
}
async function sportsStats(m:Match):Promise<Stats|null>{
  const h=slug(m.home_team),a=slug(m.away_team)
  const urls=[`https://www.sports.ru/football/match/${h}-vs-${a}/stat/`,`https://www.sports.ru/football/match/${a}-vs-${h}/stat/`]
  for(const url of urls){
    try{
      const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (compatible; RPLPredictor/1.0)'},redirect:'follow',cache:'no-store'});if(!r.ok)continue
      const html=await r.text(),lines=visibleText(html)
      const page=lines.join(' ').toLowerCase();if(!page.includes(norm(m.home_team))||!page.includes(norm(m.away_team)))continue
      const result:Stats={url,xg:pair(lines,'Ожидаемые голы (xG)'),shots:pair(lines,'Удары по воротам'),onTarget:pair(lines,'Удары в створ'),possession:pair(lines,'Владение мячом'),corners:pair(lines,'Угловые удары')}
      if([result.xg,result.shots,result.onTarget,result.possession,result.corners].filter(Boolean).length>=2)return result
    }catch{}
  }
  return null
}
function statsText(m:Match,round:number,s:Stats){
  const lines=[`📊 <b>${m.home_team} ${m.home_score}:${m.away_score} ${m.away_team} · статистика</b>`]
  if(s.xg)lines.push(`xG: <b>${s.xg[0]} — ${s.xg[1]}</b>`)
  if(s.shots)lines.push(`Удары: <b>${s.shots[0]} — ${s.shots[1]}</b>`)
  if(s.onTarget)lines.push(`🎯 В створ: <b>${s.onTarget[0]} — ${s.onTarget[1]}</b>`)
  if(s.possession)lines.push(`Владение: <b>${s.possession[0]} — ${s.possession[1]}</b>`)
  if(s.corners)lines.push(`Угловые: <b>${s.corners[0]} — ${s.corners[1]}</b>`)
  if(s.xg){const hx=Number(s.xg[0].replace('%','')),ax=Number(s.xg[1].replace('%',''));if(Number.isFinite(hx)&&Number.isFinite(ax)){const actual=Math.sign(m.home_score-m.away_score),xg=Math.sign(hx-ax);if(actual!==0&&xg!==0&&actual!==xg)lines.push('💡 Победитель по счёту уступил сопернику по xG.');else if(Math.abs(hx-ax)>=1)lines.push(`💡 По xG преимущество было заметным: ${Math.abs(hx-ax).toFixed(2)}.`)}}
  lines.push(`<i>Sports.ru · Тур ${round}</i>`)
  return lines.join('\n')
}

async function run(){
  const group=await primaryGroup();if(!group)return{ok:false,reason:'no_primary_group'}
  const matches=await db<Match[]>('matches?select=id,round_id,home_team,away_team,home_score,away_score,sports_stats_attempts&home_score=not.is.null&away_score=not.is.null&sports_stats_sent_at=is.null&sports_stats_attempts=lt.30&order=id.asc&limit=5')
  let sent=0,retried=0
  for(const m of matches){
    const attempts=(m.sports_stats_attempts||0)+1,stats=await sportsStats(m)
    if(!stats){await db(`matches?id=eq.${m.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({sports_stats_attempts:attempts})});retried++;continue}
    const round=(await db<Round[]>(`rounds?select=round_number&id=eq.${m.round_id}&limit=1`))[0]?.round_number||0
    await send(group,statsText(m,round,stats))
    await db(`matches?id=eq.${m.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({sports_stats_attempts:attempts,sports_stats_sent_at:new Date().toISOString()})});sent++
  }
  return{ok:true,checked:matches.length,sent,retried}
}

export async function GET(){try{return NextResponse.json(await run())}catch(e){console.error(e);return NextResponse.json({ok:false},{status:500})}}
