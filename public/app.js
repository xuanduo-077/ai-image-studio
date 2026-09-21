'use strict';

const $ = (s) => document.querySelector(s);

const LS_KEY = 'ai-image-studio-settings-v1';
const LS_TOKEN_KEY = 'ai-image-studio-token';

const SENSENOVA_PRESETS = [
  { label: '2752×1536 横版', value: '2752x1536' },
  { label: '1536×2752 竖版', value: '1536x2752' },
  { label: '2048×2048 方形', value: '2048x2048' },
  { label: '1024×1024 小图', value: '1024x1024' },
];

const AGNES_SIZES = [
  { label: '1K', value: '1K' },
  { label: '2K', value: '2K' },
  { label: '4K', value: '4K' },
];

const AGNES_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'].map((v) => ({ label: v, value: v }));

const COUNT_OPTIONS = [1, 2, 3, 4].map((v) => ({ label: `${v} 张`, value: v }));

const PROVIDER_MODELS = {
  sensenova: [
    { label: 'U1 Fast（快速）', value: 'sensenova-u1-fast' },
    { label: 'U1.5 Lite（轻量）', value: 'sensenova-u1.5-lite' },
  ],
  agnes: [{ label: 'Image 2.5 Flash', value: 'agnes-image-2.5-flash' }],
};

const PROVIDER_META = {
  sensenova: {
    name: '商汤 SenseNova',
    model: 'sensenova-u1-fast',
    keyHint: 'Key 仅保存在你的账户或浏览器本地，生成请求由本服务转发至商汤接口',
  },
  agnes: {
    name: 'Agnes AI',
    model: 'agnes-image-2.5-flash',
    keyHint: 'Key 仅保存在你的账户或浏览器本地，生成请求由本服务转发至 Agnes 接口',
  },
};

/* 生成类型：自由 / 人物三视图 / 场景图（选后者会套用模板强化提示词，并在结果中分类） */
const ASSET_TYPES = [
  { value: '', label: '自由生成' },
  { value: 'character', label: '人物三视图' },
  { value: 'scene', label: '场景图' },
];
const ASSET_TYPE_LABEL = { character: '人物三视图', scene: '场景图' };

function wrapAssetPrompt(type, raw) {
  if (type === 'character') {
    return (
      `角色三视图设定图：同一个角色的三个视角横向并排——正面全身、侧面全身、背面全身，站立姿势，纯浅灰色背景，` +
      `画面中只有这一个角色；角色设定：${raw}；三个视角的五官、发型、服装、配饰必须完全一致，全身完整可见`
    );
  }
  if (type === 'scene') {
    return `场景设定图：${raw}；画面中不出现任何人物，纯环境描绘，注重空间布局、光线氛围与细节质感`;
  }
  return raw;
}

const state = {
  provider: 'sensenova',
  keys: { sensenova: '', agnes: '' },
  model: { sensenova: 'sensenova-u1-fast', agnes: 'agnes-image-2.5-flash' },
  lastKeyId: { sensenova: null, agnes: null },
  size: '2752x1536',
  agnesSize: '2K',
  ratio: '16:9',
  count: 1,
  watermark: false,
  assetType: '',
  vmode: 'reference',
  vseconds: '5',
  vsize: '720P',
  vratio: '16:9',
  scripts: [],
  activeScriptId: 'script-default',
};

const auth = {
  token: localStorage.getItem(LS_TOKEN_KEY) || '',
  user: null,
  keys: [],
};

let results = [];
let generating = false;
let authMode = 'login';

/* ---------------- 视频生成状态 ---------------- */

const VSECONDS = ['4', '5', '8', '10'].map((v) => ({ label: `${v} 秒`, value: v }));
const VSIZES = ['480P', '720P', '1080P'].map((v) => ({ label: v, value: v }));
const VRATIOS = ['16:9', '9:16', '1:1'].map((v) => ({ label: v, value: v }));

const video = {
  slots: { first: null, last: null, refs: [null, null, null] },
  results: [],
};

let videoGenerating = false;
let pickerTarget = null;

/* ---------------- 提示词模板库（分层协议，精选适配中文模型） ---------------- */

const PROMPT_TEMPLATES = [
  {
    name: '写实人像摄影',
    tpl: '一张写实人像摄影照片。主体：[人物：年龄/五官特征/发型/服装材质]，表情[情绪]，[动作姿态]。镜头：85mm 定焦，浅景深，[平视/低角度仰拍]。光线：[柔和窗光/伦勃朗光/逆光轮廓光]。背景：[环境描述]，自然虚化。质感：真实皮肤纹理与发丝细节。负面约束：不要过度磨皮，不要肢体变形，不要文字水印。',
  },
  {
    name: '电影感场景',
    tpl: '一张电影感场景画面。时空：[时间+地点]。正在发生：[动作事件，要有动词]。镜头：[广角建立镜头/中景叙事/低角度仰拍]，前景、中景、远景层次分明。光线：[主光方向与冷暖对比]。氛围：[情绪基调]。质感：胶片颗粒，色调分级细腻，真实材质纹理。负面约束：不要文字水印，不要模糊。',
  },
  {
    name: '插画海报',
    tpl: '一张[题材]插画海报。主体：[角色/物件的完整描述]。画风：[厚涂/水彩/扁平]，线条[细腻/粗犷]。配色：[主色+点缀色]。构图：[景别]，重点表现[细节]，留出标题空间。氛围：[情绪基调]。质感：笔触明确，细节密度高。负面约束：不要文字乱码，不要元素堆砌。',
  },
  {
    name: '角色设定三视图',
    tpl: '角色三视图设定图：同一角色的正面全身、侧面全身、背面全身横向等距并排，自然站立，全身完整可见。角色：[姓名]，[五官拆解：眼型/眉形/鼻唇/脸型]，[发型发色]，[服装材质与款式]，[标志性配饰]。背景：纯浅灰无缝背景，只有这一个角色。光照：柔和均匀棚拍光，无强烈投影。一致性：三个视角的五官、发型、服装、配饰完全一致。负面约束：不要多余角色，不要文字水印，不要改变角色特征。',
  },
  {
    name: '3D 收藏玩具',
    tpl: '将[角色/形象描述]转换为高端 3D 收藏玩具渲染图。身份保持：保留脸部特征、发型与服装识别点。造型：大头比例，五官轻微夸张，玩具化但不失高级感。材质：哑光 vinyl 质感，服饰材质细节丰富。灯光：柔和棚拍光，干净纯色背景，主体居中轮廓清晰。质感：8K 渲染锐度，真实材质反射。负面约束：不要廉价塑料感，不要多角色，不要复杂背景，不要文字。',
  },
  {
    name: '电商产品图',
    tpl: '一张电商产品图。产品：[产品名称与外观细节]。构图：产品居中占画面 60%，[45 度俯拍/正面平铺]。场景：[使用场景/纯色背景+道具点缀]。光线：柔和顶光加轮廓光，突出[材质卖点]。质感：[材质]纹理真实，细节锐利。负面约束：不要杂乱背景，不要文字水印，不要反光过曝。',
  },
  {
    name: '美食摄影',
    tpl: '一张专业美食摄影。主体：[菜品描述：食材/色泽/摆盘/容器]。镜头：45 度俯拍或平视特写，浅景深。光线：柔和侧逆光，突出食物质感与热气。环境：[餐桌/木纹/亚麻布]，点缀[餐具/香料]。质感：食材细节锐利，色泽诱人。负面约束：不要怪异食材形态，不要文字，不要过饱和。',
  },
  {
    name: '信息图',
    tpl: '一张[主题]信息图，整体排版从[左到右/上到下]分为[N]个区块。标题：[主标题]醒目置于顶部。区块结构：[逐条列出各区块内容]。图标：每条配简洁拟人化图标。风格：[扁平插画/可爱卡通]，主色调[颜色]。质感：信息层级清晰，图文对齐工整。负面约束：文字必须准确无错字，不要排版错乱。',
  },
  {
    name: '国风卷轴',
    tpl: '一幅中国古典卷轴画。题材：[主题场景]。构图：横向长卷式叙事，散点透视，留白呼吸感。元素：[人物/建筑/器物按朝代特征描述]，服饰器物考究。配色：[绢本设色/水墨淡彩]。质感：宣纸或绢本肌理，笔触工写结合。负面约束：不要现代元素，不要文字乱码，不要西方焦点透视。',
  },
  {
    name: '徽章设计',
    tpl: '一枚[主题]徽章设计，居中置于纯色背景。造型：[圆形/盾形/珐琅徽章]，边缘[金属包边/缝线]。核心图案：[主体描述，线条简洁可辨识]。配色：[3-4 色限制]，[烤漆/金属质感]。质感：金属光泽与浮雕层次，细节精致。负面约束：不要复杂背景，不要文字错乱，不要渐变脏色。',
  },
];
let pickerMode = 'image';

const renderState = { selectedIds: [], hd: true, running: false };
let renderJobs = [];

