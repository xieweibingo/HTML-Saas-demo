/**
 * 演示Demo 录制器 — Popup Script
 */
'use strict';

const $ = id => document.getElementById(id);
let pollingTimer = null;

// ===================== 初始化 =====================
async function init() {
  // 加载创建器 URL 设置
  const urlRes = await msg({ type: 'GET_CREATOR_URL' });
  $('creatorUrl').value = urlRes.url || 'http://localhost:8080/creator.html';

  // 读取当前录制状态
  const state = await msg({ type: 'GET_STATE' });
  renderState(state);
}

// ===================== 状态渲染 =====================
function renderState(state) {
  stopPolling();

  const isRecording = state?.isRecording;
  const steps = state?.steps || [];
  const hasDoneSteps = !isRecording && steps.length > 0;

  $('state-idle').style.display = (!isRecording && !hasDoneSteps) ? '' : 'none';
  $('state-recording').style.display = isRecording ? '' : 'none';
  $('state-done').style.display = hasDoneSteps ? '' : 'none';

  // Header badge
  $('recBadge').classList.toggle('hidden', !isRecording);
  $('headerSub').textContent = isRecording
    ? `录制中 · 已捕获 ${steps.length} 步`
    : hasDoneSteps
      ? `已录制 ${steps.length} 步，待导入`
      : '点击产品，自动生成走查演示';

  if (isRecording) {
    renderRecordingState(state);
    startPolling();
  } else if (hasDoneSteps) {
    renderDoneState(state);
  }
}

function renderRecordingState(state) {
  const count = state.steps?.length || 0;
  $('recCount').textContent = `${count} 步`;

  // 获取当前录制标签页的 URL
  if (state.tabId) {
    chrome.tabs.get(state.tabId, tab => {
      if (chrome.runtime.lastError) return;
      $('recUrl').textContent = tab?.url ? shortenUrl(tab.url) : '—';
    });
  }
}

function renderDoneState(state) {
  const steps = state.steps || [];
  $('doneTitle').textContent = `录制完成 · ${steps.length} 个步骤`;
  $('doneSub').textContent = '点击下方按钮导入到演示创建器';

  // 生成步骤缩略图
  const container = $('stepThumbnails');
  container.innerHTML = '';
  steps.slice(0, 8).forEach((step, i) => {
    const div = document.createElement('div');
    div.className = 'step-thumb-mini';
    if (step.imageDataUrl) {
      const img = document.createElement('img');
      img.src = step.imageDataUrl;
      img.loading = 'lazy';
      div.appendChild(img);
    }
    const num = document.createElement('div');
    num.className = 'step-thumb-num';
    num.textContent = i + 1;
    div.appendChild(num);
    container.appendChild(div);
  });
  if (steps.length > 8) {
    const more = document.createElement('div');
    more.className = 'step-thumb-mini';
    more.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:#64748b;font-weight:700;';
    more.textContent = `+${steps.length - 8}`;
    container.appendChild(more);
  }
}

// ===================== 轮询更新（录制中） =====================
function startPolling() {
  stopPolling();
  pollingTimer = setInterval(async () => {
    const state = await msg({ type: 'GET_STATE' });
    if (!state?.isRecording) {
      renderState(state);
      return;
    }
    const count = state.steps?.length || 0;
    $('recCount').textContent = `${count} 步`;
    $('headerSub').textContent = `录制中 · 已捕获 ${count} 步`;
  }, 1200);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

// ===================== 按钮事件 =====================

// 开始录制
$('btnStart').addEventListener('click', async () => {
  setLoading(true, '正在启动录制...');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { toast('无法获取当前标签页', 'error'); return; }
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      toast('无法在浏览器内置页面录制，请切换到普通网页', 'error');
      return;
    }

    const res = await msg({ type: 'START_RECORDING', tabId: tab.id });
    if (res?.error) { toast(res.error, 'error'); return; }

    const state = await msg({ type: 'GET_STATE' });
    renderState(state);
    toast('录制已开始，请操作你的产品页面', 'success');
  } finally {
    setLoading(false);
  }
});

// 停止并导入
$('btnStopAndImport').addEventListener('click', async () => {
  setLoading(true, '正在截取最终状态并导入...');
  try {
    const res = await msg({ type: 'STOP_AND_IMPORT' });
    if (res?.error) {
      toast(res.error, 'error');
      setLoading(false);
      return;
    }
    setLoading(false);
    toast(`已导入 ${res.stepCount} 个步骤到创建器`, 'success');
    // 短暂展示成功状态再关闭
    const state = await msg({ type: 'GET_STATE' });
    renderState(state);
  } catch (e) {
    toast('导入失败：' + e.message, 'error');
    setLoading(false);
  }
});

// 手动截图（popup 中）
$('btnManualCapture').addEventListener('click', async () => {
  const state = await msg({ type: 'GET_STATE' });
  if (!state?.tabId) return;
  setLoading(true, '截图中...');
  try {
    const res = await msg({ type: 'CAPTURE_CLICK', clickX: null, clickY: null, isManual: true });
    toast(`已截图 · 共 ${res.stepCount} 步`, 'success');
    $('recCount').textContent = `${res.stepCount} 步`;
  } finally {
    setLoading(false);
  }
});

// 放弃录制
$('btnCancel').addEventListener('click', async () => {
  if (!confirm('确定放弃本次录制？已截图的内容将被清除。')) return;
  await msg({ type: 'CLEAR_RECORDING' });
  renderState({ isRecording: false, steps: [] });
  toast('已放弃录制');
});

// 重新导入
$('btnImportAgain').addEventListener('click', async () => {
  setLoading(true, '导入中...');
  try {
    const res = await msg({ type: 'IMPORT_TO_CREATOR' });
    if (res?.error) { toast(res.error, 'error'); return; }
    toast(`已导入 ${res.stepCount} 个步骤`, 'success');
  } finally {
    setLoading(false);
  }
});

// 新建录制
$('btnNewRecording').addEventListener('click', async () => {
  await msg({ type: 'CLEAR_RECORDING' });
  renderState({ isRecording: false, steps: [] });
});

// 保存创建器 URL
$('btnSaveUrl').addEventListener('click', async () => {
  const url = $('creatorUrl').value.trim();
  if (!url) { toast('请输入创建器地址', 'error'); return; }
  await msg({ type: 'SAVE_CREATOR_URL', url });
  toast('地址已保存', 'success');
});

// ===================== 工具函数 =====================
function msg(payload) {
  return chrome.runtime.sendMessage(payload);
}

function setLoading(show, text = '处理中...') {
  const overlay = $('loadingOverlay');
  $('loadingText').textContent = text;
  overlay.classList.toggle('show', show);
}

let toastTimer = null;
function toast(text, type = 'default') {
  const el = $('toast');
  el.textContent = text;
  el.className = `popup-toast show${type !== 'default' ? ' ' + type : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 2800);
}

function shortenUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname.length > 30 ? u.pathname.slice(0, 30) + '...' : u.pathname);
  } catch {
    return url.slice(0, 50);
  }
}

// ===================== 启动 =====================
init();
