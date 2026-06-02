/**
 * /api/demos  路由
 * 演示 CRUD + 统计分析端点
 */

const express = require('express');
const router  = express.Router();

const {
  saveDemo,
  getDemo,
  getDemoBySlug,
  getAllDemos,
  deleteDemo,
  incrementViews,
  updateStepStat,
  countDemos,
} = require('../db');

// ── POST /api/demos ───────────────────────────────────────────────────────────
// 发布（新增或更新）一个演示，返回 id、slug、shareUrl
router.post('/', (req, res) => {
  try {
    const demoObj = req.body;

    if (!demoObj || typeof demoObj !== 'object') {
      return res.status(400).json({ error: '请求体必须是合法的 JSON 对象' });
    }
    if (!demoObj.id) {
      return res.status(400).json({ error: '演示对象缺少必填字段：id' });
    }
    if (!demoObj.title) {
      demoObj.title = '未命名演示';
    }

    const saved = saveDemo(demoObj);

    const shareUrl = buildShareUrl(req, saved.slug);

    return res.status(201).json({
      id:       saved.id,
      slug:     saved.slug,
      title:    saved.title,
      shareUrl,
      message:  '演示已成功发布',
    });
  } catch (err) {
    console.error('[POST /api/demos]', err);
    return res.status(500).json({ error: '服务器内部错误，发布失败', detail: err.message });
  }
});

// ── GET /api/demos ────────────────────────────────────────────────────────────
// 列出全部演示（不含 data 字段）
router.get('/', (req, res) => {
  try {
    const list = getAllDemos();
    return res.json(list);
  } catch (err) {
    console.error('[GET /api/demos]', err);
    return res.status(500).json({ error: '获取演示列表失败', detail: err.message });
  }
});

// ── GET /api/demos/:id ────────────────────────────────────────────────────────
// 获取单个演示完整 JSON
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const record = getDemo(id);

    if (!record) {
      return res.status(404).json({ error: '演示不存在或已被删除' });
    }

    // 将存储的 data 字符串解析后合并统计字段一起返回
    let demoData;
    try {
      demoData = JSON.parse(record.data);
    } catch (_) {
      demoData = {};
    }

    return res.json({
      ...demoData,
      _meta: {
        slug:        record.slug,
        views:       record.views,
        completions: record.completions,
        step_stats:  record.step_stats,
        created_at:  record.created_at,
        updated_at:  record.updated_at,
        shareUrl:    buildShareUrl(req, record.slug),
      },
    });
  } catch (err) {
    console.error('[GET /api/demos/:id]', err);
    return res.status(500).json({ error: '获取演示失败', detail: err.message });
  }
});

// ── DELETE /api/demos/:id ─────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const deleted = deleteDemo(id);

    if (!deleted) {
      return res.status(404).json({ error: '演示不存在或已被删除' });
    }

    return res.json({ message: '演示已成功删除', id });
  } catch (err) {
    console.error('[DELETE /api/demos/:id]', err);
    return res.status(500).json({ error: '删除演示失败', detail: err.message });
  }
});

// ── PUT /api/demos/:id/view ───────────────────────────────────────────────────
// 播放器每次加载时调用，自增浏览次数
router.put('/:id/view', (req, res) => {
  try {
    const { id } = req.params;
    const record = getDemo(id);

    if (!record) {
      return res.status(404).json({ error: '演示不存在' });
    }

    incrementViews(id);
    return res.json({ message: '浏览次数已更新' });
  } catch (err) {
    console.error('[PUT /api/demos/:id/view]', err);
    return res.status(500).json({ error: '更新浏览次数失败', detail: err.message });
  }
});

// ── PUT /api/demos/:id/step/:idx ──────────────────────────────────────────────
// 播放器每翻到一步时调用，自增该步骤浏览次数
router.put('/:id/step/:idx', (req, res) => {
  try {
    const { id, idx } = req.params;
    const stepIndex = parseInt(idx, 10);

    if (isNaN(stepIndex) || stepIndex < 0) {
      return res.status(400).json({ error: '步骤索引必须是非负整数' });
    }

    const record = getDemo(id);
    if (!record) {
      return res.status(404).json({ error: '演示不存在' });
    }

    updateStepStat(id, stepIndex);
    return res.json({ message: `步骤 ${stepIndex} 统计已更新` });
  } catch (err) {
    console.error('[PUT /api/demos/:id/step/:idx]', err);
    return res.status(500).json({ error: '更新步骤统计失败', detail: err.message });
  }
});

// ── GET /api/demos/:id/analytics ─────────────────────────────────────────────
// 返回演示的统计分析数据
router.get('/:id/analytics', (req, res) => {
  try {
    const { id } = req.params;
    const record = getDemo(id);

    if (!record) {
      return res.status(404).json({ error: '演示不存在' });
    }

    const stepStats = Array.isArray(record.step_stats) ? record.step_stats : [];
    const completionRate = record.views > 0
      ? Math.round((record.completions / record.views) * 100)
      : 0;

    return res.json({
      id:             record.id,
      views:          record.views,
      completions:    record.completions,
      completionRate: `${completionRate}%`,
      stepStats,
      updatedAt:      record.updated_at,
    });
  } catch (err) {
    console.error('[GET /api/demos/:id/analytics]', err);
    return res.status(500).json({ error: '获取统计数据失败', detail: err.message });
  }
});

// ── GET /api/health ───────────────────────────────────────────────────────────
// 健康检查（也挂在 demos 路由文件里，通过 index.js 正确挂载）
router.get('/health', (req, res) => {
  try {
    const demos = countDemos();
    return res.json({ status: 'ok', version: '1.0.0', demos });
  } catch (err) {
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

// ── 辅助函数 ──────────────────────────────────────────────────────────────────
function buildShareUrl(req, slug) {
  return `${req.protocol}://${req.get('host')}/share/${slug}`;
}

module.exports = router;
