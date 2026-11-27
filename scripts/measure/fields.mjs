// 큰 읽기 결과(≥2,000자, JSON) 다음 턴에 실제로 쓴 필드 [측정] → 그 필드만 돌려받았다면의 크기
import {S,load,gaps,isFig,short,kind} from './lib.mjs'; import fs from 'node:fs';
const ses=load(); const KEEP=new Set(['id','name','type']);
function leaves(o,key,acc){ if(o===null||typeof o!=='object'){ acc.push([key,o]); return; } if(Array.isArray(o)) o.forEach(v=>leaves(v,key,acc)); else for(const [k,v] of Object.entries(o)) leaves(v,k,acc); }
function used(v,hay){ if(typeof v==='string') return v.length>=3 && hay.includes(v); if(typeof v==='number') return (Math.abs(v)>=100||!Number.isInteger(v)) && hay.includes(String(v)); return false; }
function project(o,keys){ if(o===null||typeof o!=='object') return o; if(Array.isArray(o)){ const a=o.map(v=>project(v,keys)).filter(v=>v!==undefined); return a.length?a:undefined; }
  const r={}; for(const [k,v] of Object.entries(o)){ if(v!==null&&typeof v==='object'){ const p=project(v,keys); if(p!==undefined) r[k]=p; } else if(keys.has(k)) r[k]=v; } return Object.keys(r).length?r:undefined; }
const items=[]; const cmdKeys={};
for(const s of ses){ const G=gaps(s);
  for(let gi=0;gi<G.length;gi++){ const g=G[gi]; if(!g.next) continue; const nx=g.next;
    // 다음 턴에서 모델이 쓴 것: 텍스트(로그엔 길이만 있으므로 원문에서 다시) + 도구 입력
    for(const e of g.items){ if(e.k!=='res') continue; const t=s.toolUse[e.tid]; const r=s.results[e.tid]; if(!t||!isFig(t.name)||kind(t.name,t.input)!=='read'||r.chars<2000) continue;
      let j; try{ j=JSON.parse(r.text);}catch{continue}
      items.push({s,nx,nm:short(t.name),j,chars:r.chars}); } } }
// 다음 턴 원문: events.json 엔 텍스트 길이만 있어 원본 jsonl 에서 텍스트를 다시 읽는다
const root=process.env.HOME+'/.claude/projects'; const textById=new Map();
for(const s of ses){ for(const l of fs.readFileSync(root+s.file,'utf8').split('\n')){ if(!l)continue; let m;try{m=JSON.parse(l)}catch{continue}; if(m.type!=='assistant'||!m.message?.id) continue;
  let t=textById.get(m.message.id)||''; for(const b of m.message.content||[]){ if(b.type==='text') t+=b.text; if(b.type==='tool_use') t+=JSON.stringify(b.input); } textById.set(m.message.id,t); } }
const stat={};
for(const it of items){ const hay=textById.get(it.nx.id)||''; const acc=[]; leaves(it.j,'',acc); const ks=new Set(); for(const [k,v] of acc) if(used(v,hay)) ks.add(k);
  it.used=ks; (cmdKeys[it.nm]??=new Set()); ks.forEach(k=>cmdKeys[it.nm].add(k)); }
for(const it of items){ const keys1=new Set([...KEEP,...it.used]); const keysC=new Set([...KEEP,...cmdKeys[it.nm]]);
  const p1=JSON.stringify(project(it.j,keys1)??{}).length, pC=JSON.stringify(project(it.j,keysC)??{}).length;
  const st=stat[it.nm]??={n:0,orig:0,p1:0,pC:0,none:0}; st.n++; st.orig+=it.chars; st.p1+=p1; st.pC+=pC; if(!it.used.size) st.none++; }
const p=(a,b)=>(100*(1-a/b)).toFixed(0)+'%';
let O=0,P1=0,PC=0; console.log('명령\t건수\t원래(자)\t이번턴필드만\t명령별합집합필드\t다음턴에값을하나도안씀\t쓴필드(합집합)');
for(const [k,v] of Object.entries(stat).sort((a,b)=>b[1].orig-a[1].orig)){ O+=v.orig;P1+=v.p1;PC+=v.pC; console.log([k,v.n,v.orig,p(v.p1,v.orig),p(v.pC,v.orig),v.none,[...cmdKeys[k]].slice(0,14).join(',')].join('\t')); }
console.log('합계',items.length,'건 원래',O,'줄어듦: 이번턴',p(P1,O),'합집합',p(PC,O));
fs.writeFileSync(S+'/fields.json',JSON.stringify(Object.fromEntries(Object.entries(stat).map(([k,v])=>[k,{...v,keys:[...cmdKeys[k]]}]))));
