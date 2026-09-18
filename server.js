/**
 * AI 图片生成工作台 - 后端服务
 *
 * 职责：
 * 1. 转发生图请求到 商汤 SenseNova / Agnes 接口（API Key 由前端传入，服务端不落库到日志）
 * 2. 图片代理与下载（解决跨域与防盗链问题）
 * 3. 账户系统：注册 / 登录 / 会话管理；按账户保存多把 API Key（JSON 文件存储）
 *
 * 启动：node server.js （或 npm start）
 * 环境变量：PORT（默认 3000）、HOST（默认 0.0.0.0）、REQUEST_TIMEOUT_MS（默认 300000）
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 300000;
const PROXY_TIMEOUT_MS = 60000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 会话有效期 30 天

app.use(express.json({ limit: '16mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PROVIDERS = {
  sensenova: {
    label: '商汤 SenseNova',
    endpoint: 'https://token.sensenova.cn/v1/images/generations',
    defaultModel: 'sensenova-u1-fast',
    maxImages: 4,
  },
  agnes: {
    label: 'Agnes AI',
    endpoint: 'https://api.agnes-ai.cn/v1/images/generations',
    defaultModel: 'agnes-image-2.5-flash',
    maxImages: 4,
  },
};

const MODELS = {
  sensenova: ['sensenova-u1-fast', 'sensenova-u1.5-lite'],
  agnes: ['agnes-image-2.5-flash'],
};

const VIDEO_MODEL = 'agnes-video-2.5-flash';
const VIDEO_ENDPOINT = process.env.AGNES_VIDEO_ENDPOINT || 'https://api.agnes-ai.cn/v1/videos';
const VIDEO_TIMEOUT_MS = Number(process.env.VIDEO_TIMEOUT_MS) || 600000;

/* ================= 账户与密钥存储（JSON 文件） ================= */

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
let db = { users: [], sessions: {} };

function loadDb() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db = {
      users: Array.isArray(raw.users) ? raw.users : [],
      sessions: raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {},
    };
  } catch {
    db = { users: [], sessions: {} };
  }
  // 清理过期会话
  const now = Date.now();
  let changed = false;
  for (const token of Object.keys(db.sessions)) {
    const sess = db.sessions[token];
    if (!sess || sess.expiresAt < now) {
      delete db.sessions[token];
      changed = true;
    }
  }
  if (changed) persistDb();
}

function persistDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 32).toString('hex');
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { userId, expiresAt: Date.now() + SESSION_TTL_MS };
  persistDb();
  return token;
}

function getUserByToken(token) {
  if (!token) return null;
  const sess = db.sessions[token];
  if (!sess || sess.expiresAt < Date.now()) {
    if (sess) {
      delete db.sessions[token];
      persistDb();
    }
    return null;
  }
  return db.users.find((u) => u.id === sess.userId) || null;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const user = getUserByToken(token);
  if (!user) return res.status(401).json({ error: '未登录或登录已过期' });
  req.user = user;
  next();
}

loadDb();

/* ================= 认证接口 ================= */

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body || {};
  const name = typeof username === 'string' ? username.trim() : '';
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,24}$/.test(name)) {
    return res.status(400).json({ error: '用户名需为 2-24 位字母、数字、下划线或中文' });
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 64) {
    return res.status(400).json({ error: '密码长度需在 6-64 位之间' });
  }
  if (db.users.some((u) => u.username === name)) {
    return res.status(400).json({ error: '用户名已存在' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: crypto.randomUUID(),
    username: name,
    salt,
    passHash: hashPassword(password, salt),
    keys: [],
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  persistDb();
  const token = createSession(user.id);
  res.json({ token, username: user.username });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const name = typeof username === 'string' ? username.trim() : '';
  const user = db.users.find((u) => u.username === name);
  if (!user || typeof password !== 'string' || hashPassword(password, user.salt) !== user.passHash) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = createSession(user.id);
  res.json({ token, username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token && db.sessions[token]) {
    delete db.sessions[token];
    persistDb();
  }
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username });
});

/* ================= 密钥管理接口 ================= */

app.get('/api/keys', requireAuth, (req, res) => {
  res.json({ keys: Array.isArray(req.user.keys) ? req.user.keys : [] });
});

app.post('/api/keys', requireAuth, (req, res) => {
  const { provider, name, key } = req.body || {};
  const conf = PROVIDERS[provider];
  if (!conf) return res.status(400).json({ error: '不支持的服务商' });
  const value = typeof key === 'string' ? key.trim() : '';
  if (!value) return res.status(400).json({ error: 'Key 内容不能为空' });
  if (value.length > 512) return res.status(400).json({ error: 'Key 内容过长' });
  if (!Array.isArray(req.user.keys)) req.user.keys = [];
  const sameCount = req.user.keys.filter((k) => k.provider === provider).length;
  const label =
    typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : `${conf.label} ${sameCount + 1}`;
  const item = {
    id: crypto.randomUUID(),
    provider,
    name: label,
    key: value,
    createdAt: new Date().toISOString(),
  };
  req.user.keys.push(item);
  persistDb();
  res.json({ key: item });
});

app.delete('/api/keys/:id', requireAuth, (req, res) => {
  if (!Array.isArray(req.user.keys)) req.user.keys = [];
  const before = req.user.keys.length;
  req.user.keys = req.user.keys.filter((k) => k.id !== req.params.id);
  if (req.user.keys.length === before) return res.status(404).json({ error: '密钥不存在' });
  persistDb();
  res.json({ ok: true });
});

/* ================= 历史记录（刷新/重开后恢复） ================= */

const FILES_DIR = path.join(DATA_DIR, 'files');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
let history = [];

loadHistory();

function loadHistory() {
  try {
    let raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // 兼容带 BOM 的文件（外部工具写入）
    const parsed = JSON.parse(raw);
    history = Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    history = [];
  }
  // 清理卡在提交/渲染状态的记录（服务重启等原因导致后台任务中断）
  let dirty = false;
  history.forEach((r) => {
    if (r.type === 'video' && r.status === 'submitting' && Date.now() - (r.createdAt || 0) > 15 * 60 * 1000) {
      r.status = 'failed';
      r.error = '提交超时，请重试';
      dirty = true;
    }
    if (r.type === 'render' && r.status === 'rendering' && Date.now() - (r.createdAt || 0) > 60 * 60 * 1000) {
      r.status = 'failed';
      r.error = '合成超时中断，请重试';
      dirty = true;
    }
  });
  if (dirty) persistHistory();
}

