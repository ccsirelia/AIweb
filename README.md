# AIWeb Studio
一个前后端分离的 AI 创作网站，支持用户注册登录、GPT 文字对话、AI 文生图/图生图、历史记录、主题切换和 SQLite 存储。聊天页支持区分 OpenAI / Grok 通道并选择管理员启用的具体模型版本，也支持最近 10 条会话、继续原会话和新对话；生图页支持 OpenAI 最多 6 张、Grok 最多 3 张参考图，提供异步生成、最近 10 张持久图库预览和原图下载。

## 项目结构

```text
AIweb/
  backend/
    main.py
    routes/
      admin.py
      auth.py
      account.py
      chat.py
      image.py
      history.py
    services/
      admin_security.py
      auth_service.py
      openai_service.py
      job_worker.py
      chat_context_service.py
      chat_job_service.py
      chat_model_service.py
      document_extract.py
      image_job_service.py
      rate_limit.py
      settings_service.py
      token_usage_service.py
    models/
      schemas.py
    database/
      models.py
      session.py
      init_db.py
    requirements.txt
    .env.example
  frontend/
    app/
      page.tsx
      chat/page.tsx
      image/page.tsx
      history/page.tsx
      settings/page.tsx
      layout.tsx
      globals.css
    components/
      sidebar.tsx
      chat-panel.tsx
      image-studio.tsx
      history-list.tsx
      theme-toggle.tsx
      ui/
    lib/
      api.ts
    package.json
    .env.example
```

## 本地安装

### 后端

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

编辑 `backend/.env`：

```env
OPENAI_API_KEY=sk-your-openai-api-key
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
JOB_POLL_INTERVAL_SECONDS=0.5
```

### 后台任务队列（进程内）

聊天与生图的长任务由 **SQLite job 表 + 进程内 worker 线程池** 执行，不再依赖 `BackgroundTasks`：

- API 只负责写入 `pending` job 并立即返回
- Worker 按 `JOB_WORKER_CONCURRENCY` 认领并执行，限制同时 hummer 上游的并发
- 启动时会把超时/僵尸 `running` job 标为 `failed`（文案提示用户重试）
- 适合 **单进程** 部署；多实例请后续换 Redis/Celery 等外部队列

相关配置：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `JOB_WORKER_CONCURRENCY` | 2 | 同时执行的 chat/image 任务数 |
| `JOB_TIMEOUT_SECONDS` | 300 | running 超时后标记失败 |
| `JOB_POLL_INTERVAL_SECONDS` | 0.5 | 调度轮询间隔（秒） |


初始化数据库：

```bash
python database/init_db.py
```

启动后端：

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：`http://localhost:8000/api/health`

后端管理控制台：`http://localhost:8000/admin`
管理员登录页：`http://localhost:8000/admin/login`

### 管理控制台鉴权与 CSRF

`/admin` 已启用独立的管理员会话鉴权与 CSRF 防护：

- 未登录访问 `/admin` 会跳转到 `/admin/login`
- 仅 `role=admin` 且 `is_active=true` 的账号可登录管理台
- 登录成功后写入 HttpOnly Cookie：
  - `aiweb_admin_session`：管理员会话
  - `aiweb_admin_csrf`：CSRF token
- 所有管理台表单 POST（保存配置、管理聊天模型、增删/启停用户、退出登录）都必须携带匹配的 `csrf_token`
- 会话有效期由 `ADMIN_SESSION_TTL_SECONDS` 控制，默认 8 小时
- HTTPS 生产环境请设置 `ADMIN_COOKIE_SECURE=true`

首次启用建议：

1. 先通过前台 `/register` 注册一个账号，或使用现有账号
2. 在数据库中把该用户的 `role` 改为 `admin`：

```sql
UPDATE user_accounts SET role = 'admin' WHERE username = 'your-admin-username';
```

3. 打开 `http://localhost:8000/admin/login` 使用该管理员账号登录

管理控制台支持：

- 设置 OpenAI 兼容 API 地址，例如 `https://api.openai.com/v1`
- 设置 xAI 官方 Grok 地址 `https://api.x.ai/v1`，推荐生图模型 `grok-imagine-image-quality`
- 设置后端使用的 API Key，留空时回退到 `.env`
- 设置兼容默认文字模型和生图模型，留空时回退到 `.env`
- 按 OpenAI / Grok 分别添加聊天模型，设置显示名称、排序和默认模型
- 启用、停用或删除聊天模型；每个通道始终保留至少一个启用模型
- 添加、启用、禁用、删除用户记录
- 管理员登录 / 退出
- 表单 CSRF 防护


注意：API Key 目前仍以明文保存在 SQLite `app_settings` 中；生产环境建议继续补充操作审计，并对数据库中的 API Key 做加密存储。

