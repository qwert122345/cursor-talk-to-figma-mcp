// 세션별 API 호출·도구 결과 타임라인 추출 → events.json
import fs from 'node:fs'; import path from 'node:path'; import {S} from './lib.mjs';
const root=process.env.HOME+'/.claude/projects';
const files=[]; (function walk(q){ for(const f of fs.readdirSync(q)){ const r=path.join(q,f); const st=fs.statSync(r); if(st.isDirectory()){ if(f!=='subagents') walk(r); } else if(f.endsWith('.jsonl')&&fs.readFileSync(r,'utf8').includes('"name":"mcp__TalkToFigma__')) files.push(r); } })(root);
const defs=Object.fromEntries(JSON.parse(fs.readFileSync(S+'/tools.json')).tools.map(t=>[t.name,JSON.stringify(t).length]));
function pngDims(b64){ try{ const b=Buffer.from(b64.slice(0,64),'base64'); if(b.toString('ascii',1,4)==='PNG') return [b.readUInt32BE(16),b.readUInt32BE(20)]; }catch{} return null; }
const out=[];
for(const f of files){
  const calls=[]; const byId=new Map(); const results=new Map(); const toolUse=new Map(); let lastCall=null; const prompts=[];
  const timeline=[]; // ordered: {k:'call',id} | {k:'res',tid} | {k:'prompt',chars} | {k:'compact'}
  for(const l of fs.readFileSync(f,'utf8').split('\n')){ if(!l)continue; let m;try{m=JSON.parse(l)}catch{continue};
    if(m.isSidechain) continue;
    const msg=m.message; if(!msg) continue;
    if(m.type==='assistant'&&msg.id){
      let c=byId.get(msg.id);
      if(!c){ const u=msg.usage||{}; c={id:msg.id,model:msg.model,ctx:(u.input_tokens||0)+(u.cache_read_input_tokens||0)+(u.cache_creation_input_tokens||0),cr:u.cache_read_input_tokens||0,cw:u.cache_creation_input_tokens||0,inp:u.input_tokens||0,out:u.output_tokens||0,text:0,thinking:0,tools:[]}; byId.set(msg.id,c); calls.push(c); timeline.push({k:'call',id:msg.id}); }
      else { const u=msg.usage||{}; c.out=Math.max(c.out,u.output_tokens||0); }
      for(const b of (msg.content||[])){ if(b.type==='text') c.text+=b.text.length; if(b.type==='thinking') c.thinking+=(b.thinking||'').length;
        if(b.type==='tool_use'&&!toolUse.has(b.id)){ const t={tid:b.id,name:b.name,input:b.input,inChars:JSON.stringify(b.input).length}; toolUse.set(b.id,t); c.tools.push(t);} }
    }
    if(m.type==='user'){
      if(m.isCompactSummary){ timeline.push({k:'compact'}); continue; }
      if(typeof msg.content==='string'){ if(!m.isMeta && !/^<(command|local-command)/.test(msg.content)) timeline.push({k:'prompt',chars:msg.content.length,text:msg.content.slice(0,80)}); continue; }
      for(const b of (msg.content||[])){
        if(b.type==='text'&&!m.isMeta&&!/^<(system-reminder|command|local-command)/.test(b.text)) timeline.push({k:'prompt',chars:b.text.length,text:b.text.slice(0,80)});
        if(b.type==='tool_result'&&!results.has(b.tool_use_id)){
          const cc=Array.isArray(b.content)?b.content:[{type:'text',text:String(b.content??'')}];
          let text=''; const imgs=[]; let refs=[];
          for(const x of cc){ if(x.type==='text') text+=x.text; if(x.type==='image') imgs.push(pngDims(x.source?.data||'')||[0,0]); if(x.type==='tool_reference') refs.push(x.tool_name); }
          const r={tid:b.tool_use_id,chars:text.length,imgs,refs,isErr:!!b.is_error,text};
          results.set(b.tool_use_id,r); timeline.push({k:'res',tid:b.tool_use_id});
        } } }
  }
  out.push({file:f.replace(root,''),calls,timeline,toolUse:Object.fromEntries(toolUse),results:Object.fromEntries(results)});
}
fs.writeFileSync(S+'/events.json',JSON.stringify(out));
const models={}; out.forEach(s=>s.calls.forEach(c=>models[c.model]=(models[c.model]||0)+1)); console.log('sessions',out.length,'models',models);
