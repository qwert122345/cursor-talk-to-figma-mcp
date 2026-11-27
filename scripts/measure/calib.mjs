import {S,load,gaps,isFig,ols,short} from './lib.mjs'; import fs from 'node:fs';
const defs=Object.fromEntries(JSON.parse(fs.readFileSync(S+'/tools.json')).tools.map(t=>['mcp__TalkToFigma__'+t.name,JSON.stringify(t).length]));
const ses=load(); const X=[],y=[]; const big=[]; const imgOnly=[]; const ts=[];
for(const s of ses){ for(const g of gaps(s)){ if(!g.next) continue; const c=g.call; if(!c.tools.length) continue;
  if(g.items.some(e=>e.k!=='res')) continue; const tids=new Set(c.tools.map(t=>t.tid)); if(g.items.length!==c.tools.length||!g.items.every(e=>tids.has(e.tid))) continue;
  const d=g.next.ctx-c.ctx; if(d<0) continue;
  let fig=0,oth=0,img=0,imgPix=0; const asst=c.text+c.tools.reduce((a,t)=>a+t.inChars+t.name.length,0);
  for(const e of g.items){ const r=s.results[e.tid]; const t=s.toolUse[e.tid]; if(isFig(t.name)) fig+=r.chars; else oth+=r.chars; img+=r.imgs.length; r.imgs.forEach(([w,h])=>imgPix+=w*h); }
  const allTS=c.tools.every(t=>t.name==='ToolSearch');
  if(allTS){ let dc=0; for(const e of g.items){ (s.results[e.tid].refs||[]).forEach(n=>dc+=defs[n]||0);} ts.push({d,out:c.out,asst,dc,refs:g.items.reduce((a,e)=>a+(s.results[e.tid].refs||[]).length,0),fig:g.items.reduce((a,e)=>a+(s.results[e.tid].refs||[]).filter(isFig).length,0)}); continue; }
  if(img===0) { X.push([fig,oth,asst,c.out,1]); y.push(d); }
  if(img===0&&oth===0&&fig>8000) big.push({d,fig,out:c.out,asst});
  if(img>0&&fig+oth<2000) imgOnly.push({d,img,imgPix,out:c.out,asst,chars:fig+oth});
}}
const r=ols(X,y); console.log('OLS Δctx = a·figChars + b·otherChars + c·asstChars + d·outTok + e', r.b.map(v=>v.toFixed(4)), 'R2',r.r2.toFixed(3),'n',r.n);
const rat=big.map(b=>(b.d-b.out)/b.fig).sort((a,b)=>a-b), rat2=big.map(b=>b.d/b.fig).sort((a,b)=>a-b);
console.log('big fig-only gaps',big.length,'tok/char (Δ-out)/chars median',rat[rat.length>>1].toFixed(4),'p25',rat[rat.length>>2].toFixed(4),'p75',rat[(rat.length*3)>>2].toFixed(4),' Δ/chars median',rat2[rat2.length>>1].toFixed(4));
// images
const ri=ols(imgOnly.map(o=>[o.img,o.imgPix/750,o.out,1]),imgOnly.map(o=>o.d)); console.log('img gaps',imgOnly.length,'coef [perImg, perPix/750, out, c]',ri.b.map(v=>v.toFixed(3)),'R2',ri.r2.toFixed(3));
const perImg=imgOnly.filter(o=>o.img===1).map(o=>({t:o.d-o.out,px:o.imgPix})); perImg.sort((a,b)=>a.t-b.t); console.log('single-image gaps',perImg.length,'median Δ-out',perImg[perImg.length>>1]?.t,'median px/750',Math.round(perImg.map(p=>p.px).sort((a,b)=>a-b)[perImg.length>>1]/750));
// tool defs
const tsr=ols(ts.map(t=>[t.dc,t.out,1]),ts.map(t=>t.d)); console.log('ToolSearch gaps',ts.length,'coef [defChars,out,c]',tsr.b.map(v=>v.toFixed(4)),'R2',tsr.r2.toFixed(3));
const tsF=ts.filter(t=>t.fig===t.refs&&t.refs>0); const rr=tsF.map(t=>(t.d-t.out)/t.dc).sort((a,b)=>a-b); console.log('figma-only ToolSearch gaps',tsF.length,'(Δ-out)/defChars median',rr[rr.length>>1]?.toFixed(4),'p25',rr[rr.length>>2]?.toFixed(4),'p75',rr[(rr.length*3)>>2]?.toFixed(4));
console.log('sample',tsF.slice(0,8).map(t=>`${t.refs}tools d=${t.d} out=${t.out} defChars=${t.dc}`).join('\n'));
