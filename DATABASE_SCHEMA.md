# AIWeb SQLite 表结构说明

数据库文件位置：

```text
backend/aiweb.db
```

初始化命令：

```bash
cd backend
.\.venv\Scripts\python.exe database\init_db.py
```

当前开发阶段使用 SQLite。后续迁移 PostgreSQL 时，建议保留相同表名与字段语义，并引入 Alembic 维护迁移版本。

## 1. chat_records

聊天记录表。每次 `/api/chat` 成功返回 AI 回复后写入一条记录。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | INTEGER | PRIMARY KEY, INDEX | 聊天记录 ID |
| user_message | TEXT | NOT NULL | 用户输入内容 |
| ai_response | TEXT | NOT NULL | AI 回复内容 |
| created_at | DATETIME | INDEX | 创建时间，UTC |

用途：

- 历史记录页面展示 GPT 对话
- 后续可扩展为多用户会话、收藏、删除、搜索

## 2. image_records

图片生成记录表。每次 `/api/image` 成功生成图片后写入一条记录。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | INTEGER | PRIMARY KEY, INDEX | 图片记录 ID |
| prompt | TEXT | NOT NULL | 用户输入的图片 Prompt |
| style | VARCHAR(40) | NOT NULL | 图片风格，如写实、动漫、3D、油画、产品图、摄影 |
| size | VARCHAR(40) | NOT NULL | 图片尺寸，如 1024x1024、1536x864、864x1536 |
| image_base64 | TEXT | NOT NULL | 图片 base64 数据 |
| created_at | DATETIME | INDEX | 创建时间，UTC |

用途：

- 历史图库 Gallery
- 开发阶段直接保存 base64
- 生产建议改为对象存储 URL，例如 S3、R2、OSS

## 3. app_settings

应用配置表。用于后端管理控制台保存 OpenAI 兼容 API 配置。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | INTEGER | PRIMARY KEY, INDEX | 配置记录 ID |
| key | VARCHAR(120) | UNIQUE, NOT NULL, INDEX | 配置键 |
| value | TEXT | NOT NULL | 配置值 |
| updated_at | DATETIME | 自动更新 | 最近更新时间，UTC |

当前使用的配置键：

| key | 说明 |
| --- | --- |
| openai_base_url | OpenAI 或兼容服务 Base URL，例如 `https://api.openai.com/v1` |
| openai_api_key | 后端使用的 OpenAI API Key |
| openai_text_model | 文字对话使用的模型 |
| openai_image_model | AI 生图使用的模型 |

安全说明：

- API Key 不会进入前端代码
- 当前为开发阶段明文存储
- 生产环境建议加密存储，并限制后台访问权限

## 4. user_accounts

用户管理表。用于后端管理界面的用户记录管理。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | INTEGER | PRIMARY KEY, INDEX | 用户 ID |
| name | VARCHAR(120) | NOT NULL | 用户名称 |
| email | VARCHAR(255) | UNIQUE, NOT NULL, INDEX | 用户邮箱 |
| role | VARCHAR(40) | NOT NULL, 默认 member | 用户角色 |
| is_active | BOOLEAN | NOT NULL, 默认 true | 用户是否启用 |
| created_at | DATETIME | INDEX | 创建时间，UTC |

当前支持角色：

| 角色 | 说明 |
| --- | --- |
| admin | 管理员 |
| member | 普通成员 |
| viewer | 只读成员 |

后续建议：

- 增加 `password_hash` 字段接入登录
- 增加 `last_login_at` 字段记录登录时间
- 增加 `workspace_id` 支持团队空间
- 增加审计日志表记录关键操作

## 当前数据库表清单

```text
app_settings
chat_records
image_records
user_accounts
```
