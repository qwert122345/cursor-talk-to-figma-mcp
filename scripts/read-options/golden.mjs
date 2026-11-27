// MCP 서버 빌드 하나를 stdio 로 띄워 같은 호출 목록을 부르고, 결과 텍스트를 파일로 남긴다. 두 빌드의 결과를 바이트로 비교한다.
//
//   부르기: node scripts/read-options/golden.mjs run <server.cjs> <채널> <calls.json> <출력 폴더>
//   비교:   node scripts/read-options/golden.mjs compare <폴더 A> <폴더 B> [라벨 접두사...]
//   크기:   node scripts/read-options/golden.mjs size <폴더>
//
// calls.json = [{ "label": "seed-check", "name": "get_nodes_info", "args": { "nodeIds": [...] } }, ...]
// 노드 id 가 든 calls.json 과 출력 폴더는 저장소 밖에 둔다. 읽기 명령만 넣는다(쓰기 명령을 넣지 않는다).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TOKENS_PER_CHAR = 0.516; // 피그마 결과의 토큰/글자 (review/code-mode 측정 문서의 usage 회귀값)
const [, , mode, ...rest] = process.argv;

async function run(server, channel, callsFile, outDir) {
  const calls = JSON.parse(fs.readFileSync(callsFile, "utf8"));
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const p = spawn("node", [server], { stdio: ["pipe", "pipe", "ignore"] });
  let buf = "", next = 1; const waiting = new Map();
  p.stdout.on("data", (d) => {
    buf += d; const lines = buf.split("\n"); buf = lines.pop();
    for (const l of lines) { if (!l.trim()) continue; const m = JSON.parse(l); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } }
  });
  const rpc = (method, params, ms = 300000) => new Promise((res, rej) => {
    const id = next++; waiting.set(id, res); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); rej(new Error(`${method} 시간 초과`)); } }, ms);
  });
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "golden", version: "1" } });
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  await new Promise((r) => setTimeout(r, 1500)); // 중계 서버 연결
  const j = await rpc("tools/call", { name: "join_channel", arguments: { channel } });
  if (j.result?.isError) throw new Error("join_channel 실패: " + JSON.stringify(j.result));
  for (const c of calls) {
    const m = await rpc("tools/call", { name: c.name, arguments: c.args });
    const body = m.error ? `RPC_ERROR ${JSON.stringify(m.error)}` : (m.result.isError ? "IS_ERROR " : "") + (m.result.content || []).map((x) => x.text ?? "").join("");
    fs.writeFileSync(path.join(outDir, c.label + ".txt"), body, { mode: 0o600 });
    console.log(`${c.label}\t${body.length}자`);
  }
  p.kill();
}

function compare(a, b, prefixes) {
  const labels = fs.readdirSync(a).filter((f) => f.endsWith(".txt") && (!prefixes.length || prefixes.some((p) => f.startsWith(p))));
  let diff = 0;
  for (const f of labels) {
    const x = fs.readFileSync(path.join(a, f)), y = fs.existsSync(path.join(b, f)) ? fs.readFileSync(path.join(b, f)) : null;
    const same = y !== null && Buffer.compare(x, y) === 0; if (!same) diff++;
    console.log(`${same ? "같음" : "다름"}\t${f}\t${x.length} / ${y ? y.length : "없음"}바이트`);
  }
  console.log(diff ? `\n${diff}개 다름` : `\n${labels.length}개 모두 같음`); process.exit(diff ? 1 : 0);
}

function size(dir) {
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).sort()) {
    const n = fs.readFileSync(path.join(dir, f), "utf8").length; console.log(`${f}\t${n}자\t약 ${Math.round(n * TOKENS_PER_CHAR)} 토큰`);
  }
}

if (mode === "run" && rest.length === 4) await run(...rest);
else if (mode === "compare" && rest.length >= 2) compare(rest[0], rest[1], rest.slice(2));
else if (mode === "size" && rest.length === 1) size(rest[0]);
else { console.error("사용법은 파일 맨 위 주석"); process.exit(2); }
