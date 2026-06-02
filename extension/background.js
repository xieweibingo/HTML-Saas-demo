/**
 * 演示Demo 录制器 — Background Service Worker (Manifest V3)
 * 负责：状态管理、截图、导入到创建器
 */

const DEFAULT_CREATOR_URL = 'http://localhost:8080/creator.html';

// ===================== 状态持久化（chrome.storage.session） =====================
// session storage 在 service worker 重启后依然有效（同一浏览器会话内）
async function getState() {
  try {
    const r = await chrome.storage.session.get(['walkr_recording']);
    return r.walkr_recording || { isRecording: false, steps: [], tabId: null };
  } catch {
    return { isRecording: false, steps: [], tabId: null };
  }
}

async function setState(data) {
  await chrome.storage.session.set({ walkr_recording: data });
}

async function getCreatorUrl() {
  const r = await chrome.storage.local.get(['creatorUrl']);
  return r.creatorUrl || DEFAULT_CREATOR_URL;
}

// ===================== 消息路由 =====================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }));
  return true; // 保持消息通道开放（异步响应）
});

async function handleMessage(msg, sender) {
  switch (msg.type) {

    case 'GET_STATE':
      return getState();

    case 'START_RECORDING': {
      const tabId = msg.tabId || sender.tab?.id;
      if (!tabId) throw new Error('无法获取标签页 ID');

      const state = {
        isRecording: true,
        steps: [],
        tabId,
        startTime: Date.now(),
      };
      await setState(state);
      updateBadge(tabId, 0, true);

      // 通知 content script 开始录制
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STARTED', stepCount: 0 });
      } catch {
        // content script 可能未加载，尝试注入
        await injectContentScript(tabId);
        await delay(300);
        try {
          await chrome.tabs.sendMessage(tabId, { type: 'RECORDING_STARTED', stepCount: 0 });
        } catch (e) {
          console.warn('Could not notify content script:', e.message);
        }
      }

      // 立刻截取初始状态（步骤 0）
      await captureTab(tabId, null, null, document?.title || '初始状态', '');

      return { success: true };
    }

    case 'CAPTURE_CLICK': {
      const state = await getState();
      if (!state.isRecording) return { ignored: true };

      await captureTab(
        state.tabId,
        msg.clickX,
        msg.clickY,
        msg.title || '',
        msg.url || '',
      );

      const newState = await getState();
      return { stepCount: newState.steps.length };
    }

    case 'STOP_AND_IMPORT': {
      const state = await getState();
      if (!state.isRecording && state.steps.length === 0) {
        return { error: '没有录制内容' };
      }

      // 最终截图（停止时的当前状态）
      if (state.isRecording && state.tabId) {
        try {
          await captureTab(state.tabId, null, null, '最终状态', '');
        } catch { /* ignore */ }
      }

      await setState({ ...state, isRecording: false });
      updateBadge(state.tabId, 0, false);

      // 通知 content script 停止
      if (state.tabId) {
        chrome.tabs.sendMessage(state.tabId, { type: 'RECORDING_STOPPED' }).catch(() => {});
      }

      return importToCreator();
    }

    case 'STOP_RECORDING': {
      const state = await getState();
      await setState({ ...state, isRecording: false });
      if (state.tabId) {
        updateBadge(state.tabId, 0, false);
        chrome.tabs.sendMessage(state.tabId, { type: 'RECORDING_STOPPED' }).catch(() => {});
      }
      return { stepCount: state.steps.length };
    }

    case 'IMPORT_TO_CREATOR':
      return importToCreator();

    case 'CLEAR_RECORDING': {
      const state = await getState();
      if (state.tabId) updateBadge(state.tabId, 0, false);
      await setState({ isRecording: false, steps: [], tabId: null });
      return { success: true };
    }

    case 'SAVE_CREATOR_URL': {
      await chrome.storage.local.set({ creatorUrl: msg.url });
      return { success: true };
    }

    case 'GET_CREATOR_URL':
      return { url: await getCreatorUrl() };

    default:
      return { ignored: true };
  }
}

// ===================== 截图 =====================
async function captureTab(tabId, clickX, clickY, title, url) {
  const tab = await chrome.tabs.get(tabId);
  let imageDataUrl;
  try {
    imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 88,
    });
  } catch (e) {
    console.error('captureVisibleTab failed:', e);
    throw new Error('截图失败：' + e.message);
  }

  const state = await getState();
  const step = {
    imageDataUrl,
    clickX: clickX ?? null,
    clickY: clickY ?? null,
    title: title || tab.title || `步骤 ${state.steps.length + 1}`,
    url: url || tab.url || '',
    timestamp: Date.now(),
  };

  const steps = [...(state.steps || []), step];
  await setState({ ...state, steps });
  updateBadge(tabId, steps.length, state.isRecording);
  return step;
}