function persistHistory() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  // 不再设数量上限、不再自动删除旧记录与文件——历史只增不减，
  // 由用户通过「清空」按钮（/api/history/clear）主动清理
  const tmp = `${HISTORY_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ items: history }, null, 2));
  fs.renameSync(tmp, HISTORY_FILE);
}

function addHistoryRecords(records) {
  if (records.length) {
    history.unshift(...records);
    persistHistory();
  }
}

function updateVideoRecord(id, patch) {
  const rec = history.find((r) => r.id === id);
  if (!rec) return null;
  Object.assign(rec, patch);
  persistHistory();
  return rec;
}

/* ================= ffmpeg（成片拼接/精细化） ================= */

const FFMPEG_NAME = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const FFPROBE_NAME = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
const FFMPEG_BIN = path.join(DATA_DIR, 'bin', FFMPEG_NAME);
const FFPROBE_BIN = path.join(DATA_DIR, 'bin', FFPROBE_NAME);

function ensureFfmpeg() {
  if (!fs.existsSync(FFMPEG_BIN)) return null;
  try {
    fs.chmodSync(FFMPEG_BIN, 0o755);
  } catch {
    /* 权限可能已正确 */
  }
  return FFMPEG_BIN;
}

function runFfmpeg(args, onProgress) {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG_BIN, args, { windowsHide: true });
    let errTail = '';
    child.stderr.on('data', (d) => {
      errTail = (errTail + String(d)).slice(-4000);
    });
    if (onProgress) {
      child.stdout.on('data', (d) => {
        String(d)
          .split('\n')
          .forEach((line) => {
            const m = /out_time_ms=(\d+)/.exec(line);
            if (m) onProgress(Number(m[1]) / 1e6);
          });
      });
    }
    child.on('error', (e) => resolve({ ok: false, errTail: String(e && e.message) }));
    child.on('close', (code) => resolve({ ok: code === 0, errTail }));
  });
}

function probeDuration(file) {
  return new Promise((resolve) => {
    if (!fs.existsSync(FFPROBE_BIN)) return resolve(null);
    const child = spawn(
      FFPROBE_BIN,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { windowsHide: true }
    );
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const v = Number.parseFloat(String(out).trim());
      resolve(Number.isFinite(v) ? v : null);
    });
  });
}

async function runRenderJob(rec, files) {
  const bin = ensureFfmpeg();
  if (!bin) throw new Error('ffmpeg 未部署：请将静态 ffmpeg 放入 data/bin/ffmpeg');
  const work = path.join(DATA_DIR, 'tmp', `render-${rec.id}`);
  fs.mkdirSync(work, { recursive: true });
  // 记录里存的是 URL 路径（/files/xxx），磁盘位置在 FILES_DIR 下
  const absFiles = files.map((f) => path.join(FILES_DIR, path.basename(f)));
  absFiles.forEach((p) => {
    if (!fs.existsSync(p)) throw new Error(`分段文件缺失：${path.basename(p)}`);
  });
  const listPath = path.join(work, 'list.txt');
  fs.writeFileSync(listPath, absFiles.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
  const intermediate = path.join(work, 'concat.mp4');

  updateVideoRecord(rec.id, { progress: 10, stage: '拼接中' });
  let r = await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', intermediate]);
  if (!r.ok) {
    appendVideoDebug(`render ${rec.id} concat copy failed: ${r.errTail.slice(-300)}`);
    updateVideoRecord(rec.id, { progress: 20, stage: '拼接中（重编码）' });
    r = await runFfmpeg([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '18',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      intermediate,
    ]);
    if (!r.ok) throw new Error(`拼接失败：${r.errTail.slice(-300)}`);
  }

  let outFile = intermediate;
  if (rec.hd) {
    updateVideoRecord(rec.id, { progress: 50, stage: '1080p 精细化中' });
    const total = (await probeDuration(intermediate)) || 0;
    const finalPath = path.join(work, 'final.mp4');
    const r2 = await runFfmpeg(
      [
        '-y',
        '-i',
        intermediate,
        '-vf',
        'scale=1920:1080:flags=lanczos,unsharp=5:5:0.6:5:5:0.0',
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        '18',
        '-c:a',
        'copy',
        '-progress',
        'pipe:1',
        '-nostats',
        finalPath,
      ],
      (seconds) => {
        if (total > 0) {
          updateVideoRecord(rec.id, { progress: 50 + Math.min(40, Math.round((seconds / total) * 40)) });
        }
      }
    );
    if (!r2.ok) throw new Error(`1080p 精细化失败：${r2.errTail.slice(-300)}`);
    outFile = finalPath;
  }

  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
  const name = `film-${Date.now()}.mp4`;
  fs.copyFileSync(outFile, path.join(FILES_DIR, name));
  fs.rmSync(work, { recursive: true, force: true });
  updateVideoRecord(rec.id, { status: 'done', progress: 100, stage: '完成', file: `/files/${name}` });
}

app.post('/api/render', (req, res) => {
  const { items, hd, title } = req.body || {};
  if (!Array.isArray(items) || items.length < 2) {
    return res.status(400).json({ error: '请至少选择 2 段视频' });
  }
  if (items.length > 40) return res.status(400).json({ error: '分段数量过多（最多 40 段）' });
  const files = [];
  for (const it of items) {
    const r = history.find((x) => x.id === it && x.type === 'video' && x.status === 'done');
    if (!r || !r.file) return res.status(400).json({ error: `分段 ${it} 不存在或尚未完成` });
    files.push(r.file);
  }
  const now = Date.now();
  const rec = {
    id: `render-${crypto.randomUUID()}`,
    type: 'render',
    title: (typeof title === 'string' && title.trim().slice(0, 60)) || `成片 ${new Date(now).toLocaleString('zh-CN', { hour12: false }).slice(5, 16)}`,
    segments: files.length,
    hd: hd !== false,
    status: 'rendering',
    stage: '准备中',
    progress: 0,
    file: null,
    url: null,
    createdAt: now,
  };
  addHistoryRecords([rec]);
  res.json({ record: rec });
  (async () => {
    try {
      await runRenderJob(rec, files);
    } catch (err) {
      updateVideoRecord(rec.id, { status: 'failed', error: (err && err.message) || '合成失败' });
    }
  })();
});

/* ================= 图片代理与下载 ================= */

function extFromContentType(ct, fallback) {
  const m = /(?:image|video)\/(png|jpeg|jpg|webp|gif|mp4|webm|quicktime)/i.exec(ct || '');
  if (!m) return fallback;
  if (m[1] === 'jpeg') return 'jpg';
  if (m[1] === 'quicktime') return 'mov';
  return m[1];
}

/** 从公网 URL 下载媒体文件保存到本地（NAS），返回 /files/ 路径 */
async function saveDataFromUrl(url, baseName, fallbackExt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 AIImageStudio/1.0' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
    const name = `${baseName}.${extFromContentType(resp.headers.get('content-type'), fallbackExt)}`;
    fs.writeFileSync(path.join(FILES_DIR, name), buf);
    return `/files/${name}`;
  } finally {
    clearTimeout(timer);
  }
}

function saveDataFromB64(b64, baseName) {
  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
  const name = `${baseName}.png`;
  fs.writeFileSync(path.join(FILES_DIR, name), Buffer.from(b64, 'base64'));
  return `/files/${name}`;
}

app.get('/api/history', (req, res) => {
  // 完整历史保留在 history.json；接口返回最近 500 条供界面展示
  res.json({ items: history.slice(0, 500) });
});

app.post('/api/history/clear', (req, res) => {
  const type = req.body && req.body.type;
  const kept = [];
  const removed = [];
  history.forEach((r) => {
    if ((type === 'image' || type === 'video') && r.type !== type) kept.push(r);
    else removed.push(r);
  });
  removed.forEach((r) => {
    if (r.file) {
      try {
        fs.unlinkSync(path.join(__dirname, r.file));
      } catch {
        /* 文件可能已不存在 */
      }
    }
  });
  history = kept;
  persistHistory();
  res.json({ ok: true });
});

app.use('/files', express.static(FILES_DIR));

/* ================= 生图接口 ================= */

function pickErrorMessage(json, text, status) {
  if (json) {
    if (typeof json.error === 'string') return json.error;
    if (json.error && typeof json.error.message === 'string') return json.error.message;
    if (typeof json.message === 'string') return json.message;
    if (typeof json.msg === 'string') return json.msg;
  }
  if (text) return text.slice(0, 300);
  return `HTTP ${status}`;
}

/** 兼容多种响应结构，提取图片（url 或 base64） */
function extractImages(payload) {
  const images = [];
  const pushItem = (item) => {
    if (!item) return;
    if (typeof item === 'string') {
      if (/^https?:\/\//.test(item)) images.push({ url: item });
      else if (item.length > 64) images.push({ b64: item });
      return;
    }
    if (typeof item !== 'object') return;
    if (typeof item.url === 'string') images.push({ url: item.url });
    else if (typeof item.b64_json === 'string') images.push({ b64: item.b64_json });
    else if (item.image_url) {
      const u = typeof item.image_url === 'string' ? item.image_url : item.image_url.url;
      if (typeof u === 'string') images.push({ url: u });
    } else if (typeof item.image === 'string') images.push({ b64: item.image });
  };
  if (Array.isArray(payload && payload.data)) payload.data.forEach(pushItem);
  if (Array.isArray(payload && payload.images)) payload.images.forEach(pushItem);
  if (Array.isArray(payload && payload.output)) payload.output.forEach(pushItem);
  if (Array.isArray(payload && payload.results)) payload.results.forEach(pushItem);
  if (!images.length) pushItem(payload);
  return images;
}

async function callImageApi(provider, apiKey, payload) {
  const conf = PROVIDERS[provider];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(conf.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await resp.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 非 JSON 响应，保留原文用于报错 */
    }
    if (!resp.ok) {
      const err = new Error(pickErrorMessage(json, text, resp.status));
      err.statusCode = resp.status;
      throw err;
    }
    const images = extractImages(json);
    if (!images.length) throw new Error('接口调用成功，但未返回任何图片数据');
    return images;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`请求超时（超过 ${Math.round(REQUEST_TIMEOUT_MS / 1000)} 秒），请稍后重试`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

app.post('/api/generate', async (req, res) => {
  const { provider, apiKey, prompt, size, ratio, n, watermark, model, referenceImages } = req.body || {};
  const conf = PROVIDERS[provider];
  if (!conf) {
    return res.status(400).json({ error: '不支持的服务商，请选择 商汤 SenseNova 或 Agnes' });
  }
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ error: '请先填写 API Key' });
  }
  const promptText = typeof prompt === 'string' ? prompt.trim() : '';
  if (!promptText) {
    return res.status(400).json({ error: '请先填写提示词' });
  }
  let count = Number.parseInt(n, 10);
  if (!Number.isFinite(count) || count < 1) count = 1;
  count = Math.min(count, conf.maxImages);
  const requestedModel = typeof model === 'string' ? model.trim() : '';
  const useModel = MODELS[provider].includes(requestedModel) ? requestedModel : conf.defaultModel;

  const tasks = [];
  let pixelSize = null;
  if (provider === 'sensenova') {
    const rawSize = String(size || '2752x1536').trim().replace(/[x×X]/gi, 'X');
    const match = rawSize.match(/^(\d{2,5})X(\d{2,5})$/);
    if (!match) {
      return res.status(400).json({ error: `图像尺寸格式不正确：${rawSize}，应为 宽x高（如 2752x1536）` });
    }
    pixelSize = `${match[1]}x${match[2]}`;
    for (let i = 0; i < count; i++) {
      tasks.push(
        callImageApi('sensenova', apiKey.trim(), {
          model: useModel,
          prompt: promptText,
          size: pixelSize,
          n: 1,
          watermark: watermark === true,
        })
      );
    }
  } else {
    // Agnes：支持图生图/多图合成（extra_body.image 数组，URL 或 data URL，最多 3 张）
    const refs = (Array.isArray(referenceImages) ? referenceImages : [])
      .map(normalizeFrame)
      .filter(Boolean)
      .slice(0, 3);
    for (let i = 0; i < count; i++) {
      const payload = {
        model: useModel,
        prompt: promptText,
        size: String(size || '2K').trim(),
        ratio: String(ratio || '16:9').trim(),
        extra_body: { response_format: 'url' },
      };
      if (refs.length) payload.extra_body.image = refs;
      tasks.push(callImageApi('agnes', apiKey.trim(), payload));
    }
  }

  try {
    const settled = await Promise.allSettled(tasks);
    const images = [];
    const errors = [];
    settled.forEach((r) => {
      if (r.status === 'fulfilled') images.push(...r.value);
      else errors.push((r.reason && r.reason.message) || String(r.reason));
    });

    if (!images.length) {
      return res.status(502).json({ error: errors[0] || '图片生成失败' });
    }

    // 落盘保存，刷新页面后可从历史恢复
    const now = Date.now();
    const records = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const rec = {
        id: `${now}-${i}`,
        type: 'image',
        provider,
        model: useModel,
        prompt: promptText,
        size: provider === 'sensenova' ? pixelSize : null,
        ratio: provider === 'agnes' ? String(ratio || '16:9').trim() : null,
        file: null,
        url: img.url || null,
        b64: null,
        createdAt: now,
      };
      const baseName = `img-${provider}-${now}-${i}`;
      try {
        if (img.url) rec.file = await saveDataFromUrl(img.url, baseName, 'png');
        else if (img.b64) rec.file = saveDataFromB64(img.b64, baseName);
      } catch (e) {
        // 保存失败时保留 url/b64，由前端兜底展示
        if (img.b64) rec.b64 = img.b64;
      }
      records.push(rec);
    }
    addHistoryRecords(records);

    res.json({
      provider,
      model: useModel,
      records,
      partialErrors: errors.length ? errors : undefined,
    });
  } catch (err) {
    console.error('[generate] unexpected error:', err);
    res.status(500).json({ error: (err && err.message) || '服务器内部错误' });
  }
});

/* ================= 视频生成接口 ================= */

/** 帧图归一化：支持公网 URL / 本地文件（转 data URL）/ base64（转 data URL 透传） */
function normalizeFrame(f) {
  if (!f) return null;
  if (typeof f === 'string') {
    if (/^https?:\/\//i.test(f)) return f;
    if (/^data:image\//i.test(f)) return f;
    return null;
  }
  if (typeof f === 'object') {
    if (f.kind === 'url' && typeof f.value === 'string' && /^https?:\/\//i.test(f.value)) return f.value;
    if (f.kind === 'file' && typeof f.value === 'string' && f.value.startsWith('/files/')) {
      // 本地已落盘的历史图片：读取后转为 data URL（外部 API 无法访问内网地址）
      const name = path.basename(f.value);
      const p = path.join(FILES_DIR, name);
      if (!fs.existsSync(p)) return null;
      const ext = path.extname(name).slice(1).toLowerCase();
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
    }
    if (f.kind === 'b64' && typeof f.value === 'string' && f.value.length > 64) {
      return `data:image/png;base64,${f.value}`;
    }
  }
  return null;
}

function extractVideos(payload) {
  const out = [];
  const seen = new Set();
  const push = (item) => {
    if (!item) return;
    const key = item.url || (item.b64 ? `b64:${item.b64.slice(0, 32)}` : '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };
  const pushItem = (item) => {
    if (!item) return;
    if (typeof item === 'string') {
      if (/^https?:\/\//.test(item)) push({ url: item });
      else if (item.length > 256) push({ b64: item });
      return;
    }
    if (typeof item !== 'object') return;
    const u =
      item.url ||
      item.video_url ||
      (item.video && typeof item.video === 'object' && item.video.url) ||
      (item.output && typeof item.output === 'object' && item.output.url);
    if (typeof u === 'string') push({ url: u });
    else if (typeof item.b64_json === 'string') push({ b64: item.b64_json });
    else if (typeof item.video === 'string' && item.video.length > 256) push({ b64: item.video });
  };
  pushItem(payload);
  ['data', 'videos', 'output', 'results'].forEach((k) => {
    if (Array.isArray(payload && payload[k])) payload[k].forEach(pushItem);
  });
  if (!out.length) {
    // 深度兜底：兼容未知嵌套结构
    deepCollectVideos(payload, out, 0);
  }
  return out;
}

function deepCollectVideos(node, out, depth) {
  if (!node || depth > 6) return;
  if (typeof node === 'string') {
    if (/^https?:\/\/\S+\.(mp4|webm|mov)(\?\S*)?$/i.test(node) || node.startsWith('data:video/')) {
      out.push({ url: node });
    } else if (
      node.length > 4096 &&
      !/^https?:/i.test(node) &&
      !/^data:/i.test(node) &&
      /^[A-Za-z0-9+/=_-]+$/.test(node)
    ) {
      out.push({ b64: node });
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => deepCollectVideos(n, out, depth + 1));
    return;
  }
  if (typeof node === 'object') {
    Object.entries(node).forEach(([k, v]) => {
      if (typeof v === 'string') {
        // 任意层级的字符串值：命中视频扩展名或 data:video 直接采用
        if (/^https?:\/\/\S+\.(mp4|webm|mov)(\?\S*)?$/i.test(v) || v.startsWith('data:video/')) {
          out.push({ url: v });
          return;
        }
        // 常见视频下载字段名
        if (/^(video_?url|download_?url|file_?url|mp4_?url)$/i.test(k) && /^https?:\/\//.test(v)) {
          out.push({ url: v });
          return;
        }
      }
      if (typeof v === 'object' || Array.isArray(v)) deepCollectVideos(v, out, depth + 1);
    });
  }
}

/** 在未知嵌套结构里找状态字段 */
function deepFindStatus(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 5) return null;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && /^(status|state|task_status)$/i.test(k)) return v;
  }
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') {
      const found = deepFindStatus(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function appendVideoDebug(line) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(path.join(DATA_DIR, 'video-debug.log'), `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* 日志失败不影响主流程 */
  }
}

