/**
 * 演示Demo — Express 服务器入口
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const path       = require('path');

const demosRouter    = require('./routes/demos');
const uploadRouter   = require('./routes/upload');
const { countDemos } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── 中间件 ────────────────────────────────────────────────────────────────────

// 允许所有来源跨域（开发 & 内嵌 iframe 场景）
app.use(cors());

// JSON 请求体，限制 50MB（演示含 base64 截图）
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态文件：将项目根目录作为静态资源目录
// index.html、app.html、creator.html、player.html、js/、css/ 均可直接访问
app.use(express.static(path.join(__dirname, '..')));

// ── 路由 ──────────────────────────────────────────────────────────────────────

// REST API
app.use('/api/demos',      demosRouter);
app.use('/api/screenshot', uploadRouter);

// 健康检查（独立路径，方便负载均衡器探活）
app.get('/api/health', (req, res) => {
  try {
    const demos = countDemos();
    return res.json({ status: 'ok', version: '1.0.0', demos });
  } catch (err) {
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

// 公开分享路由：/share/:slug → 重定向到 player.html?id=<demoId>
// player.html 自己从 IndexedDB 或 /api/demos/:id 加载内容
const { getDemoBySlug } = require('./db');

app.get('/share/:slug', (req, res) => {
  const { slug } = req.params;

  try {
    const record = getDemoBySlug(slug);

    if (!record) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
          <meta charset="UTF-8">
          <title>演示不存在 — 演示Demo</title>
          <style>
            body { font-family: system-ui, sans-serif; display: flex; align-items: center;
                   justify-content: center; height: 100vh; margin: 0; background: #f8fafc; }
            .box { text-align: center; color: #64748b; }
            h1 { font-size: 2rem; margin-bottom: .5rem; }
          </style>
        </head>
        <body>
          <div class="box">
            <h1>404</h1>
            <p>该演示链接不存在或已被删除。</p>
            <a href="/">返回首页</a>
          </div>
        </body>
        </html>
      `);
    }

    // 重定向到 player.html，携带 demo id
    return res.redirect(`/player.html?id=${encodeURIComponent(record.id)}&slug=${encodeURIComponent(slug)}`);
  } catch (err) {
    console.error('[GET /share/:slug]', err);
    return res.status(500).send('服务器内部错误');
  }
});

// ── 404 兜底 ──────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在', path: req.originalUrl });
});

// ── 全局错误处理 ───────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[未捕获错误]', err);
  res.status(500).json({ error: '服务器内部错误', detail: err.message });
});

// ── 启动 ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;

  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║         演示Demo  后端服务             ║');
  console.log('  ╠═══════════════════════════════════════╣');
  console.log(`  ║  本地地址：${url.padEnd(28)}║`);
  console.log(`  ║  健康检查：${(url + '/api/health').padEnd(28)}║`);
  console.log(`  ║  演示列表：${(url + '/api/demos').padEnd(28)}║`);
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('');
});

module.exports = app; // 方便测试
