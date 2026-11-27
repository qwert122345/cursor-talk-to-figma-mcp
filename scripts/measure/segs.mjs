// 사용자 입력 사이 구간마다 피그마 호출 순서·결과 토큰 [측정]
import {S,load,gaps,isFig,short,kind} from './lib.mjs'; import fs from 'node:fs';
const A_FIG=0.5156, imgTok=imgs=>imgs.reduce((a,[w,h])=>a+101+0.957*(w*h)/750,0);
const ses=load(); const segs=[];
for(const s of ses){ const G=gaps(s); let cur=null;
  const start=(i,pr)=>{ cur={s:s.file.split('/').pop().slice(0,8),i0:i,prompt:pr?.text||'',turns:0,figTurns:0,calls:[],resTok:0,out:0,M0:G[i]?.call.ctx||0}; segs.push(cur); };
  start(0,null);
  for(let i=0;i<G.length;i++){ const g=G[i];
    cur.turns++; cur.out+=g.call.out; if(g.call.tools.some(t=>isFig(t.name))) cur.figTurns++;
    for(const t of g.call.tools) if(isFig(t.name)){ const r=s.results[t.tid]; const tk=r?r.chars*A_FIG+imgTok(r.imgs):0; cur.calls.push({n:short(t.name),k:kind(t.name,t.input),tk:Math.round(tk),turn:cur.turns}); cur.resTok+=tk; }
    const pr=g.items.find(e=>e.k==='prompt'); if(pr&&G[i+1]) start(i+1,pr); } }
const fmt=x=>`${x.s}@${x.i0} turns=${x.turns} fig=${x.figTurns} calls=${x.calls.length} res=${Math.round(x.resTok)} out=${x.out} ctx0=${Math.round(x.M0/1000)}K | ${x.prompt.replace(/\s+/g,' ').slice(0,50)}\n   `+x.calls.map(c=>`${c.turn}:${c.n}${c.k==='dryrun'?'(dry)':''}[${c.tk}]`).join(' ');
const A=segs.filter(x=>x.calls.length>=2&&x.calls.length<=8&&x.calls.every(c=>/get_node|get_nodes_info|get_selection|find_nodes/.test(c.n)));
const B=segs.filter(x=>x.calls.length<=14&&x.calls.some(c=>/set_multiple_text_contents|set_text_content/.test(c.n))&&x.calls.some(c=>c.k==='read'&&c.n!=='export_node_as_image'));
const C=segs.filter(x=>x.calls.length>=4&&x.calls.length<=20&&x.calls.filter(c=>c.k==='write'||c.k==='dryrun').length>=2&&new Set(x.calls.map(c=>c.n)).size>=3&&!x.calls.some(c=>/set_multiple_text|set_text_content/.test(c.n)));
console.log('A 읽기',A.length); A.slice(0,5).forEach(x=>console.log(fmt(x)));
console.log('\nB 문구',B.length); B.slice(0,5).forEach(x=>console.log(fmt(x)));
console.log('\nC 여러단계쓰기',C.length); C.slice(0,6).forEach(x=>console.log(fmt(x)));
fs.writeFileSync(S+'/segs.json',JSON.stringify(segs));
