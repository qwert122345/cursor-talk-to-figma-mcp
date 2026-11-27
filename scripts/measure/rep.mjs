// 대표 구간 3개: 지금 [측정] vs Code Mode 읽기 전용 [추정]
import {S,load,gaps,isFig,short,kind} from './lib.mjs'; import fs from 'node:fs';
const A_FIG=0.5156, imgTok=imgs=>imgs.reduce((a,[w,h])=>a+101+0.957*(w*h)/750,0);
const F=JSON.parse(fs.readFileSync(S+'/fields.json')); const SCRIPT=250;
const BOT=new Set(['export_text_tree','inspect_paints','build_review_listing']);
const SC=t=>kind(t.name,t.input)==='read'&&!BOT.has(short(t.name))&&!/export_node_as_image|join_channel/.test(t.name);
// 세션은 S1·S2 로 적는다. 실제 세션 id 와의 대응표는 결과 폴더의 session-labels.json(저장소 밖)
const LABELS=JSON.parse(fs.readFileSync(S+'/session-labels.json','utf8'));
const ses=load(); const pick=[['노드 정보 읽기','S1',99],['화면 하나 문구 수정','S2',523],['여러 단계 쓰기','S2',128]];
for(const [label,f,i0] of pick){ const s=ses.find(x=>x.file.includes(LABELS[f])); const G=gaps(s);
  let i=i0; const turns=[]; do{ turns.push(G[i]); i++; } while(i<G.length&&!G[i-1].items.some(e=>e.k==='prompt'));
  let calls=0,figTurns=0,res=0,out=0; const rows=[];
  // Code Mode
  let cmTurns=0,cmRes=0,cmScripts=0; let prevScriptOnly=false;
  for(const g of turns){ const ft=g.call.tools.filter(t=>isFig(t.name)); out+=g.call.out; if(!ft.length){ cmTurns++; prevScriptOnly=false; continue; }
    figTurns++; calls+=ft.length; const sc=ft.filter(SC), di=ft.filter(t=>!SC(t));
    let tRes=0,tCm=0;
    for(const t of ft){ const r=s.results[t.tid]; const tk=r.chars*A_FIG+imgTok(r.imgs); tRes+=tk; const nm=short(t.name);
      if(SC(t)&&r.chars>=2000&&F[nm]) tCm+=tk*(F[nm].p1/F[nm].orig); else tCm+=tk; }
    res+=tRes; cmRes+=tCm; rows.push(ft.map(t=>short(t.name)+(t.input?.dryRun?'(dry)':'')).join('+'));
    const scriptOnly=di.length===0;
    if(scriptOnly&&prevScriptOnly){ /* 앞 스크립트 턴에 합친다 */ } else { cmTurns++; if(sc.length) { cmScripts++; } }
    prevScriptOnly=scriptOnly; }
  console.log(`\n[${label}] ${f} 구간 시작 호출 #${i0}, 시작 문맥 ${Math.round(turns[0].call.ctx/1000)}K`);
  console.log(`  지금 [측정]: 턴 ${turns.length}(피그마 ${figTurns}), 피그마 호출 ${calls}, 대화에 남은 결과 ${Math.round(res)} 토큰, 출력 ${out}`);
  console.log(`  턴별: ${rows.join(' → ')}`);
  console.log(`  Code Mode [추정]: 턴 ${cmTurns}, 스크립트 ${cmScripts}개(출력 +${cmScripts*SCRIPT}), 남을 결과 ${Math.round(cmRes)} 토큰`);
}
