// 1) MCP 서버를 stdio 로 띄워 tools/list 를 받아 S/tools.json 에 쓴다. 사용: node list.mjs dist/server.cjs
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import {S} from './lib.mjs';
const p = spawn('node', [process.argv[2] || 'dist/server.cjs'], { stdio: ['pipe','pipe','ignore'] });
let buf='';
p.stdout.on('data', d => { buf += d; const lines = buf.split('\n'); buf = lines.pop();
  for (const l of lines) { if(!l.trim()) continue; const m = JSON.parse(l);
    if (m.id===2) { fs.writeFileSync(S+'/tools.json', JSON.stringify(m.result)); console.log('tools', m.result.tools.length, '→', S+'/tools.json'); p.kill(); process.exit(0);} } });
const send = o => p.stdin.write(JSON.stringify(o)+'\n');
send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'measure',version:'1'}}});
setTimeout(()=>{ send({jsonrpc:'2.0',method:'notifications/initialized'}); send({jsonrpc:'2.0',id:2,method:'tools/list',params:{}}); },500);
setTimeout(()=>process.exit(1),8000);
