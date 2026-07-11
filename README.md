# AIWeb Studio
一个前后端分离的 AI 创作网站，支持用户注册登录、GPT 文字对话、AI 生图、历史记录、主题切换和 SQLite 存储。聊天页支持最近 10 条会话、继续原会话和新对话；生图页支持最近 10 张持久图库预览和原图下载。

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
      chat_job_service.py
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
- 所有管理台表单 POST（保存配置、增删用户、启停用户、退出登录）都必须携带匹配的 `csrf_token`
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
- 设置后端使用的 API Key，留空时回退到 `.env`
- 设置文字模型和生图模型，留空时回退到 `.env`
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
{ "message": "你好，请介绍一下你自己", "session_id": null, "provider": "openai" }
```

也支持 `multipart/form-data` 上传附件字段 `files`。

`POST /api/chat`

同步聊天（兼容保留）；生产 UI 使用 `/api/chat/jobs`。

`GET /api/chat/sessions`

返回最近 10 条聊天会话。

`GET /api/chat/sessions/{session_id}`

返回指定会话及其消息列表。

`POST /api/image/jobs`（推荐）

入队异步生图任务，立即返回 job；前端轮询 `GET /api/image/jobs/{job_id}`。完成后响应可含 `image_base64` 与 `image_record_id`。

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
- `chat_jobs`: `id`, `user_id`, `session_id`, `user_message_id`, `provider`, `status`, `error`, `created_at`, `started_at`, `completed_at`
- `chat_attachments`: 聊天附件元数据与本地路径
- `image_records`: `id`, `user_id`, `prompt`, `style`, `size`, `image_base64`, `created_at`
- `image_jobs`: 异步生图任务（pending/running/completed/failed）
- `token_usage_records`: Token 用量统计
- `user_accounts`: `id`, `username`, `name`, `email`, `password_hash`, `role`, `is_active`, `created_at`
- `app_settings`: OpenAI / Gork 运行时配置

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
