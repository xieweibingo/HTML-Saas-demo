/**
 * 演示Demo 录制器 — Content Script
 * 注入到用户正在操作的目标页面中
 * 负责：显示录制工具栏、监听点击事件、通知 background 截图
 */

(function () {
  'use strict';

  // 防止重复注入
  if (window.__walkrContentLoaded) {
    // 已存在，刷新状态
    chrome.runtime.sendMessage({ type: 'GET_STATE' }).then(state => {
      if (state?.isRecording) {
        updateBar(state.steps?.length || 0);
      }
    }).catch(() => {});
    return;
  }
  window.__walkrContentLoaded = true;

  let isRecording = false;
  let stepCount = 0;
  let barEl = null;
  let clickBlocked = false; // 截图期间短暂屏蔽重复触发

  // ===================== 录制工具栏 =====================
  function createBar() {
    if (barEl) return;
    barEl = document.createElement('div');
    barEl.id = 'walkr-bar';
    barEl.innerHTML = `
      <div class="walkr-dot"></div>
      <span class="walkr-label">录制中</span>
      <span class="walkr-count" id="walkr-step-count">0 步</span>
      <div class="walkr-sep"></div>
      <button class="walkr-btn walkr-btn-manual" id="walkr-manual-btn">📸 手动截图</button>
      <button class="walkr-btn walkr-btn-stop" id="walkr-stop-btn">■ 停止录制</button>
      <button class="walkr-btn walkr-btn-cancel" id="walkr-cancel-btn" title="放弃录制">✕</button>
    `;
    document.body.appendChild(barEl);

    barEl.querySelector('#walkr-stop-btn').addEventListener('click', e => {
      e.stopPropagation();
      stopRecording(true);
    });

    barEl.querySelector('#walkr-manual-btn').addEventListener('click', e => {
      e.stopPropagation();
      triggerCapture(null, null, true);
    });

    barEl.querySelector('#walkr-cancel-btn').addEventListener('click', e => {
      e.stopPropagation();
      if (confirm('放弃本次录制？已截图的内容将被清除。')) {
        cancelRecording();
      }
    });
  }

  function removeBar() {
    if (barEl) {
      barEl.remove();
      barEl = null;
    }
  }

  function updateBar(count) {
    stepCount = count;
    if (barEl) {
      const el = barEl.querySelector('#walkr-step-count');
      if (el) el.textContent = `${count} 步`;
    }
  }

  // ===================== 点击动效 =====================
  function showClickRipple(x, y) {
    const el = document.createElement('div');
    el.className = 'walkr-click-ripple';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 600);
  }

  function showStepFlash(count) {
    const el = document.createElement('div');
    el.className = 'walkr-step-flash';
    el.textContent = `✓ 步骤 ${count} 已截图`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  // ===================== 截图触发 =====================
  function triggerCapture(clientX, clientY, isManual = false) {
    if (clickBlocked) return;
    clickBlocked = true;

    // 点击坐标 → 百分比（相对于视口）
    const xPct = clientX != null ? (clientX / window.innerWidth * 100) : null;
    const yPct = clientY != null ? (clientY / window.innerHeight * 100) : null;

    // 截图前短暂隐藏录制条，避免出现在截图里
    if (barEl) barEl.classList.add('walkr-hidden');

    // 短暂延迟让 CSS transition 生效
    setTimeout(() => {
      chrome.runtime.sendMessage({
        type: 'CAPTURE_CLICK',
        clickX: xPct,
        clickY: yPct,
        isManual,
        title: document.title,
        url: location.href,
      }).then(res => {
        if (barEl) barEl.classList.remove('walkr-hidden');
        if (res?.stepCount !== undefined) {
          updateBar(res.stepCount);
          showStepFlash(res.stepCount);
        }
        setTimeout(() => { clickBlocked = false; }, 200);
      }).catch(() => {
        if (barEl) barEl.classList.remove('walkr-hidden');
        clickBlocked = false;
      });
    }, 80);
  }

  // ===================== 点击监听 =====================
  function onPageClick(e) {
    if (!isRecording) return;
    // 忽略录制条自身的点击
    if (barEl && barEl.contains(e.target)) return;

    // 显示点击涟漪
    showClickRipple(e.clientX, e.clientY);

    // 触发截图（在 click 事件阶段，此时 UI 可能已开始变化，符合"截图操作结果"的预期）
    triggerCapture(e.clientX, e.clientY, false);
  }

  // ===================== 开始/停止录制 =====================
  function startRecording(initialStepCount) {
    isRecording = true;
    stepCount = initialStepCount || 0;
    createBar();
    updateBar(stepCount);
    document.addEventListener('click', onPageClick, true);
  }

  async function stopRecording(importNow) {
    isRecording = false;
    document.removeEventListener('click', onPageClick, true);
    removeBar();

    if (importNow) {
      // 最后截一张最终状态
      if (barEl) barEl.classList.add('walkr-hidden');
      try {
        const res = await chrome.runtime.sendMessage({ type: 'STOP_AND_IMPORT' });
        if (res?.error) {
          alert('导入失败：' + res.error);
        }
      } catch (e) {
        console.error('Walkr: stop failed', e);
      }
    }
  }

  function cancelRecording() {
    isRecording = false;
    document.removeEventListener('click', onPageClick, true);
    removeBar();
    chrome.runtime.sendMessage({ type: 'CLEAR_RECORDING' }).catch(() => {});
  }

  // ===================== 监听来自 background 的消息 =====================
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'RECORDING_STARTED') {
      startRecording(msg.stepCount || 0);
      sendResponse({ ok: true });
    }
    if (msg.type === 'RECORDING_STOPPED') {
      isRecording = false;
      document.removeEventListener('click', onPageClick, true);
      removeBar();
      sendResponse({ ok: true });
    }
    if (msg.type === 'UPDATE_COUNT') {
      updateBar(msg.count);
      sendResponse({ ok: true });
    }
    return false;
  });

  // ===================== 页面加载时检查是否正在录制 =====================
  chrome.runtime.sendMessage({ type: 'GET_STATE' }).then(state => {
    if (state?.isRecording) {
      startRecording(state.steps?.length || 0);
    }
  }).catch(() => {
    // Extension context not available (e.g., extension reloaded)
  });

})();
