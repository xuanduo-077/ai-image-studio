# AGENTS.md — AI Image Studio 项目指南

本文件面向在本仓库工作的编码代理（CodeBuddy Code 等）。人类开发者请阅读 README.md / README.en.md。

## 项目是什么

自托管 AI 影像创作工作台（v2.0.0，MIT 开源）：文生图、图生视频、故事三步出片（角色三视图 → 场景图 → 逐镜头视频）、成片合成。技术栈：Node.js 20 + Express 单服务（`server.js`）+ 原生 JS 前端（`public/`，无构建步骤），数据全部落盘 `data/`（gitignore）。

## 运行与验证

```bash
npm install        # 唯一依赖 express
npm start          # Node ≥ 18，默认端口 3000（PORT 可改）
node --check server.js public/app.js public/story.js   # 语法验证
curl http://localhost:3000/api/health                  # 健康检查
```

配套服务（可选，缺失时功能优雅降级）：InkOS（:4567，小说书架）、prompt-optimizer（:28081，提示词优化）。地址均为候选自动探测或 `data/config.json` / 环境变量覆盖。

## 代码地图

- `server.js` — 全部后端，按注释分段：认证 / 密钥 / 生图（/api/generate）/ 视频（/api/video + 异步轮询）/ 提示词优化（/api/optimize → prompt-optimizer MCP）/ InkOS 代理（/api/inkos/*）/ 故事工坊（/api/story*）/ 成片合成（/api/render，ffmpeg）/ 历史管理 / 上传（/api/uploads）
- `public/app.js` — 图片 + 视频工作台 + 账号浮窗（密钥管理、多 Key 故障转移 withKeyFailover）
- `public/story.js` — 故事工坊（三步出片、InkOS 书架、镜头卡）
- `public/index.html` + `style.css` — 结构与样式

## 必须遵守的约定（踩坑沉淀，违反会直接产生 bug）

1. **新增生成/提交类接口的请求体必须带 `scriptId`**（前端 `activeScriptId()`）——历史记录按剧本过滤，漏带会导致"生成了但结果不显示"
2. **改写 `data/*.json` 必须用无 BOM 的 UTF-8**（PowerShell 用 `[IO.File]::WriteAllText` + `UTF8Encoding($false)`），BOM 会让 JSON.parse 静默失败
3. **默认值不得包含任何部署环境特定地址（内网 IP / 容器 IP）**——外部服务地址用"候选自动探测 + 环境变量/data/config.json 覆盖"模式（参考 InkOS 与 prompt-optimizer 的实现）
4. **密钥永不硬编码、不写入任何文档**；`data/` 整体 gitignore
5. **历史记录只增不减**——不要恢复"自动删除旧记录"逻辑（v1 的教训）
6. 前端无构建：改 `public/` 即生效；`server.js` 改动需重启进程
7. **多 Key 故障转移在客户端**（app.js `withKeyFailover`）；文本模型轮询在服务端（`pickLlmCandidates`）——新增服务商调用时接入对应机制
8. 视频轮询沿用提交成功的 Key（`item.pollKey` / `shot.pollKey`），兜底第一把保存的 Agnes 密钥

## 详细文档

- `README.md` / `README.en.md` — 功能全景、快速开始、环境变量、外部服务对接（InkOS / prompt-optimizer）、更新日志
- 更深的部署细节与 API 全表：见项目在 OpenViking 中的知识库（viking://resources/projects/ai-image-studio/，若已配置 OpenViking MCP 可语义检索）
