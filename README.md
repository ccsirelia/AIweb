# AIWeb Studio

AIWeb Studio 是一个前后端分离的 AI 创作网站，包含用户注册登录、GPT 对话、AI 生图、图生图、PPT 生成、工作流编排、历史记录、账号信息、后台管理和 SQLite 存储。

PPT 工坊可根据提示词和上传资料生成可编辑的 PPTX，支持多种叙事模式、国企汇报等视觉风格、可编辑图表和多版式轮换。上传现有 PPTX 作为模板时，系统会分析并复用其原生页面、母版、配色、页眉、表格及内容槽位；模板无法安全解析或填充时会明确报错，不会静默退回到无关样式。

## 统一端口

本项目统一使用以下端口启动：

- 前端 Next.js：`3000`
- 后端 FastAPI：`8008`

请后续迁移服务器时保持这个约定，避免前端代理、浏览器 API 地址和后端 CORS 不一致。

本地访问地址：

- 前端页面：http://localhost:3000
- PPT 工坊：http://localhost:3000/presentations
- 后端健康检查：http://localhost:8008/api/health
- 后端管理后台：http://localhost:8008/admin
- 管理员登录页：http://localhost:8008/admin/login

## 项目结构

```text
AIweb/
  backend/
    main.py
    routes/
    services/
    models/
    database/
    requirements.txt
    .env.example
  frontend/
    app/
    components/
    lib/
    package.json
    .env.example
  AIWeb-start.bat
  AIWeb-stop.bat
  AIWeb-restart.bat
  aiweb-start.sh
  aiweb-stop.sh
  aiweb-restart.sh
```

## 环境变量

### 后端 `backend/.env`

从示例文件复制：

```powershell
cd backend
copy .env.example .env
```

关键配置：

```env
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_TEXT_MODEL=gpt-4.1-mini
OPENAI_IMAGE_MODEL=gpt-image-1

GROK_API_KEY=xai-your-api-key
GROK_BASE_URL=https://api.x.ai/v1
GROK_TEXT_MODEL=grok-3-mini
GROK_IMAGE_MODEL=grok-imagine-image-quality

DATABASE_URL=sqlite:///./aiweb.db
FRONTEND_ORIGIN=http://localhost:3000

RATE_LIMIT_PER_MINUTE=30
AUTH_SECRET_KEY=change-this-long-random-secret
AUTH_TOKEN_TTL_SECONDS=604800
ADMIN_SESSION_TTL_SECONDS=28800
ADMIN_COOKIE_SECURE=false

JOB_WORKER_CONCURRENCY=2
JOB_TIMEOUT_SECONDS=300
WORKFLOW_TIMEOUT_SECONDS=900
PRESENTATION_TIMEOUT_SECONDS=900
JOB_POLL_INTERVAL_SECONDS=0.5
```

`PRESENTATION_TIMEOUT_SECONDS` 建议保留在 900 秒或更高。包含大体积参考 PPT、较多页面或图表分析的任务通常比聊天和生图耗时更长。

服务器部署时，把 `FRONTEND_ORIGIN` 改成真实前端域名，例如：

```env
FRONTEND_ORIGIN=https://your-domain.com
```

### 前端 `frontend/.env.local`

从示例文件复制：

```powershell
cd frontend
copy .env.example .env.local
```

