/**
 * /api/screenshot  路由（占位，功能待开发）
 * 未来用于：给定 URL，截图并返回 base64 图片
 */

const express = require('express');
const router  = express.Router();

// POST /api/screenshot
router.post('/', (req, res) => {
  return res.status(501).json({ error: '功能开发中' });
});

module.exports = router;
