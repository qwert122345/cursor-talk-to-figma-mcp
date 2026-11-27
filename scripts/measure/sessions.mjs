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

// ── 읽기 옵션(fields·summary·maxDepth) 사용 — feat/read-fields 합친 뒤의 세션에서 의미가 있다 ──
// 대상 6개 명령의 정의가 늘어난 토큰(main 1d073aa → fb4319c 의 tools/list 글자 차이 × 0.43) [측정·환산]
const DEF_PLUS = { get_node_info: 246, get_nodes_info: 246, get_variable_bindings: 85, find_nodes_by_name: 147, find_hidden_nodes: 131, get_instance_census: 191 };
// 옵션별 감소율: 골든 시험(리뷰 페이지의 같은 노드, 옵션 없음 대비)에서 잰 값. 옵션을 쓴 결과에서 원래 크기를 되짚는 데 쓴다 → 절감량은 [추정]
const CUT = { get_node_info: { maxDepth: 0.983, fields: 0.157 }, get_nodes_info: { maxDepth: 0.983, fields: 0.221 },
  find_hidden_nodes: { summary: 0.994, fields: 0.718 }, find_nodes_by_name: { summary: 0.998, fields: 0.271 },
  get_instance_census: { summary: 0.943, fields: 0.584 }, get_variable_bindings: { summary: 0.883 } };
const TPC = 0.516;
const opt = []; for (const s of load()) { const start = startOf(s.file); const loaded = new Set(); let target = 0, used = 0, saved = 0, kept = 0;
  for (const r of Object.values(s.results)) (r.refs || []).forEach((n) => { const k = n.replace('mcp__TalkToFigma__', ''); if (DEF_PLUS[k]) loaded.add(k); });
  for (const [tid, t] of Object.entries(s.toolUse)) { const k = t.name.replace('mcp__TalkToFigma__', ''); if (!DEF_PLUS[k]) continue; loaded.add(k); target++;
    const a = t.input || {}; const kind = a.summary === true ? 'summary' : a.maxDepth !== undefined ? 'maxDepth' : a.fields !== undefined ? 'fields' : null; if (!kind) continue;
    used++; const res = (s.results[tid]?.chars || 0) * TPC; kept += res; const r = Math.min(0.99, CUT[k]?.[kind] ?? 0); saved += res * r / (1 - r); }
  const defCost = [...loaded].reduce((x, k) => x + DEF_PLUS[k], 0);
  opt.push({ trial: start >= since, target, used, defCost, saved, kept }); }
for (const [lab, g] of [['기준', opt.filter((o) => !o.trial)], ['시범', opt.filter((o) => o.trial)]]) { if (!g.length) continue;
  const sum = (f) => g.reduce((x, o) => x + o[f], 0); const T = sum('target'), U = sum('used'), D = sum('defCost'), V = sum('saved');
  console.log(`${lab} 읽기 옵션 | 대상 6개 호출 ${T}회 중 옵션 ${U}회 (${T ? (100 * U / T).toFixed(1) : 0}%) [측정] | 늘어난 정의 ${K(D)} [측정·환산] vs 줄어든 결과 ${K(V)} [추정] → ${D ? (V / D).toFixed(1) + '배' : '정의 안 불러옴'}`); }