**文档约定：以后所有功能改动、安全加固、配置项/接口变更完成后，都需要同步更新本 README；若涉及表结构变化，同时更新 `DATABASE_SCHEMA.md`。**

### 前端

```bash
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

打开：`http://localhost:3000`

如果 PowerShell 禁止运行 `npm.ps1`，使用：

```bash
npm.cmd install
npm.cmd run dev
```

## 一键启停脚本

项目根目录提供了只管理当前项目进程的启停脚本。脚本会把 PID 和日志写入 `.runtime/`，停止时只根据本项目 PID 文件和命令行校验停止 AIWeb 服务，避免误伤其他项目。

默认端口：

- 前端：`5008`
- 后端：`8008`

Windows：

```bat
AIWeb-start.bat
AIWeb-stop.bat
AIWeb-restart.bat
```

Linux：

```bash
chmod +x aiweb-start.sh aiweb-stop.sh aiweb-restart.sh
./aiweb-start.sh
./aiweb-stop.sh
./aiweb-restart.sh
```

Linux 可通过环境变量临时改端口：

```bash
FRONTEND_PORT=5008 BACKEND_PORT=8008 ./aiweb-start.sh
```

## 接口

`POST /api/auth/register`

```json
{
  "username": "demo",
  "name": "Demo User",
  "email": "demo@example.com",
  "password": "secret123"
}
```

`POST /api/auth/login`

```json
{ "account": "demo", "password": "secret123" }
```

登录后前端会保存 Bearer Token，并在聊天、生图和历史接口中自动携带。

`POST /api/chat/jobs`（推荐）

入队异步聊天任务，立即返回 job；前端轮询 `GET /api/chat/jobs/{job_id}`。

```json
{ "message": "你好，请介绍一下你自己", "session_id": null, "provider": "openai", "model": "gpt-4.1-mini" }
```

`provider` 与 `model` 会在入队时校验并固化到任务；管理员之后修改默认模型不会影响已经排队的任务。未传 `model` 时使用该通道在模型目录中的默认模型。也支持 `multipart/form-data` 上传附件字段 `files`，此时同样可以传 `provider` 和 `model`。附件处理链路为：

1. 浏览器以 multipart 上传文件；
2. 后端校验扩展名、文件大小并保存附件记录；
3. `.docx`、`.pdf`、`.xlsx`、`.pptx` 和纯文本类文件在后端提取可读正文；
4. 提取后的正文随用户问题一起发送给聊天模型；
5. 前端通过聊天任务状态轮询读取并展示 AI 处理结果。

每次模型调用会按消息 ID 选择当前会话最近 20 条用户/助手消息，并在发送前恢复为时间正序。长会话不会再因为正序 `LIMIT` 而持续使用最早 20 条、丢失最新上下文。

Office/PDF 解析依赖包含在 `backend/requirements.txt` 中。更新依赖后需要重新执行：