/* ---------------- 工具 ---------------- */

function authHeaders() {
  return auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
}

function maskKey(key) {
  return key.length > 12 ? `${key.slice(0, 6)}••••${key.slice(-4)}` : '••••••';
}

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* 忽略写入失败（如隐私模式） */
  }
}

function loadPersisted() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (saved.provider && PROVIDER_META[saved.provider]) state.provider = saved.provider;
    if (saved.keys) state.keys = { ...state.keys, ...saved.keys };
    if (saved.model) state.model = { ...state.model, ...saved.model };
    if (saved.lastKeyId) state.lastKeyId = { ...state.lastKeyId, ...saved.lastKeyId };
    if (typeof saved.assetType === 'string') state.assetType = saved.assetType;
    if (typeof saved.size === 'string' && saved.size) state.size = saved.size;
    if (typeof saved.agnesSize === 'string' && saved.agnesSize) state.agnesSize = saved.agnesSize;
    if (typeof saved.ratio === 'string' && saved.ratio) state.ratio = saved.ratio;
    if (Number.isFinite(saved.count)) state.count = Math.min(Math.max(saved.count, 1), 4);
    if (typeof saved.watermark === 'boolean') state.watermark = saved.watermark;
    if (saved.vmode === 'reference' || saved.vmode === 'keyframe') state.vmode = saved.vmode;
    if (typeof saved.vseconds === 'string' && saved.vseconds) state.vseconds = saved.vseconds;
    if (typeof saved.vsize === 'string' && saved.vsize) state.vsize = saved.vsize;
    if (typeof saved.vratio === 'string' && saved.vratio) state.vratio = saved.vratio;
  } catch {
    /* 忽略本地存储解析失败 */
  }
}

/* ---------------- 提示与错误 ---------------- */

function showError(msg) {
  const box = $('#error-box');
  box.textContent = msg;
  box.hidden = false;
}

function hideError() {
  $('#error-box').hidden = true;
}

let toastTimer = null;
function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, 6000);
}

/* ---------------- 通用渲染 ---------------- */

function renderChips(container, options, current, onPick) {
  container.innerHTML = '';
  options.forEach((opt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (opt.value === current ? ' active' : '');
    btn.textContent = opt.label;
    btn.setAttribute('aria-pressed', String(opt.value === current));
    btn.addEventListener('click', () => onPick(opt.value));
    container.appendChild(btn);
  });
}

/* ---- 多密钥故障转移（图片 / 视频生成共用） ---- */

const keyHealth = {}; // keyId -> { limited, error, at }

function isKeyLimitError(msg) {
  return /429|rate.?limit|too many|quota|余额|额度|欠费|insufficient|balance|限流|限制|forbidden|403|unauthorized|401|invalid[\s_-]*(api[\s_-]*)?key/i.test(
    String(msg)
  );
}

function markKeyHealth(key, err) {
  const msg = String((err && err.message) || err);
  keyHealth[key.id] = { limited: isKeyLimitError(msg), error: msg.slice(0, 140), at: Date.now() };
}

/**
 * 按顺序尝试账号中保存的密钥：成功即返回；一把失败自动换下一把，
 * 全部失败时抛出包含各密钥错误详情的异常。task(key, keyItem) 返回结果。
 */
async function withKeyFailover(provider, task) {
  const keys = auth.user ? keysForProvider(provider) : [];
  if (!keys.length) {
    throw new Error(`请先点击右上角账号，在浮窗中添加 ${PROVIDER_META[provider].name} 密钥`);
  }
  const notices = [];
  for (const k of keys) {
    try {
      const out = await task(k.key, k);
      return { out, usedKey: k, notices };
    } catch (err) {
      markKeyHealth(k, err);
      notices.push({ id: k.id, name: k.name, error: String((err && err.message) || err).slice(0, 100) });
    }
  }
  const detail = notices.map((n) => `「${n.name}」${n.error}`).join('；');
  throw new Error(`所有 ${PROVIDER_META[provider].name} 密钥均不可用：${detail}`);
}

/** 部分密钥失败但最终成功时，提示用户已自动切换 */
function notifyKeyFailover(notices, usedKey) {
  if (notices && notices.length && usedKey) {
    showToast(`密钥「${notices.map((n) => n.name).join('」「')}」不可用，已自动切换到「${usedKey.name}」`);
  }
}

function renderSizePresets() {
  renderChips($('#size-presets'), SENSENOVA_PRESETS, state.size, (v) => {
    state.size = v;
    $('#size-input').value = v;
    renderSizePresets();
    persist();
  });
}

function renderAgnesChips() {
  renderChips($('#agnes-size-chips'), AGNES_SIZES, state.agnesSize, (v) => {
    state.agnesSize = v;
    renderAgnesChips();
    persist();
  });
  renderChips($('#ratio-chips'), AGNES_RATIOS, state.ratio, (v) => {
    state.ratio = v;
    renderAgnesChips();
    persist();
  });
}

function renderCountChips() {
  renderChips($('#count-chips'), COUNT_OPTIONS, state.count, (v) => {
    state.count = v;
    renderCountChips();
    persist();
  });
}

/* ---------------- 账户 ---------------- */

function setAuthUI() {
  const area = $('#user-area');
  area.innerHTML = '';
  if (auth.user) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'user-chip';
    chip.title = '账号与模型管理';
    chip.addEventListener('click', () => openAccountModal());
    chip.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    const name = document.createElement('b');
    name.textContent = auth.user.username;
    chip.appendChild(name);

    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'ghost-btn';
    out.textContent = '退出';
    out.addEventListener('click', logout);

    area.appendChild(chip);
    area.appendChild(out);
  } else {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ghost-btn';
    btn.textContent = '登录 / 注册';
    btn.addEventListener('click', () => openAuthModal('login'));
    area.appendChild(btn);
  }
}

async function refreshAuth() {
  if (!auth.token) {
    auth.user = null;
    auth.keys = [];
    setAuthUI();
    renderKeyStatuses();
    return;
  }
  try {
    const resp = await fetch('/api/auth/me', { headers: authHeaders() });
    if (!resp.ok) throw new Error('unauthorized');
    const data = await resp.json();
    auth.user = { username: data.username };
    await loadKeys();
  } catch {
    auth.token = '';
    auth.user = null;
    auth.keys = [];
    localStorage.removeItem(LS_TOKEN_KEY);
  }
  setAuthUI();
  renderKeyStatuses();
  document.dispatchEvent(new CustomEvent('auth-changed'));
}

/* ---------------- 剧本体系 ---------------- */

function activeScriptId() {
  return state.activeScriptId || 'script-default';
}

function renderScriptSelects() {
  ['image', 'video'].forEach((p) => {
    const sel = $(`#${p}-script-select`);
    if (!sel) return;
    sel.innerHTML = '';
    if (!auth.user || !state.scripts.length) {
      const opt = document.createElement('option');
      opt.value = activeScriptId();
      opt.textContent = auth.user ? '默认剧本' : '登录后可用剧本';
      sel.appendChild(opt);
      sel.disabled = !auth.user;
    } else {
      sel.disabled = false;
      state.scripts.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        sel.appendChild(opt);
      });
      sel.value = activeScriptId();
    }
    const dis = !auth.user;
    const add = $(`#${p}-script-add`);
    const ren = $(`#${p}-script-rename`);
    const del = $(`#${p}-script-del`);
    if (add) add.disabled = dis;
    if (ren) ren.disabled = dis;
    if (del) del.disabled = dis;
  });
  renderGallery();
  renderVideoGallery();
}

async function loadScripts() {
  if (!auth.user) {
    state.scripts = [];
    state.activeScriptId = 'script-default';
    renderScriptSelects();
    return;
  }
  try {
    const resp = await fetch('/api/scripts', { headers: authHeaders() });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    state.scripts = Array.isArray(data.scripts) ? data.scripts : [];
    state.activeScriptId = data.activeScriptId || 'script-default';
    localStorage.setItem('ai-image-studio-script', state.activeScriptId);
  } catch {
    /* 拉取失败保持现状 */
  }
  renderScriptSelects();
}

