'use strict';

/* ============================================================
 * 故事工坊模块
 * 依赖 app.js 的全局：$、auth、authHeaders、state、showToast、triggerDownload、sanitizeFilename
 * ============================================================ */

const STORY_LS_KEY = 'ai-image-studio-story-v1';

const STORY_STYLES = [
  {
    name: '吉卜力动画',
    prompt: '吉卜力工作室风格手绘动画：细腻水彩背景，赛璐璐平涂上色，柔和自然光带暖色滤镜，温暖怀旧色调，笔触温润干净',
  },
  {
    name: '写实电影感',
    prompt: '写实电影质感：35mm 胶片颗粒，电影级三点打光与冷暖对比光影，浅景深，细腻色调分级，真实材质纹理',
  },
  {
    name: '日漫风',
    prompt: '日式动漫风格：清晰利落的线条，鲜明平涂色块，眼神光点缀，情感化表情演绎，背景精细度高于人物',
  },
  {
    name: '国风水墨',
    prompt: '中国水墨画风格：留白构图，墨色浓淡晕染，淡彩点缀，宣纸质感，笔触写意而有骨',
  },
  {
    name: '赛博朋克',
    prompt: '赛博朋克风格：粉紫与青蓝霓虹光源，湿润路面反射，体积光雾，高反差暗部，机能面料材质细节',
  },
  {
    name: '3D 皮克斯',
    prompt: '皮克斯风格 3D 渲染：柔和全局光照，次表面散射皮肤，适度夸张的造型比例，细腻材质贴图，明快饱和配色',
  },
];

const STORY_SHOT_COUNTS = [8, 12, 16, 20, 24];
const STORY_MANUAL = '__manual__';
const STORY_SHOT_IMAGE_SIZE = '2752x1536'; // 16:9

const storyState = {
  projects: [],
  currentId: null,
  current: null,
  style: STORY_STYLES[0],
  shotCount: 12,
  chain: true,
  batchRunning: false,
};

let llmConfigs = [];
let llmActiveId = null;
let llmEditingId = null;
let shotSaveTimers = {};

/* InkOS 书架状态 */
let inkosBooks = [];
let inkosChapters = [];
let inkosCanon = '';

/* ---------------- 本地偏好 ---------------- */

function storyLoadPrefs() {
  try {
    const s = JSON.parse(localStorage.getItem(STORY_LS_KEY) || '{}');
    if (typeof s.style === 'string' && s.style) storyState.style = s.style;
    if (STORY_SHOT_COUNTS.includes(s.shotCount)) storyState.shotCount = s.shotCount;
    if (typeof s.chain === 'boolean') storyState.chain = s.chain;
  } catch {
    /* 忽略 */
  }
}

function storyPersistPrefs() {
  try {
    localStorage.setItem(
      STORY_LS_KEY,
      JSON.stringify({ style: storyState.style, shotCount: storyState.shotCount, chain: storyState.chain })
    );
  } catch {
    /* 忽略 */
  }
}

/* ---------------- 文本模型配置 ---------------- */

async function refreshLlmConfigs() {
  const list = $('#llm-config-list');
  if (!auth.user) {
    llmConfigs = [];
    llmActiveId = null;
    list.innerHTML = '';
    const hint = document.createElement('p');
    hint.className = 'key-empty';
    hint.textContent = '登录账户后即可配置文本模型（用于分镜拆解）';
    list.appendChild(hint);
    return;
  }
  try {
    const resp = await fetch('/api/llm-configs', { headers: authHeaders() });
    if (!resp.ok) throw new Error('加载失败');
    const data = await resp.json();
    llmConfigs = Array.isArray(data.configs) ? data.configs : [];
    llmActiveId = data.activeId || null;
    renderLlmConfigs();
  } catch {
    list.innerHTML = '';
    const hint = document.createElement('p');
    hint.className = 'key-empty';
    hint.textContent = '文本模型配置加载失败';
    list.appendChild(hint);
  }
}

