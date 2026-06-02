/* ===================== IndexedDB Storage Layer ===================== */
const DB_NAME = 'WalkrDB';
const DB_VERSION = 1;
const STORE_DEMOS = 'demos';

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_DEMOS)) {
        const store = db.createObjectStore(STORE_DEMOS, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('title', 'title');
      }
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror = e => reject(e.target.error);
  });
}

function tx(mode, cb) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE_DEMOS, mode);
    const store = t.objectStore(STORE_DEMOS);
    const req = cb(store);
    if (req) {
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    } else {
      t.oncomplete = () => resolve();
      t.onerror = e => reject(e.target.error);
    }
  }));
}

const DemoDB = {
  save(demo) {
    demo.updatedAt = Date.now();
    return tx('readwrite', store => store.put(demo));
  },

  get(id) {
    return tx('readonly', store => store.get(id));
  },

  getAll() {
    return tx('readonly', store => store.getAll()).then(list =>
      list.sort((a, b) => b.updatedAt - a.updatedAt)
    );
  },

  delete(id) {
    return tx('readwrite', store => store.delete(id));
  },

  duplicate(id) {
    return DemoDB.get(id).then(demo => {
      if (!demo) throw new Error('Demo not found');
      const copy = JSON.parse(JSON.stringify(demo));
      copy.id = genId();
      copy.title = demo.title + ' (副本)';
      copy.createdAt = Date.now();
      copy.updatedAt = Date.now();
      copy.analytics = { views: 0, completions: 0, stepStats: [] };
      return DemoDB.save(copy).then(() => copy);
    });
  },

  recordView(id) {
    return DemoDB.get(id).then(demo => {
      if (!demo) return;
      demo.analytics = demo.analytics || { views: 0, completions: 0, stepStats: [] };
      demo.analytics.views = (demo.analytics.views || 0) + 1;
      return DemoDB.save(demo);
    });
  },

  recordStepView(id, stepIndex) {
    return DemoDB.get(id).then(demo => {
      if (!demo) return;
      demo.analytics = demo.analytics || { views: 0, completions: 0, stepStats: [] };
      if (!demo.analytics.stepStats) demo.analytics.stepStats = [];
      if (!demo.analytics.stepStats[stepIndex]) {
        demo.analytics.stepStats[stepIndex] = { views: 0 };
      }
      demo.analytics.stepStats[stepIndex].views++;
      if (stepIndex === demo.steps.length - 1) {
        demo.analytics.completions = (demo.analytics.completions || 0) + 1;
      }
      return DemoDB.save(demo);
    });
  }
};

/* ===================== Utilities ===================== */
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function createDemo(title = '未命名演示') {
  return {
    id: genId(),
    title,
    description: '',
    branding: {
      primaryColor: '#6366f1',
      logoUrl: null,
      nextButtonText: '下一步',
      prevButtonText: '上一步',
      ctaText: '立即体验',
      ctaUrl: '',
      showBranding: true,
      theme: 'light',
    },
    steps: [],
    analytics: { views: 0, completions: 0, stepStats: [] },
    isPublished: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createStep(index) {
  return {
    id: genId(),
    title: `步骤 ${index + 1}`,
    imageDataUrl: null,
    annotations: [],
    voiceover: { enabled: false, text: '', voice: 'zh-CN' },
  };
}

function createAnnotation(type, x, y, opts = {}) {
  const defaults = {
    hotspot: { title: '点击查看', description: '在这里添加说明文字' },
    callout: { title: '注意这里', description: '在这里添加描述信息' },
    spotlight: { title: '聚焦区域', description: '关注这个区域的内容' },
    backdrop: { title: '重点功能', description: '这是需要重点介绍的功能' },
    rectangle: { title: '高亮区域', description: '' },
    text: { title: '文字标注', description: '' },
    chapter: { title: '第一章', description: '章节简介' },
  };
  const d = defaults[type] || {};
  return {
    id: genId(),
    type,
    x, y,
    width: opts.width || 20,
    height: opts.height || 14,
    title: opts.title || d.title || '',
    description: opts.description || d.description || '',
    placement: opts.placement || 'bottom',
    color: opts.color || '#6366f1',
    size: opts.size || 'md',
    action: opts.action || { type: 'next', target: null },
    visible: true,
  };
}

/* ===================== Toast Helper ===================== */
function showToast(msg, type = 'default', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✓', error: '✕', warning: '⚠', default: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || icons.default}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove());
  }, duration);
}

/* ===================== AI: TTS via Web Speech API ===================== */
const TTSEngine = {
  synth: window.speechSynthesis,
  voices: [],
  init() {
    const load = () => {
      this.voices = this.synth.getVoices().filter(v =>
        v.lang.startsWith('zh') || v.lang.startsWith('en')
      );
    };
    load();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = load;
    }
  },
  getChineseVoices() {
    return this.voices.filter(v => v.lang.startsWith('zh'));
  },
  speak(text, opts = {}) {
    if (!text) return;
    this.synth.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = opts.lang || 'zh-CN';
    utt.rate = opts.rate || 1;
    utt.pitch = opts.pitch || 1;
    utt.volume = opts.volume !== undefined ? opts.volume : 1;
    if (opts.voice) {
      const v = this.voices.find(v => v.name === opts.voice);
      if (v) utt.voice = v;
    }
    if (opts.onEnd) utt.onend = opts.onEnd;
    this.synth.speak(utt);
    return utt;
  },
  stop() { this.synth.cancel(); },
  pause() { this.synth.pause(); },
  resume() { this.synth.resume(); },
};

/* ===================== AI: Auto Annotation Text Generator ===================== */
const AIAnnotator = {
  tones: {
    conversational: { prefix: '👋 ', suffix: '，快来了解一下！' },
    technical: { prefix: '', suffix: '' },
    executive: { prefix: '📊 ', suffix: '，助力业务增长。' },
  },

  generateStepText(stepTitle, imgDescription = '', tone = 'conversational') {
    const t = this.tones[tone] || this.tones.conversational;
    const templates = [
      `${t.prefix}这里是「${stepTitle}」功能区域，用于处理相关操作${t.suffix}`,
      `${t.prefix}在「${stepTitle}」中，您可以快速完成此步骤${t.suffix}`,
      `${t.prefix}注意「${stepTitle}」部分，这是核心操作区域${t.suffix}`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  },

  generateFromImageAlt(element) {
    const alt = element?.alt || element?.title || element?.placeholder || '';
    if (alt) return `这里是「${alt}」，点击进行下一步操作`;
    return '点击此处继续下一步操作';
  },

  suggestAnnotationType(x, y, imgW, imgH) {
    const relX = x / imgW, relY = y / imgH;
    if (relX > 0.1 && relX < 0.9 && relY > 0.1 && relY < 0.9) return 'hotspot';
    return 'callout';
  },

  async generateAnnotationsForStep(step, tone = 'conversational') {
    if (!step.annotations || step.annotations.length === 0) return [];
    return step.annotations.map(ann => ({
      ...ann,
      title: ann.title || this.generateStepText(step.title, '', tone),
      description: ann.description || '点击下方按钮继续下一步',
    }));
  },

  generateVoiceoverText(step) {
    const parts = [];
    parts.push(step.title || '欢迎');
    step.annotations?.forEach(ann => {
      if (ann.title) parts.push(ann.title);
      if (ann.description) parts.push(ann.description);
    });
    return parts.join('。');
  }
};
