import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
// 측정 결과(events.json 등)를 두는 폴더. 저장소 밖(기본: OS 임시 폴더)에 둔다 — 로그 원문이 들어 있다
export const S=process.env.MEASURE_OUT||path.join(os.tmpdir(),'talk-to-figma-measure');
fs.mkdirSync(S,{recursive:true});
export const load=()=>JSON.parse(fs.readFileSync(S+'/events.json','utf8'));
export const isFig=n=>n.startsWith('mcp__TalkToFigma__');
export const short=n=>n.replace('mcp__TalkToFigma__','');
// 갭: 호출 i 와 다음 호출 사이의 항목
export function gaps(s){ const out=[]; let cur=null; const callById=new Map(s.calls.map(c=>[c.id,c]));
  for(const e of s.timeline){ if(e.k==='call'){ const c=callById.get(e.id); if(cur){cur.next=c; out.push(cur);} cur={call:c,items:[]}; } else if(cur) cur.items.push(e); }
  if(cur) out.push(cur); return out; }
export function ols(X,y){ const k=X[0].length; const A=Array.from({length:k},()=>Array(k+1).fill(0));
  for(let r=0;r<X.length;r++){ for(let i=0;i<k;i++){ for(let j=0;j<k;j++) A[i][j]+=X[r][i]*X[r][j]; A[i][k]+=X[r][i]*y[r]; } }
  for(let i=0;i<k;i++){ let p=i; for(let r=i+1;r<k;r++) if(Math.abs(A[r][i])>Math.abs(A[p][i])) p=r; [A[i],A[p]]=[A[p],A[i]];
    for(let r=0;r<k;r++) if(r!==i){ const f=A[r][i]/A[i][i]; for(let j=i;j<=k;j++) A[r][j]-=f*A[i][j]; } }
  const b=A.map((row,i)=>row[k]/row[i]); const pred=X.map(x=>x.reduce((a,v,i)=>a+v*b[i],0)); const my=y.reduce((a,v)=>a+v,0)/y.length;
  const ssr=y.reduce((a,v,i)=>a+(v-pred[i])**2,0), sst=y.reduce((a,v)=>a+(v-my)**2,0); return {b,r2:1-ssr/sst,n:y.length}; }
export const READ=/^(get_|find_|scan_|read_my_design|export_node_as_image|export_text_tree|inspect_paints|join_channel)/;
export const UI=/^(set_focus|set_selections|select_hardcoded)$/;
export function kind(name,input){ const n=short(name); if(READ.test(n)) return 'read'; if(UI.test(n)) return 'ui'; if(input&&input.dryRun===true) return 'dryrun'; return 'write'; }