function renderLlmConfigs() {
  const list = $('#llm-config-list');
  list.innerHTML = '';
  if (!llmConfigs.length) {
    const hint = document.createElement('p');
    hint.className = 'key-empty';
    hint.textContent = '还没有文本模型配置，点右上角「新增配置」';
    list.appendChild(hint);
    return;
  }
  llmConfigs.forEach((cfg) => {
    const item = document.createElement('div');
    item.className = 'llm-item' + (cfg.id === llmActiveId ? ' active' : '');

    const main = document.createElement('div');
    main.className = 'llm-main';
    const name = document.createElement('span');
    name.className = 'llm-name';
    name.textContent = (cfg.id === llmActiveId ? '★ ' : '') + cfg.name;
    name.title = '点击设为默认';
    const model = document.createElement('span');
    model.className = 'llm-model';
    model.textContent = `${cfg.model} · ${cfg.baseUrl.replace(/^https?:\/\//, '')}`;
    main.appendChild(name);
    main.appendChild(model);
    main.addEventListener('click', () => activateLlmConfig(cfg.id));
    main.style.cursor = 'pointer';

    const actions = document.createElement('div');
    actions.className = 'llm-actions';

    const test = document.createElement('button');
    test.type = 'button';
    test.className = 'slot-btn';
    test.textContent = '测试';
    test.addEventListener('click', () => testLlmConfig(cfg.id, test));

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'slot-btn';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => openLlmForm(cfg));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'slot-btn';
    del.textContent = '删除';
    del.addEventListener('click', () => deleteLlmConfig(cfg.id));

    actions.appendChild(test);
    actions.appendChild(edit);
    actions.appendChild(del);

    item.appendChild(main);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

function openLlmForm(cfg) {
  llmEditingId = cfg ? cfg.id : null;
  $('#llm-form').hidden = false;
  $('#llm-name').value = cfg ? cfg.name : '';
  $('#llm-base-url').value = cfg ? cfg.baseUrl : '';
  $('#llm-model').value = cfg ? cfg.model : '';
  $('#llm-key').value = '';
  $('#llm-key').placeholder = cfg ? 'API Key（留空则不修改）' : 'API Key';
  $('#llm-name').focus();
}

function closeLlmForm() {
  llmEditingId = null;
  $('#llm-form').hidden = true;
}

async function saveLlmConfig() {
  const name = $('#llm-name').value.trim();
  const baseUrl = $('#llm-base-url').value.trim();
  const model = $('#llm-model').value.trim();
  const key = $('#llm-key').value.trim();
  if (!baseUrl || !model) {
    showToast('请填写连接地址和模型名称');
    return;
  }
  if (!llmEditingId && !key) {
    showToast('请填写 API Key');
    return;
  }
  try {
    const resp = await fetch(llmEditingId ? `/api/llm-configs/${llmEditingId}` : '/api/llm-configs', {
      method: llmEditingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name, baseUrl, model, key: key || undefined }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `请求失败（HTTP ${resp.status}）`);
    await refreshLlmConfigs();
    closeLlmForm();
    showToast('文本模型配置已保存');
  } catch (err) {
    showToast(err.message || '保存失败');
  }
}

async function deleteLlmConfig(id) {
  if (!confirm('确定删除该文本模型配置？')) return;
  try {
    const resp = await fetch(`/api/llm-configs/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (!resp.ok) throw new Error('删除失败');
    await refreshLlmConfigs();
  } catch (err) {
    showToast(err.message || '删除失败');
  }
}

async function activateLlmConfig(id) {
  try {
    const resp = await fetch(`/api/llm-configs/${id}/activate`, { method: 'POST', headers: authHeaders() });
    if (!resp.ok) throw new Error('设置失败');
    llmActiveId = id;
    renderLlmConfigs();
  } catch (err) {
    showToast(err.message || '设置失败');
  }
}

async function testLlmConfig(id, btn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '测试中…';
  try {
    const resp = await fetch(`/api/llm-configs/${id}/test`, { method: 'POST', headers: authHeaders() });
    const data = await resp.json().catch(() => ({}));
    if (data.ok) showToast(`连接正常，模型回复：${data.reply || '正常'}`);
    else showToast(`连接失败：${data.error || '未知错误'}`);
  } catch (err) {
    showToast(err.message || '测试失败');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

/* ---------------- 故事项目 ---------------- */

async function loadProjects() {
  const select = $('#story-project-select');
  select.innerHTML = '';
  if (!auth.user) {
    storyState.projects = [];
    const opt = document.createElement('option');
    opt.textContent = '登录后查看故事项目';
    select.appendChild(opt);
    return;
  }
  try {
    const resp = await fetch('/api/story/list', { headers: authHeaders() });
    if (!resp.ok) throw new Error('加载失败');
    const data = await resp.json();
    storyState.projects = Array.isArray(data.items) ? data.items : [];
  } catch {
    storyState.projects = [];
  }
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = storyState.projects.length ? '打开历史项目…' : '暂无故事项目';
  select.appendChild(placeholder);
  storyState.projects.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.title}（图 ${p.imageDone}/${p.shots} · 视频 ${p.videoDone}/${p.shots}）`;
    select.appendChild(opt);
  });
  if (storyState.currentId && storyState.projects.some((p) => p.id === storyState.currentId)) {
    select.value = storyState.currentId;
  }
}

async function openProject(id) {
  if (!id) return;
  try {
    const resp = await fetch(`/api/story/${id}`, { headers: authHeaders() });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || '打开失败');
    storyState.current = data.story;
    storyState.currentId = data.story.id;
    inkosCanon = ''; // 打开已有项目时清除 InkOS 角色参考，避免干扰旧项目
    $('#story-current-title').textContent = data.story.title;
    renderShots();
    loadProjects();
  } catch (err) {
    showToast(err.message || '打开项目失败');
  }
}

async function deleteProject() {
  if (!storyState.currentId) {
    showToast('请先在右上角选择一个故事项目');
    return;
  }
  if (!confirm('确定删除该故事项目？分镜内容将不可恢复（已生成的图片视频保留在画廊历史中）')) return;
  try {
    const resp = await fetch(`/api/story/${storyState.currentId}`, { method: 'DELETE', headers: authHeaders() });
    if (!resp.ok) throw new Error('删除失败');
    storyState.currentId = null;
    storyState.current = null;
    $('#story-current-title').textContent = '';
    renderStoryAll();
    loadProjects();
    showToast('项目已删除');
  } catch (err) {
    showToast(err.message || '删除失败');
  }
}

/* ---------------- InkOS 书架对接 ---------------- */

const INKOS_STATUS_LABEL = {
  'ready-for-review': '待审校',
  approved: '已通过',
  'audit-failed': '审核未通过',
  draft: '草稿',
  revising: '修订中',
  writing: '写作中',
  planned: '已规划',
};

function setInkosHint(msg) {
  const hint = $('#inkos-hint');
  if (!msg) {
    hint.hidden = true;
    hint.textContent = '';
    return;
  }
  hint.textContent = msg;
  hint.hidden = false;
}

function fillSelect(select, items, placeholder) {
  select.innerHTML = '';
  if (placeholder) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholder;
    select.appendChild(opt);
  }
  items.forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  });
}

async function loadInkosBooks() {
  const bookSel = $('#inkos-book-select');
  const chapSel = $('#inkos-chapter-select');
  const pullBtn = $('#inkos-pull-btn');
  chapSel.disabled = true;
  pullBtn.disabled = true;
  try {
    const resp = await fetch('/api/inkos/books', { headers: authHeaders() });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    inkosBooks = Array.isArray(data.books) ? data.books : [];
    if (!inkosBooks.length) {
      fillSelect(bookSel, [], 'InkOS 还没有书目');
      fillSelect(chapSel, [], '先选书');
      setInkosHint('InkOS 已连接但没有书目；可以直接粘贴文本。');
      return;
    }
    fillSelect(
      bookSel,
      inkosBooks.map((b) => ({
        value: b.id,
        label: `${b.title}（${b.chaptersWritten}/${b.targetChapters || '?'} 章）`,
      }))
    );
    await loadInkosChapters(inkosBooks[0].id);
  } catch (err) {
    inkosBooks = [];
    fillSelect(bookSel, [], 'InkOS 未连接');
    fillSelect(chapSel, [], '先选书');
    setInkosHint(`InkOS 连接失败：${err.message}。仍可粘贴文本或导入文件。`);
  }
}

async function loadInkosChapters(bookId) {
  const chapSel = $('#inkos-chapter-select');
  const pullBtn = $('#inkos-pull-btn');
  if (!bookId) {
    fillSelect(chapSel, [], '先选书');
    chapSel.disabled = true;
    pullBtn.disabled = true;
    return;
  }
  fillSelect(chapSel, [], '章节加载中…');
  chapSel.disabled = true;
  pullBtn.disabled = true;
  try {
    const resp = await fetch(`/api/inkos/books/${encodeURIComponent(bookId)}`, { headers: authHeaders() });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    inkosChapters = Array.isArray(data.chapters) ? data.chapters : [];
    if (!inkosChapters.length) {
      fillSelect(chapSel, [], '这本书还没有章节');
      return;
    }
    fillSelect(
      chapSel,
      inkosChapters.map((c) => ({
        value: String(c.number),
        label: `第${c.number}章 ${c.title || ''}（${INKOS_STATUS_LABEL[c.status] || c.status} · ${c.wordCount} 字）`,
      }))
    );
    chapSel.disabled = false;
    pullBtn.disabled = false;
  } catch (err) {
    inkosChapters = [];
    fillSelect(chapSel, [], '章节加载失败');
    setInkosHint(`章节加载失败：${err.message}`);
  }
}