async function activateScript(id) {
  if (!id) return;
  try {
    const resp = await fetch(`/api/scripts/${encodeURIComponent(id)}/activate`, {
      method: 'POST',
      headers: authHeaders(),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || '切换失败');
    state.activeScriptId = data.activeScriptId || id;
    localStorage.setItem('ai-image-studio-script', state.activeScriptId);
    renderScriptSelects();
    const cur = state.scripts.find((s) => s.id === state.activeScriptId);
    showToast(`已切换剧本：${cur ? cur.name : ''}`);
  } catch (err) {
    showToast(err.message || '切换失败');
    renderScriptSelects();
  }
}

async function createScript() {
  const name = prompt('新剧本名称（如：断开的莫比乌斯·第1章）');
  if (!name || !name.trim()) return;
  try {
    const resp = await fetch('/api/scripts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name: name.trim() }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || '创建失败');
    state.scripts = data.scripts;
    state.activeScriptId = data.activeScriptId;
    localStorage.setItem('ai-image-studio-script', state.activeScriptId);
    renderScriptSelects();
    showToast(`剧本「${data.script.name}」已创建并切换`);
  } catch (err) {
    showToast(err.message || '创建失败');
  }
}

async function renameScript() {
  const cur = state.scripts.find((s) => s.id === activeScriptId());
  if (!cur) return;
  const name = prompt('修改剧本名称', cur.name);
  if (!name || !name.trim() || name.trim() === cur.name) return;
  try {
    const resp = await fetch(`/api/scripts/${encodeURIComponent(cur.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name: name.trim() }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || '重命名失败');
    state.scripts = data.scripts;
    renderScriptSelects();
    showToast('剧本已重命名');
  } catch (err) {
    showToast(err.message || '重命名失败');
  }
}

async function deleteScript() {
  const cur = state.scripts.find((s) => s.id === activeScriptId());
  if (!cur) return;
  if (cur.id === 'script-default') {
    showToast('默认剧本不能删除');
    return;
  }
  if (!confirm(`删除剧本「${cur.name}」？该剧本下的图片和视频将归入默认剧本，文件不会被删除。`)) return;
  try {
    const resp = await fetch(`/api/scripts/${encodeURIComponent(cur.id)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || '删除失败');
    state.scripts = data.scripts;
    state.activeScriptId = data.activeScriptId;
    localStorage.setItem('ai-image-studio-script', state.activeScriptId);
    renderScriptSelects();
    loadHistory();
    showToast('剧本已删除');
  } catch (err) {
    showToast(err.message || '删除失败');
  }
}

async function loadKeys() {
  const resp = await fetch('/api/keys', { headers: authHeaders() });
  if (!resp.ok) throw new Error('load keys failed');
  const data = await resp.json();
  auth.keys = Array.isArray(data.keys) ? data.keys : [];
}

function keysForProvider(provider) {
  return auth.keys.filter((k) => k.provider === provider);
}

/** 更新图片 / 视频面板的密钥状态行 */
function renderKeyStatuses() {
  const mk = (sel, provider) => {
    const el = $(sel);
    if (!el) return;
    const n = auth.user ? keysForProvider(provider).length : 0;
    el.textContent = auth.user
      ? n
        ? `已保存 ${n} 把密钥，自动选用`
        : '尚未保存密钥，点击「账号管理」添加'
      : '登录后使用账号中保存的密钥';
  };
  mk('#img-key-status', state.provider);
  mk('#video-key-status', 'agnes');
}

/* ---------------- 登录 / 注册弹窗 ---------------- */

function setAuthMode(mode) {
  authMode = mode;
  $('#tab-login').classList.toggle('active', mode === 'login');
  $('#tab-register').classList.toggle('active', mode === 'register');
  $('#tab-login').setAttribute('aria-selected', String(mode === 'login'));
  $('#tab-register').setAttribute('aria-selected', String(mode === 'register'));
  $('#auth-title').textContent = mode === 'login' ? '账户登录' : '注册新账户';
  $('#auth-submit').textContent = mode === 'login' ? '登录' : '注册并登录';
  $('#auth-password').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
  hideAuthError();
}

function showAuthError(msg) {
  const box = $('#auth-error');
  box.textContent = msg;
  box.hidden = false;
}

function hideAuthError() {
  $('#auth-error').hidden = true;
}

function openAuthModal(mode) {
  setAuthMode(mode);
  $('#auth-form').reset();
  hideAuthError();
  $('#auth-modal').hidden = false;
  $('#auth-username').focus();
}

function closeAuthModal() {
  $('#auth-modal').hidden = true;
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;
  if (!username || !password) {
    showAuthError('请填写用户名和密码');
    return;
  }
  const btn = $('#auth-submit');
  btn.disabled = true;
  btn.textContent = authMode === 'login' ? '登录中…' : '注册中…';
  try {
    const resp = await fetch(`/api/auth/${authMode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `请求失败（HTTP ${resp.status}）`);
    auth.token = data.token;
    localStorage.setItem(LS_TOKEN_KEY, data.token);
    closeAuthModal();
    await refreshAuth();
    showToast(`欢迎，${data.username}`);
  } catch (err) {
    showAuthError(err.message || '操作失败，请稍后重试');
  } finally {
    btn.disabled = false;
    btn.textContent = authMode === 'login' ? '登录' : '注册并登录';
  }
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() });
  } catch {
    /* 本地清理不受影响 */
  }
  auth.token = '';
  auth.user = null;
  auth.keys = [];
  localStorage.removeItem(LS_TOKEN_KEY);
  setAuthUI();
  renderKeyStatuses();
  document.dispatchEvent(new CustomEvent('auth-changed'));
  showToast('已退出登录');
}

/* ---------------- 账号与模型浮窗 ---------------- */

function setAccountTab(tab) {
  ['llm', 'imgkey', 'vidkey'].forEach((t) => {
    $(`#acct-tab-${t}`).classList.toggle('active', t === tab);
    $(`#acct-tab-${t}`).setAttribute('aria-selected', String(t === tab));
    $(`#acct-pane-${t}`).hidden = t !== tab;
  });
}

function openAccountModal(tab) {
  setAccountTab(tab || 'llm');
  renderAccountKeys();
  if (typeof refreshLlmConfigs === 'function') refreshLlmConfigs(); // story.js 提供
  $('#account-modal').hidden = false;
}

function closeAccountModal() {
  $('#account-modal').hidden = true;
}

function showAcctError(sel, msg) {
  const box = $(sel);
  if (!box) return;
  box.textContent = msg;
  box.hidden = false;
}

function hideAcctError(sel) {
  const box = $(sel);
  if (box) box.hidden = true;
}

function keyItemRow(k) {
  const row = document.createElement('div');
  row.className = 'key-item';

  const name = document.createElement('span');
  name.className = 'key-item-name';
  name.textContent = k.name;
  name.title = k.name;
  row.appendChild(name);

  const value = document.createElement('span');
  value.className = 'key-item-value';
  value.textContent = maskKey(k.key);
  value.title = '点击显示完整 Key';
  let revealed = false;
  value.addEventListener('click', () => {
    revealed = !revealed;
    value.textContent = revealed ? k.key : maskKey(k.key);
  });
  row.appendChild(value);

  const health = keyHealth[k.id];
  if (health && health.limited && Date.now() - health.at < 30 * 60 * 1000) {
    const flag = document.createElement('span');
    flag.className = 'key-item-flag';
    flag.textContent = '受限';
    flag.title = health.error;
    row.appendChild(flag);
  }

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'key-item-del';
  del.setAttribute('aria-label', `删除密钥 ${k.name}`);
  del.innerHTML =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  del.addEventListener('click', async () => {
    if (!confirm(`确定删除密钥「${k.name}」？`)) return;
    try {
      const resp = await fetch(`/api/keys/${k.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!resp.ok) throw new Error('删除失败');
      auth.keys = auth.keys.filter((x) => x.id !== k.id);
      delete keyHealth[k.id];
      renderAccountKeys();
      renderKeyStatuses();
      showToast('密钥已删除');
    } catch (err) {
      showToast(err.message || '删除失败');
    }
  });
  row.appendChild(del);
  return row;
}

function renderAccountKeys() {
  const fill = (sel, provider) => {
    const box = $(sel);
    if (!box) return;
    box.innerHTML = '';
    const list = auth.user ? keysForProvider(provider) : [];
    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'key-empty';
      empty.textContent = auth.user ? '暂无密钥，在下方添加' : '登录后可管理密钥';
      box.appendChild(empty);
      return;
    }
    list.forEach((k) => box.appendChild(keyItemRow(k)));
  };
  fill('#acct-key-list-sensenova', 'sensenova');
  fill('#acct-key-list-agnes', 'agnes');
  fill('#acct-key-list-video', 'agnes');
}

async function addAccountKey(provider, name, key, errSel) {
  if (!key) {
    showAcctError(errSel, '请粘贴 API Key 内容');
    return false;
  }
  try {
    const resp = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ provider, name, key }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `请求失败（HTTP ${resp.status}）`);
    auth.keys.push(data.key);
    renderAccountKeys();
    renderKeyStatuses();
    showToast(`已添加 ${PROVIDER_META[provider].name} 密钥「${data.key.name}」`);
    return true;
  } catch (err) {
    showAcctError(errSel, err.message || '保存失败，请稍后重试');
    return false;
  }
}

async function handleAcctImgKeySubmit(e) {
  e.preventDefault();
  hideAcctError('#acct-imgkey-error');
  const ok = await addAccountKey(
    $('#acct-imgkey-provider').value,
    $('#acct-imgkey-name').value.trim() || '未命名',
    $('#acct-imgkey-value').value.trim(),
    '#acct-imgkey-error'
  );
  if (ok) e.target.reset();
}

async function handleAcctVidKeySubmit(e) {
  e.preventDefault();
  hideAcctError('#acct-vidkey-error');
  const ok = await addAccountKey(
    'agnes',
    $('#acct-vidkey-name').value.trim() || '未命名',
    $('#acct-vidkey-value').value.trim(),
    '#acct-vidkey-error'
  );
  if (ok) e.target.reset();
}

/* ---------------- 视频生成 ---------------- */

function slotSrc(val) {
  if (!val) return '';
  if (val.kind === 'file') return val.value;
  return val.kind === 'url'
    ? `/api/image?url=${encodeURIComponent(val.value)}`
    : `data:image/png;base64,${val.value}`;
}

function getSlotValue(target) {
  return target.type === 'ref' ? video.slots.refs[target.index] : video.slots[target.type];
}

function setSlotValue(target, val) {
  if (target.type === 'ref') video.slots.refs[target.index] = val;
  else video.slots[target.type] = val;
  renderSlots();
}

/* ---- 本地图片上传（拖拽 / 点选） ---- */

const UPLOAD_MAX_BYTES = 12 * 1024 * 1024; // 与服务端 JSON 16mb 限制匹配
let uploadingSlotKey = null;

function slotKeyOf(t) {
  return `${t.type}:${t.index == null ? '' : t.index}`;
}

/** 读取本地图片并上传到服务端，成功后填入槽位 */
async function uploadSlotFile(file, target) {
  if (!file) return;
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
    showToast('仅支持 PNG / JPG / WebP 图片');
    return;
  }
  if (file.size > UPLOAD_MAX_BYTES) {
    showToast('图片太大，请控制在 12MB 以内');
    return;
  }
  const key = slotKeyOf(target);
  uploadingSlotKey = key;
  renderSlots();
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });
    const resp = await fetch('/api/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ dataUrl }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `上传失败（HTTP ${resp.status}）`);
    if (!data.file) throw new Error('上传结果异常');
    setSlotValue(target, { kind: 'file', value: data.file });
    showToast('图片已上传');
  } catch (err) {
    showToast(err.message || '上传失败，请重试');
  } finally {
    uploadingSlotKey = null;
    renderSlots();
  }
}

/** 给槽位容器绑定拖放（重复调用安全） */
function bindSlotDrop(box, target) {
  if (box.dataset.dropBound === '1') return;
  box.dataset.dropBound = '1';
  box.addEventListener('dragover', (e) => {
    e.preventDefault();
    box.classList.add('drag-over');
  });
  box.addEventListener('dragleave', () => box.classList.remove('drag-over'));
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    box.classList.remove('drag-over');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) uploadSlotFile(file, target);
  });
}

function buildSlotInner(target, label) {
  const wrap = document.createElement('div');
  const val = getSlotValue(target);

  const head = document.createElement('div');
  head.className = 'slot-label';
  const name = document.createElement('span');
  name.textContent = label;
  head.appendChild(name);
  if (val) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'slot-btn';
    clear.textContent = '清除';
    clear.addEventListener('click', () => setSlotValue(target, null));
    head.appendChild(clear);
  }
  wrap.appendChild(head);

  if (val) {
    const img = document.createElement('img');
    img.className = 'slot-preview';
    img.alt = label;
    img.src = slotSrc(val);
    img.title = '拖拽新图片到此框可直接替换';
    wrap.appendChild(img);
    return wrap;
  }

  if (uploadingSlotKey === slotKeyOf(target)) {
    const up = document.createElement('div');
    up.className = 'slot-uploading';
    const sp = document.createElement('span');
    sp.className = 'pending-spinner';
    const txt = document.createElement('span');
    txt.textContent = '上传中…';
    up.appendChild(sp);
    up.appendChild(txt);
    wrap.appendChild(up);
    return wrap;
  }

  const actions = document.createElement('div');
  actions.className = 'slot-actions';

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'slot-btn';
  pick.textContent = '从生成结果选择';
  pick.addEventListener('click', () => openPicker(target));

  const upload = document.createElement('button');
  upload.type = 'button';
  upload.className = 'slot-btn';
  upload.textContent = '上传图片';
  upload.title = '点击选择本地图片，或直接把图片拖进此框';
  upload.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (f) uploadSlotFile(f, target);
    });
    input.click();
  });

  actions.appendChild(pick);
  actions.appendChild(upload);
  wrap.appendChild(actions);
  return wrap;
}

function renderSlots() {
  const kfField = $('#kf-slots-field');
  kfField.hidden = state.vmode !== 'keyframe';
  if (!kfField.hidden) {
    kfField.querySelectorAll('.slot-box').forEach((box) => {
      const type = box.dataset.slot;
      box.innerHTML = '';
      box.appendChild(buildSlotInner({ type }, type === 'first' ? '首帧' : '尾帧'));
      bindSlotDrop(box, { type });
    });
  }

  const refField = $('#ref-slots-field');
  refField.hidden = state.vmode !== 'reference';
  if (!refField.hidden) {
    const list = $('#ref-slots');
    list.innerHTML = '';
    video.slots.refs.forEach((_, i) => {
      const box = document.createElement('div');
      box.className = 'slot-box';
      box.appendChild(buildSlotInner({ type: 'ref', index: i }, `参考图 ${i + 1}`));
      bindSlotDrop(box, { type: 'ref', index: i });
      list.appendChild(box);
    });
  }
}

let pickerFilter = '';

function renderPickerFilterChips() {
  const box = $('#picker-filter-chips');
  box.hidden = pickerMode !== 'image';
  if (box.hidden) return;
  renderChips(
    box,
    [
      { value: '', label: '全部' },
      { value: 'character', label: '人物三视图' },
      { value: 'scene', label: '场景图' },
      { value: 'plain', label: '普通图' },
    ],
    pickerFilter,
    (v) => {
      pickerFilter = v;
      renderPickerFilterChips();
      renderPickerGrid();
    }
  );
}

function openPicker(target) {
  pickerTarget = target;
  pickerFilter = '';
  setPickerMode('image');
  $('#picker-modal').hidden = false;
}

function setPickerMode(mode) {
  pickerMode = mode;
  $('#picker-tab-image').classList.toggle('active', mode === 'image');
  $('#picker-tab-video').classList.toggle('active', mode === 'video');
  $('#picker-tab-image').setAttribute('aria-selected', String(mode === 'image'));
  $('#picker-tab-video').setAttribute('aria-selected', String(mode === 'video'));
  $('#picker-title').textContent = mode === 'image' ? '从生成结果选择图片' : '选择视频并提取尾帧';
  renderPickerFilterChips();
  renderPickerGrid();
}

function renderPickerGrid() {
  const grid = $('#picker-grid');
  grid.innerHTML = '';

  if (pickerMode === 'video') {
    const vids = video.results.filter(
      (v) => (v.status === 'done' || v.status === 'video_done') && (v.file || v.url || v.b64)
    );
    if (!vids.length) {
      const empty = document.createElement('p');
      empty.className = 'picker-empty';
      empty.textContent = '还没有已完成的视频，先生成一段视频再来提取尾帧';
      grid.appendChild(empty);
      return;
    }
    vids.forEach((v) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'picker-item';
      btn.title = v.prompt ? v.prompt.slice(0, 60) : '视频尾帧';
      const vid = document.createElement('video');
      vid.muted = true;
      vid.preload = 'metadata';
      vid.src = v.file || (v.url ? `/api/image?url=${encodeURIComponent(v.url)}` : `data:video/mp4;base64,${v.b64}`);
      btn.appendChild(vid);
      const tag = document.createElement('span');
      tag.className = 'picker-tag';
      tag.textContent = '提取尾帧';
      btn.appendChild(tag);
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        tag.textContent = '截帧中…';
        try {
          const dataUrl = await extractVideoLastFrame(vid.src);
          const b64 = String(dataUrl).split(',')[1] || '';
          if (!b64) throw new Error('截帧结果为空');
          setSlotValue(pickerTarget, { kind: 'b64', value: b64 });
          closePicker();
        } catch (err) {
          showToast(`尾帧提取失败：${err.message}`);
          btn.disabled = false;
          tag.textContent = '提取尾帧';
        }
      });
      grid.appendChild(btn);
    });
    return;
  }

  const pool = results.filter((item) =>
    pickerFilter === '' ? true : pickerFilter === 'plain' ? !item.assetType : item.assetType === pickerFilter
  );
  if (!pool.length) {
    const empty = document.createElement('p');
    empty.className = 'picker-empty';
    empty.textContent = results.length
      ? '该分类下还没有图片，换个分类或先去图片区生成'
      : '还没有可用的生成图片，请先在左侧生成图片';
    grid.appendChild(empty);
    return;
  }
  pool.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'picker-item';
    btn.title = item.prompt.slice(0, 60);
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '选择此图';
    img.src = item.file || (item.b64 ? `data:image/png;base64,${item.b64}` : `/api/image?url=${encodeURIComponent(item.url)}`);
    btn.appendChild(img);
    const nameTag = document.createElement('span');
    nameTag.className = 'picker-name';
    const typePrefix = item.assetType === 'character' ? '三视图·' : item.assetType === 'scene' ? '场景·' : '';
    nameTag.textContent = typePrefix + (item.name || (item.prompt || '').slice(0, 12));
    nameTag.title = nameTag.textContent;
    btn.appendChild(nameTag);
    btn.addEventListener('click', () => {
      const val = item.file
        ? { kind: 'file', value: item.file }
        : item.url
          ? { kind: 'url', value: item.url }
          : { kind: 'b64', value: item.b64 };
      setSlotValue(pickerTarget, val);
      closePicker();
    });
    grid.appendChild(btn);
  });
}

function closePicker() {
  $('#picker-modal').hidden = true;
  pickerTarget = null;
}

function setVideoMode(mode) {
  state.vmode = mode;
  $('#vtab-reference').classList.toggle('active', mode === 'reference');
  $('#vtab-keyframe').classList.toggle('active', mode === 'keyframe');
  $('#vtab-reference').setAttribute('aria-pressed', String(mode === 'reference'));
  $('#vtab-keyframe').setAttribute('aria-pressed', String(mode === 'keyframe'));
  $('#vratio-field').hidden = mode !== 'reference';
  renderSlots();
  persist();
}

function renderVideoChips() {
  renderChips($('#vsec-chips'), VSECONDS, state.vseconds, (v) => {
    state.vseconds = v;
    renderVideoChips();
    persist();
  });
  renderChips($('#vsize-chips'), VSIZES, state.vsize, (v) => {
    state.vsize = v;
    renderVideoChips();
    persist();
  });
  renderChips($('#vratio-chips'), VRATIOS, state.vratio, (v) => {
    state.vratio = v;
    renderVideoChips();
    persist();
  });
}

function showVideoError(msg) {
  const box = $('#video-error-box');
  box.textContent = msg;
  box.hidden = false;
}

function hideVideoError() {
  $('#video-error-box').hidden = true;
}

function setVideoGenerating(v) {
  videoGenerating = v;
  const btn = $('#video-generate-btn');
  btn.disabled = v;
  btn.textContent = v ? '生成中，视频通常需要 1-5 分钟…' : '生成视频';
  if (v) hideVideoError();
}

async function generateVideo() {
  if (videoGenerating) return;
  const prompt = $('#video-prompt').value.trim();
  if (!prompt) {
    showVideoError('请先填写视频提示词');
    $('#video-prompt').focus();
    return;
  }

  let body;
  if (state.vmode === 'keyframe') {
    const ff = video.slots.first;
    const lf = video.slots.last;
    if (!ff && !lf) {
      showVideoError('首尾帧模式至少需要设置一张首帧或尾帧图片');
      return;
    }
    body = {
      prompt,
      mode: 'keyframe',
      seconds: state.vseconds,
      size: state.vsize,
      firstFrame: ff,
      lastFrame: lf,
      scriptId: activeScriptId(),
    };
  } else {
    const imgs = video.slots.refs.filter(Boolean);
    if (!imgs.length) {
      showVideoError('请至少选择一张参考图');
      return;
    }
    body = {
      prompt,
      mode: 'reference',
      seconds: state.vseconds,
      size: state.vsize,
      aspectRatio: state.vratio,
      images: imgs,
      scriptId: activeScriptId(),
    };
  }

  setVideoGenerating(true);
  hideVideoError();

  // 占位卡片：点击后立即出现在结果区，避免接口受理慢时无反馈
  const placeholder = {
    id: `temp-${Date.now()}`,
    status: 'submitting',
    mode: state.vmode,
    seconds: state.vseconds,
    size: state.vsize,
    ratio: state.vmode === 'reference' ? state.vratio : null,
    prompt,
    scriptId: activeScriptId(),
    createdAt: Date.now(),
  };
  video.results = [placeholder, ...video.results];
  renderVideoGallery();

  try {
    const { out: data, usedKey, notices } = await withKeyFailover('agnes', (key) =>
      fetch('/api/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, apiKey: key }),
      }).then(async (resp) => {
        const d = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(d.error || `请求失败（HTTP ${resp.status}）`);
        return d;
      })
    );
    notifyKeyFailover(notices, usedKey);

    video.results = video.results.filter((x) => x !== placeholder);

    const rec = data.record;
    if (!rec) throw new Error('接口未返回任务记录');
    let item = video.results.find((x) => x.id === rec.id);
    if (item) Object.assign(item, rec);
    else {
      item = { ...rec };
      video.results = [item, ...video.results];
    }
    item.pollKey = usedKey.key; // 轮询沿用提交成功的密钥
    renderVideoGallery();
    if (item.taskId) startPolling(item);
  } catch (err) {
    const msg = err.message || '视频生成失败，请稍后重试';
    const target = video.results.find((x) => x === placeholder);
    if (target) {
      target.status = 'failed';
      target.error = msg;
    }
    showVideoError(msg);
    renderVideoGallery();
  } finally {
    setVideoGenerating(false);
  }
}

function startPolling(item) {
  if (!item || !item.taskId || item.polling) return;
  item.polling = true;
  let tries = 0;
  const maxTries = 150; // 12 秒 × 150 ≈ 30 分钟
  const pollKey = () =>
    item.pollKey || (auth.user ? (keysForProvider('agnes')[0] || {}).key || '' : '');
  const timer = setInterval(async () => {
    tries += 1;
    if (tries > maxTries) {
      clearInterval(timer);
      item.status = 'failed';
      item.error = '查询超时，视频可能仍在生成，请稍后重试或前往 Agnes 平台查看';
      renderVideoGallery();
      return;
    }
    try {
      const resp = await fetch(`/api/video/status/${encodeURIComponent(item.taskId)}`, {
        headers: { 'X-Api-Key': pollKey() },
      });
      const data = await resp.json().catch(() => ({}));
      if (data.status === 'done') {
        clearInterval(timer);
        if (data.record) Object.assign(item, data.record);
        else if (Array.isArray(data.videos) && data.videos.length) {
          item.url = data.videos[0].url || null;
          item.b64 = data.videos[0].b64 || null;
        }
        item.status = 'done';
        renderVideoGallery();
      } else if (data.status === 'failed') {
        clearInterval(timer);
        item.status = 'failed';
        item.error = data.error || '视频生成失败';
        renderVideoGallery();
      }
    } catch {
      /* 网络抖动时继续轮询 */
    }
  }, 12000);
}

function videoModeLabel(mode) {
  return mode === 'keyframe' ? '首尾帧' : '参考图';
}

function buildVideoCard(item) {
  const card = document.createElement('div');
  card.className = 'video-card';

  if (item.status === 'pending' || item.status === 'submitting') {
    const box = document.createElement('div');
    box.className = 'video-pending';
    const sp = document.createElement('span');
    sp.className = 'spinner';
    const txt = document.createElement('span');
    txt.textContent =
      item.status === 'submitting'
        ? '正在提交生成任务，请稍候…'
        : `视频生成中（${videoModeLabel(item.mode)} · ${item.seconds} 秒），请稍候…` +
          (item.taskId ? `（任务 ${String(item.taskId).slice(0, 12)}…）` : '');
    box.appendChild(sp);
    box.appendChild(txt);
    card.appendChild(box);
    return card;
  }

  if (item.status === 'failed') {
    const body = document.createElement('div');
    body.className = 'vc-body';
    const meta = document.createElement('p');
    meta.className = 'vc-meta';
    meta.textContent = `${videoModeLabel(item.mode)} · ${item.seconds} 秒 · ${item.size}`;
    const err = document.createElement('p');
    err.className = 'vc-error';
    err.textContent = `生成失败：${item.error}`;
    body.appendChild(meta);
    body.appendChild(err);
    card.appendChild(body);
    return card;
  }

  const vid = document.createElement('video');
  vid.controls = true;
  vid.preload = 'metadata';
  vid.playsInline = true;
  vid.setAttribute('referrerpolicy', 'no-referrer');
  vid.src = item.file || item.url || (item.b64 ? `data:video/mp4;base64,${item.b64}` : '');
  vid.addEventListener('error', () => {
    if (item.url && !vid.dataset.fallback) {
      vid.dataset.fallback = '1';
      vid.src = `/api/image?url=${encodeURIComponent(item.url)}`;
    }
  });
  card.appendChild(vid);

  const body = document.createElement('div');
  body.className = 'vc-body';

  const promptLine = document.createElement('p');
  promptLine.className = 'vc-prompt';
  promptLine.textContent = item.prompt;
  promptLine.title = item.prompt;

  const time = new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const meta = document.createElement('p');
  meta.className = 'vc-meta';
  meta.textContent = `${videoModeLabel(item.mode)} · ${item.seconds} 秒 · ${item.size}${item.ratio ? ` · ${item.ratio}` : ''} · ${time}`;

  const actions = document.createElement('div');
  actions.className = 'vc-actions';
  const dl = document.createElement('button');
  dl.type = 'button';
  dl.className = 'mini-btn primary';
  dl.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>下载</span>';
  dl.addEventListener('click', () => downloadVideo(item));
  actions.appendChild(dl);

  if (item.url) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'mini-btn';
    open.textContent = '原链';
    open.addEventListener('click', () => window.open(item.url, '_blank', 'noopener'));
    actions.appendChild(open);
  }

  body.appendChild(promptLine);
  body.appendChild(meta);
  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

function renderVideoGallery() {
  const list = $('#video-list');
  list.innerHTML = '';
  const visible = video.results.filter((item) => (item.scriptId || 'script-default') === activeScriptId());
  visible.forEach((item) => list.appendChild(buildVideoCard(item)));
  $('#video-empty').hidden = visible.length > 0;
  $('#video-result-count').textContent = visible.length ? `（${visible.length}）` : '';
}

function downloadVideo(item) {
  const filename = sanitizeFilename(`aivid_agnes_${item.mode}_${item.seconds}s_${item.id}.mp4`);
  if (item.file) {
    triggerDownload(item.file, filename);
    return;
  }
  if (item.b64) {
    const byteStr = atob(item.b64);
    const bytes = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  triggerDownload(
    `/api/download?url=${encodeURIComponent(item.url)}&filename=${encodeURIComponent(filename)}`,
    filename
  );
}

/* ---------------- 成片合成 ---------------- */

function doneVideos() {
  return video.results
    .filter((v) => (v.status === 'done' || v.status === 'video_done') && (v.file || v.url || v.b64))
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt);
}

function renderRenderPanel() {
  const list = $('#render-seg-list');
  list.innerHTML = '';
  const vids = doneVideos();
  if (!vids.length) {
    const p = document.createElement('p');
    p.className = 'seg-empty';
    p.textContent = '还没有已完成的分段视频';
    list.appendChild(p);
  }
  vids.forEach((v) => {
    const row = document.createElement('div');
    row.className = 'render-seg';
    const order = renderState.selectedIds.indexOf(v.id);
    const checked = order !== -1;

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = checked;
    box.setAttribute('aria-label', '选择该分段');
    box.addEventListener('change', () => {
      if (box.checked) renderState.selectedIds.push(v.id);
      else renderState.selectedIds = renderState.selectedIds.filter((x) => x !== v.id);
      renderRenderPanel();
    });
    row.appendChild(box);

    if (checked) {
      const ord = document.createElement('span');
      ord.className = 'seg-order';
      ord.textContent = order + 1;
      row.appendChild(ord);
    }

    const meta = document.createElement('span');
    meta.className = 'seg-meta';
    const time = new Date(v.createdAt).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    meta.textContent = `${videoModeLabel(v.mode)} · ${v.seconds}s · ${time}`;
    meta.title = v.prompt ? v.prompt.slice(0, 80) : '';
    row.appendChild(meta);

    if (checked) {
      const btns = document.createElement('div');
      btns.className = 'seg-btns';
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'slot-btn';
      up.textContent = '↑';
      up.disabled = order === 0;
      up.addEventListener('click', () => moveSelected(v.id, -1));
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'slot-btn';
      down.textContent = '↓';
      down.disabled = order === renderState.selectedIds.length - 1;
      down.addEventListener('click', () => moveSelected(v.id, 1));
      btns.appendChild(up);
      btns.appendChild(down);
      row.appendChild(btns);
    }

    list.appendChild(row);
  });

  renderRenderJobs();
}

function moveSelected(id, dir) {
  const idx = renderState.selectedIds.indexOf(id);
  const to = idx + dir;
  if (idx === -1 || to < 0 || to >= renderState.selectedIds.length) return;
  renderState.selectedIds.splice(to, 0, renderState.selectedIds.splice(idx, 1)[0]);
  renderRenderPanel();
}

function renderRenderJobs() {
  const list = $('#render-jobs');
  list.innerHTML = '';
  if (!renderJobs.length) {
    const p = document.createElement('p');
    p.className = 'seg-empty';
    p.textContent = '暂无合成任务';
    list.appendChild(p);
    return;
  }
  renderJobs.forEach((job) => list.appendChild(buildRenderJobCard(job)));
}

function buildRenderJobCard(job) {
  const card = document.createElement('div');
  card.className = 'render-job';

  if (job.status === 'rendering') {
    const body = document.createElement('div');
    body.className = 'rj-body';
    const title = document.createElement('p');
    title.className = 'rj-title';
    title.textContent = job.title;
    const bar = document.createElement('div');
    bar.className = 'rj-progress';
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(3, job.progress || 0)}%`;
    bar.appendChild(fill);
    const meta = document.createElement('p');
    meta.className = 'rj-meta';
    meta.textContent = `${job.stage || '处理中'} · ${job.progress || 0}%`;
    body.appendChild(title);
    body.appendChild(bar);
    body.appendChild(meta);
    card.appendChild(body);
    return card;
  }

  if (job.status === 'failed') {
    const body = document.createElement('div');
    body.className = 'rj-body';
    const title = document.createElement('p');
    title.className = 'rj-title';
    title.textContent = job.title;
    const err = document.createElement('p');
    err.className = 'rj-error';
    err.textContent = `合成失败：${job.error || '未知错误'}`;
    body.appendChild(title);
    body.appendChild(err);
    card.appendChild(body);
    return card;
  }

  const vid = document.createElement('video');
  vid.controls = true;
  vid.preload = 'metadata';
  vid.src = job.file || '';
  card.appendChild(vid);

  const body = document.createElement('div');
  body.className = 'rj-body';
  const title = document.createElement('p');
  title.className = 'rj-title';
  title.textContent = job.title;
  const meta = document.createElement('p');
  meta.className = 'rj-meta';
  meta.textContent = `成片 · ${job.segments} 段 · 1080p 精细化`;
  const actions = document.createElement('div');
  actions.className = 'vc-actions';
  const dl = document.createElement('button');
  dl.type = 'button';
  dl.className = 'mini-btn primary';
  dl.textContent = '下载成片';
  dl.addEventListener('click', () => triggerDownload(job.file, sanitizeFilename(`${job.title}.mp4`)));
  actions.appendChild(dl);
  body.appendChild(title);
  body.appendChild(meta);
  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

async function startRender() {
  if (renderState.running) return;
  if (renderState.selectedIds.length < 2) {
    showRenderError('请至少选择 2 段视频');
    return;
  }
  renderState.running = true;
  hideRenderError();
  const btn = $('#render-start-btn');
  btn.disabled = true;
  btn.textContent = '合成中…';
  try {
    const resp = await fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: renderState.selectedIds, hd: renderState.hd, scriptId: activeScriptId() }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `请求失败（HTTP ${resp.status}）`);
    renderJobs = [{ ...data.record }, ...renderJobs.filter((j) => j.id !== data.record.id)];
    renderRenderJobs();
    showToast('成片合成已开始，进度将自动更新');
  } catch (err) {
    showRenderError(err.message || '合成失败');
  } finally {
    renderState.running = false;
    btn.disabled = false;
    btn.textContent = '合成成片';
  }
}

function showRenderError(msg) {
  const box = $('#render-error-box');
  box.textContent = msg;
  box.hidden = false;
}

function hideRenderError() {
  $('#render-error-box').hidden = true;
}

/* ---------------- 历史记录（刷新后恢复） ---------------- */

function historySignature(items) {
  return items.map((r) => `${r.id}:${r.status || ''}:${r.file || ''}:${r.url || ''}`).join('|');
}

function mergeImageHistory(items) {
  if (!items.length) return false;
  const before = historySignature(results);
  const map = new Map(results.map((r) => [r.id, r]));
  items.forEach((it) => {
    const existing = map.get(it.id);
    if (existing) Object.assign(existing, it);
    else map.set(it.id, { ...it });
  });
  results = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
  return historySignature(results) !== before;
}

function mergeVideoHistory(items) {
  if (!items.length) return false;
  const before = historySignature(video.results);
  const map = new Map(video.results.map((r) => [r.id, r]));
  items.forEach((it) => {
    const existing = map.get(it.id);
    if (existing) Object.assign(existing, it);
    else map.set(it.id, { ...it });
  });
  video.results = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
  return historySignature(video.results) !== before;
}

async function loadHistory() {
  try {
    const resp = await fetch('/api/history');
    if (!resp.ok) return;
    const data = await resp.json().catch(() => ({}));
    const items = Array.isArray(data.items) ? data.items : [];
    const imgChanged = mergeImageHistory(items.filter((r) => r.type === 'image'));
    const vidChanged = mergeVideoHistory(items.filter((r) => r.type === 'video'));
    if (imgChanged) renderGallery();
    if (vidChanged) renderVideoGallery();
    // 恢复未完成视频任务的轮询
    video.results.forEach((it) => {
      if (it.status === 'pending' && it.taskId) startPolling(it);
    });
    // 同步成片合成任务
    renderJobs = items.filter((r) => r.type === 'render');
    renderRenderPanel();
    // 通知故事工坊等模块同步任务状态
    document.dispatchEvent(new CustomEvent('history-updated', { detail: { items } }));
  } catch {
    /* 忽略历史加载失败 */
  }
}

function startHistorySync() {
  setInterval(async () => {
    if (document.hidden) return;
    await loadHistory();
  }, 15000);
}

/* ---------------- 服务商切换 ---------------- */

function setProvider(p) {
  state.provider = p;
  $('#sensenova-size-field').hidden = p !== 'sensenova';
  $('#agnes-size-field').hidden = p !== 'agnes';
  $('#watermark-field').hidden = p !== 'sensenova';
  const sel = $('#model-select');
  if (sel) sel.value = `${p}|${state.model[p]}`;
  renderKeyStatuses();
  persist();
}

/** 模型下拉切换：值格式 provider|model */
function onModelSelectChange(e) {
  const [provider, model] = String(e.target.value || '').split('|');
  if (!PROVIDER_META[provider] || !model) return;
  state.model[provider] = model;
  setProvider(provider);
  persist();
}

/* ---------------- 画廊 ---------------- */

function sanitizeFilename(name) {
  return String(name).replace(/[\\/:*?"<>|]+/g, '-');
}

/* ---- 生成类型选择 / 结果筛选 / 重命名 / 重新编辑 ---- */

function renderAssetTypeChips() {
  renderChips($('#asset-type-chips'), ASSET_TYPES, state.assetType, (v) => {
    state.assetType = v;
    renderAssetTypeChips();
    persist();
  });
}

let galleryFilter = '';

function renderGalleryFilterChips() {
  renderChips(
    $('#gallery-filter-chips'),
    [
      { value: '', label: '全部' },
      { value: 'character', label: '人物三视图' },
      { value: 'scene', label: '场景图' },
      { value: 'plain', label: '普通图' },
    ],
    galleryFilter,
    (v) => {
      galleryFilter = v;
      renderGalleryFilterChips();
      renderGallery();
    }
  );
}

async function renameItem(item) {
  const name = window.prompt('给这张图片起个名字（视频选图时更易辨认，留空则清除）：', item.name || '');
  if (name === null) return;
  try {
    const resp = await fetch('/api/history/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, name }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `请求失败（HTTP ${resp.status}）`);
    item.name = data.record && data.record.name ? data.record.name : null;
    renderGallery();
    showToast(item.name ? `已重命名为「${item.name}」` : '已清除名称');
  } catch (err) {
    showToast(err.message || '重命名失败');
  }
}

function editItem(item) {
  $('#prompt').value = item.prompt || '';
  state.assetType = item.assetType === 'character' || item.assetType === 'scene' ? item.assetType : '';
  renderAssetTypeChips();
  persist();
  const ta = $('#prompt');
  ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  showToast('提示词已回填到左侧，修改后点击「立即生成」重新生成');
}

async function deleteItem(item) {
  if (!confirm('确定删除这张图片？服务器上保存的图片文件也会一并删除')) return;
  try {
    const resp = await fetch('/api/history/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `请求失败（HTTP ${resp.status}）`);
    results = results.filter((r) => r.id !== item.id);
    renderGallery();
    showToast('已删除');
  } catch (err) {
    showToast(err.message || '删除失败');
  }
}

function buildCard(item) {
  const fig = document.createElement('figure');
  fig.className = 'img-card';

  const img = document.createElement('img');
  img.alt = (item.prompt || '').slice(0, 60);
  img.loading = 'lazy';
  img.title = '点击查看大图';
  img.src = item.file || (item.b64 ? `data:image/png;base64,${item.b64}` : `/api/image?url=${encodeURIComponent(item.url)}`);
  img.addEventListener('click', () => openLightbox(item));
  img.addEventListener('error', () => img.classList.add('broken'));

  const cap = document.createElement('figcaption');

  const nameRow = document.createElement('p');
  nameRow.className = 'img-name';
  if (item.assetType) {
    const typeTag = document.createElement('span');
    typeTag.className = 'type-badge' + (item.assetType === 'character' ? ' t-character' : ' t-scene');
    typeTag.textContent = ASSET_TYPE_LABEL[item.assetType];
    nameRow.appendChild(typeTag);
  }
  const nameText = document.createElement('span');
  nameText.className = 'img-name-text';
  nameText.textContent = item.name || '未命名';
  nameText.title = '点击重命名';
  nameText.addEventListener('click', () => renameItem(item));
  nameRow.appendChild(nameText);
  cap.appendChild(nameRow);

  const spec = item.size || item.ratio || '';
  const time = new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  const promptLine = document.createElement('p');
  promptLine.className = 'img-prompt';
  promptLine.textContent = item.prompt.length > 48 ? item.prompt.slice(0, 48) + '…' : item.prompt;
  promptLine.title = item.prompt;

  const meta = document.createElement('p');
  meta.className = 'img-meta';
  meta.textContent = `${PROVIDER_META[item.provider] ? PROVIDER_META[item.provider].name : item.provider} · ${item.model || ''} · ${spec} · ${time}`;

  const actions = document.createElement('div');
  actions.className = 'img-actions';

  const dl = document.createElement('button');
  dl.type = 'button';
  dl.className = 'mini-btn primary';
  dl.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>下载</span>';
  dl.addEventListener('click', () => downloadItem(item));
  actions.appendChild(dl);

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'mini-btn';
  edit.textContent = '重新编辑';
  edit.title = '把这张图的提示词回填到左侧，修改后可重新生成';
  edit.addEventListener('click', () => editItem(item));
  actions.appendChild(edit);

  const ren = document.createElement('button');
  ren.type = 'button';
  ren.className = 'mini-btn';
  ren.textContent = '重命名';
  ren.addEventListener('click', () => renameItem(item));
  actions.appendChild(ren);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'mini-btn danger';
  del.textContent = '删除';
  del.addEventListener('click', () => deleteItem(item));
  actions.appendChild(del);

  if (item.url) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'mini-btn';
    open.textContent = '原图';
    open.addEventListener('click', () =>
      window.open(`/api/image?url=${encodeURIComponent(item.url)}`, '_blank', 'noopener')
    );
    actions.appendChild(open);
  }

  cap.appendChild(promptLine);
  cap.appendChild(meta);
  cap.appendChild(actions);
  fig.appendChild(img);
  fig.appendChild(cap);
  return fig;
}

function renderGallery() {
  const grid = $('#gallery-grid');
  grid.innerHTML = '';
  grid.setAttribute('aria-busy', String(generating));

  if (generating) {
    for (let i = 0; i < state.count; i++) {
      const card = document.createElement('div');
      card.className = 'img-card skeleton-card';
      card.setAttribute('aria-hidden', 'true');
      card.innerHTML =
        '<div class="skeleton-img"></div><div class="skeleton-bar"></div><div class="skeleton-bar short"></div>';
      grid.appendChild(card);
    }
  }

  const visible = results.filter(
    (item) =>
      (item.scriptId || 'script-default') === activeScriptId() &&
      (galleryFilter === '' || (galleryFilter === 'plain' ? !item.assetType : item.assetType === galleryFilter))
  );
  visible.forEach((item) => grid.appendChild(buildCard(item)));
  $('#empty-state').hidden = visible.length > 0 || generating;
  $('#result-count').textContent = visible.length ? `（${visible.length}）` : '';
}

/* ---------------- 下载与预览 ---------------- */

function triggerDownload(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadItem(item) {
  const spec = (item.size || item.ratio || '').replace(':', '-');
  const modelTag = (item.model || '').replace(/^sensenova-|^agnes-image-/, '');
  const filename = sanitizeFilename(`aiimg_${item.provider}_${modelTag}_${spec}_${item.id}.png`);
  if (item.file) {
    triggerDownload(item.file, filename);
    return;
  }
  if (item.b64) {
    const byteStr = atob(item.b64);
    const bytes = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  triggerDownload(
    `/api/download?url=${encodeURIComponent(item.url)}&filename=${encodeURIComponent(filename)}`,
    filename
  );
}

function openLightbox(item) {
  $('#lightbox-img').src = item.file
    ? item.file
    : item.b64
      ? `data:image/png;base64,${item.b64}`
      : `/api/image?url=${encodeURIComponent(item.url)}`;
  $('#lightbox').hidden = false;
}

function closeLightbox() {
  $('#lightbox').hidden = true;
}

/* ---------------- 生成 ---------------- */

function setGenerating(v) {
  generating = v;
  const btn = $('#generate-btn');
  btn.disabled = v;
  btn.textContent = v ? '生成中，请稍候…' : '立即生成';
  if (v) hideError();
  renderGallery();
}

async function generate() {
  if (generating) return;
  const prompt = $('#prompt').value.trim();
  if (!prompt) {
    showError('请先填写提示词');
    $('#prompt').focus();
    return;
  }

  const isSense = state.provider === 'sensenova';
  const assetType = state.assetType === 'character' || state.assetType === 'scene' ? state.assetType : '';
  const body = {
    provider: state.provider,
    prompt: wrapAssetPrompt(assetType, prompt),
    rawPrompt: prompt,
    assetType: assetType || undefined,
    model: state.model[state.provider],
    n: state.count,
    watermark: state.watermark,
    size: isSense ? state.size : state.agnesSize,
    ratio: state.ratio,
    scriptId: activeScriptId(),
  };

  setGenerating(true);
  try {
    const { out: data, usedKey, notices } = await withKeyFailover(state.provider, (key) =>
      fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, apiKey: key }),
      }).then(async (resp) => {
        const d = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(d.error || `请求失败（HTTP ${resp.status}）`);
        return d;
      })
    );
    notifyKeyFailover(notices, usedKey);

    const recs = Array.isArray(data.records) ? data.records : [];
    if (recs.length) {
      results = [...recs.map((r) => ({ ...r })), ...results];
    }
    renderGallery();
    if (data.partialErrors && data.partialErrors.length) {
      showToast(`有 ${data.partialErrors.length} 张图片生成失败：${data.partialErrors[0]}`);
    }
  } catch (err) {
    showError(err.message || '生成失败，请稍后重试');
    renderGallery();
  } finally {
    setGenerating(false);
  }
}

/* ---------------- 提示词优化（prompt-optimizer MCP） ---------------- */

/** 优化 textarea 中的提示词并回填；绑定在各「AI 优化」按钮上 */
async function optimizeTextarea(ta, btn) {
  const text = ta.value.trim();
  if (!text) {
    showToast('请先填写提示词再优化');
    return;
  }
  const old = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '优化中…';
  }
  try {
    const resp = await fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ prompt: text }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `请求失败（HTTP ${resp.status}）`);
    ta.value = data.optimized || text;
    ta.dispatchEvent(new Event('change')); // 让故事镜头等监听 change 的逻辑自动保存
    showToast('提示词已优化，可继续修改');
  } catch (err) {
    showToast(err.message || '优化失败，请稍后重试');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = old;
    }
  }
}

/* ---------------- 健康检查 ---------------- */

async function checkHealth() {
  const dot = document.querySelector('#status-badge .dot');
  const text = $('#status-text');
  try {
    const r = await fetch('/api/health');
    if (!r.ok) throw new Error('bad status');
    dot.className = 'dot ok';
    text.textContent = '服务正常';
  } catch {
    dot.className = 'dot bad';
    text.textContent = '服务异常';
  }
}

/* ---------------- 初始化 ---------------- */

function init() {
  loadPersisted();

  // 工作区切换
  document.querySelectorAll('.ws-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ws-tab').forEach((t) => {
        const active = t === tab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', String(active));
      });
      ['image', 'video', 'story'].forEach((id) => {
        const el = document.getElementById(`ws-${id}`);
        if (el) el.hidden = id !== tab.dataset.ws;
      });
    });
  });

  // 登录 / 注册
  $('#tab-login').addEventListener('click', () => setAuthMode('login'));
  $('#tab-register').addEventListener('click', () => setAuthMode('register'));
  $('#auth-form').addEventListener('submit', handleAuthSubmit);
  $('#auth-close').addEventListener('click', closeAuthModal);
  $('#auth-modal').addEventListener('click', (e) => {
    if (e.target === $('#auth-modal')) closeAuthModal();
  });

  // 账号与模型浮窗
  $('#account-close').addEventListener('click', closeAccountModal);
  $('#account-modal').addEventListener('click', (e) => {
    if (e.target === $('#account-modal')) closeAccountModal();
  });
  $('#acct-tab-llm').addEventListener('click', () => setAccountTab('llm'));
  $('#acct-tab-imgkey').addEventListener('click', () => setAccountTab('imgkey'));
  $('#acct-tab-vidkey').addEventListener('click', () => setAccountTab('vidkey'));
  $('#acct-imgkey-form').addEventListener('submit', handleAcctImgKeySubmit);
  $('#acct-vidkey-form').addEventListener('submit', handleAcctVidKeySubmit);
  $('#img-account-btn').addEventListener('click', () => openAccountModal('imgkey'));
  $('#video-account-btn').addEventListener('click', () => openAccountModal('vidkey'));

  // 生成模型选择
  $('#model-select').addEventListener('change', onModelSelectChange);

  // AI 提示词优化
  $('#prompt-optimize-btn').addEventListener('click', (e) => optimizeTextarea($('#prompt'), e.currentTarget));
  $('#video-optimize-btn').addEventListener('click', (e) => optimizeTextarea($('#video-prompt'), e.currentTarget));

  // 尺寸与选项
  $('#size-input').value = state.size;
  $('#size-input').addEventListener('input', (e) => {
    state.size = e.target.value.trim();
    renderSizePresets();
    persist();
  });
  $('#watermark').checked = state.watermark;
  $('#watermark').addEventListener('change', (e) => {
    state.watermark = e.target.checked;
    persist();
  });

  // 生成与画廊
  $('#generate-btn').addEventListener('click', generate);
  $('#clear-btn').addEventListener('click', async () => {
    if (results.length && !confirm('确定清空全部图片记录？服务器上保存的图片文件也会一并删除')) return;
    try {
      await fetch('/api/history/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'image' }),
      });
    } catch {
      /* 服务端清理失败时仍清空本地展示 */
    }
    results = [];
    renderGallery();
  });
  // 视频生成
  $('#vtab-reference').addEventListener('click', () => setVideoMode('reference'));
  $('#vtab-keyframe').addEventListener('click', () => setVideoMode('keyframe'));
  $('#video-generate-btn').addEventListener('click', generateVideo);
  $('#video-clear-btn').addEventListener('click', async () => {
    if (video.results.length && !confirm('确定清空全部视频记录？服务器上保存的视频文件也会一并删除')) return;
    try {
      await fetch('/api/history/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'video' }),
      });
    } catch {
      /* 服务端清理失败时仍清空本地展示 */
    }
    video.results = [];
    renderVideoGallery();
  });
  $('#picker-close').addEventListener('click', closePicker);
  $('#picker-tab-image').addEventListener('click', () => setPickerMode('image'));
  $('#picker-tab-video').addEventListener('click', () => setPickerMode('video'));
  $('#picker-modal').addEventListener('click', (e) => {
    if (e.target === $('#picker-modal')) closePicker();
  });

  // 成片合成
  $('#render-selectall-btn').addEventListener('click', () => {
    renderState.selectedIds = doneVideos().map((v) => v.id);
    renderRenderPanel();
  });
  $('#render-reverse-btn').addEventListener('click', () => {
    renderState.selectedIds.reverse();
    renderRenderPanel();
  });
  $('#render-clear-btn').addEventListener('click', () => {
    renderState.selectedIds = [];
    renderRenderPanel();
  });
  $('#render-hd').checked = renderState.hd;
  $('#render-hd').addEventListener('change', (e) => {
    renderState.hd = e.target.checked;
  });
  $('#render-start-btn').addEventListener('click', startRender);
  renderRenderPanel();

  $('#lightbox').addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLightbox();
      closeAuthModal();
      closeAccountModal();
      closePicker();
    }
  });

  // 剧本切换器
  ['image', 'video'].forEach((p) => {
    const sel = $(`#${p}-script-select`);
    if (sel) sel.addEventListener('change', (e) => activateScript(e.target.value));
    const add = $(`#${p}-script-add`);
    if (add) add.addEventListener('click', createScript);
    const ren = $(`#${p}-script-rename`);
    if (ren) ren.addEventListener('click', renameScript);
    const del = $(`#${p}-script-del`);
    if (del) del.addEventListener('click', deleteScript);
  });
  document.addEventListener('auth-changed', () => {
    loadScripts();
  });

  // 初始渲染
  const tplSelect = $('#prompt-template');
  PROMPT_TEMPLATES.forEach((t, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = t.name;
    tplSelect.appendChild(opt);
  });
  tplSelect.addEventListener('change', () => {
    const t = PROMPT_TEMPLATES[Number(tplSelect.value)];
    if (!t) return;
    $('#prompt').value = t.tpl;
    tplSelect.value = '';
    showToast('模板已填入，替换 [ ] 内的变量后生成');
  });

  setProvider(state.provider);
  renderSizePresets();
  renderAgnesChips();
  renderCountChips();
  renderVideoChips();
  setVideoMode(state.vmode);
  renderAssetTypeChips();
  renderGalleryFilterChips();
  renderGallery();
  renderVideoGallery();
  checkHealth();
  refreshAuth();
  loadHistory();
  startHistorySync();
}

document.addEventListener('DOMContentLoaded', init);
