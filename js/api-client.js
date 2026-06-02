/**
 * 演示Demo API 客户端
 * 优先调用后端 API，不可用时回退到 IndexedDB (DemoDB)
 */
const DemoAPIClient = {
  _baseUrl: null,
  _detected: false,

  async detectBackend() {
    if (this._detected) return this._baseUrl !== null;
    this._detected = true;
    try {
      const r = await fetch('/api/health', {
        signal: AbortSignal.timeout(2000)
      });
      if (r.ok) { this._baseUrl = ''; return true; }
    } catch { /* offline */ }
    return false;
  },

  async publish(demo) {
    const hasBackend = await this.detectBackend();
    if (!hasBackend) return { error: '后端服务未启动，演示已保存到本地' };
    const r = await fetch('/api/demos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(demo)
    });
    return r.json();
  },

  async getPublicUrl(demo) {
    const result = await this.publish(demo);
    if (result.shareUrl) return result.shareUrl;
    return `${location.origin}/player.html?id=${demo.id}`;
  },

  async recordView(id) {
    const hasBackend = await this.detectBackend();
    if (hasBackend) {
      fetch(`/api/demos/${id}/view`, { method: 'PUT' }).catch(() => {});
    }
    if (typeof DemoDB !== 'undefined') {
      DemoDB.recordView(id).catch(() => {});
    }
  },

  async recordStepView(id, stepIndex) {
    const hasBackend = await this.detectBackend();
    if (hasBackend) {
      fetch(`/api/demos/${id}/step/${stepIndex}`, { method: 'PUT' }).catch(() => {});
    }
    if (typeof DemoDB !== 'undefined') {
      DemoDB.recordStepView(id, stepIndex).catch(() => {});
    }
  },

  async getAnalytics(id) {
    const hasBackend = await this.detectBackend();
    if (hasBackend) {
      const r = await fetch(`/api/demos/${id}/analytics`);
      return r.json();
    }
    const demo = await DemoDB.get(id);
    return demo?.analytics || { views: 0, completions: 0, stepStats: [] };
  }
};