// ===================== 导入到创建器 =====================
async function importToCreator() {
  const state = await getState();
  const steps = state.steps || [];

  if (steps.length === 0) return { error: '没有录制内容，请先录制步骤' };

  const creatorUrl = await getCreatorUrl();

  // 打开创建器页面
  const tab = await chrome.tabs.create({ url: creatorUrl });

  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve({ error: '打开创建器超时，请手动刷新并重试' });
    }, 20000);

    function cleanup() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
    }

    function listener(tabId, info) {
      if (tabId !== tab.id || info.status !== 'complete') return;
      cleanup();

      // 等待页面 JS 完全初始化
      delay(800).then(() => {
        const recordingData = {
          steps,
          title: `录制演示 ${new Date().toLocaleDateString('zh-CN')}`,
        };

        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: injectImportToCreator,
          args: [recordingData],
        }).then(() => {
          // 清空录制数据
          setState({ isRecording: false, steps: [], tabId: null });
          resolve({ success: true, stepCount: steps.length });
        }).catch(err => {
          resolve({ error: '注入失败：' + err.message + '。请检查创建器 URL 是否正确。' });
        });
      });
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * 此函数在创建器页面 (creator.html) 的上下文中执行
 * 可以访问页面全局变量：DemoDB, createDemo, createStep, createAnnotation, genId
 */
function injectImportToCreator(data) {
  const { steps, title } = data;

  function waitForFunctions(maxMs = 6000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function check() {
        if (
          typeof DemoDB !== 'undefined' &&
          typeof createDemo !== 'undefined' &&
          typeof createStep !== 'undefined' &&
          typeof createAnnotation !== 'undefined' &&
          typeof genId !== 'undefined'
        ) {
          resolve();
        } else if (Date.now() - start > maxMs) {
          reject(new Error('创建器函数未就绪（超时）'));
        } else {
          setTimeout(check, 150);
        }
      })();
    });
  }

  waitForFunctions().then(() => {
    const demo = createDemo(title);

    steps.forEach((stepData, i) => {
      const step = createStep(i);
      step.imageDataUrl = stepData.imageDataUrl;
      step.title = stepData.title || `步骤 ${i + 1}`;

      // 在步骤上添加热点：当前步骤的点击位置 → 引导用户"点这里继续"
      // 第 i 步的热点来自 stepData.clickX/Y（该截图是在点击 (x,y) 之前/之后录制的）
      // clickX/Y 是百分比坐标
      if (
        stepData.clickX !== null &&
        stepData.clickX !== undefined &&
        i < steps.length - 1
      ) {
        const ann = createAnnotation('hotspot', stepData.clickX, stepData.clickY, {
          color: '#6366f1',
          title: `操作 ${i + 1}`,
          description: '点击此处继续下一步',
          placement: 'bottom',
          size: 'md',
          action: { type: 'next', target: null },
        });
        step.annotations.push(ann);
      }

      demo.steps.push(step);
    });

    DemoDB.save(demo).then(() => {
      // 跳转到创建器，加载新录制的演示
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('id', demo.id);
      newUrl.searchParams.set('imported', '1');
      newUrl.searchParams.set('steps', steps.length);
      window.location.href = newUrl.toString();
    }).catch(err => {
      alert('保存失败：' + err.message);
    });
  }).catch(err => {
    alert('导入失败：' + err.message + '\n\n请确认页面已完全加载后重试。');
  });
}

// ===================== 导航时重新注入 content script =====================
chrome.webNavigation.onCompleted.addListener(async details => {
  if (details.frameId !== 0) return; // 只处理主框架
  const state = await getState();
  if (!state.isRecording || state.tabId !== details.tabId) return;

  // 导航完成后重新注入 content script
  await delay(200);
  try {
    await injectContentScript(details.tabId);
    await delay(300);
    await chrome.tabs.sendMessage(details.tabId, {
      type: 'RECORDING_STARTED',
      stepCount: state.steps.length,
    });
  } catch (e) {
    console.warn('Re-inject after navigation failed:', e.message);
  }
});

// ===================== 工具函数 =====================
async function injectContentScript(tabId) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (e) {
    console.warn('injectContentScript failed:', e.message);
  }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function updateBadge(tabId, count, isRecording) {
  if (!tabId) return;
  const text = count > 0 ? String(count) : (isRecording ? 'REC' : '');
  chrome.action.setBadgeText({ text, tabId }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({
    color: isRecording ? '#ef4444' : '#6366f1',
    tabId,
  }).catch(() => {});
}
