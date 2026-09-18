# AI 影像工作台 (AI Image Studio)

一个自托管的 AI 影像创作工作台：文生图、图生视频、小说分镜三步出片、成片合成，全部跑在你自己的机器上。API Key 由使用者自行填写，服务端不内置任何密钥。

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue)

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
- 账户系统：注册/登录（scrypt 加盐哈希），登录后自动填充账户保存的多把 API Key（按服务商分组、掩码显示）
- 文本模型配置：支持配置多个 OpenAI 兼容接口（DeepSeek / GLM / Kimi 等）用于分镜拆解
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
| `INKOS_BASE` | `http://127.0.0.1:4567` | InkOS 服务地址（不部署 InkOS 可忽略，书架会显示未连接） |

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

## License

[MIT](LICENSE)
