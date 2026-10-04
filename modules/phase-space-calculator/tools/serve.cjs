/**
 * serve.cjs —— 仅为验收而起的本地静态服务（不是应用的一部分）
 *
 * 作用有两个，都是"取证"用途：
 *  1. 让真实浏览器能通过 http:// 打开应用（file:// 下页面里的 fetch 回传会被拦）
 *  2. 把浏览器自己发出的请求逐条记进日志 —— 日志是**被作用系统吐出来的量**：
 *     页面报告了什么、请求了哪些资源、有没有 404，都在这里，不靠我复述
 *
 * 用法：node tools/serve.cjs [port] [root]
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