```powershell
cd backend
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

`.docx` 文件如果加密、损坏或仅包含扫描图片而没有可读文字，接口会直接返回明确的正文提取错误，不再把只有文件名的空附件发送给 AI。旧版二进制 `.doc` 不支持正文提取，请先转换为 `.docx`。

`POST /api/chat`

同步聊天（兼容保留）；同样支持 `provider` 和 `model`，生产 UI 使用 `/api/chat/jobs`。

`GET /api/chat/models`

返回当前登录用户可选的启用模型，按 OpenAI / Grok、默认状态和后台排序排列。聊天页只显示当前通道的模型，并分别记住两个通道上次选择的版本。

`GET /api/chat/sessions`

返回最近 10 条聊天会话。

`GET /api/chat/sessions/{session_id}`

返回指定会话及其消息列表。

`POST /api/image/jobs`（推荐）

入队异步生图任务，立即返回 job；前端轮询 `GET /api/image/jobs/{job_id}`。完成后响应可含 `image_base64` 与 `image_record_id`。

文生图继续使用 JSON：

```json
{
  "prompt": "一只穿宇航服的橘猫，赛博朋克风格",
  "style": "写实",
  "size": "1024x1024",
  "aspect_ratio": "1:1",
  "quality": "1k",
  "provider": "openai"
}
```

图生图使用 `multipart/form-data`，字段包含上述参数、`mode=image_to_image`，以及可重复的 `reference_images` 文件字段。OpenAI 通道最多 6 张，Grok 官方通道最多 3 张；每张不超过 10MB，仅支持 PNG、JPG/JPEG、WebP。服务端会校验真实图片格式和像素尺寸。上传文件保存在 `backend/uploads/image-references/`，任务会将全部参考图按上传顺序传给图片编辑模型。

```text
prompt=保留人物特征，将场景改为雨夜霓虹街道
style=摄影
size=1024x1024
aspect_ratio=1:1
quality=1k
provider=openai
mode=image_to_image
reference_images=<image-1.jpg>
reference_images=<image-2.png>
```

Grok 图生图调用 `POST {GROK_BASE_URL}/images/edits`，本地参考图编码成 base64 data URI，并根据上游自动选择协议：

- 直连 `api.x.ai`：使用官方 `url` JSON；单图写入 `image`，多图写入有序 `images` 数组。
- Sub2API / 自定义中转：使用其 Grok Media Bridge 实际解析的 `image_url` JSON。首次请求会携带画幅、清晰度和 base64 返回参数；若中转的 OAuth 上游返回 400，会自动以最小兼容字段重试。
- Sub2 临时可用性错误（HTTP 429/500/502/503/504）：自动按 5、15、30 秒退避，最多请求 4 次，并优先遵循上游 `Retry-After`（最大等待 60 秒）。请求始终发送到配置的 `GROK_BASE_URL`，不会绕过 Sub2。

OpenAI SDK 的 `images.edit()` 是 multipart 格式，不能直接用于 xAI 官方编辑接口。文生图不受上述协议分流影响。

Sub2 返回 `Service temporarily unavailable` 通常表示当前 API Key 所属分组没有可调度的 Grok 账号：可能是账号池为空、并发已满、额度/限流暂停或账号运行时不可用。客户端退避可以覆盖短暂波动；若连续 4 次仍失败，需要在 Sub2 管理端检查该分组的 Grok 账号、模型映射、额度和并发状态。

推荐的官方配置：

```env
GROK_API_KEY=xai-your-api-key
GROK_BASE_URL=https://api.x.ai/v1
GROK_IMAGE_MODEL=grok-imagine-image-quality
```

如果官方 xAI 地址仍残留旧默认模型名 `grok-2-image`，运行时会自动切换到 `grok-imagine-image-quality`；自定义中转地址不会被自动改写。

`POST /api/image`

同步生图（兼容保留）；生产 UI 使用 `/api/image/jobs`。

`GET /api/history`

返回最近 50 条聊天记录和图片记录。

`GET /api/images`

返回最近 10 张生成图片，用于生图页右侧持久图库。

## 数据库设计

开发阶段使用 SQLite：

- `chat_records`: `id`, `user_message`, `ai_response`, `created_at`
- `chat_sessions`: `id`, `user_id`, `title`, `created_at`, `updated_at`
- `chat_messages`: `id`, `session_id`, `role`, `content`, `created_at`
- `chat_jobs`: `id`, `user_id`, `session_id`, `user_message_id`, `provider`, `model`, `status`, `error`, `created_at`, `started_at`, `completed_at`
- `chat_models`: OpenAI / Grok 聊天模型目录、显示名称、启停状态、默认状态与排序
- `chat_attachments`: 聊天附件元数据与本地路径
- `image_records`: `id`, `user_id`, `prompt`, `style`, `size`, `mode`, `reference_count`, `image_base64`, `created_at`
- `image_jobs`: 异步生图任务（含 `mode`，状态为 pending/running/completed/failed）
- `image_job_references`: 图生图参考文件元数据、顺序与本地路径
- `token_usage_records`: Token 用量统计
- `user_accounts`: `id`, `username`, `name`, `email`, `password_hash`, `role`, `is_active`, `created_at`
- `app_settings`: OpenAI / Grok 运行时配置

后续迁移 PostgreSQL 时，把 `DATABASE_URL` 改成 PostgreSQL 连接串，并引入 Alembic 做迁移即可。

## 部署建议

- 前端部署到 Vercel、Netlify 或自托管 Node 服务。
- 后端部署到 Render、Fly.io、Railway、Docker VPS 或云厂商容器服务。
- 生产环境使用 PostgreSQL，不建议长期把 base64 大图存 SQLite，可迁移到 S3/R2/OSS 后只保存 URL。
- CORS 的 `FRONTEND_ORIGIN` 改为真实域名。
- 限流建议替换为 Redis + IP/User 维度。
- OpenAI API Key 只配置在后端环境变量，绝不放入 `NEXT_PUBLIC_*`。
- 管理台生产环境务必：
  - 设置强随机 `AUTH_SECRET_KEY`
  - 设置 `ADMIN_COOKIE_SECURE=true`
  - 仅放行可信管理员账号的 `role=admin`
  - 不要把 `/admin` 暴露给公网匿名访问而不做反向代理/IP 限制

## 后续优化

- 管理台操作审计日志。
- API Key 加密存储。
- 流式聊天输出。
- 多实例部署时用 Redis/Celery 替换进程内 job worker。
- Prompt 模板库与收藏夹。
- Alembic 数据库迁移。
- 对象存储保存图片。
- 计费、额度与 Redis 限流。

## 文档维护约定

- 每次功能改动、安全加固、配置项变更、接口变更完成后，都需要同步更新 `README.md`。
- 如涉及数据库表结构变化，同时更新 `DATABASE_SCHEMA.md`。
