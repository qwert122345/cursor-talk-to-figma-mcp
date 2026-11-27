// 세 방식 비교 시뮬레이션: Code Mode(읽기 전용 접기 + 결과 거르기) / fields 옵션 / 세션 나누기
import {S,load,gaps,isFig,short,kind} from './lib.mjs'; import fs from 'node:fs';
const A_FIG=0.5156, imgTok=imgs=>imgs.reduce((a,[w,h])=>a+101+0.957*(w*h)/750,0);
const F=JSON.parse(fs.readFileSync(S+'/fields.json'));
const P=JSON.parse(process.argv[2]||'{}'); const SCRIPT=P.script??250, KEEP=P.keep??0.3, FAIL=P.fail??0.2, ERR=P.err??300, H=P.handoff??2000, SEARCH=P.search??600;
const BOT=new Set(['export_text_tree','inspect_paints','build_review_listing']);
const SCRIPTABLE=n=>{ const s=short(n); return kind(n,{})==='read' && !BOT.has(s) && s!=='export_node_as_image' && s!=='join_channel'; };
const ses=load(); const T={calls:0,A:0,R:0,figTurns:0,readTurns:0,streaks:0,extra:0,dep:0,pairs:0,fold:{R:0,A:0},filt:{R:0,A:0,n:0},fieldsU:{R:0,A:0},fieldsO:{R:0,A:0},split:{R:0,Aplus:0,segs:0},split2:{R:0,Aplus:0,segs:0}};
for(const s of ses){ const G=gaps(s); if(!G.length) continue; const calls=G.map(g=>g.call); const n=calls.length; const base=calls[0].ctx; const M=calls.map(c=>Math.max(0,c.ctx-base));
  // 경계: 압축, 사용자 입력
  const comp=Array(n).fill(false), prompt=Array(n).fill(null);
  for(let i=0;i<n-1;i++){ const g=G[i]; if(g.items.some(e=>e.k==='compact')||calls[i+1].ctx<calls[i].ctx*0.7) comp[i+1]=true; const pr=g.items.find(e=>e.k==='prompt'); if(pr) prompt[i+1]=pr; }
  const lifeAfter=i=>{ let k=0; for(let j=i+1;j<n;j++){ if(comp[j]) break; k++; } return k; }; // 호출 i 뒤로 몇 번 더 읽히나
  T.calls+=n; T.R+=M.reduce((a,b)=>a+b,0); for(let i=0;i<n-1;i++) T.A+=Math.max(0,calls[i+1].ctx-calls[i].ctx);
  const resTok=i=>G[i].items.filter(e=>e.k==='res').reduce((a,e)=>{const r=s.results[e.tid],t=s.toolUse[e.tid]; return a+(t&&isFig(t.name)?r.chars*A_FIG+imgTok(r.imgs):0);},0);
  const RT=calls.map(c=>c.tools.length>0&&c.tools.every(t=>isFig(t.name)&&SCRIPTABLE(t.name)));
  calls.forEach((c,i)=>{ if(c.tools.some(t=>isFig(t.name))) T.figTurns++; if(RT[i]) T.readTurns++; });
  // 1) 읽기 전용 연속 턴 접기
  for(let i=0;i<n;){ if(!RT[i]){i++;continue;} let j=i; while(j+1<n&&RT[j+1]&&!prompt[j+1]&&!comp[j+1]) j++;
    if(j>i){ T.streaks++; T.extra+=j-i;
      for(let k=i;k<j;k++){ T.pairs++; const ids=new Set(); G[k].items.filter(e=>e.k==='res').forEach(e=>{(s.results[e.tid].text.match(/I?\d+:\d+(;\d+:\d+)*/g)||[]).forEach(x=>ids.add(x));});
        const inp=calls[k+1].tools.map(t=>JSON.stringify(t.input)).join(' '); if([...ids].some(x=>x.length>4&&inp.includes(x))) T.dep++; }
      let removedR=0; for(let k=i+1;k<=j;k++) removedR+=M[k];
      let orig=0; for(let k=i;k<=j;k++) orig+=calls[k].out+resTok(k);
      let inter=0; for(let k=i;k<j;k++) inter+=resTok(k);
      const repl=calls[i].out+SCRIPT+resTok(j)+KEEP*inter; const net=orig-repl; const life=lifeAfter(j);
      const retry=FAIL*(M[i]+(ERR+SCRIPT)*life);
      T.fold.R+=removedR+net*life-retry; T.fold.A+=net-FAIL*(ERR+SCRIPT); }
    i=j+1; }
  // 2) 결과 거르기: 큰 읽기 결과(≥2000자) — Code Mode 는 스크립트로(이번 턴 필드만), fields 옵션은 합집합/이번턴
  for(let i=0;i<n-1;i++){ for(const e of G[i].items){ if(e.k!=='res') continue; const t=s.toolUse[e.tid]; if(!t||!isFig(t.name)) continue; const nm=short(t.name); const r=s.results[e.tid];
      if(!SCRIPTABLE(t.name)||r.chars<2000||!F[nm]) continue; const tok=r.chars*A_FIG; const life=lifeAfter(i);
      const fo=1-F[nm].p1/F[nm].orig, fu=1-F[nm].pC/F[nm].orig;
      T.fieldsO.A+=tok*fo; T.fieldsO.R+=tok*fo*life; T.fieldsU.A+=tok*fu; T.fieldsU.R+=tok*fu*life;
      const cm=tok*fo-SCRIPT-FAIL*(ERR+SCRIPT); T.filt.n++; if(cm>0){ T.filt.A+=cm; T.filt.R+=cm*life-FAIL*M[i]; } } }
  // 3) 세션 나누기: (가) 모든 사용자 입력마다 (나) 200자 이상 입력만
  for(const [key,minLen] of [['split',0],['split2',200]]){ let segStart=0; let segs=1;
    for(let i=0;i<n;i++){ if(i>0&&prompt[i]&&prompt[i].chars>=minLen){ segStart=i; segs++; }
      const Mi=segStart===0?M[i]:Math.max(0,calls[i].ctx-calls[segStart].ctx)+H; T[key].R+=M[i]-Mi; }
    T[key].segs+=segs; T[key].Aplus+=(segs-1)*H; }
}
const pc=(a,b)=>(100*a/b).toFixed(1)+'%', K=x=>(x/1e3).toFixed(0)+'K', MM=x=>(x/1e6).toFixed(1)+'M';
console.log('params',{SCRIPT,KEEP,FAIL,ERR,H});
console.log('호출',T.calls,'A',K(T.A),'R',MM(T.R),'호출당 평균 Messages',K(T.R/T.calls));
console.log('피그마 턴',T.figTurns,'스크립트로 갈 수 있는 읽기 턴',T.readTurns,'읽기 연속 묶음',T.streaks,'접을 수 있는 턴',T.extra,`(피그마 턴의 ${pc(T.extra,T.figTurns)})`,'앞 결과 id 를 다음 입력에 씀',`${T.dep}/${T.pairs}`);
for(const f of [0.1,0.4,0.7,1]) console.log(`접기 ${f*100}%: A −${K(T.fold.A*f)} (${pc(T.fold.A*f,T.A)}), R −${MM(T.fold.R*f)} (${pc(T.fold.R*f,T.R)})`);
console.log('Code Mode 결과 거르기(큰 읽기 결과',T.filt.n,'건): A −'+K(T.filt.A),pc(T.filt.A,T.A),'R −'+MM(T.filt.R),pc(T.filt.R,T.R));
console.log('fields 옵션 보수(명령별 합집합): A −'+K(T.fieldsU.A),pc(T.fieldsU.A,T.A),'R −'+MM(T.fieldsU.R),pc(T.fieldsU.R,T.R));
console.log('fields 옵션 낙관(이번 턴 필드): A −'+K(T.fieldsO.A),pc(T.fieldsO.A,T.A),'R −'+MM(T.fieldsO.R),pc(T.fieldsO.R,T.R));
console.log('세션 나누기(모든 입력):',T.split.segs,'구간, R −'+MM(T.split.R),pc(T.split.R,T.R),'A +'+K(T.split.Aplus),pc(T.split.Aplus,T.A));
console.log('세션 나누기(200자 이상 입력만):',T.split2.segs,'구간, R −'+MM(T.split2.R),pc(T.split2.R,T.R),'A +'+K(T.split2.Aplus),pc(T.split2.Aplus,T.A));
fs.writeFileSync(S+'/sim.json',JSON.stringify(T));