async function pullInkosChapter() {
  const bookSel = $('#inkos-book-select');
  const chapSel = $('#inkos-chapter-select');
  const pullBtn = $('#inkos-pull-btn');
  const bookId = bookSel.value;
  const num = chapSel.value;
  if (!bookId || !num || pullBtn.disabled) return;
  const book = inkosBooks.find((b) => b.id === bookId);
  const chap = inkosChapters.find((c) => String(c.number) === String(num));
  pullBtn.disabled = true;
  const old = pullBtn.textContent;
  pullBtn.textContent = '拉取中…';
  try {
    const [chapResp, charResp] = await Promise.all([
      fetch(`/api/inkos/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(num)}`, {
        headers: authHeaders(),
      }),
      fetch(`/api/inkos/books/${encodeURIComponent(bookId)}/characters`, { headers: authHeaders() }),
    ]);
    const chapData = await chapResp.json().catch(() => ({}));
    if (!chapResp.ok) throw new Error(chapData.error || `拉取正文失败（HTTP ${chapResp.status}）`);
    const charData = await charResp.json().catch(() => ({}));
    inkosCanon = typeof charData.content === 'string' ? charData.content : '';

    $('#story-text').value = chapData.content || '';
    if (!$('#story-title').value.trim() && book) {
      const label = chap ? `第${chap.number}章 ${chap.title}` : `第${num}章`;
      $('#story-title').value = `${book.title}·${label}`.slice(0, 60);
    }
    const chars = ($('#story-text').value.match(/\S/g) || []).length;
    setInkosHint(
      `已拉取第${num}章正文（约 ${chars} 字）` +
        (inkosCanon ? `，附带 InkOS 角色设定（${inkosCanon.length} 字），提取人物时将以此为准` : '') +
        '，点击「智能分镜」开始改编。'
    );
    hideStoryError();
  } catch (err) {
    setInkosHint(`拉取失败：${err.message}`);
  } finally {
    pullBtn.disabled = false;
    pullBtn.textContent = old;
  }
}

/* ---------------- 分镜分析 ---------------- */

async function analyzeStory() {
  if (!auth.user) {
    showStoryError('请先登录账户（文本模型配置保存在账户中）');
    return;
  }
  if (!llmConfigs.length) {
    showStoryError('请先添加一个文本模型配置（用于分镜拆解）');
    return;
  }
  const text = $('#story-text').value.trim();
  if (!text) {
    showStoryError('请先粘贴小说文本');
    return;
  }
  const title = $('#story-title').value.trim() || '未命名故事';
  const style = $('#story-style').value.trim() || storyState.style;

  const btn = $('#story-analyze-btn');
  btn.disabled = true;
  btn.textContent = '分镜分析中，约需 1-2 分钟…';
  hideStoryError();
  try {
    const resp = await fetch('/api/story/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text, style, shotCount: storyState.shotCount, llmConfigId: llmActiveId, canon: inkosCanon }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `请求失败（HTTP ${resp.status}）`);

    const create = await fetch('/api/story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        title,
        style: data.style,
        characters: data.characters,
        scenes: data.scenes,
        shots: data.shots,
        sourceText: text.slice(0, 100000),
      }),
    });
    const created = await create.json().catch(() => ({}));
    if (!create.ok) throw new Error(created.error || '项目保存失败');

    storyState.current = created.story;
    storyState.currentId = created.story.id;
    $('#story-current-title').textContent = created.story.title;
    renderStoryAll();
    switchStoryTab('characters');
    loadProjects();
    const usedLlm = data.usedLlm ? `（文本模型：${data.usedLlm}）` : '';
    showToast(
      `分镜完成${usedLlm}：${created.story.characters.length} 个角色、${created.story.scenes.length} 个场景、${created.story.shots.length} 个镜头。请先在①②生成设定图，再到③制作视频`
    );
  } catch (err) {
    showStoryError(err.message || '分镜分析失败');
  } finally {
    btn.disabled = false;
    btn.textContent = '智能分镜';
  }
}

function showStoryError(msg) {
  const box = $('#story-error-box');
  box.textContent = msg;
  box.hidden = false;
}

function hideStoryError() {
  $('#story-error-box').hidden = true;
}

/* ---------------- 分镜渲染 ---------------- */

/** 镜头归属场景匹配：优先同名，其次包含关系（兼容旧数据 scene 为自由文本） */
function storySceneOf(shot) {
  const story = storyState.current;
  const name = String((shot && shot.scene) || '').trim();
  if (!story || !name || !Array.isArray(story.scenes)) return null;
  return (
    story.scenes.find((s) => s.name === name) ||
    story.scenes.find((s) => name.includes(s.name) || (s.name && s.name.includes(name))) ||
    null
  );
}

/** 镜头出场角色（按 cast 名单匹配角色卡） */
function storyCastOf(shot) {
  const story = storyState.current;
  if (!story || !Array.isArray(story.characters)) return [];
  const cast = Array.isArray(shot.cast) ? shot.cast : [];
  return cast.map((n) => story.characters.find((c) => c.name === n)).filter(Boolean);
}

function shotHasView(o) {
  return !!(o && (o.imageFile || o.imageUrl));
}

function assetViewSrc(o) {
  return o.imageFile || `/api/image?url=${encodeURIComponent(o.imageUrl)}`;
}

function shotStatusLabel(shot) {
  if (shot.status === 'submitting') return '提交中…';
  if (shot.status === 'video_done') return '视频完成';
  if (shot.status === 'video_pending') return '视频生成中';
  if (shot.status === 'failed') return '生成失败';
  return '待生成';
}

function shotStatusClass(shot) {
  if (shot.status === 'submitting') return 'pending';
  if (shot.status === 'video_done') return 'done';
  if (shot.status === 'video_pending') return 'pending';
  if (shot.status === 'failed') return 'failed';
  return '';
}

function saveShotLater(index) {
  clearTimeout(shotSaveTimers[index]);
  shotSaveTimers[index] = setTimeout(() => saveShotNow(index), 800);
}

