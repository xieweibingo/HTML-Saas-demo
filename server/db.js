/**
 * SQLite 数据库层 — 演示Demo 后端
 * 使用 better-sqlite3（同步 API）
 */

const Database = require('better-sqlite3');
const path = require('path');
const { nanoid } = require('nanoid');

const DB_PATH = path.join(__dirname, 'walkr.db');
const db = new Database(DB_PATH);

// 开启 WAL 模式，提升并发读性能
db.pragma('journal_mode = WAL');

// ── 建表 ──────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS demos (
    id           TEXT PRIMARY KEY,
    slug         TEXT UNIQUE NOT NULL,
    title        TEXT NOT NULL DEFAULT '未命名演示',
    data         TEXT NOT NULL,
    views        INTEGER DEFAULT 0,
    completions  INTEGER DEFAULT 0,
    step_stats   TEXT DEFAULT '[]',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    is_published INTEGER DEFAULT 1
  )
`);

// ── 预编译语句 ────────────────────────────────────────────────────────────────
const stmtUpsert = db.prepare(`
  INSERT INTO demos (id, slug, title, data, views, completions, step_stats, created_at, updated_at, is_published)
  VALUES (@id, @slug, @title, @data, @views, @completions, @step_stats, @created_at, @updated_at, @is_published)
  ON CONFLICT(id) DO UPDATE SET
    slug         = excluded.slug,
    title        = excluded.title,
    data         = excluded.data,
    views        = excluded.views,
    completions  = excluded.completions,
    step_stats   = excluded.step_stats,
    updated_at   = excluded.updated_at,
    is_published = excluded.is_published
`);

const stmtGetById    = db.prepare('SELECT * FROM demos WHERE id = ?');
const stmtGetBySlug  = db.prepare('SELECT * FROM demos WHERE slug = ?');
const stmtGetAll     = db.prepare('SELECT id, slug, title, views, completions, step_stats, created_at, updated_at, is_published FROM demos ORDER BY updated_at DESC');
const stmtDelete     = db.prepare('DELETE FROM demos WHERE id = ?');
const stmtIncrViews  = db.prepare('UPDATE demos SET views = views + 1 WHERE id = ?');
const stmtCount      = db.prepare('SELECT COUNT(*) AS cnt FROM demos');
const stmtSlugExists = db.prepare('SELECT 1 FROM demos WHERE slug = ? AND id != ?');

// ── 辅助：生成唯一 slug ────────────────────────────────────────────────────────
function generateUniqueSlug(existingId = '') {
  let slug;
  let attempts = 0;
  do {
    slug = nanoid(8);
    attempts++;
    if (attempts > 20) throw new Error('无法生成唯一 slug，请重试');
  } while (stmtSlugExists.get(slug, existingId || ''));
  return slug;
}

// ── 辅助：将数据库行反序列化 ───────────────────────────────────────────────────
function deserializeRow(row) {
  if (!row) return null;
  return {
    ...row,
    step_stats: JSON.parse(row.step_stats || '[]'),
  };
}

// ── 公开函数 ──────────────────────────────────────────────────────────────────

/**
 * 保存（新增或更新）演示。
 * @param {Object} demoObj  前端传入的完整 demo JSON
 * @returns {Object}        保存后的记录（含 slug）
 */
function saveDemo(demoObj) {
  if (!demoObj || !demoObj.id) {
    throw new Error('demo 对象必须包含 id 字段');
  }

  const now = Date.now();

  // 查询已有记录（用于保留现有 slug 和统计数据）
  const existing = stmtGetById.get(demoObj.id);

  const slug = existing?.slug || generateUniqueSlug(demoObj.id);

  // 保留已有统计数据，不允许发布者覆盖
  const views       = existing?.views       ?? 0;
  const completions = existing?.completions ?? 0;
  const stepStats   = existing?.step_stats  ?? '[]';

  const record = {
    id:           demoObj.id,
    slug,
    title:        demoObj.title || '未命名演示',
    data:         JSON.stringify(demoObj),
    views,
    completions,
    step_stats:   stepStats,
    created_at:   existing?.created_at ?? (demoObj.createdAt || now),
    updated_at:   now,
    is_published: 1,
  };

  stmtUpsert.run(record);

  return deserializeRow(stmtGetById.get(demoObj.id));
}

/**
 * 根据 id 查询完整演示（含 data 字段）。
 */
function getDemo(id) {
  const row = stmtGetById.get(id);
  return deserializeRow(row);
}

/**
 * 根据 slug 查询完整演示（含 data 字段）。
 */
function getDemoBySlug(slug) {
  const row = stmtGetBySlug.get(slug);
  return deserializeRow(row);
}

/**
 * 查询所有演示（不含 data 字段，用于列表展示）。
 */
function getAllDemos() {
  return stmtGetAll.all().map(deserializeRow);
}

/**
 * 删除演示。
 * @returns {boolean} 是否实际删除了记录
 */
function deleteDemo(id) {
  const result = stmtDelete.run(id);
  return result.changes > 0;
}

/**
 * 自增浏览次数。
 */
function incrementViews(id) {
  stmtIncrViews.run(id);
}

/**
 * 自增指定步骤的浏览次数，并在最后一步时自增完成次数。
 */
function updateStepStat(id, stepIndex) {
  const row = stmtGetById.get(id);
  if (!row) return;

  const stats = JSON.parse(row.step_stats || '[]');

  // 确保数组长度足够
  while (stats.length <= stepIndex) {
    stats.push({ views: 0 });
  }
  stats[stepIndex].views = (stats[stepIndex].views || 0) + 1;

  // 判断是否为最后一步（解析 data 获取步骤总数）
  let isLastStep = false;
  try {
    const demo = JSON.parse(row.data);
    if (Array.isArray(demo.steps) && stepIndex === demo.steps.length - 1) {
      isLastStep = true;
    }
  } catch (_) { /* 解析失败时忽略 */ }

  const updateStmt = db.prepare(
    isLastStep
      ? 'UPDATE demos SET step_stats = ?, completions = completions + 1, updated_at = ? WHERE id = ?'
      : 'UPDATE demos SET step_stats = ?, updated_at = ? WHERE id = ?'
  );
  updateStmt.run(JSON.stringify(stats), Date.now(), id);
}

/**
 * 查询演示总数。
 */
function countDemos() {
  return stmtCount.get().cnt;
}

module.exports = {
  db,
  saveDemo,
  getDemo,
  getDemoBySlug,
  getAllDemos,
  deleteDemo,
  incrementViews,
  updateStepStat,
  countDemos,
};