function pickTaskId(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.task_id === 'string') return payload.task_id;
  if (typeof payload.taskId === 'string') return payload.taskId;
  if (typeof payload.job_id === 'string') return payload.job_id;
  if (typeof payload.id === 'string' && payload.id.length > 8) return payload.id;
  return null;
}

async function callVideoApi(apiKey, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VIDEO_TIMEOUT_MS);
  try {
    const resp = await fetch(VIDEO_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await resp.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 保留原文用于报错 */
    }
    if (!resp.ok) throw new Error(pickErrorMessage(json, text, resp.status));
    const videos = extractVideos(json);
    if (videos.length) return { videos };
    const status = json && typeof json.status === 'string' ? json.status.toLowerCase() : '';
    if (status === 'failed' || status === 'error') {
      throw new Error(pickErrorMessage(json, text, resp.status) || '视频生成失败');
    }
    const taskId = pickTaskId(json);
    if (taskId) return { pending: true, taskId, status: status || 'pending' };
    throw new Error(`接口未返回视频数据：${text.slice(0, 200)}`);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`视频生成超时（超过 ${Math.round(VIDEO_TIMEOUT_MS / 1000)} 秒）`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

app.post('/api/video', async (req, res) => {
  const { apiKey, prompt, mode, seconds, size, aspectRatio, firstFrame, lastFrame, images, meta } = req.body || {};
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ error: '请先填写 Agnes API Key' });
  }
  const promptText = typeof prompt === 'string' ? prompt.trim() : '';
  if (!promptText) return res.status(400).json({ error: '请先填写视频提示词' });
  if (mode !== 'keyframe' && mode !== 'reference') {
    return res.status(400).json({ error: '生成模式不正确，应为 keyframe 或 reference' });
  }
  const sec = String(seconds || '5').trim();
  if (!/^\d{1,2}$/.test(sec)) return res.status(400).json({ error: `视频时长不正确：${sec}` });
  const sz = String(size || '720P').trim();

  const payload = { model: VIDEO_MODEL, prompt: promptText, seconds: sec, mode, size: sz };
  if (mode === 'keyframe') {
    const ff = normalizeFrame(firstFrame);
    const lf = normalizeFrame(lastFrame);
    if (!ff && !lf) {
      return res.status(400).json({ error: '首尾帧模式至少需要设置一张首帧或尾帧图片' });
    }
    if (ff) payload.first_frame = ff;
    if (lf) payload.last_frame = lf;
  } else {
    const refs = (Array.isArray(images) ? images : []).map(normalizeFrame).filter(Boolean);
    if (!refs.length) return res.status(400).json({ error: '参考图模式至少需要一张参考图' });
    if (refs.length > 3) refs.length = 3;
    payload.aspect_ratio = String(aspectRatio || '16:9').trim();
    payload.images = refs;
  }

  // 立即创建“提交中”记录并响应；Agnes 调用放后台，完成后回写历史
  const ratioOut = mode === 'reference' ? String(aspectRatio || '16:9').trim() : null;
  const now = Date.now();
  const rec = {
    id: `${now}`,
    type: 'video',
    model: VIDEO_MODEL,
    mode,
    seconds: sec,
    size: sz,
    ratio: ratioOut,
    prompt: promptText,
    status: 'submitting',
    taskId: null,
    file: null,
    url: null,
    b64: null,
    meta:
      meta && typeof meta === 'object'
        ? { storyId: String(meta.storyId || '').slice(0, 80), shotIndex: Number.parseInt(meta.shotIndex, 10) || 0 }
        : null,
    createdAt: now,
  };
  addHistoryRecords([rec]);
  res.json({ record: rec });

  const submitKey = apiKey.trim();
  (async () => {
    try {
      const result = await callVideoApi(submitKey, payload);
      if (result.videos && result.videos.length) {
        const v = result.videos[0];
        const patch = { status: 'done', url: v.url || null };
        try {
          if (v.url) patch.file = await saveDataFromUrl(v.url, `vid-agnes-${Date.now()}`, 'mp4');
          else if (v.b64) patch.file = saveDataFromB64(v.b64, `vid-agnes-${Date.now()}`);
        } catch (e) {
          /* 下载失败保留原链展示 */
        }
        updateVideoRecord(rec.id, patch);
      } else if (result.taskId) {
        updateVideoRecord(rec.id, { status: 'pending', taskId: result.taskId });
      } else {
        updateVideoRecord(rec.id, { status: 'failed', error: '接口未返回任务信息' });
      }
    } catch (err) {
      updateVideoRecord(rec.id, { status: 'failed', error: (err && err.message) || '视频生成失败' });
    }
  })();
});