async function saveShotNow(index) {
  const story = storyState.current;
  if (!story) return;
  try {
    await fetch(`/api/story/${story.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ shots: story.shots }),
    });
  } catch {
    /* 保存失败不打断生成流程 */
  }
}

function buildShotCard(shot, i) {
  const card = document.createElement('div');
  card.className = 'shot-card';

  const busy = shot.status === 'submitting' || shot.status === 'video_pending';

  const media = document.createElement('div');
  media.className = 'shot-media';
  if (shot.videoFile || shot.videoUrl) {
    const vid = document.createElement('video');
    vid.controls = true;
    vid.preload = 'metadata';
    vid.playsInline = true;
    vid.src = shot.videoFile || `/api/image?url=${encodeURIComponent(shot.videoUrl)}`;
    vid.addEventListener('error', () => {
      if (shot.videoUrl && !vid.dataset.fallback) {
        vid.dataset.fallback = '1';
        vid.src = `/api/image?url=${encodeURIComponent(shot.videoUrl)}`;
      }
    });
    media.appendChild(vid);
  } else if (busy) {
    const pend = document.createElement('div');
    pend.className = 'shot-pending';
    const sp = document.createElement('span');
    sp.className = 'pending-spinner';
    const txt = document.createElement('span');
    txt.textContent = shot.status === 'submitting' ? '提交中…' : '视频生成中，约 2-5 分钟…';
    pend.appendChild(sp);
    pend.appendChild(txt);
    media.appendChild(pend);
  } else {
    const ph = document.createElement('div');
    ph.className = 'shot-placeholder';
    ph.textContent = '尚未生成视频';
    media.appendChild(ph);
  }
  if (shot.lastFrameFile) {
    const lf = document.createElement('div');
    lf.className = 'shot-lf';
    const lfImg = document.createElement('img');
    lfImg.loading = 'lazy';
    lfImg.alt = '末帧';
    lfImg.src = shot.lastFrameFile;
    lfImg.title = '该镜头视频的最后一帧，下一镜头衔接用';
    const tag = document.createElement('span');
    tag.textContent = '末帧';
    lf.appendChild(lfImg);
    lf.appendChild(tag);
    media.appendChild(lf);
  }
  card.appendChild(media);

  const body = document.createElement('div');
  body.className = 'shot-body';

  const head = document.createElement('div');
  head.className = 'shot-head';
  const no = document.createElement('span');
  no.className = 'shot-no';
  no.textContent = `镜头 ${i + 1}`;
  const scene = storySceneOf(shot);
  const castChars = storyCastOf(shot);
  const castText = castChars.length
    ? castChars.map((c) => c.name).join('、')
    : Array.isArray(shot.cast) && shot.cast.length
      ? shot.cast.join('、')
      : '';
  const tags = document.createElement('span');
  tags.className = 'shot-tags';
  tags.textContent = `${scene ? scene.name : shot.scene || '未指定场景'}${castText ? ` · ${castText}` : ''} · ${shot.duration}s`;
  const modeTag = document.createElement('span');
  modeTag.className = 'shot-mode';
  modeTag.textContent = shot.chained ? '尾帧衔接' : '参考图';
  modeTag.title = shot.chained
    ? '场景未变化，使用上一镜头视频尾帧作为首帧'
    : '使用角色三视图 + 场景图作为参考图生成';
  const status = document.createElement('span');
  status.className = 'shot-status ' + shotStatusClass(shot);
  status.textContent = shotStatusLabel(shot);
  head.appendChild(no);
  head.appendChild(tags);
  head.appendChild(modeTag);
  head.appendChild(status);
  body.appendChild(head);

  const vpLabel = document.createElement('label');
  vpLabel.textContent = '视频提示词（画面 + 运动）';
  body.appendChild(vpLabel);
  const vp = document.createElement('textarea');
  vp.rows = 3;
  vp.value = shot.videoPrompt || '';
  vp.addEventListener('change', () => {
    shot.videoPrompt = vp.value.trim();
    saveShotLater(i);
  });
  body.appendChild(vp);

  const actions = document.createElement('div');
  actions.className = 'shot-actions';

  const vidBtn = document.createElement('button');
  vidBtn.type = 'button';
  vidBtn.className = 'mini-btn' + (shot.status !== 'video_done' && !busy ? ' primary' : '');
  vidBtn.textContent = shot.status === 'video_done' ? '重新生成视频' : '生成视频';
  if (busy) vidBtn.disabled = true;
  vidBtn.addEventListener('click', () => generateShotVideo(shot, i, vidBtn));
  actions.appendChild(vidBtn);

  if (shot.videoFile || shot.videoUrl) {
    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'mini-btn';
    dl.textContent = '下载视频';
    dl.addEventListener('click', () => {
      const filename = sanitizeFilename(`story_${(storyState.current ? storyState.current.title : 'video')}_shot${i + 1}.mp4`);
      if (shot.videoFile) triggerDownload(shot.videoFile, filename);
      else
        triggerDownload(
          `/api/download?url=${encodeURIComponent(shot.videoUrl)}&filename=${encodeURIComponent(filename)}`,
          filename
        );
    });
    actions.appendChild(dl);
  }

  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

function renderShots() {
  const list = $('#shot-list');
  list.innerHTML = '';
  const story = storyState.current;
  const shots = story && Array.isArray(story.shots) ? story.shots : [];
  shots.forEach((shot, i) => list.appendChild(buildShotCard(shot, i)));
  $('#story-empty').hidden = shots.length > 0;
  updateStoryBadges();
}

/* ---------------- Tab 切换与角色 / 场景渲染 ---------------- */

function switchStoryTab(tab) {
  ['characters', 'scenes', 'shots'].forEach((t) => {
    const tabBtn = $(`#story-tab-${t}`);
    const pane = $(`#pane-${t}`);
    const active = t === tab;
    tabBtn.classList.toggle('active', active);
    tabBtn.setAttribute('aria-selected', String(active));
    pane.hidden = !active;
  });
}

function updateStoryBadges() {
  const story = storyState.current;
  const chars = story && Array.isArray(story.characters) ? story.characters : [];
  const scenes = story && Array.isArray(story.scenes) ? story.scenes : [];
  const shots = story && Array.isArray(story.shots) ? story.shots : [];
  const cDone = chars.filter(shotHasView).length;
  const sDone = scenes.filter(shotHasView).length;
  const vDone = shots.filter((s) => s.status === 'video_done').length;
  $('#tab-badge-characters').textContent = chars.length ? `${cDone}/${chars.length}` : '';
  $('#tab-badge-scenes').textContent = scenes.length ? `${sDone}/${scenes.length}` : '';
  $('#tab-badge-shots').textContent = shots.length ? `${vDone}/${shots.length}` : '';
}

