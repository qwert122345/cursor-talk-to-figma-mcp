// Messages 구성 [측정]: 갭마다 Δctx 를 피그마 결과 / 기타 도구 결과 / 모델 출력 / 나머지로 나눈다
import {S,load,gaps,isFig,short,kind} from './lib.mjs'; import fs from 'node:fs';
const A_FIG=0.5156, A_OTH=0.6437; // calib.mjs 회귀계수
const imgTok=imgs=>imgs.reduce((a,[w,h])=>a+101+0.957*(w*h)/750,0);
const ses=load(); const tot={A:0,R:0,fig:0,figR:0,figDerived:0,figDerivedR:0,out:0,othTool:0,figCalls:0,calls:0,figTurns:0,compactions:0,imgTok:0};
const byCmd={}; const overflow={}; const perSession=[]; const resRows=[];
for(const s of ses){ const G=gaps(s); if(!G.length) continue; const base=G[0].call.ctx; let A=0,R=0,fig=0,figR=0;
  // 압축 경계: compact 항목 또는 ctx 30% 이상 감소
  const callIdx=new Map(s.calls.map((c,i)=>[c.id,i])); const n=s.calls.length; const boundary=[]; // boundary[i]=true 면 호출 i 직전에 압축
  for(let gi=0;gi<G.length;gi++){ const g=G[gi]; if(g.next && (g.items.some(e=>e.k==='compact') || g.next.ctx<g.call.ctx*0.7)) boundary[callIdx.get(g.next.id)]=true; }
  const lifeFrom=i=>{ let k=0; for(let j=i;j<n;j++){ if(j>i-1&&boundary[j]&&j!==i) break; k++; } return k; }; // 호출 i 부터 압축 전까지 읽히는 호출 수
  let segBase=base;
  for(let gi=0;gi<G.length;gi++){ const g=G[gi]; const ci=callIdx.get(g.call.id);
    if(boundary[ci]) { segBase=g.call.ctx; tot.compactions++; }
    R+=Math.max(0,g.call.ctx-base); tot.calls++;
    if(g.call.tools.some(t=>isFig(t.name))) tot.figTurns++;
    if(!g.next) continue; const d=g.next.ctx-g.call.ctx; const nextI=ci+1; const life=lifeFrom(nextI);
    if(d>0) A+=d;
    tot.out+=g.call.out;
    for(const e of g.items){ if(e.k!=='res') continue; const r=s.results[e.tid]; const t=s.toolUse[e.tid]; if(!t) continue;
      if(isFig(t.name)){ const tk=r.chars*A_FIG+imgTok(r.imgs); tot.imgTok+=imgTok(r.imgs); fig+=tk; figR+=tk*life; tot.figCalls++;
        const nm=short(t.name); const k=kind(t.name,t.input); const b=byCmd[nm]??={calls:0,tok:0,tokR:0,kind:new Set(),dry:0,max:0,ov:0,ovChars:0}; b.calls++; b.tok+=tk; b.tokR+=tk*life; b.kind.add(k); if(k==='dryrun')b.dry++; b.max=Math.max(b.max,r.chars);
        const m=r.text.slice(0,300).match(/result \(([\d,]+) characters|Output too large \(([\d.]+)KB\)/);
        if(m){ const real=m[1]?+m[1].replace(/,/g,''):Math.round(+m[2]*1024); b.ov++; b.ovChars+=real; overflow[nm]=(overflow[nm]||0)+1; }
        resRows.push({s:s.file,nm,k,chars:r.chars,tok:tk,life,tid:e.tid});
      } else { const tk=r.chars*A_OTH; const inp=JSON.stringify(t.input||{});
        if(/tool-results\/(mcp-TalkToFigma|toolu_)/.test(inp)){ tot.figDerived+=tk; tot.figDerivedR+=tk*life; } else tot.othTool+=tk; } }
  }
  tot.A+=A; tot.R+=R; tot.fig+=fig; tot.figR+=figR; perSession.push({f:s.file.split('/').pop().slice(0,8),calls:s.calls.length,A:Math.round(A),fig:Math.round(fig),R:Math.round(R),figR:Math.round(figR)});
}
const p=(a,b)=>(100*a/b).toFixed(1)+'%'; const K=x=>(x/1000).toFixed(0)+'K';
console.log('호출',tot.calls,'피그마 결과',tot.figCalls,'피그마 턴',tot.figTurns,'압축',tot.compactions);
console.log('Messages 추가량 A',K(tot.A),'| 피그마 결과',K(tot.fig),p(tot.fig,tot.A),'| 그중 이미지',K(tot.imgTok),'| 파일로 빠진 결과 다시 읽기',K(tot.figDerived),p(tot.figDerived,tot.A),'| 모델 출력',K(tot.out),p(tot.out,tot.A),'| 기타 도구',K(tot.othTool),p(tot.othTool,tot.A));
console.log('다시 읽기량 R',(tot.R/1e6).toFixed(1)+'M','| 피그마 결과',(tot.figR/1e6).toFixed(1)+'M',p(tot.figR,tot.R),'| 파일 재읽기',p(tot.figDerivedR,tot.R));
const rows=Object.entries(byCmd).map(([k,v])=>({k,...v,kind:[...v.kind].join('/')})).sort((a,b)=>b.tok-a.tok);
console.log('\n명령\t종류\t호출\t결과토큰\tA비율\tR비율\t평균\t최대자\t파일로빠짐(원래크기합)\tdryRun');
rows.slice(0,22).forEach(r=>console.log([r.k,r.kind,r.calls,K(r.tok),p(r.tok,tot.A),p(r.tokR,tot.R),Math.round(r.tok/r.calls),r.max,r.ov+(r.ov?`(${K(r.ovChars)}자)`:''),r.dry].join('\t')));
const top10=rows.slice(0,10); console.log('\n상위10 합: A비율',p(top10.reduce((a,r)=>a+r.tok,0),tot.A),'피그마결과중',p(top10.reduce((a,r)=>a+r.tok,0),tot.fig),'R비율',p(top10.reduce((a,r)=>a+r.tokR,0),tot.R));
const rd=rows.filter(r=>!/write/.test(r.kind)).slice(0,10), wr=rows.filter(r=>/write/.test(r.kind)).slice(0,10);
console.log('읽기 상위10',rd.map(r=>r.k).join(','),'A',p(rd.reduce((a,r)=>a+r.tok,0),tot.A),'R',p(rd.reduce((a,r)=>a+r.tokR,0),tot.R));
console.log('쓰기 상위10',wr.map(r=>r.k).join(','),'A',p(wr.reduce((a,r)=>a+r.tok,0),tot.A),'R',p(wr.reduce((a,r)=>a+r.tokR,0),tot.R));
console.log('파일로 빠진 결과',Object.values(overflow).reduce((a,b)=>a+b,0),JSON.stringify(overflow));
console.log('\nsessions'); perSession.forEach(x=>console.log(Object.values(x).join('\t')));
fs.writeFileSync(S+'/compose.json',JSON.stringify({tot,rows,resRows}));