/** 视频任务状态轮询（接口为异步模式时使用） */
app.get('/api/video/status/:taskId', async (req, res) => {
  const header = req.headers.authorization || '';
  const apiKey = String(req.headers['x-api-key'] || header.replace(/^Bearer\s+/i, '') || '').trim();
  const { taskId } = req.params;
  if (!apiKey || !/^[\w.-]{4,128}$/.test(taskId)) {
    return res.status(400).json({ error: '参数不完整' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await fetch(`${VIDEO_ENDPOINT}/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    const text = await resp.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 保留原文 */
    }
    appendVideoDebug(`poll ${taskId} -> HTTP ${resp.status} body: ${text.slice(0, 600)}`);
    if (resp.status === 404 || resp.status === 400) {
      const rec = history.find((r) => r.type === 'video' && r.taskId === taskId);
      if (rec) {
        rec.status = 'failed';
        rec.error = '任务不存在或已过期';
        persistHistory();
      }
      return res.json({ status: 'failed', error: '任务不存在或已过期' });
    }
    if (!resp.ok) throw new Error(pickErrorMessage(json, text, resp.status));
    const videos = extractVideos(json);
    if (videos.length) {
      // 生成完成：落盘保存并更新历史记录
      const rec = history.find((r) => r.type === 'video' && r.taskId === taskId);
      if (rec) {
        rec.status = 'done';
        const v = videos[0];
        if (v.url) rec.url = v.url;
        const baseName = `vid-agnes-${Date.now()}`;
        try {
          if (v.url) rec.file = await saveDataFromUrl(v.url, baseName, 'mp4');
          else if (v.b64) rec.file = saveDataFromB64(v.b64, baseName);
        } catch (e) {
          /* 保存失败时保留原链展示 */
        }
        persistHistory();
        return res.json({ status: 'done', videos, record: rec });
      }
      return res.json({ status: 'done', videos });
    }
    let status = json && typeof json.status === 'string' ? json.status : deepFindStatus(json) || '';
    status = String(status).toLowerCase();
    if (status === 'failed' || status === 'error') {
      const rec = history.find((r) => r.type === 'video' && r.taskId === taskId);
      if (rec) {
        rec.status = 'failed';
        rec.error = pickErrorMessage(json, text, resp.status) || '视频生成失败';
        persistHistory();
      }
      return res.json({ status: 'failed', error: pickErrorMessage(json, text, resp.status) || '视频生成失败' });
    }
    res.json({ status: status || 'pending', taskId });
  } catch (err) {
    res.status(502).json({ error: `查询视频状态失败：${(err && err.message) || err}` });
  } finally {
    clearTimeout(timer);
  }
});

/* ================= 故事工坊：文本模型配置 / 分镜分析 / 项目管理 ================= */

const STORIES_DIR = path.join(DATA_DIR, 'stories');
const STORY_MAX_TEXT = 16000;

function chatEndpoint(baseUrl) {
  const b = String(baseUrl).trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(b) ? b : `${b}/chat/completions`;
}

async function callChatLlm(cfg, messages, opts = {}) {
  const timeout = opts.timeout || 300000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(chatEndpoint(cfg.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: opts.temperature != null ? opts.temperature : 0.7,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await resp.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 保留原文报错 */
    }
    if (!resp.ok) throw new Error(pickErrorMessage(json, text, resp.status));
    const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('文本模型未返回内容');
    return content;
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error(`文本模型请求超时（超过 ${Math.round(timeout / 1000)} 秒）`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 宽松提取 JSON（容忍 markdown 代码块与前后缀文字） */
function parseJsonLoose(text) {
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('文本模型返回的内容不是有效 JSON');
  return JSON.parse(t.slice(start, end + 1));
}

const STORY_CHAR_SYSTEM = `你是一位专业的小说改编顾问。分析用户给出的小说文本，提取用于视觉化改编的信息。
严格输出 JSON，格式：{"characters":[{"name":"角色名","appearance":"外貌设定"}],"scenes":[{"name":"场景名","description":"场景设定"}]}
要求：
1. characters 最多 5 个主要角色；appearance 为 60-100 字的详细外貌设定，将用于生成角色三视图，必须具体可画：
   - 五官拆解到具体特征（眼型、眉形、鼻唇、脸型），禁止使用"美丽/帅气/清秀"等抽象词
   - 发型发色明确；服装写明材质与款式（如"洗旧的棉质衬衫"而非"随便的衣服"）
   - 体型、年龄段、标志性配饰一件不落；不要写性格
2. scenes 最多 8 个故事主要发生场景；description 为 80-140 字的场景环境设定，将用于生成场景设定图：
   - 空间布局与建筑陈设特征、材质（石材/织物/金属等）、时间与光线方向、季节天气
   - 要有生活痕迹与微观细节（如"桌上摊开的未寄出的信"），不要空泛罗列
3. 只输出 JSON，不要任何其他文字、解释或代码块标记`;

function buildStoryboardSystem(style, characters, scenes, count) {
  return `你是一位专业影视分镜师。将小说改编为 ${count} 个连续镜头。每个镜头将用「参考图生视频」或「首尾帧衔接」方式直接生成视频，没有逐镜头文生图环节。
全局视觉风格（会自动拼在提示词前，无需重复）：${style}
角色外貌卡（cast 中的角色名必须从这里选）：
${JSON.stringify(characters)}
场景卡（scene 字段必须从下面的场景名中选）：
${JSON.stringify(scenes)}
输出要求：
1. cast：该镜头出场角色名的数组；空镜/环境镜头可为空数组
2. scene：该镜头所属场景名，必须与场景卡中的场景名完全一致
3. videoPrompt：40-80 字的完整画面描述 = 景别与机位（可用低角度仰拍/俯拍/过肩镜头/荷兰角增强戏剧性）+ 出场角色正在发生的动作（要有动作动词，神态具体，关键外貌特征要提及）+ 环境要点 + 镜头运动（推进/拉远/平移/跟随/环绕）；这是生成视频的唯一画面描述，必须完整自洽
4. duration 只能是 4 或 5
5. 镜头按叙事顺序覆盖完整故事弧（开端-发展-高潮-收尾）；同一场景的连续镜头尽量相邻排列（便于尾帧衔接）
严格输出 JSON：{"shots":[{"index":1,"scene":"场景名","cast":["角色名"],"duration":4,"videoPrompt":"..."}]}
只输出 JSON，不要任何其他文字。`;
}

function validateCard(data) {
  const characters = Array.isArray(data && data.characters)
    ? data.characters
        .filter((c) => c && c.name && c.appearance)
        .slice(0, 5)
        .map((c) => ({ name: String(c.name).slice(0, 20), appearance: String(c.appearance).slice(0, 300) }))
    : [];
  const scenes = Array.isArray(data && data.scenes)
    ? data.scenes
        .slice(0, 8)
        .map((s) => ({ name: String((s && s.name) || '').slice(0, 30), description: String((s && s.description) || '').slice(0, 200) }))
    : [];
  return { characters, scenes };
}

function validateShots(data, count) {
  const arr = Array.isArray(data && data.shots) ? data.shots : [];
  if (!arr.length) throw new Error('文本模型未返回任何镜头');
  return arr.slice(0, count).map((s, i) => {
    if (!s || typeof s.videoPrompt !== 'string' || !s.videoPrompt.trim()) {
      throw new Error(`第 ${i + 1} 个镜头缺少视频提示词`);
    }
    const dur = Number.parseInt(s.duration, 10) === 5 ? 5 : 4;
    const cast = Array.isArray(s.cast)
      ? s.cast
          .map((n) => String(n || '').trim().slice(0, 20))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    return {
      index: i + 1,
      scene: String(s.scene || '').slice(0, 30),
      cast,
      duration: dur,
      videoPrompt: s.videoPrompt.trim().slice(0, 500),
      imagePrompt: typeof s.imagePrompt === 'string' ? s.imagePrompt.trim().slice(0, 2000) : '',
    };
  });
}

app.get('/api/llm-configs', requireAuth, (req, res) => {
  res.json({ configs: Array.isArray(req.user.llmConfigs) ? req.user.llmConfigs : [], activeId: req.user.activeLlmId || null });
});

app.post('/api/llm-configs', requireAuth, (req, res) => {
  const { name, baseUrl, model, key } = req.body || {};
  const b = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  const m = typeof model === 'string' ? model.trim() : '';
  const k = typeof key === 'string' ? key.trim() : '';
  if (!b || !/^https?:\/\//i.test(b)) return res.status(400).json({ error: '连接地址需为 http(s) 开头' });
  if (!m) return res.status(400).json({ error: '请填写模型名称' });
  if (!k) return res.status(400).json({ error: '请填写 API Key' });
  if (b.length > 300 || m.length > 120 || k.length > 300) return res.status(400).json({ error: '配置内容过长' });
  if (!Array.isArray(req.user.llmConfigs)) req.user.llmConfigs = [];
  const item = {
    id: crypto.randomUUID(),
    name: (typeof name === 'string' && name.trim().slice(0, 40)) || `${m.slice(0, 20)} 配置`,
    baseUrl: b,
    model: m,
    key: k,
    createdAt: new Date().toISOString(),
  };
  req.user.llmConfigs.push(item);
  if (!req.user.activeLlmId) req.user.activeLlmId = item.id;
  persistDb();
  res.json({ config: item });
});

app.put('/api/llm-configs/:id', requireAuth, (req, res) => {
  const cfg = (req.user.llmConfigs || []).find((c) => c.id === req.params.id);
  if (!cfg) return res.status(404).json({ error: '配置不存在' });
  const { name, baseUrl, model, key } = req.body || {};
  if (typeof name === 'string' && name.trim()) cfg.name = name.trim().slice(0, 40);
  if (typeof baseUrl === 'string' && /^https?:\/\//i.test(baseUrl.trim())) cfg.baseUrl = baseUrl.trim();
  if (typeof model === 'string' && model.trim()) cfg.model = model.trim();
  if (typeof key === 'string' && key.trim()) cfg.key = key.trim();
  persistDb();
  res.json({ config: cfg });
});

app.delete('/api/llm-configs/:id', requireAuth, (req, res) => {
  const before = (req.user.llmConfigs || []).length;
  req.user.llmConfigs = (req.user.llmConfigs || []).filter((c) => c.id !== req.params.id);
  if (req.user.llmConfigs.length === before) return res.status(404).json({ error: '配置不存在' });
  if (req.user.activeLlmId === req.params.id) {
    req.user.activeLlmId = req.user.llmConfigs.length ? req.user.llmConfigs[0].id : null;
  }
  persistDb();
  res.json({ ok: true });
});

app.post('/api/llm-configs/:id/activate', requireAuth, (req, res) => {
  const cfg = (req.user.llmConfigs || []).find((c) => c.id === req.params.id);
  if (!cfg) return res.status(404).json({ error: '配置不存在' });
  req.user.activeLlmId = cfg.id;
  persistDb();
  res.json({ ok: true, activeId: cfg.id });
});

app.post('/api/llm-configs/:id/test', requireAuth, async (req, res) => {
  const cfg = (req.user.llmConfigs || []).find((c) => c.id === req.params.id);
  if (!cfg) return res.status(404).json({ error: '配置不存在' });
  try {
    const reply = await callChatLlm(cfg, [{ role: 'user', content: '请只回复两个字：正常' }], { timeout: 30000, temperature: 0 });
    res.json({ ok: true, reply: reply.trim().slice(0, 50) });
  } catch (err) {
    res.status(502).json({ ok: false, error: (err && err.message) || '连接失败' });
  }
});

/* ================= InkOS 对接代理 ================= */

const INKOS_BASE = String(process.env.INKOS_BASE || 'http://127.0.0.1:4567').replace(/\/+$/, '');
const INKOS_ID_RE = /^[\w\u4e00-\u9fa5\-·]{1,120}$/;

async function inkosFetch(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const resp = await fetch(`${INKOS_BASE}/api/v1${path}`, { signal: controller.signal });
    const raw = await resp.text();
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {
      /* 保留原文用于报错 */
    }
    if (!resp.ok) throw new Error(pickErrorMessage(json, raw, resp.status));
    return json;
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('InkOS 服务响应超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 书目列表 */
app.get('/api/inkos/books', requireAuth, async (req, res) => {
  try {
    const data = await inkosFetch('/books');
    const books = (Array.isArray(data && data.books) ? data.books : []).map((b) => ({
      id: String(b.id),
      title: String(b.title || b.id),
      genre: String(b.genre || ''),
      status: String(b.status || ''),
      chaptersWritten: Number(b.chaptersWritten) || 0,
      targetChapters: Number(b.targetChapters) || 0,
    }));
    res.json({ books });
  } catch (err) {
    res.status(502).json({ error: `InkOS 连接失败：${(err && err.message) || err}` });
  }
});

/** 书目详情（含章节列表元信息） */
app.get('/api/inkos/books/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!INKOS_ID_RE.test(id)) return res.status(400).json({ error: '无效的书目 ID' });
  try {
    const data = await inkosFetch(`/books/${encodeURIComponent(id)}`);
    const chapters = (Array.isArray(data && data.chapters) ? data.chapters : []).map((c) => ({
      number: Number(c.number) || 0,
      title: String(c.title || ''),
      status: String(c.status || ''),
      wordCount: Number(c.wordCount) || 0,
    }));
    const book = data && data.book ? { id: String(data.book.id), title: String(data.book.title || data.book.id) } : null;
    res.json({ book, chapters });
  } catch (err) {
    res.status(502).json({ error: `InkOS 连接失败：${(err && err.message) || err}` });
  }
});

/** 章节正文 */
app.get('/api/inkos/books/:id/chapters/:n', requireAuth, async (req, res) => {
  const { id, n } = req.params;
  if (!INKOS_ID_RE.test(id)) return res.status(400).json({ error: '无效的书目 ID' });
  if (!/^\d{1,4}$/.test(n)) return res.status(400).json({ error: '无效的章节号' });
  try {
    const data = await inkosFetch(`/books/${encodeURIComponent(id)}/chapters/${n}`);
    const content = data && typeof data.content === 'string' ? data.content : '';
    if (!content.trim()) return res.status(404).json({ error: '章节内容为空' });
    res.json({
      number: Number(n),
      title: String((data && data.filename) || '').replace(/\.md$/i, '').replace(/^\d+_/, ''),
      content: content.slice(0, 200000),
    });
  } catch (err) {
    res.status(502).json({ error: `拉取章节失败：${(err && err.message) || err}` });
  }
});

/** InkOS 角色矩阵（新书可能尚未生成，失败不致命） */
app.get('/api/inkos/books/:id/characters', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!INKOS_ID_RE.test(id)) return res.status(400).json({ error: '无效的书目 ID' });
  try {
    const data = await inkosFetch(`/books/${encodeURIComponent(id)}/truth/character_matrix.md`);
    const content = data && typeof data.content === 'string' ? data.content : '';
    res.json({ content: content.slice(0, 20000) });
  } catch {
    res.json({ content: '' });
  }
});

/** 组装文本模型候选列表：优先指定/激活的配置，其余配置按轮询次序作为故障转移备份 */
let llmRotateCounter = 0;
function pickLlmCandidates(user, requestedId) {
  const all = (Array.isArray(user.llmConfigs) ? user.llmConfigs : []).filter(
    (c) => c && c.baseUrl && c.model && c.key
  );
  if (!all.length) return [];
  const primary = all.find((c) => c.id === requestedId) || all.find((c) => c.id === user.activeLlmId) || null;
  const rest = all.filter((c) => c !== primary);
  llmRotateCounter += 1;
  const k = rest.length ? llmRotateCounter % rest.length : 0;
  const rotatedRest = rest.slice(k).concat(rest.slice(0, k));
  return primary ? [primary, ...rotatedRest] : rotatedRest;
}

/** 单阶段 LLM 调用：同一配置重试一次，仍失败则自动切换下一个配置 */
async function runLlmStage(candidates, buildRequest, validateResult, stageLabel) {
  let lastErr = null;
  for (const cfg of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { messages, opts } = buildRequest(cfg);
        const raw = await callChatLlm(cfg, messages, opts);
        return { result: validateResult(raw), cfg };
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw new Error(
    `${stageLabel}失败：${(lastErr && lastErr.message) || '所有文本模型配置均不可用'}（已尝试 ${candidates.length} 个配置）`
  );
}

app.post('/api/story/analyze', requireAuth, async (req, res) => {
  const { text, style, shotCount, llmConfigId, canon } = req.body || {};
  const candidates = pickLlmCandidates(req.user, llmConfigId);
  if (!candidates.length) return res.status(400).json({ error: '请先添加并选择一个文本模型配置' });
  const storyText = typeof text === 'string' ? text.trim() : '';
  if (!storyText) return res.status(400).json({ error: '请先粘贴小说文本' });
  const canonText = typeof canon === 'string' ? canon.trim().slice(0, 6000) : '';
  if (storyText.length > STORY_MAX_TEXT) {
    return res.status(400).json({ error: `文本过长（${storyText.length} 字），请截取 ${STORY_MAX_TEXT} 字以内，或分多次改编` });
  }
  const styleText = (typeof style === 'string' && style.trim().slice(0, 80)) || '电影感插画风格，光线细腻';
  let count = Number.parseInt(shotCount, 10);
  if (!Number.isFinite(count)) count = 12;
  count = Math.min(Math.max(count, 4), 24);

  try {
    const cardStage = await runLlmStage(
      candidates,
      () => ({
        messages: [
          { role: 'system', content: STORY_CHAR_SYSTEM },
          {
            role: 'user',
            content: canonText
              ? `小说文本：\n${storyText}\n\n角色设定参考（InkOS 角色矩阵，提取人物时以此为准）：\n${canonText}`
              : `小说文本：\n${storyText}`,
          },
        ],
        opts: { temperature: 0.5 },
      }),
      (raw) => {
        const card = validateCard(parseJsonLoose(raw));
        if (!card.characters.length) throw new Error('未能从文本中提取到角色信息');
        return card;
      },
      '角色提取'
    );
    const card = cardStage.result;

    const shotsStage = await runLlmStage(
      candidates,
      () => ({
        messages: [
          { role: 'system', content: buildStoryboardSystem(styleText, card.characters, card.scenes, count) },
          { role: 'user', content: `小说文本：\n${storyText}` },
        ],
        opts: { temperature: 0.7 },
      }),
      (raw) => validateShots(parseJsonLoose(raw), count),
      '分镜生成'
    );

    res.json({
      characters: card.characters,
      scenes: card.scenes,
      shots: shotsStage.result,
      style: styleText,
      usedLlm: cardStage.cfg.name || cardStage.cfg.model,
    });
  } catch (err) {
    res.status(502).json({ error: (err && err.message) || '分镜分析失败' });
  }
});

function normalizeStoryCharacters(arr) {
  return (Array.isArray(arr) ? arr : [])
    .slice(0, 5)
    .map((c) => {
      const name = String((c && c.name) || '').trim().slice(0, 20);
      if (!name) return null;
      const hasImg = typeof (c && c.imageFile) === 'string' && c.imageFile.startsWith('/files/');
      return {
        name,
        appearance: String((c && c.appearance) || '').slice(0, 300),
        imageFile: hasImg ? c.imageFile : null,
        imageUrl: c && typeof c.imageUrl === 'string' && /^https?:\/\//.test(c.imageUrl) ? c.imageUrl : null,
      };
    })
    .filter(Boolean);
}

function normalizeStoryScenes(arr) {
  return (Array.isArray(arr) ? arr : [])
    .slice(0, 8)
    .map((s) => {
      const name = String((s && s.name) || '').trim().slice(0, 30);
      if (!name) return null;
      const hasImg = typeof (s && s.imageFile) === 'string' && s.imageFile.startsWith('/files/');
      return {
        name,
        description: String((s && s.description) || '').slice(0, 200),
        imageFile: hasImg ? s.imageFile : null,
        imageUrl: s && typeof s.imageUrl === 'string' && /^https?:\/\//.test(s.imageUrl) ? s.imageUrl : null,
      };
    })
    .filter(Boolean);
}

function normalizeStoryShots(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, 40).map((s, i) => {
    const src = s || {};
    const hasImage = typeof src.imageFile === 'string' && src.imageFile.startsWith('/files/');
    return {
      index: i + 1,
      scene: String(src.scene || '').slice(0, 30),
      cast: Array.isArray(src.cast)
        ? src.cast
            .map((n) => String(n || '').slice(0, 20))
            .filter(Boolean)
            .slice(0, 3)
        : [],
      shotSize: String(src.shotSize || '中景').slice(0, 10),
      cameraMove: String(src.cameraMove || '固定镜头').slice(0, 12),
      duration: Number.parseInt(src.duration, 10) === 5 ? 5 : 4,
      imagePrompt: String(src.imagePrompt || '').slice(0, 2000),
      videoPrompt: String(src.videoPrompt || '').slice(0, 400),
      imageId: String(src.imageId || '').slice(0, 80) || null,
      imageFile: hasImage ? src.imageFile : null,
      imageUrl: typeof src.imageUrl === 'string' && /^https?:\/\//.test(src.imageUrl) ? src.imageUrl : null,
      stillFile:
        typeof src.stillFile === 'string' && src.stillFile.startsWith('/files/') ? src.stillFile : null,
      stillUrl: typeof src.stillUrl === 'string' && /^https?:\/\//.test(src.stillUrl) ? src.stillUrl : null,
      videoId: String(src.videoId || '').slice(0, 80) || null,
      videoFile: typeof src.videoFile === 'string' && src.videoFile.startsWith('/files/') ? src.videoFile : null,
      videoUrl: typeof src.videoUrl === 'string' && /^https?:\/\//.test(src.videoUrl) ? src.videoUrl : null,
      taskId: String(src.taskId || '').slice(0, 80) || null,
      status: ['image_done', 'video_pending', 'video_done', 'failed'].includes(src.status)
        ? src.status
        : hasImage || src.imageUrl
          ? 'image_done'
          : 'none',
    };
  });
}

function loadStoryFile(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(STORIES_DIR, `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
}

function saveStoryFile(story) {
  if (!fs.existsSync(STORIES_DIR)) fs.mkdirSync(STORIES_DIR, { recursive: true });
  const tmp = path.join(STORIES_DIR, `.${story.id}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(story, null, 2));
  fs.renameSync(tmp, path.join(STORIES_DIR, `${story.id}.json`));
}

const STORY_ID_RE = /^story-[0-9a-f-]{36}$/;

app.get('/api/story/list', requireAuth, (req, res) => {
  const items = [];
  try {
    fs.readdirSync(STORIES_DIR).forEach((f) => {
      if (!f.endsWith('.json')) return;
      const s = loadStoryFile(f.replace(/\.json$/, ''));
      if (s && s.userId === req.user.username) {
        items.push({
          id: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
          shots: (s.shots || []).length,
          imageDone: (s.shots || []).filter((x) => x.imageFile || x.imageUrl).length,
          videoDone: (s.shots || []).filter((x) => x.videoFile || x.videoUrl).length,
        });
      }
    });
  } catch {
    /* 目录不存在时返回空 */
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  res.json({ items });
});

app.get('/api/story/:id', requireAuth, (req, res) => {
  if (!STORY_ID_RE.test(req.params.id)) return res.status(400).json({ error: '无效的项目 ID' });
  const story = loadStoryFile(req.params.id);
  if (!story || story.userId !== req.user.username) return res.status(404).json({ error: '项目不存在' });
  res.json({ story });
});

app.post('/api/story', requireAuth, (req, res) => {
  const { title, style, characters, scenes, shots, sourceText } = req.body || {};
  if (!Array.isArray(shots) || !shots.length) return res.status(400).json({ error: '分镜数据为空' });
  const now = Date.now();
  const story = {
    id: `story-${crypto.randomUUID()}`,
    userId: req.user.username,
    title: (typeof title === 'string' && title.trim().slice(0, 60)) || '未命名故事',
    style: (typeof style === 'string' && style.trim().slice(0, 80)) || '',
    aspect: '16:9',
    characters: normalizeStoryCharacters(characters),
    scenes: normalizeStoryScenes(scenes),
    shots: normalizeStoryShots(shots),
    sourceText: typeof sourceText === 'string' ? sourceText.slice(0, 200000) : '',
    createdAt: now,
    updatedAt: now,
  };
  saveStoryFile(story);
  res.json({ story });
});

app.put('/api/story/:id', requireAuth, (req, res) => {
  if (!STORY_ID_RE.test(req.params.id)) return res.status(400).json({ error: '无效的项目 ID' });
  const story = loadStoryFile(req.params.id);
  if (!story || story.userId !== req.user.username) return res.status(404).json({ error: '项目不存在' });
  const { title, style, shots, characters, scenes } = req.body || {};
  if (typeof title === 'string' && title.trim()) story.title = title.trim().slice(0, 60);
  if (typeof style === 'string' && style.trim()) story.style = style.trim().slice(0, 80);
  if (Array.isArray(shots) && shots.length) story.shots = normalizeStoryShots(shots);
  if (Array.isArray(characters)) story.characters = normalizeStoryCharacters(characters);
  if (Array.isArray(scenes)) story.scenes = normalizeStoryScenes(scenes);
  story.updatedAt = Date.now();
  saveStoryFile(story);
  res.json({ story });
});

app.delete('/api/story/:id', requireAuth, (req, res) => {
  if (!STORY_ID_RE.test(req.params.id)) return res.status(400).json({ error: '无效的项目 ID' });
  const story = loadStoryFile(req.params.id);
  if (!story || story.userId !== req.user.username) return res.status(404).json({ error: '项目不存在' });
  try {
    fs.unlinkSync(path.join(STORIES_DIR, `${req.params.id}.json`));
  } catch {
    /* 文件可能已不存在 */
  }
  res.json({ ok: true });
});

/** 保存前端截取的视频末帧（data URL） */
app.post('/api/frames', requireAuth, (req, res) => {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(String((req.body && req.body.dataUrl) || ''));
  if (!m) return res.status(400).json({ error: '无效的图片数据' });
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
  const name = `frame-${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`;
  fs.writeFileSync(path.join(FILES_DIR, name), Buffer.from(m[2], 'base64'));
  res.json({ file: `/files/${name}` });
});

/* ================= 图片代理与下载 ================= */

/** 图片代理：内联展示（规避防盗链 / Referer 限制） */
app.get('/api/image', (req, res) => handleImageProxy(req, res, false));

/** 图片下载：带附件头，浏览器直接保存 */
app.get('/api/download', (req, res) => handleImageProxy(req, res, true));

async function handleImageProxy(req, res, attachment) {
  const target = String(req.query.url || '');
  if (!/^https?:\/\//i.test(target)) {
    return res.status(400).json({ error: '无效的图片地址' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 AIImageStudio/1.0' },
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: `获取图片失败（HTTP ${upstream.status}）` });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (attachment) {
      const filename = String(req.query.filename || 'image.png').replace(/[\\/:*?"<>|\s]+/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    }
    res.send(buffer);
  } catch (err) {
    res.status(502).json({ error: `获取图片失败：${(err && err.message) || err}` });
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    providers: Object.keys(PROVIDERS),
    models: MODELS,
    time: new Date().toISOString(),
  });
});

// 统一错误处理（含 JSON 解析错误）
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求体格式错误' });
  }
  console.error('[server]', err);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`[AI 图片工作台] 服务已启动: http://${shown}:${PORT}`);
  console.log(
    `[AI 图片工作台] 可用模型: ${Object.entries(MODELS)
      .map(([p, list]) => `${p}: ${list.join(', ')}`)
      .join(' | ')}`
  );
});