function buildCharacterCard(c, ci) {
  const card = document.createElement('div');
  card.className = 'asset-card';
  if (shotHasView(c)) {
    const img = document.createElement('img');
    img.className = 'asset-img';
    img.loading = 'lazy';
    img.alt = `${c.name} 三视图`;
    img.src = assetViewSrc(c);
    card.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'asset-placeholder';
    ph.textContent = c.generating ? '三视图生成中…' : '尚未生成三视图';
    card.appendChild(ph);
  }

  const body = document.createElement('div');
  body.className = 'asset-body';

  const name = document.createElement('div');
  name.className = 'asset-name';
  name.textContent = c.name;
  body.appendChild(name);

  const desc = document.createElement('textarea');
  desc.className = 'asset-edit';
  desc.rows = 3;
  desc.value = c.appearance || '';
  desc.placeholder = '外貌设定（生成三视图的依据，可编辑）';
  desc.addEventListener('change', () => {
    c.appearance = desc.value.trim().slice(0, 300);
    saveStoryMeta();
  });
  body.appendChild(desc);

  const actions = document.createElement('div');
  actions.className = 'asset-actions';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mini-btn primary';
  btn.textContent = shotHasView(c) ? '重新生成三视图' : '生成三视图';
  if (c.generating || storyState.batchRunning) btn.disabled = true;
  btn.addEventListener('click', () => generateCharacterView(ci, btn));
  actions.appendChild(btn);
  body.appendChild(actions);

  card.appendChild(body);
  return card;
}

function buildSceneCard(s, si) {
  const card = document.createElement('div');
  card.className = 'asset-card';
  if (shotHasView(s)) {
    const img = document.createElement('img');
    img.className = 'asset-img';
    img.loading = 'lazy';
    img.alt = `${s.name} 场景图`;
    img.src = assetViewSrc(s);
    card.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'asset-placeholder';
    ph.textContent = s.generating ? '场景图生成中…' : '尚未生成场景图';
    card.appendChild(ph);
  }

  const body = document.createElement('div');
  body.className = 'asset-body';

  const name = document.createElement('div');
  name.className = 'asset-name';
  name.textContent = s.name;
  body.appendChild(name);

  const desc = document.createElement('textarea');
  desc.className = 'asset-edit';
  desc.rows = 3;
  desc.value = s.description || '';
  desc.placeholder = '场景设定（生成场景图的依据，可编辑）';
  desc.addEventListener('change', () => {
    s.description = desc.value.trim().slice(0, 200);
    saveStoryMeta();
  });
  body.appendChild(desc);

  const actions = document.createElement('div');
  actions.className = 'asset-actions';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mini-btn primary';
  btn.textContent = shotHasView(s) ? '重新生成场景图' : '生成场景图';
  if (s.generating || storyState.batchRunning) btn.disabled = true;
  btn.addEventListener('click', () => generateSceneImage(si, btn));
  actions.appendChild(btn);
  body.appendChild(actions);

  card.appendChild(body);
  return card;
}

function renderCharacters() {
  const story = storyState.current;
  const grid = $('#char-grid');
  grid.innerHTML = '';
  const list = story && Array.isArray(story.characters) ? story.characters : [];
  list.forEach((c, ci) => grid.appendChild(buildCharacterCard(c, ci)));
  $('#char-empty').hidden = list.length > 0;
}

function renderScenes() {
  const story = storyState.current;
  const grid = $('#scene-grid');
  grid.innerHTML = '';
  const list = story && Array.isArray(story.scenes) ? story.scenes : [];
  list.forEach((s, si) => grid.appendChild(buildSceneCard(s, si)));
  $('#scene-empty').hidden = list.length > 0;
}

function renderStoryAll() {
  renderCharacters();
  renderScenes();
  renderShots();
}

/* ---------------- 密钥选择（复用账户密钥库） ---------------- */

function renderStoryKeySelects() {
  const sensSelect = $('#story-sensenova-key-select');
  const agnesSelect = $('#story-agnes-key-select');
  const sensInput = $('#story-sensenova-key');
  const agnesInput = $('#story-agnes-key');
  if (!auth.user) {
    sensSelect.innerHTML = '';
    agnesSelect.innerHTML = '';
    return;
  }
  const fill = (select, provider) => {
    select.innerHTML = '';
    const list = auth.keys.filter((k) => k.provider === provider);
    if (!list.length) {
      const opt = document.createElement('option');
      opt.value = STORY_MANUAL;
      opt.textContent = '无保存密钥，请手动粘贴';
      select.appendChild(opt);
      select.value = STORY_MANUAL;
      return;
    }
    list.forEach((k) => {
      const opt = document.createElement('option');
      opt.value = k.key;
      opt.textContent = `${k.name}（${k.key.length > 12 ? k.key.slice(0, 6) + '••••' + k.key.slice(-4) : '••••••'}）`;
      select.appendChild(opt);
    });
    const manual = document.createElement('option');
    manual.value = STORY_MANUAL;
    manual.textContent = '手动输入';
    select.appendChild(manual);
  };
  fill(sensSelect, 'sensenova');
  fill(agnesSelect, 'agnes');

  const sync = (select, input) => {
    if (select.value === STORY_MANUAL) {
      input.hidden = false;
      return '';
    }
    input.hidden = true;
    return select.value;
  };
  storyState.sensKey = sync(sensSelect, sensInput);
  storyState.agnesKey = sync(agnesSelect, agnesInput);
}

function storyKey(provider) {
  const select = $(provider === 'sensenova' ? '#story-sensenova-key-select' : '#story-agnes-key-select');
  const input = $(provider === 'sensenova' ? '#story-sensenova-key' : '#story-agnes-key');
  if (select.value === STORY_MANUAL) return input.value.trim();
  return select.value;
}

/* ---------------- 设定图生成（角色三视图 / 场景图） ---------------- */

