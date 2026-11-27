// 2·3·4번: Messages 항목별 내역, 파일로 빠진 결과 다시 읽기, 세션 나누기 순감소 (events.json + 원본 jsonl)
import {S,load,gaps,isFig,short} from './lib.mjs'; import fs from 'node:fs';
const A_FIG=0.5156, A_OTH=0.6437, A_DEF=0.43; const imgTok=imgs=>imgs.reduce((a,[w,h])=>a+101+0.957*(w*h)/750,0);
const root=process.env.HOME+'/.claude/projects'; const ses=load(); const P=JSON.parse(process.argv[2]||'{}');
const SUM=P.summary??2000, REREAD=P.reread??5000, REFETCH=P.refetch??3000, MINLEN=P.minLen??200;
const C={A:0,out:0,vis:0,figRes:0,figImg:0,ts:0,tsN:0,skill:0,skillN:0,other:{},otherImg:0,userPrompt:0,meta:0,compact:0}; const ov={n:0,reads:0,readTok:0,readsBy:{},filesRead:0};
const first=[]; const split={gross:0,startPrefix:0,startPrefixW:0,reload:0,handoff:0,segs:0,newSegs:0};
for(const s of ses){ const G=gaps(s); if(!G.length) continue; const calls=G.map(g=>g.call); const n=calls.length;
  // 원본에서 사용자 텍스트 분류(글자 수)
  let promptCh=0,metaCh=0,skillCh=0,compactCh=0;
  for(const l of fs.readFileSync(root+s.file,'utf8').split('\n')){ if(!l)continue; let m;try{m=JSON.parse(l)}catch{continue}; if(m.isSidechain||m.type!=='user') continue; const c=m.message?.content;
    const texts=typeof c==='string'?[c]:(Array.isArray(c)?c.filter(b=>b.type==='text').map(b=>b.text):[]);
    for(const t of texts){ if(m.isCompactSummary) compactCh+=t.length; else if(/Base directory for this skill/.test(t)) skillCh+=t.length; else if(m.isMeta||/^<(system-reminder|command|local-command)/.test(t)) metaCh+=t.length; else promptCh+=t.length; } }
  // 갭별 Δ 를 나눈다
  let resid=0; const tsGapTok=[];
  for(let i=0;i<n-1;i++){ const g=G[i]; const d=calls[i+1].ctx-calls[i].ctx; if(d<=0) continue; C.A+=d; let known=g.call.out; C.out+=g.call.out;
    C.vis+=(g.call.text+g.call.tools.reduce((a,t)=>a+t.inChars,0))*A_OTH;
    for(const e of g.items){ if(e.k!=='res') continue; const t=s.toolUse[e.tid]; const r=s.results[e.tid]; if(!t) continue;
      if(isFig(t.name)){ const tk=r.chars*A_FIG; C.figRes+=tk; C.figImg+=imgTok(r.imgs); known+=tk+imgTok(r.imgs); continue; }
      if(t.name==='ToolSearch'){ continue; } // 정의 로드는 아래에서 Δ로 잰다
      const tk=r.chars*A_OTH, it=imgTok(r.imgs); known+=tk+it;
      if(t.name==='Skill'){ C.skill+=tk; C.skillN++; continue; }
      C.other[t.name]=(C.other[t.name]||0)+tk; C.otherImg+=it; }
    // ToolSearch 만 있는 갭: Δ − 출력 = 정의 로드 토큰 [측정]
    if(g.call.tools.length&&g.call.tools.every(t=>t.name==='ToolSearch')){ const v=Math.max(0,d-g.call.out); C.ts+=v; C.tsN++; known+=v; tsGapTok.push(v); }
    resid+=Math.max(0,d-known); }
  // 나머지(Δ 중 설명 안 된 것)를 사용자 텍스트 종류별 글자 비율로 나눈다 [추정 배분]
  const tot=promptCh+metaCh+skillCh+compactCh||1; C.userPrompt+=resid*promptCh/tot; C.meta+=resid*metaCh/tot; C.skill+=resid*skillCh/tot; C.compact+=resid*compactCh/tot;
  // 4) 파일로 빠진 결과와 그 파일 다시 읽기
  const saved=new Map();
  for(const [tid,t] of Object.entries(s.toolUse)){ if(!isFig(t.name)) continue; const r=s.results[tid]; if(!r) continue; const m=r.text.slice(0,600).match(/(tool-results\/[^\s"]+)/); if(m&&/exceeds maximum|Output too large/.test(r.text.slice(0,300))){ ov.n++; saved.set(m[1].split('/').pop().replace(/\.$/,''),tid); } }
  const filesHit=new Set();
  for(const [tid,t] of Object.entries(s.toolUse)){ if(isFig(t.name)) continue; const inp=JSON.stringify(t.input||{}); for(const f of saved.keys()){ if(inp.includes(f)){ ov.reads++; const r=s.results[tid]; ov.readTok+=(r?r.chars:0)*A_OTH; ov.readsBy[t.name]=(ov.readsBy[t.name]||0)+1; filesHit.add(f); break; } } }
  ov.filesRead+=filesHit.size;
  // 첫 턴 [측정]
  first.push({ctx:calls[0].ctx,cw:calls[0].cw,cr:calls[0].cr});
  // 2) 세션 나누기: 경계 = MINLEN 자 이상 사용자 입력. 재로드 = 이 세션의 ToolSearch 로드 중앙값×개수 근사 → 세션 평균 로드량
  const sessReload=tsGapTok.reduce((a,b)=>a+b,0)+(P.join??20); // 그 세션에서 도구 정의를 불러온 총량(세션당) — 새 세션도 같은 만큼 다시 불러온다고 본다
  const base=calls[0].ctx; const M=calls.map(c=>Math.max(0,c.ctx-base));
  const prompt=Array(n).fill(null); for(let i=0;i<n-1;i++){ const pr=G[i].items.find(e=>e.k==='prompt'); if(pr) prompt[i+1]=pr; }
  let segStart=0, segs=1;
  for(let i=0;i<n;i++){ if(i>0&&prompt[i]&&prompt[i].chars>=MINLEN){ segStart=i; segs++; split.startPrefix+=base; split.startPrefixW+=calls[0].cw||base; }
    if(segStart>0){ const Mi=Math.max(0,calls[i].ctx-calls[segStart].ctx); split.gross+=M[i]-Mi; split.reload+=sessReload; split.handoff+=SUM+REREAD+REFETCH; } }
  split.segs+=segs; split.newSegs+=segs-1;
}
const K=x=>(x/1e3).toFixed(0)+'K', MM=x=>(x/1e6).toFixed(1)+'M', pc=(a,b)=>(100*a/b).toFixed(1)+'%';
console.log('=== 3) Messages 추가량 A 내역 ===  A',K(C.A));
const think=C.out-C.vis;
const rows=[['피그마 결과(텍스트)',C.figRes],['피그마 이미지',C.figImg],['모델 출력 중 보이는 부분(텍스트·도구 입력)',C.vis],['모델 출력 중 생각',think],['도구 정의 로드(ToolSearch)',C.ts],['스킬 로드',C.skill],['다른 도구 결과 이미지(스크린샷 등)',C.otherImg],...Object.entries(C.other).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>['도구 결과: '+k,v]),['도구 결과: 그 밖',Object.entries(C.other).sort((a,b)=>b[1]-a[1]).slice(8).reduce((a,[,v])=>a+v,0)],['사용자 입력',C.userPrompt],['시스템 알림·훅·명령 출력',C.meta],['압축 요약',C.compact]];
rows.forEach(([k,v])=>console.log(k,'\t',K(v),'\t',pc(v,C.A))); console.log('합',pc(rows.reduce((a,[,v])=>a+v,0),C.A),'ToolSearch 갭',C.tsN,'Skill 호출',C.skillN);
console.log('\n=== 4) 파일로 빠진 결과 ===',JSON.stringify(ov));
console.log('피그마 몫: 결과만',pc(C.figRes+C.figImg,C.A),'→ 다시 읽기 포함',pc(C.figRes+C.figImg+ov.readTok,C.A));
const fc=first.map(f=>f.ctx).sort((a,b)=>a-b), fw=first.map(f=>f.cw).sort((a,b)=>a-b);
console.log('\n=== 2) 첫 턴 ===  문맥 중앙값',fc[fc.length>>1],'최소',fc[0],'최대',fc.at(-1),'| 캐시 쓰기 중앙값',fw[fw.length>>1]);
const R=730.4e6; const net=split.gross-split.reload-split.handoff;
console.log('경계',MINLEN,'자 이상 입력 → 구간',split.segs,'새 세션',split.newSegs);
console.log('총감소',MM(split.gross),pc(split.gross,R),'| 재로드(도구 정의 등) −',MM(split.reload),'| 넘겨받기 −',MM(split.handoff),'| 순감소',MM(net),pc(net,R));
console.log('시작 프리픽스(캐시 쓰기) 새 세션마다',K(split.startPrefixW/Math.max(1,split.newSegs)),'평균, 합',MM(split.startPrefixW),'— 1회 읽기로 치면',pc(net-split.startPrefixW,R),'· Opus 5.5 1시간 캐시 쓰기($8)=읽기($0.20)의 40배로 치면',pc(net-40*split.startPrefixW,R));
