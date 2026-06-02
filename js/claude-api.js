/**
 * 演示Demo — Claude API 客户端
 * 在 creator.html 中 <script src="js/claude-api.js"> 加载
 */
const ClaudeAPI = {
  MODEL: 'claude-sonnet-4-6',
  BASE_URL: 'https://api.anthropic.com/v1/messages',

  getKey() { return localStorage.getItem('walkr_claude_key') || ''; },
  setKey(key) { localStorage.setItem('walkr_claude_key', key.trim()); },
  hasKey() { return !!this.getKey(); },

  async _call(system, userMsg, maxTokens = 512) {
    const key = this.getKey();
    if (!key) throw new Error('请先在设置中填入 Claude API Key');

    const res = await fetch(this.BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.content[0].text.trim();
  },

  /** 为步骤自动生成标注标题和描述 */
  async generateAnnotation(stepTitle, tone = 'conversational') {
    const tones = {
      conversational: '友好对话风格，简洁易懂',
      technical: '技术专业风格，准确详细',
      executive: '高管摘要风格，突出价值和结果',
    };
    const system = `你是产品演示专家。根据步骤标题，生成简短的标注标题和描述。语气：${tones[tone] || tones.conversational}。只返回JSON：{"title":"标题","description":"描述（一两句话）"}`;
    const text = await this._call(system, `步骤名称：${stepTitle}`);
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : text);
  },

  /** 为步骤生成旁白文案 */
  async generateVoiceover(stepTitle, annotations = [], tone = 'conversational') {
    const annText = annotations.map(a => `${a.title}：${a.description}`).join('；');
    const system = `你是产品演示旁白撰写专家。根据步骤信息生成自然流畅的口播旁白文案，直接讲给观众听。风格：${tone === 'executive' ? '简洁有力' : '友好自然'}。只返回旁白文字，不要标点过多，不要任何前言。`;
    return this._call(system, `步骤：${stepTitle}\n标注内容：${annText || '无'}`);
  },

  /** 一键生成整个演示的所有步骤标注 */
  async generateAllAnnotations(steps, tone = 'conversational') {
    const results = [];
    for (const step of steps) {
      try {
        const ann = await this.generateAnnotation(step.title, tone);
        results.push({ stepId: step.id, ...ann });
        // Rate limit: 200ms between calls
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        results.push({ stepId: step.id, title: step.title, description: '', error: e.message });
      }
    }
    return results;
  },

  /** 翻译文字到目标语言 */
  async translate(texts, targetLang = 'en') {
    const langNames = { 'en': '英文', 'ja': '日文', 'ko': '韩文', 'de': '德文', 'fr': '法文' };
    const system = `你是专业翻译。将输入的JSON数组中每个对象的title和description字段翻译成${langNames[targetLang] || targetLang}。保持JSON格式不变，只翻译字段值。只返回JSON数组。`;
    const text = await this._call(system, JSON.stringify(texts), 1024);
    const match = text.match(/\[[\s\S]*\]/);
    return JSON.parse(match ? match[0] : text);
  },

  /** 识别并建议脱敏区域（基于截图描述） */
  async suggestRedaction(stepTitle, url = '') {
    const system = `你是数据安全专家。根据产品演示步骤的上下文，判断截图中可能出现哪些敏感信息，并给出脱敏建议。返回JSON：{"hasSensitiveData": boolean, "suggestions": ["建议1", "建议2"]}`;
    const text = await this._call(system, `页面：${url || stepTitle}\n步骤：${stepTitle}`);
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : '{"hasSensitiveData":false,"suggestions":[]}');
  },

  /** 生成视频故事板 JSON（for video-studio.html）*/
  async generateVideoStoryboard(description) {
    const system = `你是视频故事板生成器。根据用户描述生成视频故事板JSON。
只返回合法JSON，不要任何其他文字。
格式：{"duration":毫秒数,"fps":30,"width":1280,"height":720,"background":"#hex","clips":[...]}
clip字段：id,type(gradient/color/text/logo-box/rect/circle/line/badge),start(ms),end(ms)
text clip额外字段：x,y,text,fontSize,fontWeight,color,align(left/center/right),animation
logo-box额外字段：x,y,size,text,bgColor,textColor,radius,animation
gradient额外字段：from,to,direction
支持animation值：none,fade-in,fade-out,fade-slide-up,pop,expand-h,type-in,scale-in,slide-left
视频应该专业、美观，动画时间安排合理。中文演示内容用中文。`;
    const text = await this._call(system, description, 2048);
    const match = text.match(/```json\n?([\s\S]*?)\n?```/) || [null, text.match(/\{[\s\S]*\}/)?.[0]];
    return JSON.parse(match[1] || text);
  },
};