/** 只保存角色与场景元数据（不覆盖镜头） */
async function saveStoryMeta() {
  const story = storyState.current;
  if (!story) return;
  try {
    await fetch(`/api/story/${story.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ characters: story.characters || [], scenes: story.scenes || [] }),
    });
  } catch {
    /* 保存失败不打断生成流程 */
  }
}

async function generateCharacterView(ci, btn) {
  const story = storyState.current;
  const c = story && Array.isArray(story.characters) ? story.characters[ci] : null;
  if (!c || c.generating) return;
  const apiKey = storyKey('sensenova');
  if (!apiKey) {
    showToast('请先配置商汤图片 Key');
    return;
  }
  const old = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '生成中…';
  }
  c.generating = true;
  renderCharacters();
  try {
    const style = story.style || '电影感插画风格';
    const prompt = [
      `${style}`,
      `角色三视图设定图：同一角色的三个视角横向等距并排——正面全身、侧面全身、背面全身，自然站立姿势，全身完整可见，三个视角大小一致`,
      `角色「${c.name}」：${c.appearance}`,
      `版式与背景：纯浅灰色无缝背景，画面中只有这一个角色，无任何文字标注`,
      `光照与质感：柔和均匀的棚拍光，无强烈投影；线条清晰，布料纹理与发丝层次细节丰富`,
      `一致性约束（最高优先）：三个视角的五官、发型、服装、配饰完全一致`,
      `负面约束：不要多余角色，不要复杂背景，不要文字水印，不要改变角色特征`,
    ].join('。');
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'sensenova',
        apiKey,
        prompt,
        model: state.model.sensenova,
        size: STORY_SHOT_IMAGE_SIZE,
        n: 1,
        watermark: false,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `请求失败（HTTP ${resp.status}）`);
    const rec = (data.records || [])[0];
    if (!rec) throw new Error('未返回图片记录');
    c.imageId = rec.id;
    c.imageFile = rec.file || null;
    c.imageUrl = rec.url || null;
    await saveStoryMeta();
  } catch (err) {
    showToast(`「${c.name}」三视图生成失败：${err.message}`);
  } finally {
    c.generating = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = old;
    }
    renderCharacters();
  }
}

async function generateSceneImage(si, btn) {
  const story = storyState.current;
  const s = story && Array.isArray(story.scenes) ? story.scenes[si] : null;
  if (!s || s.generating) return;
  const apiKey = storyKey('sensenova');
  if (!apiKey) {
    showToast('请先配置商汤图片 Key');
    return;
  }
  const old = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '生成中…';
  }
  s.generating = true;
  renderScenes();
  try {
    const style = story.style || '电影感插画风格';
    const prompt = [
      `${style}`,
      `场景设定图：${s.description}`,
      `镜头语言：广角建立镜头，前景、中景、远景层次分明，空间纵深强`,
      `光照与氛围：光线方向明确，冷暖层次细腻，氛围沉浸`,
      `质感与细节：材质纹理具体（按场景对应石材/织物/金属/植被），微观细节点缀，主体清晰`,
      `负面约束：画面中不出现任何人物，不要文字水印，不要模糊`,
    ].join('。');
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'sensenova',
        apiKey,
        prompt,
        model: state.model.sensenova,
        size: STORY_SHOT_IMAGE_SIZE,
        n: 1,
        watermark: false,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `请求失败（HTTP ${resp.status}）`);
    const rec = (data.records || [])[0];
    if (!rec) throw new Error('未返回图片记录');
    s.imageId = rec.id;
    s.imageFile = rec.file || null;
    s.imageUrl = rec.url || null;
    await saveStoryMeta();
  } catch (err) {
    showToast(`场景「${s.name}」生成失败：${err.message}`);
  } finally {
    s.generating = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = old;
    }
    renderScenes();
  }
}

async function generateShotVideo(shot, i, btn) {
  const apiKey = storyKey('agnes');
  if (!apiKey) {
    showToast('请先配置 Agnes 视频 Key');
    return;
  }
  if (shot.status === 'submitting' || shot.status === 'video_pending') return;
  const story = storyState.current;
  const prev = i > 0 && story ? story.shots[i - 1] : null;
  const scene = storySceneOf(shot);
  const cast = storyCastOf(shot);
  const prevScene = prev ? storySceneOf(prev) : null;

  // 模式判定：场景未变化且上一镜头有尾帧 → 尾帧衔接；否则参考图模式（三视图 + 场景图）
  const chainOk =
    storyState.chain &&
    !!prev &&
    !!(prev.lastFrameFile || prev.lastFrameUrl) &&
    ((scene && prevScene && scene.name === prevScene.name) || (!scene && !prevScene));

  let mode;
  let prompt;
  const frames = {};
  const style = (story && story.style) || '';
  if (chainOk) {
    mode = 'keyframe';
    prompt = [style, shot.videoPrompt].filter(Boolean).join('，');
    frames.firstFrame = prev.lastFrameFile
      ? { kind: 'file', value: prev.lastFrameFile }
      : { kind: 'url', value: prev.lastFrameUrl };
  } else {
    const images = [];
    const refs = [];
    if (scene && shotHasView(scene)) {
      images.push(scene.imageFile ? { kind: 'file', value: scene.imageFile } : { kind: 'url', value: scene.imageUrl });
      refs.push(`场景环境以 <Picture ${images.length}> 为准`);
    }
    cast
      .filter(shotHasView)
      .slice(0, 3 - images.length)
      .forEach((c) => {
        images.push(c.imageFile ? { kind: 'file', value: c.imageFile } : { kind: 'url', value: c.imageUrl });
        refs.push(`角色「${c.name}」的外貌与服装严格以 <Picture ${images.length}> 为准`);
      });
    if (!images.length) {
      showToast(`镜头 ${i + 1} 缺少参考图：请先在「① 角色三视图」「② 场景图」生成设定图`);
      return;
    }
    mode = 'reference';
    prompt = [style, ...refs, shot.videoPrompt].filter(Boolean).join('。');
    frames.images = images;
    frames.aspectRatio = '16:9';
  }

  const old = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '提交中…';
  }
  shot.mode = mode;
  shot.chained = chainOk;
  shot.status = 'submitting';
  renderShots();
  try {
    const bodyObj = {
      apiKey,
      prompt,
      mode,
      seconds: String(shot.duration || 4),
      size: '720P',
      meta: story ? { storyId: story.id, shotIndex: i } : null,
      ...frames,
    };
    const resp = await fetch('/api/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `请求失败（HTTP ${resp.status}）`);
    const rec = data.record;
    if (!rec) throw new Error('接口未返回任务记录');
    shot.videoRecordId = rec.id;
    shot.taskId = rec.taskId || null;
    shot.status = rec.status === 'pending' ? 'video_pending' : rec.status === 'done' ? 'video_done' : rec.status;
    await saveShotNow(i);
    renderShots();
    if (shot.taskId) startShotPolling(shot, i);
  } catch (err) {
    showToast(`镜头 ${i + 1} 视频提交失败：${err.message}`);
    shot.status = 'failed';
    shot.error = err.message;
    await saveShotNow(i);
    renderShots();
    if (btn) {
      btn.disabled = false;
      btn.textContent = old;
    }
  }
}

/** 等待某个镜头的视频完成（轮询由 startShotPolling / 历史同步驱动） */
function waitForShotVideo(shot) {
  return new Promise((resolve, reject) => {
    const check = setInterval(() => {
      if (shot.status === 'video_done') {
        clearInterval(check);
        resolve();
      } else if (shot.status === 'failed') {
        clearInterval(check);
        reject(new Error(shot.error || '视频生成失败'));
      }
    }, 2000);
  });
}

/** 浏览器端解码视频，截取最后一帧并上传落盘，返回 /files/ 路径 */
function extractVideoLastFrame(src) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = src;
    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
    };
    const fail = (msg) => {
      cleanup();
      reject(new Error(msg));
    };
    video.addEventListener('error', () => fail('视频解码失败'));
    video.addEventListener('loadedmetadata', () => {
      const dur = video.duration;
      if (Number.isFinite(dur) && dur > 0.1) {
        video.currentTime = Math.max(dur - 0.08, 0);
      } else {
        video.currentTime = 1e6; // 时长未知时先跳远端触发元数据修正
        video.addEventListener(
          'durationchange',
          () => {
            if (Number.isFinite(video.duration) && video.duration > 0.1) {
              video.currentTime = Math.max(video.duration - 0.08, 0);
            }
          },
          { once: true }
        );
      }
    });
    video.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        if (!canvas.width || !canvas.height) throw new Error('无法读取视频画面');
        canvas.getContext('2d').drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        cleanup();
        resolve(dataUrl);
      } catch (err) {
        fail(err.message || '截帧失败');
      }
    });
  });
}

/** 确保镜头已有末帧：没有则自动提取并保存 */
async function ensureLastFrame(shot, i) {
  if (shot.lastFrameFile || shot.lastFrameUrl) return shot.lastFrameFile || shot.lastFrameUrl;
  if (!(shot.videoFile || shot.videoUrl)) return null;
  try {
    const src = shot.videoFile || `/api/image?url=${encodeURIComponent(shot.videoUrl)}`;
    const dataUrl = await extractVideoLastFrame(src);
    const resp = await fetch('/api/frames', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ dataUrl }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || '保存失败');
    shot.lastFrameFile = data.file;
    await saveShotNow(i);
    renderShots();
    return shot.lastFrameFile;
  } catch (err) {
    showToast(`镜头 ${i + 1} 末帧提取失败：${err.message}（下一镜头将改用分镜图作首帧）`);
    return null;
  }
}

function startShotPolling(shot, i) {
  if (!shot || !shot.taskId || shot.polling) return;
  shot.polling = true;
  let tries = 0;
  const maxTries = 150;
  const timer = setInterval(async () => {
    tries += 1;
    if (tries > maxTries) {
      clearInterval(timer);
      shot.status = 'failed';
      renderShots();
      return;
    }
    try {
      const resp = await fetch(`/api/video/status/${encodeURIComponent(shot.taskId)}`, {
        headers: { 'X-Api-Key': storyKey('agnes') },
      });
      const data = await resp.json().catch(() => ({}));
      if (data.status === 'done') {
        clearInterval(timer);
        const rec = data.record || {};
        if (rec.id) shot.videoRecordId = rec.id;
        shot.videoFile = rec.file || shot.videoFile || null;
        shot.videoUrl = rec.url || (data.videos && data.videos[0] ? data.videos[0].url : null) || shot.videoUrl;
        shot.status = 'video_done';
        await saveShotNow(i);
        renderShots();
        showToast(`镜头 ${i + 1} 视频已完成`);
        ensureLastFrame(shot, i); // 自动提取末帧，供下一镜头衔接
      } else if (data.status === 'failed') {
        clearInterval(timer);
        shot.status = 'failed';
        shot.error = data.error || '视频生成失败';
        await saveShotNow(i);
        renderShots();
      }
    } catch {
      /* 网络抖动继续轮询 */
    }
  }, 12000);
}

/* ---------------- 批量制作 ---------------- */

async function batchAssets() {
  if (storyState.batchRunning) return;
  const story = storyState.current;
  if (!story) {
    showToast('请先选择或创建故事项目');
    return;
  }
  if (!storyKey('sensenova')) {
    showToast('请先配置商汤图片 Key');
    return;
  }
  const jobs = [];
  (story.characters || []).forEach((c, ci) => {
    if (!shotHasView(c)) jobs.push({ type: 'character', c, ci });
  });
  (story.scenes || []).forEach((s, si) => {
    if (!shotHasView(s)) jobs.push({ type: 'scene', s, si });
  });
  if (!jobs.length) {
    showToast('角色三视图与场景图都已生成');
    return;
  }
  if (!confirm(`将按顺序生成 ${jobs.length} 张设定图（每张约 30-60 秒），继续？`)) return;

  storyState.batchRunning = true;
  let ok = 0;
  let fail = 0;
  for (const job of jobs) {
    if (!storyState.batchRunning) break;
    $('#story-progress').textContent = `设定图 ${ok + fail + 1}/${jobs.length}（${
      job.type === 'character' ? '角色·' + job.c.name : '场景·' + job.s.name
    }）…`;
    try {
      if (job.type === 'character') await generateCharacterView(job.ci, null);
      else await generateSceneImage(job.si, null);
      if (shotHasView(job.c) || shotHasView(job.s)) ok += 1;
      else fail += 1;
    } catch {
      fail += 1;
    }
  }
  storyState.batchRunning = false;
  $('#story-progress').textContent = '';
  showToast(`设定图批量生成完成：成功 ${ok} 张${fail ? `，失败 ${fail} 张（可单独重试）` : ''}`);
}

async function batchVideos() {
  if (storyState.batchRunning) return;
  const story = storyState.current;
  if (!story) {
    showToast('请先选择或创建故事项目');
    return;
  }
  if (!storyKey('agnes')) {
    showToast('请先配置 Agnes 视频 Key');
    return;
  }
  const targets = [];
  let skipped = 0;
  story.shots.forEach((shot, i) => {
    if (['video_pending', 'video_done', 'submitting'].includes(shot.status) || shot.taskId) return;
    const scene = storySceneOf(shot);
    const prev = i > 0 ? story.shots[i - 1] : null;
    const hasRefs = (scene && shotHasView(scene)) || storyCastOf(shot).some(shotHasView);
    const chainPossible = storyState.chain && !!prev;
    if (!hasRefs && !chainPossible) {
      skipped += 1;
      return;
    }
    targets.push({ shot, i });
  });
  if (!targets.length) {
    showToast(
      skipped
        ? `没有可生成的镜头（${skipped} 个镜头缺少场景图/三视图，请先完成①②步）`
        : '没有可生成的镜头'
    );
    return;
  }
  const tip = skipped ? `（另有 ${skipped} 个镜头缺少设定图，将跳过）` : '';
  if (
    !confirm(
      storyState.chain
        ? `将按镜头顺序制作 ${targets.length} 段视频：场景不变的镜头自动用上一段尾帧衔接，场景切换的镜头用角色三视图+场景图参考${tip}，继续？`
        : `将依次提交 ${targets.length} 段视频${tip}，继续？`
    )
  )
    return;

  storyState.batchRunning = true;
  let ok = 0;
  let fail = 0;
  for (let t = 0; t < targets.length; t++) {
    if (!storyState.batchRunning) break;
    const { shot, i } = targets[t];
    $('#story-progress').textContent = `提交 ${ok + fail + 1}/${targets.length}（镜头 ${i + 1}）…`;
    await generateShotVideo(shot, i, null);
    if (shot.status === 'failed') {
      fail += 1;
    } else if (storyState.chain) {
      // 衔接模式：等待本镜头完成并提取末帧，再提交下一镜头
      $('#story-progress').textContent = `镜头 ${i + 1} 生成中，完成后自动衔接下一镜头…`;
      try {
        await waitForShotVideo(shot);
        await ensureLastFrame(shot, i);
        ok += 1;
      } catch {
        fail += 1; // 失败镜头无末帧时，下一镜头自动回退为参考图模式
      }
    } else {
      ok += 1;
      if (t < targets.length - 1) {
        await new Promise((r) => setTimeout(r, 3000)); // 提交间隔，避免触发限流
      }
    }
  }
  storyState.batchRunning = false;
  $('#story-progress').textContent = '';
  showToast(
    `批量制作完成：成功 ${ok} 段${fail ? `，失败 ${fail} 段` : ''}${skipped ? `，跳过 ${skipped} 段` : ''}`
  );
}

/* ---------------- 历史同步：故事镜头任务状态 ---------------- */

document.addEventListener('history-updated', (e) => {
  const items = (e.detail && e.detail.items) || [];
  const story = storyState.current;
  if (!story) return;
  const changedIdx = new Set();
  items.forEach((r) => {
    if (r.type !== 'video' || !r.meta || r.meta.storyId !== story.id) return;
    const idx = r.meta.shotIndex;
    if (!(idx >= 0 && idx < story.shots.length)) return;
    const shot = story.shots[idx];
    if (shot.videoRecordId !== r.id) return;
    if (
      shot.status !== r.status ||
      (shot.taskId || null) !== (r.taskId || null) ||
      (shot.videoFile || null) !== (r.videoFile || null) ||
      (shot.videoUrl || null) !== (r.videoUrl || null)
    ) {
      shot.status = r.status === 'pending' ? 'video_pending' : r.status === 'done' ? 'video_done' : r.status;
      shot.taskId = r.taskId || null;
      shot.videoFile = r.videoFile || null;
      shot.videoUrl = r.videoUrl || null;
      shot.error = r.error || null;
      changedIdx.add(idx);
    }
    if (shot.status === 'video_pending' && shot.taskId) startShotPolling(shot, idx);
    if (shot.status === 'video_done') ensureLastFrame(shot, idx);
  });
  if (changedIdx.size) {
    changedIdx.forEach((idx) => saveShotNow(idx));
    renderShots();
  }
});

/* ---------------- 导入小说文件 ---------------- */

function handleStoryFile(file) {
  if (!file) return;
  if (file.size > 400 * 1024) {
    showToast('文件过大（超过 400KB），请截取后使用');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || '').trim();
    if (!text) {
      showToast('文件内容为空');
      return;
    }
    $('#story-text').value = text;
    if (!$('#story-title').value.trim()) {
      $('#story-title').value = file.name.replace(/\.(txt|md|markdown)$/i, '');
    }
    showToast(`已导入 ${file.name}（${text.length} 字）`);
  };
  reader.readAsText(file, 'utf-8');
}

/* ---------------- 初始化 ---------------- */

function renderStoryChips() {
  renderChips($('#style-chips'), STORY_STYLES.map((v) => ({ label: v.name, value: v.prompt })), storyState.style, (v) => {
    storyState.style = v;
    $('#story-style').value = v;
    renderStoryChips();
    storyPersistPrefs();
  });
  renderChips(
    $('#shotcount-chips'),
    STORY_SHOT_COUNTS.map((v) => ({ label: `${v} 镜头`, value: v })),
    storyState.shotCount,
    (v) => {
      storyState.shotCount = v;
      renderStoryChips();
      storyPersistPrefs();
    }
  );
}

function initStory() {
  storyLoadPrefs();
  $('#story-style').value = storyState.style;
  renderStoryChips();

  $('#llm-add-btn').addEventListener('click', () => openLlmForm(null));
  $('#llm-cancel-btn').addEventListener('click', closeLlmForm);
  $('#llm-save-btn').addEventListener('click', saveLlmConfig);
  $('#llm-test-btn').addEventListener('click', () => {
    if (llmEditingId) testLlmConfig(llmEditingId, $('#llm-test-btn'));
  });

  $('#story-project-select').addEventListener('change', (e) => openProject(e.target.value));
  $('#story-delete-btn').addEventListener('click', deleteProject);
  $('#story-analyze-btn').addEventListener('click', analyzeStory);
  $('#story-batch-image-btn').addEventListener('click', batchAssets);
  $('#story-batch-video-btn').addEventListener('click', batchVideos);
  $('#story-tab-characters').addEventListener('click', () => switchStoryTab('characters'));
  $('#story-tab-scenes').addEventListener('click', () => switchStoryTab('scenes'));
  $('#story-tab-shots').addEventListener('click', () => switchStoryTab('shots'));

  $('#story-import-btn').addEventListener('click', () => $('#story-file-input').click());
  $('#story-file-input').addEventListener('change', (e) => {
    handleStoryFile(e.target.files && e.target.files[0]);
    e.target.value = '';
  });

  $('#inkos-book-select').addEventListener('change', (e) => loadInkosChapters(e.target.value));
  $('#inkos-pull-btn').addEventListener('click', pullInkosChapter);

  $('#story-sensenova-key-select').addEventListener('change', renderStoryKeySelects);
  $('#story-agnes-key-select').addEventListener('change', renderStoryKeySelects);

  $('#story-chain').checked = storyState.chain;
  $('#story-chain').addEventListener('change', (e) => {
    storyState.chain = e.target.checked;
    storyPersistPrefs();
  });

  renderStoryKeySelects();
  loadInkosBooks();
  document.addEventListener('auth-changed', () => {
    refreshLlmConfigs();
    loadProjects();
    renderStoryKeySelects();
    loadInkosBooks();
  });
}

document.addEventListener('DOMContentLoaded', initStory);
