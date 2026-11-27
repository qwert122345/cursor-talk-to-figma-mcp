// 세션 나누기 시범 측정: 세션별 다시 읽는 Messages·첫 턴·넘겨받기·압축 횟수 [측정]
// 사용: node sessions.mjs --since 2026-11-28   (그 날짜 이후 시작한 세션 = 시범, 이전 = 기준)
import {S,load,gaps,isFig} from './lib.mjs'; import fs from 'node:fs';
const root=process.env.HOME+'/.claude/projects';
const since=(process.argv.indexOf('--since')>0)?process.argv[process.argv.indexOf('--since')+1]:null;
if(!since){ console.error('--since YYYY-MM-DD 를 주세요'); process.exit(1); }
const startOf=f=>{ for(const l of fs.readFileSync(root+f,'utf8').split('\n')){ if(!l) continue; try{ const m=JSON.parse(l); if(m.timestamp) return m.timestamp.slice(0,10); }catch{} } return '0000-00-00'; };
const rows=[];
for(const s of load()){ const G=gaps(s); if(!G.length) continue; const calls=G.map(g=>g.call); const base=calls[0].ctx;
  const R=calls.reduce((a,c)=>a+Math.max(0,c.ctx-base),0);
  let comp=0; for(let i=0;i<G.length-1;i++) if(G[i].items.some(e=>e.k==='compact')||calls[i+1].ctx<calls[i].ctx*0.7) comp++;
  const fi=calls.findIndex(c=>c.tools.some(t=>isFig(t.name))); const preFig=fi>0?calls[fi].ctx-base:0; // 첫 피그마 호출 전까지 붙은 토큰(요약 읽기·파일 다시 읽기 등)
  rows.push({id:s.file.split('/').pop().slice(0,8),start:startOf(s.file),trial:startOf(s.file)>=since,calls:calls.length,R,first:base,firstWrite:calls[0].cw,preFig,comp}); }
const med=a=>{ const b=[...a].sort((x,y)=>x-y); return b.length?b[b.length>>1]:0; }, avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0, K=x=>(x/1e3).toFixed(1)+'K', M=x=>(x/1e6).toFixed(2)+'M';
console.log('세션\t시작\t구분\t호출\tR(다시읽기 합)\t호출당\t첫턴문맥\t첫턴캐시쓰기\t첫피그마전\t압축');
for(const r of rows.sort((a,b)=>a.start.localeCompare(b.start))) console.log([r.id,r.start,r.trial?'시범':'기준',r.calls,M(r.R),K(r.R/r.calls),K(r.first),K(r.firstWrite),K(r.preFig),r.comp].join('\t'));
for(const [lab,g] of [['기준',rows.filter(r=>!r.trial)],['시범',rows.filter(r=>r.trial)]]){ if(!g.length){ console.log(`\n${lab}: 세션 없음`); continue; }
  console.log(`\n${lab} ${g.length}세션 | 세션당 R 평균 ${M(avg(g.map(r=>r.R)))} 중앙값 ${M(med(g.map(r=>r.R)))} | 호출당 R 중앙값 ${K(med(g.map(r=>r.R/r.calls)))} | 첫 턴 문맥 중앙값 ${K(med(g.map(r=>r.first)))} | 첫 피그마 전 토큰 중앙값 ${K(med(g.map(r=>r.preFig)))} | 압축 세션당 ${avg(g.map(r=>r.comp)).toFixed(2)}회`); }
