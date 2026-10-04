/**
 * serve.cjs 鈥斺€?浠呬负楠屾敹鑰岃捣鐨勬湰鍦伴潤鎬佹湇鍔★紙涓嶆槸搴旂敤鐨勪竴閮ㄥ垎锛? *
 * 浣滅敤鏈変袱涓紝閮芥槸"鍙栬瘉"鐢ㄩ€旓細
 *  1. 璁╃湡瀹炴祻瑙堝櫒鑳介€氳繃 http:// 鎵撳紑搴旂敤锛坒ile:// 涓嬮〉闈㈤噷鐨?fetch 鍥炰紶浼氳鎷︼級
 *  2. 鎶婃祻瑙堝櫒鑷繁鍙戝嚭鐨勮姹傞€愭潯璁拌繘鏃ュ織 鈥斺€?鏃ュ織鏄?*琚綔鐢ㄧ郴缁熷悙鍑烘潵鐨勯噺**锛? *     椤甸潰鎶ュ憡浜嗕粈涔堛€佽姹備簡鍝簺璧勬簮銆佹湁娌℃湁 404锛岄兘鍦ㄨ繖閲岋紝涓嶉潬鎴戝杩? *
 * 鐢ㄦ硶锛歯ode tools/serve.cjs [port] [root]
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const port = Number(process.argv[2] || 4188);
const root = path.resolve(process.argv[3] || path.join(__dirname, '..'));
const logFile = path.join(root, 'tools', 'server.log');
fs.writeFileSync(logFile, '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function log(line) {
  const s = `[${new Date().toISOString().slice(11, 23)}] ${line}`;
  console.log(s);
  fs.appendFileSync(logFile, s + '\n');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/__report') {
    log(`REPORT pass=${url.searchParams.get('pass')} fail=${url.searchParams.get('fail')} failed=${url.searchParams.get('failed') || '-'}`);
    res.writeHead(204).end();
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(root, rel.replace(/^[/\\]+/, ''));
  if (!file.startsWith(root)) { log(`403 ${rel}`); res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { log(`404 ${rel}`); res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
    log(`200 ${rel} (${data.length}B)`);
  });
});

server.listen(port, '127.0.0.1', () => log(`SERVE http://127.0.0.1:${port}/  root=${root}`));
