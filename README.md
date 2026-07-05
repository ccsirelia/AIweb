# AIWeb Studio

一个前后端分离的 AI 创作网站，支持 GPT 文字对话、AI 生图、历史记录、主题切换和 SQLite 存储。

## 项目结构

```text
AIweb/
  backend/
    main.py
    routes/
      chat.py
      image.py
      history.py
    services/
      openai_service.py
      rate_limit.py
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
```

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

管理控制台支持：

- 设置 OpenAI 兼容 API 地址，例如 `https://api.openai.com/v1`
- 设置后端使用的 API Key，留空时回退到 `.env`
- 设置文字模型和生图模型，留空时回退到 `.env`
- 添加、启用、禁用、删除用户记录

注意：当前管理控制台适合开发阶段使用，生产环境上线前建议加入管理员登录、CSRF 防护、操作审计，并对数据库中的 API Key 做加密存储。

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

## 接口

`POST /api/chat`

```json
{ "message": "你好，请介绍一下你自己" }
```

`POST /api/image`

```json
{
  "prompt": "一只穿宇航服的橘猫，赛博朋克风格",
  "style": "写实",
  "size": "1024x1024"
}
```

`GET /api/history`

返回最近 50 条聊天记录和图片记录。

## 数据库设计

开发阶段使用 SQLite：

- `chat_records`: `id`, `user_message`, `ai_response`, `created_at`
- `image_records`: `id`, `prompt`, `style`, `size`, `image_base64`, `created_at`

后续迁移 PostgreSQL 时，把 `DATABASE_URL` 改成 PostgreSQL 连接串，并引入 Alembic 做迁移即可。

## 部署建议

- 前端部署到 Vercel、Netlify 或自托管 Node 服务。
- 后端部署到 Render、Fly.io、Railway、Docker VPS 或云厂商容器服务。
- 生产环境使用 PostgreSQL，不建议长期把 base64 大图存 SQLite，可迁移到 S3/R2/OSS 后只保存 URL。
- CORS 的 `FRONTEND_ORIGIN` 改为真实域名。
- 限流建议替换为 Redis + IP/User 维度。
- OpenAI API Key 只配置在后端环境变量，绝不放入 `NEXT_PUBLIC_*`。

## 后续优化

- 用户登录和多租户 workspace。
- 流式聊天输出。
- 图片任务队列与异步状态查询。
- Prompt 模板库与收藏夹。
- Alembic 数据库迁移。
- 对象存储保存图片。
- 计费、额度、审计日志和 Redis 限流。
