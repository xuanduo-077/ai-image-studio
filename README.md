# AI 影像工作台 (AI Image Studio)

简体中文 | [English](README.en.md)

一个自托管的 AI 影像创作工作台：文生图、图生视频、小说分镜三步出片、成片合成，全部跑在你自己的机器上。API Key 由使用者自行填写，服务端不内置任何密钥。

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue)

## 界面预览

| 故事工坊 | 图片工作台 |
|---|---|
| ![故事工坊](docs/screenshots/story.png) | ![图片工作台](docs/screenshots/image.png) |
| **视频工作台** | **账号与模型管理** |
| ![视频工作台](docs/screenshots/video.png) | ![账号与模型管理](docs/screenshots/account.png) |

## 功能

### 图片生成
- **商汤 SenseNova**（`sensenova-u1-fast` / `sensenova-u1.5-lite`）：像素级尺寸（默认 2752x1536），1~4 张并行，水印可选
- **Agnes**（`agnes-image-2.5-flash`）：分辨率 1K/2K/4K + 任意画面比例
- 生成历史落盘持久化，点击下载 / 大图预览

### 视频生成
- **Agnes**（`agnes-video-2.5-flash`），两种模式：
  - **参考图生视频**（reference）：最多 3 张参考图，提示词用 `<Picture 1>` 指代
  - **首尾帧控制**（keyframe）：首帧 / 尾帧槽位，镜头在两帧间平滑过渡
- 可直接从图片生成结果或视频尾帧选取参考素材
- 异步任务自动轮询，结果自动落盘

### 故事工坊（小说 → 成片）
1. **智能分镜**：粘贴小说文本（或从 InkOS 一键拉取章节），文本模型自动产出角色卡、场景卡、镜头表
2. **角色三视图**：每个角色生成正/侧/背三视角设定图
3. **场景图**：每个场景生成无人物的环境设定图
4. **逐镜头视频**：模式自动判定——场景切换的镜头用「三视图 + 场景图」作参考图生成；场景未变化的镜头自动用上一段视频的尾帧作首帧衔接
5. **成片合成**：将多个片段按顺序拼接成片（ffmpeg），支持 720P / 1080P