本地默认：

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8008
BACKEND_API_URL=http://localhost:8008
```

说明：

- `NEXT_PUBLIC_API_BASE_URL` 用于浏览器直接请求后端。
- `BACKEND_API_URL` 用于 Next.js rewrites 代理 `/api/*`。
- 生产部署时可改成真实后端地址。

## 本地安装

### 后端

Windows PowerShell：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env
.\.venv\Scripts\python.exe database\init_db.py
```

Linux：

```bash
cd backend
python3 -m venv .venv
./.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
./.venv/bin/python database/init_db.py
```

### 前端

Windows PowerShell：

```powershell
cd frontend
npm.cmd install
copy .env.example .env.local
```

Linux：

```bash
cd frontend
npm install
cp .env.example .env.local
```

## 启动、停止、重启

推荐使用项目根目录的一键脚本。脚本只管理当前 AIWeb 项目的进程，并把 PID 与日志写入 `.runtime/`。

### Windows

在项目根目录执行：

```bat
AIWeb-start.bat
AIWeb-stop.bat
AIWeb-restart.bat
```

启动后：

- 前端：http://localhost:3000
- 后端：http://localhost:8008

### Linux

在项目根目录执行：

```bash
chmod +x aiweb-start.sh aiweb-stop.sh aiweb-restart.sh
./aiweb-start.sh
./aiweb-stop.sh
./aiweb-restart.sh
```

启动后：

- 前端：http://localhost:3000
- 后端：http://localhost:8008

Linux 脚本迁移约定：

- 脚本不写死项目绝对路径。
- 启动时会先切到脚本所在目录，并使用相对目录 `backend/`、`frontend/`、`.runtime/`。
- 停止时只读取当前项目 `.runtime/` 下的 PID 文件，并校验进程工作目录是否是当前项目的 `backend/` 或 `frontend/`。
- 因此迁移服务器后，只要保持项目目录结构不变，在当前项目目录运行 `./aiweb-start.sh`、`./aiweb-stop.sh`、`./aiweb-restart.sh` 即可。
- 不要把脚本移动到项目目录外单独执行；如需从其他目录调用，请先 `cd` 到项目目录，或使用项目内脚本的相对路径调用。

## 手动启动

如需手动启动，端口也必须保持一致。

后端：

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 0.0.0.0 --port 8008
```

前端：

```powershell
cd frontend
npm.cmd run dev
```

`frontend/package.json` 已固定 `dev` 和 `start` 使用 `3000` 端口。

## PPT 工坊

登录后打开 `http://localhost:3000/presentations`：

1. 填写标题、受众、目的和内容要求，选择叙事模式、风格及页数。
2. 可上传 PDF、Word、Excel、PPT、文本或图片作为内容依据；单个参考资料不超过 25MB。
3. 可额外上传一个不超过 100MB 的 PPTX 模板。系统默认启用原生模板保真，并按页面语义选择、复用和填充模板中的版式。
4. 生成任务在后端队列中执行，完成后下载可继续用 PowerPoint 或 WPS 编辑的 PPTX。

单次任务最多上传 8 个文件，总大小不超过 125MB。涉及数字、比例和趋势的页面只使用资料中可核验的数据生成图表；缺少可靠数据时不会编造数值。

## 服务器迁移建议

1. 后端继续监听 `8008`，前端继续监听 `3000`。
2. 前端服务器环境变量设置：

```env
NEXT_PUBLIC_API_BASE_URL=https://api.your-domain.com
BACKEND_API_URL=https://api.your-domain.com
```

3. 后端服务器环境变量设置：

```env
FRONTEND_ORIGIN=https://your-domain.com
ADMIN_COOKIE_SECURE=true
AUTH_SECRET_KEY=replace-with-a-long-random-secret
```

4. 如果使用 Nginx，可以：

- 将公网 `https://your-domain.com` 反向代理到 `127.0.0.1:3000`
- 将公网 `https://api.your-domain.com` 反向代理到 `127.0.0.1:8008`

5. 不要把 OpenAI/Grok API Key 放到前端环境变量里，API Key 只放在后端 `.env` 或后端管理后台配置中。

## 验证命令

后端：

```powershell
cd backend
.\.venv\Scripts\python.exe -m compileall main.py routes services models database
```

前端：

```powershell
cd frontend
npm.cmd run build
```

健康检查：

```powershell
Invoke-RestMethod http://localhost:8008/api/health
```

## 数据库

开发阶段默认使用 SQLite：

```env
DATABASE_URL=sqlite:///./aiweb.db
```

初始化：

```powershell
cd backend
.\.venv\Scripts\python.exe database\init_db.py
```

后续迁移 PostgreSQL 时，建议引入 Alembic 管理迁移，并把 `DATABASE_URL` 改成 PostgreSQL 连接串。

## 维护约定

- 前端统一端口：`3000`
- 后端统一端口：`8008`
- 修改端口时必须同步检查：
  - `AIWeb-start.ps1`
  - `AIWeb-restart.ps1`
  - `aiweb-start.sh`
  - `aiweb-stop.sh`
  - `aiweb-restart.sh`
  - `frontend/package.json`
  - `frontend/.env.example`
  - `frontend/next.config.ts`
  - `backend/main.py`
  - `backend/.env.example`
  - `README.md`
- 功能变更后应同步更新 README；涉及表结构变更时同步更新 `DATABASE_SCHEMA.md`。
