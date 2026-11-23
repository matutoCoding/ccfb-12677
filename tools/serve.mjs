// 零依赖静态文件服务器: node tools/serve.mjs [root] [port]
// 用于离线环境下托管 dist 构建产物 (也可直接双击 dist/index.html)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.argv[2] || 'dist');
const port = Number(process.argv[3] || 8080);
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.wasm': 'application/wasm',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = join(root, p === '/' ? 'index.html' : p);
    if (!(await stat(file).catch(() => null))) file = join(root, 'index.html');
    const buf = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
}).listen(port, () => {
  console.log(`离线服务已启动: http://localhost:${port}/  (根目录: ${fileURLToPath(new URL('../' + root, import.meta.url))})`);
});