### 其他
- **账号中心化密钥管理**：点击右上角账号打开浮窗，统一管理文本模型（多套 OpenAI 兼容配置）、图片 Key（商汤 / Agnes）、视频 Key（Agnes）
- **多 Key 自动故障转移**：同一服务商可保存多把 Key，某把被限流 / 额度不足 / 失效时自动切换下一把，切换过程有提示，全部失败时汇总各把 Key 的具体错误
- 文本模型配置：支持配置多个 OpenAI 兼容接口（DeepSeek / GLM / Kimi 等）用于分镜拆解，多配置自动轮询
- **本地图片上传**：参考图 / 首尾帧槽位支持拖拽或点选上传本地图片
- **结果管理**：生成结果按类型（人物三视图 / 场景图 / 普通图）筛选，支持重命名、单张删除、重新编辑回填
- **AI 提示词优化**：一键调用 [prompt-optimizer](https://github.com/linshenkx/prompt-optimizer) 优化当前提示词（图片 / 视频 / 镜头提示词均可）
- **InkOS 对接**：检测到本地 [InkOS](https://github.com/czstudio/inkos_studio) 服务后，可在书架中直接选书选章，一键拉取章节正文与角色矩阵（用于人物一致性）

## 快速开始

### 方式一：Docker Compose（推荐）

```bash
git clone https://github.com/xuanduo-077/ai-image-studio.git
cd ai-image-studio
docker compose up -d --build
```

打开 `http://localhost:8787`，注册账户即可使用。

### 方式二：源码运行

```bash
git clone https://github.com/<your-name>/ai-image-studio.git
cd ai-image-studio
npm install
npm start
```

需要 Node.js >= 18。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 服务监听端口 |
| `INKOS_BASE` | `http://127.0.0.1:4567` | InkOS 服务地址；不设置时按候选列表自动探测（回环 → docker 网关 → host.docker.internal） |
| `OPTIMIZER_URL` | `http://127.0.0.1:28081` | prompt-optimizer 服务地址（用于 AI 提示词优化，不部署可忽略） |
| `OPTIMIZER_USER` / `OPTIMIZER_PASS` | `admin` / `123456` | prompt-optimizer 的访问账号与密码（其 `ACCESS_USERNAME` / `ACCESS_PASSWORD`） |

## API Key 获取

| 服务商 | 用途 | 获取方式 |
|---|---|---|
| 商汤 SenseNova | 图片生成 | [sensecore 控制台](https://console.sensecore.cn/) 创建 API Key |
| Agnes | 图片 / 视频生成 | [agnes-ai.cn](https://www.agnes-ai.cn/) 平台获取 |
| 文本模型 | 分镜拆解 | 任意 OpenAI 兼容接口（DeepSeek / GLM / Kimi 等），在「模型配置」中填写 baseUrl 与 Key |

Key 有两种使用方式：
- **登录账户保存**（推荐）：存于服务端 `data/db.json`，多设备共用，可保存多把
- **临时粘贴**：仅存浏览器 localStorage，不清除则保留

## 成片合成：ffmpeg 安装

成片合成功能需要一个静态 ffmpeg。首次使用时若未安装，界面会明确提示。

```bash
# Linux (amd64)
mkdir -p data/bin
curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
  | tar -xJ --strip-components=1 -C data/bin --wildcards '*/ffmpeg' '*/ffprobe'
```

Windows：从 [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) 下载 essentials 包，将 `ffmpeg.exe` 与 `ffprobe.exe` 放入 `data/bin/`。

## InkOS 对接（可选）

[InkOS](https://github.com/czstudio/inkos_studio) 是开源的 AI 小说创作 Agent。部署后（默认 4567 端口），故事工坊会出现 InkOS 书架：

1. 选书 → 选章节（显示审校状态与字数）
2. 「拉取」一键填入章节正文，并自动附带 InkOS 角色矩阵（`truth/character_matrix.md`）作为人物设定参考
3. 建议优先拉取「已通过 / 待审校」状态的章节

若 InkOS 不在默认地址，设置环境变量 `INKOS_BASE` 即可。

## 提示词优化对接（可选）

部署 [prompt-optimizer](https://github.com/linshenkx/prompt-optimizer)（Docker 一体化镜像，内置 MCP 服务）后，图片提示词、视频提示词、镜头提示词旁会出现「AI 优化」按钮，一键将简单描述扩写为专业提示词：

```bash
docker run -d -p 28081:80 \
  -e ACCESS_USERNAME=admin \
  -e ACCESS_PASSWORD=你的密码 \
  -e MCP_DEFAULT_MODEL_PROVIDER=custom \
  -e VITE_CUSTOM_API_KEY=你的文本模型Key \
  -e VITE_CUSTOM_API_BASE_URL=https://api.deepseek.com/v1 \
  -e VITE_CUSTOM_API_MODEL=deepseek-chat \
  --restart unless-stopped \
  --name prompt-optimizer \
  linshen/prompt-optimizer
```

优化动作消耗该文本模型的额度（每次优化约一次 LLM 调用）。不在默认地址时设置 `OPTIMIZER_URL` / `OPTIMIZER_USER` / `OPTIMIZER_PASS`。

> 高级：所有环境变量也可以通过 `data/config.json`（键值对形式，如 `{"OPTIMIZER_URL": "http://192.168.1.10:28081"}`）覆盖，适合不方便设置容器环境变量的部署。该文件在 `data/` 下，不会被提交到仓库。

## 安全须知

- `data/db.json` 中 API Key 与文本模型 Key **明文存储**（服务端调用模型时需要使用），请确保服务器本身可信
- 注册接口开放，请勿将服务直接暴露到公网；如需公网访问，建议加反向代理 + HTTPS + 访问控制
- 所有生成记录保存在 `data/` 下，删除项目不会删除已生成的媒体文件，可定期手动清理 `data/files/`

## 目录结构

```
├── server.js          # Express 后端（API 转发、代理、账户、故事、成片合成）
├── public/            # 前端（原生 HTML/CSS/JS，无构建步骤）
│   ├── index.html     # 图片 / 视频工作台
│   ├── app.js
│   ├── story.js       # 故事工坊
│   └── style.css
├── data/              # 运行时数据（不入库）：db.json、history.json、files/、stories/、bin/
├── Dockerfile
└── docker-compose.yml
```

## 更新部署

代码更新后重启容器/进程即可生效（依赖仅有 express）：

```bash
docker compose up -d --build
```

## 更新日志

### v2.0.0
- 账号中心化：模型与密钥管理统一收进账号浮窗（文本模型 / 图片 Key / 视频 Key），各工作区改为下拉选择
- 多 Key 自动故障转移：同一服务商多把密钥限流自动切换，全失败时汇总错误；密钥健康徽标
- 故事工坊「三步出片」重构：角色三视图 → 场景图 → 逐镜头视频（场景切换用参考图模式、场景延续用尾帧衔接），镜头带出场角色与场景归属
- InkOS 深度对接：书架选书选章、一键拉取正文与角色矩阵、角色提取以矩阵为准
- 图片区升级：生成类型（人物三视图 / 场景图）、结果分类筛选、重命名、单张删除、重新编辑回填、本地图拖拽上传
- AI 提示词优化：对接 prompt-optimizer（MCP），一键扩写专业提示词
- 历史记录改为只增不减（不再自动删除），支持按剧本隔离
- 修复：密钥管理弹窗清空时文件未真正删除；生成记录剧本归属缺失导致结果不显示

### v1.0.0
- 首个开源版本：文生图、图生视频、故事分镜、成片合成、账户系统

## License

[MIT](LICENSE)
