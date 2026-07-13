from html import escape
from urllib.parse import parse_qs, quote

from fastapi import APIRouter, Depends, Request

from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy import desc, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database.models import ChatModel, UserAccount
from database.session import get_db

from services.admin_security import (
    clear_admin_cookies,
    create_admin_session_token,
    ensure_csrf_token,
    get_admin_user,
    issue_csrf_token,
    set_admin_cookies,
    set_csrf_cookie,
    validate_csrf,
)
from services.auth_service import hash_password, verify_password
from services.chat_model_service import add_legacy_model_to_catalog, set_default_chat_model
from services.settings_service import (
    SETTING_GROK_API_KEY,
    SETTING_GROK_BASE_URL,
    SETTING_GROK_IMAGE_MODEL,
    SETTING_GROK_TEXT_MODEL,
    SETTING_OPENAI_API_KEY,
    SETTING_OPENAI_BASE_URL,
    SETTING_OPENAI_IMAGE_MODEL,
    SETTING_OPENAI_TEXT_MODEL,
    get_setting,
    mask_secret,
    normalize_provider,
    set_setting,
)

router = APIRouter(tags=["admin"])


async def read_form(request: Request) -> dict[str, str]:
    body = (await request.body()).decode("utf-8")
    parsed = parse_qs(body, keep_blank_values=True)
    return {key: values[-1] if values else "" for key, values in parsed.items()}


def redirect_admin(message: str = "", *, login: bool = False) -> RedirectResponse:
    base = "/admin/login" if login else "/admin"
    suffix = f"?message={quote(message)}" if message else ""
    return RedirectResponse(url=f"{base}{suffix}", status_code=303)


def csrf_field(csrf_token: str) -> str:
    return f'<input type="hidden" name="csrf_token" value="{escape(csrf_token)}" />'


def require_admin_or_redirect(request: Request, db: Session) -> UserAccount | RedirectResponse:
    admin = get_admin_user(request, db)
    if admin is None:
        return redirect_admin("请先使用管理员账号登录。", login=True)
    return admin


def attach_csrf_if_needed(request: Request, response: Response, csrf_token: str) -> Response:
    if not request.cookies.get("aiweb_admin_csrf"):
        set_csrf_cookie(response, csrf_token)
    return response


def chat_model_setting_key(provider: str) -> str:
    return SETTING_GROK_TEXT_MODEL if provider == "grok" else SETTING_OPENAI_TEXT_MODEL


def sync_default_chat_model_setting(db: Session, model: ChatModel) -> None:
    """Keep the legacy provider default in sync with the model catalog."""
    set_setting(db, chat_model_setting_key(model.provider), model.model_id)


def render_provider_card(
    title: str,
    description: str,
    prefix: str,
    base_url: str,
    api_key: str,
    text_model: str,
    image_model: str,
    base_placeholder: str,
    text_placeholder: str,
    image_placeholder: str,
    csrf_token: str,
) -> str:
    base_url_hint = (
        "xAI 官方地址为 https://api.x.ai/v1；Sub2API 等中转会自动使用兼容的 image_url JSON 请求。"
        if prefix == "grok"
        else "填写官方或兼容 OpenAI SDK 的 Base URL，一般只填到 /v1。"
    )
    return f"""
      <section class="card">
        <div class="card-head">
          <h2>{escape(title)}</h2>
          <p>{escape(description)}</p>
        </div>
        <div class="card-body">
          <form method="post" action="/admin/settings">
            {csrf_field(csrf_token)}
            <input type="hidden" name="provider" value="{escape(prefix)}" />
            <div class="field">
              <label for="{prefix}_base_url">API 地址</label>
              <input id="{prefix}_base_url" name="base_url" value="{escape(base_url)}" placeholder="{escape(base_placeholder)}" />
              <div class="hint">{escape(base_url_hint)}</div>
            </div>
            <div class="field">
              <label for="{prefix}_api_key">API Key</label>
              <input id="{prefix}_api_key" name="api_key" type="password" placeholder="留空则不覆盖现有 Key" />
              <div class="hint">当前状态：{escape(mask_secret(api_key))}</div>
            </div>
            <div class="field">
              <label for="{prefix}_text_model">默认聊天模型（兼容回退）</label>
              <input id="{prefix}_text_model" name="text_model" maxlength="160" value="{escape(text_model)}" placeholder="{escape(text_placeholder)}" />
            </div>
            <div class="field">
              <label for="{prefix}_image_model">生图模型</label>
              <input id="{prefix}_image_model" name="image_model" value="{escape(image_model)}" placeholder="{escape(image_placeholder)}" />
            </div>
            <button class="button" type="submit">保存 {escape(title)} 配置</button>
          </form>
        </div>
      </section>
    """


def render_chat_models(models: list[ChatModel], csrf_token: str) -> str:
    rows: list[str] = []
    for model in models:
        provider_label = "OpenAI" if model.provider == "openai" else "Grok"
        status = "已启用" if model.is_active else "已停用"
        status_class = "pill ok" if model.is_active else "pill muted"
        default_badge = '<span class="pill role">默认</span>' if model.is_default else ""
        default_action = "" if model.is_default else f"""
          <form method="post" action="/admin/chat-models/{model.id}/default">
            {csrf_field(csrf_token)}
            <button class="ghost" type="submit">设为默认</button>
          </form>
        """
        rows.append(
            f"""
            <tr>
              <td><span class="pill role">{provider_label}</span></td>
              <td><strong>{escape(model.display_name)}</strong><div class="hint model-id">{escape(model.model_id)}</div></td>
              <td><span class="{status_class}">{status}</span> {default_badge}</td>
              <td>{model.sort_order}</td>
              <td class="actions">
                {default_action}
                <form method="post" action="/admin/chat-models/{model.id}/toggle">
                  {csrf_field(csrf_token)}
                  <button class="ghost" type="submit">{'停用' if model.is_active else '启用'}</button>
                </form>
                <form method="post" action="/admin/chat-models/{model.id}/delete">
                  {csrf_field(csrf_token)}
                  <button class="danger" type="submit">删除</button>
                </form>
              </td>
            </tr>
            """
        )
    if not rows:
        return '<div class="empty"><div><h3>暂无聊天模型</h3><p>请先添加 OpenAI 或 Grok 模型。</p></div></div>'
    return f"""
      <div class="table-wrap">
        <table>
          <thead><tr><th>通道</th><th>模型</th><th>状态</th><th>排序</th><th>操作</th></tr></thead>
          <tbody>{''.join(rows)}</tbody>
        </table>
      </div>
    """


def render_users(users: list[UserAccount], csrf_token: str) -> str:
    if not users:
        return """
        <div class="empty">
          <h3>暂无用户</h3>
          <p>添加第一个成员后，这里会展示账号状态与角色。</p>
        </div>
        """

    rows = []
    for user in users:
        status = "Active" if user.is_active else "Disabled"
        status_class = "pill ok" if user.is_active else "pill muted"
        toggle_text = "禁用" if user.is_active else "启用"
        rows.append(
            f"""
            <tr>
              <td>
                <div class="user-cell">
                  <div class="avatar">{escape(user.name[:1].upper())}</div>
                  <div>
                    <strong>{escape(user.name)}</strong>
                    <span>@{escape(user.username)} · {escape(user.email)}</span>
                  </div>
                </div>
              </td>
              <td><span class="pill role">{escape(user.role)}</span></td>
              <td><span class="{status_class}">{status}</span></td>
              <td>{user.created_at.strftime("%Y-%m-%d %H:%M")}</td>
              <td class="actions">
                <form method="post" action="/admin/users/{user.id}/toggle">
                  {csrf_field(csrf_token)}
                  <button class="ghost" type="submit">{toggle_text}</button>
                </form>
                <form method="post" action="/admin/users/{user.id}/delete">
                  {csrf_field(csrf_token)}
                  <button class="danger" type="submit">删除</button>
                </form>
              </td>
            </tr>
            """
        )
    return f"""
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>用户</th>
              <th>角色</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>{''.join(rows)}</tbody>
        </table>
      </div>
    """


def render_login_page(message: str = "", csrf_token: str = "") -> str:
    return f"""
    <!doctype html>
    <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>AIWeb Admin Login</title>
      <style>
        :root {{
          --bg: #f6f7fb;
          --card: rgba(255,255,255,.9);
          --text: #1a1a1a;
          --muted: #808080;
          --line: #e3e7f0;
          --primary: #5b7cff;
          --accent: #8a5cff;
          --shadow: 0 24px 80px rgba(15,17,23,.09);
        }}
        * {{ box-sizing: border-box; }}
        body {{
          margin: 0; min-height: 100vh; display: grid; place-items: center;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: var(--text);
          background:
            radial-gradient(circle at 12% 0%, rgba(91,124,255,.16), transparent 32rem),
            radial-gradient(circle at 88% 12%, rgba(138,92,255,.10), transparent 30rem),
            var(--bg);
        }}
        .card {{
          width: min(420px, calc(100vw - 32px));
          border: 1px solid var(--line); border-radius: 28px; background: var(--card);
          box-shadow: var(--shadow); padding: 28px;
        }}
        h1 {{ margin: 0 0 8px; font-size: 28px; }}
        p {{ margin: 0 0 18px; color: var(--muted); line-height: 1.6; }}
        label {{ display: block; margin-bottom: 8px; font-size: 13px; font-weight: 700; }}
        input {{
          width: 100%; height: 46px; border: 1px solid var(--line); border-radius: 16px;
          padding: 0 14px; outline: none; background: rgba(255,255,255,.78); color: var(--text);
        }}
        input:focus {{ border-color: var(--primary); box-shadow: 0 0 0 4px rgba(91,124,255,.12); }}
        .field {{ margin-bottom: 16px; }}
        .button {{
          display: inline-flex; align-items: center; justify-content: center; width: 100%; height: 46px;
          border: 0; border-radius: 16px; color: #fff; font-weight: 800; cursor: pointer;
          background: linear-gradient(135deg, var(--primary), var(--accent));
        }}
        .message {{
          margin-bottom: 16px; border: 1px solid rgba(91,124,255,.22); border-radius: 18px;
          background: rgba(91,124,255,.08); padding: 12px 14px; color: #3854d8; font-size: 14px; font-weight: 700;
        }}
        .hint {{ margin-top: 14px; color: var(--muted); font-size: 12px; line-height: 1.6; }}
      </style>
    </head>
    <body>
      <div class="card">
        <h1>管理员登录</h1>
        <p>仅 role=admin 且启用的账号可进入后端管理控制台。</p>
        {f'<div class="message">{escape(message)}</div>' if message else ''}
        <form method="post" action="/admin/login">
          {csrf_field(csrf_token)}
          <div class="field">
            <label for="account">用户名或邮箱</label>
            <input id="account" name="account" required maxlength="255" placeholder="admin" autocomplete="username" />
          </div>
          <div class="field">
            <label for="password">密码</label>
            <input id="password" name="password" type="password" required minlength="6" maxlength="128" placeholder="管理员密码" autocomplete="current-password" />
          </div>
          <button class="button" type="submit">登录管理台</button>
        </form>
        <div class="hint">首次使用请先在前台注册一个账号，再通过数据库/管理台将其 role 设为 admin；或使用已有 admin 账号登录。</div>
      </div>
    </body>
    </html>
    """


@router.get("/admin/login", response_class=HTMLResponse)
def admin_login_page(request: Request, db: Session = Depends(get_db)) -> Response:
    if get_admin_user(request, db) is not None:
        return redirect_admin()
    csrf_token = ensure_csrf_token(request)
    message = request.query_params.get("message", "")
    response = HTMLResponse(render_login_page(message=message, csrf_token=csrf_token))
    return attach_csrf_if_needed(request, response, csrf_token)


@router.post("/admin/login")
async def admin_login(request: Request, db: Session = Depends(get_db)) -> Response:
    data = await read_form(request)
    csrf_token = ensure_csrf_token(request)
    if not validate_csrf(request, data.get("csrf_token", "")):
        response = HTMLResponse(render_login_page(message="CSRF 校验失败，请刷新页面后重试。", csrf_token=csrf_token), status_code=403)
        return attach_csrf_if_needed(request, response, csrf_token)

    account = data.get("account", "").strip().lower()
    password = data.get("password", "").strip()
    user = (
        db.query(UserAccount)
        .filter(or_(UserAccount.username == account, UserAccount.email == account))
        .first()
    )
    if user is None or not verify_password(password, user.password_hash):
        response = HTMLResponse(render_login_page(message="用户名或密码错误。", csrf_token=csrf_token), status_code=401)
        return attach_csrf_if_needed(request, response, csrf_token)
    if not user.is_active:
        response = HTMLResponse(render_login_page(message="账号已被禁用。", csrf_token=csrf_token), status_code=403)
        return attach_csrf_if_needed(request, response, csrf_token)
    if user.role != "admin":
        response = HTMLResponse(render_login_page(message="该账号没有管理员权限。", csrf_token=csrf_token), status_code=403)
        return attach_csrf_if_needed(request, response, csrf_token)

    response = redirect_admin("管理员登录成功")
    set_admin_cookies(response, create_admin_session_token(user), issue_csrf_token())
    return response


@router.post("/admin/logout")
async def admin_logout(request: Request) -> Response:
    data = await read_form(request)
    if not validate_csrf(request, data.get("csrf_token", "")):
        return redirect_admin("CSRF 校验失败，请刷新后重试。", login=True)
    response = redirect_admin("已退出管理台", login=True)
    clear_admin_cookies(response)
    return response


@router.get("/admin", response_class=HTMLResponse)
def admin_page(request: Request, db: Session = Depends(get_db)) -> Response:
    admin = require_admin_or_redirect(request, db)
    if isinstance(admin, RedirectResponse):
        return admin

    openai_base_url = get_setting(db, SETTING_OPENAI_BASE_URL, "")
    openai_api_key = get_setting(db, SETTING_OPENAI_API_KEY, "")
    openai_text_model = get_setting(db, SETTING_OPENAI_TEXT_MODEL, "")
    openai_image_model = get_setting(db, SETTING_OPENAI_IMAGE_MODEL, "")

    grok_base_url = get_setting(db, SETTING_GROK_BASE_URL, "")
    grok_api_key = get_setting(db, SETTING_GROK_API_KEY, "")
    grok_text_model = get_setting(db, SETTING_GROK_TEXT_MODEL, "")
    grok_image_model = get_setting(db, SETTING_GROK_IMAGE_MODEL, "")

    users = db.query(UserAccount).order_by(desc(UserAccount.created_at)).all()
    chat_models = db.query(ChatModel).order_by(ChatModel.provider.asc(), ChatModel.sort_order.asc(), ChatModel.id.asc()).all()
    message = request.query_params.get("message", "")
    csrf_token = ensure_csrf_token(request)

    openai_card = render_provider_card(
        "OpenAI",
        "默认 OpenAI 或 OpenAI-compatible 通道配置。",
        "openai",
        openai_base_url,
        openai_api_key,
        openai_text_model,
        openai_image_model,
        "https://api.openai.com/v1",
        "gpt-4.1-mini",
        "gpt-image-1",
        csrf_token,
    )
    grok_card = render_provider_card(
        "Grok",
        "xAI 官方或兼容通道配置。官方 Grok 图生图要求 JSON Images Edit 接口。",
        "grok",
        grok_base_url,
        grok_api_key,
        grok_text_model,
        grok_image_model,
        "https://api.x.ai/v1",
        "grok-3-mini 或兼容模型名",
        "grok-imagine-image-quality",
        csrf_token,
    )

    html = f"""
    <!doctype html>
    <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>AIWeb Admin</title>
      <style>
        :root {{
          --bg: #f6f7fb;
          --card: rgba(255,255,255,.86);
          --text: #1a1a1a;
          --muted: #808080;
          --line: #e3e7f0;
          --primary: #5b7cff;
          --accent: #8a5cff;
          --danger: #ef4444;
          --shadow: 0 24px 80px rgba(15,17,23,.09);
        }}
        * {{ box-sizing: border-box; }}
        body {{
          margin: 0;
          min-height: 100vh;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: var(--text);
          background:
            radial-gradient(circle at 12% 0%, rgba(91,124,255,.16), transparent 32rem),
            radial-gradient(circle at 88% 12%, rgba(138,92,255,.10), transparent 30rem),
            var(--bg);
        }}
        .layout {{ display: grid; min-height: 100vh; grid-template-columns: 280px 1fr; }}
        .sidebar {{
          position: sticky; top: 0; height: 100vh; padding: 28px 22px;
          border-right: 1px solid var(--line); background: rgba(255,255,255,.58); backdrop-filter: blur(24px);
        }}
        .brand {{ display: flex; align-items: center; gap: 12px; margin-bottom: 42px; color: inherit; text-decoration: none; }}
        .logo {{ width: 44px; height: 44px; border-radius: 16px; display: grid; place-items: center; background: #1a1a1a; color: #fff; }}
        .brand strong {{ display: block; font-size: 18px; }}
        .brand span {{ color: var(--muted); font-size: 12px; }}
        .nav {{ display: grid; gap: 10px; }}
        .nav a {{
          display: flex; align-items: center; height: 46px; padding: 0 14px; border-radius: 16px;
          color: #4b5563; font-weight: 700; font-size: 14px; text-decoration: none;
        }}
        .nav a.active {{ color: #fff; background: linear-gradient(135deg, var(--primary), var(--accent)); }}
        .safe-box {{
          position: absolute; left: 22px; right: 22px; bottom: 24px; padding: 16px;
          border: 1px solid var(--line); border-radius: 20px; background: rgba(246,247,251,.72);
        }}
        .safe-box p {{ margin: 8px 0 0; color: var(--muted); font-size: 12px; line-height: 1.7; }}
        main {{ padding: 28px 36px 48px; min-width: 0; }}
        .topbar {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }}
        .eyebrow {{ margin: 0 0 6px; font-size: 12px; letter-spacing: .22em; font-weight: 800; color: #4b5563; }}
        h1 {{ margin: 0; font-size: 32px; }}
        .badge {{
          display: inline-flex; align-items: center; height: 38px; padding: 0 14px;
          border: 1px solid var(--line); border-radius: 999px; background: rgba(255,255,255,.66);
          color: #4b5563; font-size: 13px; font-weight: 700;
        }}
        .grid {{ display: grid; grid-template-columns: repeat(2, minmax(320px, 1fr)); gap: 22px; align-items: start; }}
        .card {{
          border: 1px solid var(--line); border-radius: 28px; background: var(--card);
          box-shadow: var(--shadow); backdrop-filter: blur(24px); overflow: hidden;
        }}
        .card-head {{ padding: 22px 24px 0; }}
        .card-head h2 {{ margin: 0; font-size: 19px; }}
        .card-head p {{ margin: 8px 0 0; color: var(--muted); font-size: 14px; line-height: 1.7; }}
        .card-body {{ padding: 22px 24px 24px; }}
        label {{ display: block; margin-bottom: 8px; font-size: 13px; font-weight: 700; }}
        input, select {{
          width: 100%; height: 46px; border: 1px solid var(--line); border-radius: 16px;
          padding: 0 14px; outline: none; background: rgba(255,255,255,.78); color: var(--text);
        }}
        input:focus, select:focus {{ border-color: var(--primary); box-shadow: 0 0 0 4px rgba(91,124,255,.12); }}
        .field {{ margin-bottom: 16px; }}
        .hint {{ margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 1.6; }}
        .button {{
          display: inline-flex; align-items: center; justify-content: center; width: 100%; height: 46px;
          border: 0; border-radius: 16px; color: #fff; font-weight: 800; cursor: pointer;
          background: linear-gradient(135deg, var(--primary), var(--accent));
          box-shadow: 0 16px 38px rgba(91,124,255,.25);
        }}
        .message {{
          margin-bottom: 16px; border: 1px solid rgba(91,124,255,.22); border-radius: 18px;
          background: rgba(91,124,255,.08); padding: 12px 14px; color: #3854d8; font-size: 14px; font-weight: 700;
        }}
        .wide {{ grid-column: 1 / -1; }}
        .table-wrap {{ overflow-x: auto; }}
        table {{ width: 100%; border-collapse: collapse; }}
        th, td {{ padding: 15px 16px; border-bottom: 1px solid var(--line); text-align: left; font-size: 14px; }}
        th {{ color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }}
        .user-cell {{ display: flex; align-items: center; gap: 12px; }}
        .avatar {{ width: 40px; height: 40px; border-radius: 16px; display: grid; place-items: center; color: #fff; font-weight: 850; background: linear-gradient(135deg, var(--primary), var(--accent)); }}
        .user-cell span {{ display: block; margin-top: 2px; color: var(--muted); font-size: 12px; }}
        .pill {{ display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 800; }}
        .pill.ok {{ color: #047857; background: #d1fae5; }}
        .pill.muted {{ color: #6b7280; background: #f3f4f6; }}
        .pill.role {{ color: #4f46e5; background: #eef2ff; }}
        .actions {{ display: flex; gap: 8px; align-items: center; }}
        .actions form {{ margin: 0; }}
        .ghost, .danger {{ height: 34px; border-radius: 12px; padding: 0 12px; cursor: pointer; border: 1px solid var(--line); background: #fff; font-weight: 750; }}
        .danger {{ color: var(--danger); }}
        .user-form-grid {{ display: grid; grid-template-columns: 1fr 1fr 1fr 160px; gap: 12px; }}
        .model-form-grid {{ display: grid; grid-template-columns: 150px minmax(220px,1.2fr) minmax(180px,1fr) 110px 130px; gap: 12px; }}
        .model-id {{ margin-top: 4px; overflow-wrap: anywhere; }}
        .empty {{ display: grid; place-items: center; min-height: 180px; text-align: center; color: var(--muted); }}
        @media (max-width: 1200px) {{
          .model-form-grid {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
        }}
        @media (max-width: 980px) {{
          .layout, .grid, .user-form-grid, .model-form-grid {{ grid-template-columns: 1fr; }}
          .sidebar {{ position: relative; height: auto; }}
          .safe-box {{ position: static; margin-top: 18px; }}
          main {{ padding: 22px 16px 36px; }}
          .topbar {{ align-items: flex-start; gap: 14px; flex-direction: column; }}
        }}
      </style>
    </head>
    <body>
      <div class="layout">
        <aside class="sidebar">
          <a class="brand" href="/admin">
            <div class="logo">AI</div>
            <div><strong>AIWeb Admin</strong><span>Backend Console</span></div>
          </a>
          <nav class="nav">
            <a class="active" href="/admin">API 配置</a>
            <a href="#chat-models">聊天模型</a>
            <a href="#users">用户管理</a>
            <a href="/docs">API Docs</a>
            <a href="/api/health">Health</a>
          </nav>
          <div class="safe-box">
            <strong>密钥安全</strong>

            <p>OpenAI 与 Grok API Key 都只保存在后端 SQLite 或环境变量中，前端不会读取。管理台已启用管理员会话鉴权与 CSRF 防护。</p>
            <p>当前管理员：{escape(admin.username)}</p>
            <form method="post" action="/admin/logout" style="margin-top:12px;">
              {csrf_field(csrf_token)}
              <button class="ghost" type="submit" style="width:100%;">退出登录</button>
            </form>
          </div>
        </aside>

        <main>
          <div class="topbar">
            <div>
              <p class="eyebrow">AIWEB BACKEND</p>
              <h1>后端管理控制台</h1>
            </div>

            <div class="badge">Admin · CSRF Protected</div>
          </div>

          {f'<div class="message">{escape(message)}</div>' if message else ''}

          <div class="grid">
            {openai_card}
            {grok_card}

            <section class="card wide" id="chat-models">
              <div class="card-head">
                <h2>聊天模型目录</h2>
                <p>按 OpenAI / Grok 通道维护前端可选模型。实际模型 ID 会原样发送给对应上游。</p>
              </div>
              <div class="card-body">
                <form method="post" action="/admin/chat-models">
                  {csrf_field(csrf_token)}
                  <div class="model-form-grid">
                    <div class="field">
                      <label for="chat_model_provider">通道</label>
                      <select id="chat_model_provider" name="provider">
                        <option value="openai">OpenAI</option>
                        <option value="grok">Grok</option>
                      </select>
                    </div>
                    <div class="field">
                      <label for="chat_model_id">实际模型 ID</label>
                      <input id="chat_model_id" name="model_id" required maxlength="160" placeholder="gpt-4.1-mini" />
                    </div>
                    <div class="field">
                      <label for="chat_model_name">显示名称</label>
                      <input id="chat_model_name" name="display_name" maxlength="120" placeholder="GPT-4.1 Mini" />
                    </div>
                    <div class="field">
                      <label for="chat_model_sort">排序</label>
                      <input id="chat_model_sort" name="sort_order" type="number" min="0" max="9999" value="100" />
                    </div>
                    <div class="field">
                      <label for="chat_model_default">默认模型</label>
                      <select id="chat_model_default" name="make_default">
                        <option value="0">否</option>
                        <option value="1">是</option>
                      </select>
                    </div>
                  </div>
                  <button class="button" type="submit">添加聊天模型</button>
                </form>
              </div>
              {render_chat_models(chat_models, csrf_token)}
            </section>

            <section class="card wide" id="users">
              <div class="card-head">
                <h2>用户管理</h2>
                <p>添加、启用、禁用或删除后台用户记录。</p>
              </div>
              <div class="card-body">
                <form method="post" action="/admin/users">
                  {csrf_field(csrf_token)}
                  <div class="user-form-grid">
                    <div class="field">
                      <label for="name">姓名</label>
                      <input id="name" name="name" required maxlength="120" placeholder="Admin" />
                    </div>
                    <div class="field">
                      <label for="username">用户名</label>
                      <input id="username" name="username" required maxlength="80" placeholder="admin" />
                    </div>
                    <div class="field">
                      <label for="email">邮箱</label>
                      <input id="email" name="email" type="email" required maxlength="255" placeholder="admin@example.com" />
                    </div>
                    <div class="field">
                      <label for="role">角色</label>
                      <select id="role" name="role">
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                        <option value="viewer">viewer</option>
                      </select>
                    </div>
                  </div>
                  <div class="field">
                    <label for="password">初始密码</label>
                    <input id="password" name="password" type="password" required minlength="6" maxlength="128" placeholder="至少 6 位" />
                  </div>
                  <button class="button" type="submit">添加用户</button>
                </form>
              </div>
              {render_users(users, csrf_token)}
            </section>
          </div>
        </main>
      </div>
    </body>
    </html>
    """
    response = HTMLResponse(html)
    return attach_csrf_if_needed(request, response, csrf_token)


@router.post("/admin/settings")
async def update_settings(request: Request, db: Session = Depends(get_db)) -> RedirectResponse:
    admin = require_admin_or_redirect(request, db)
    if isinstance(admin, RedirectResponse):
        return admin

    data = await read_form(request)
    if not validate_csrf(request, data.get("csrf_token", "")):
        return redirect_admin("CSRF 校验失败，请刷新页面后重试。")

    provider = normalize_provider(data.get("provider", "openai"))
    base_url = data.get("base_url", "").strip()
    api_key = data.get("api_key", "").strip()
    text_model = data.get("text_model", "").strip()
    image_model = data.get("image_model", "").strip()
    if len(text_model) > 160 or any(character.isspace() for character in text_model):
        return redirect_admin("默认聊天模型 ID 不能超过 160 个字符或包含空格。")

    if provider == "grok":
        set_setting(db, SETTING_GROK_BASE_URL, base_url)
        set_setting(db, SETTING_GROK_TEXT_MODEL, text_model)
        set_setting(db, SETTING_GROK_IMAGE_MODEL, image_model)
        if api_key:
            set_setting(db, SETTING_GROK_API_KEY, api_key)
        catalog_model = add_legacy_model_to_catalog(db, provider, text_model)
        if catalog_model is not None:
            set_default_chat_model(db, catalog_model)
        db.commit()
        return redirect_admin("Grok 配置已保存")

    set_setting(db, SETTING_OPENAI_BASE_URL, base_url)
    set_setting(db, SETTING_OPENAI_TEXT_MODEL, text_model)
    set_setting(db, SETTING_OPENAI_IMAGE_MODEL, image_model)
    if api_key:
        set_setting(db, SETTING_OPENAI_API_KEY, api_key)
    catalog_model = add_legacy_model_to_catalog(db, provider, text_model)
    if catalog_model is not None:
        set_default_chat_model(db, catalog_model)
    db.commit()
    return redirect_admin("OpenAI 配置已保存")


@router.post("/admin/chat-models")
async def create_chat_model(request: Request, db: Session = Depends(get_db)) -> RedirectResponse:
    admin = require_admin_or_redirect(request, db)
    if isinstance(admin, RedirectResponse):
        return admin

    data = await read_form(request)
    if not validate_csrf(request, data.get("csrf_token", "")):
        return redirect_admin("CSRF 校验失败，请刷新页面后重试。")

    provider = data.get("provider", "").strip().lower()
    model_id = data.get("model_id", "").strip()
    display_name = data.get("display_name", "").strip() or model_id
    if provider not in {"openai", "grok"}:
        return redirect_admin("模型通道必须是 OpenAI 或 Grok。")
    if not model_id:
        return redirect_admin("实际模型 ID 不能为空。")
    if len(model_id) > 160 or len(display_name) > 120:
        return redirect_admin("模型 ID 或显示名称过长。")
    if any(character.isspace() for character in model_id):
        return redirect_admin("实际模型 ID 不能包含空格。")
    try:
        sort_order = max(0, min(9999, int(data.get("sort_order", "100") or "100")))
    except ValueError:
        return redirect_admin("模型排序必须是 0 到 9999 的整数。")

    if db.query(ChatModel.id).filter(ChatModel.provider == provider, ChatModel.model_id == model_id).first():
        return redirect_admin("该通道下已经存在相同的模型 ID。")

    has_default = (
        db.query(ChatModel.id)
        .filter(ChatModel.provider == provider, ChatModel.is_default.is_(True))
        .first()
        is not None
    )
    model = ChatModel(
        provider=provider,
        model_id=model_id,
        display_name=display_name,
        is_active=True,
        is_default=False,
        sort_order=sort_order,
    )
    db.add(model)
    try:
        db.flush()
        if data.get("make_default") == "1" or not has_default:
            set_default_chat_model(db, model)
            sync_default_chat_model_setting(db, model)
        db.commit()
    except IntegrityError:
        db.rollback()
        return redirect_admin("该通道下已经存在相同的模型 ID。")
    return redirect_admin(f"{display_name} 已添加到 {provider.upper()} 模型目录。")


@router.post("/admin/chat-models/{model_id}/default")
async def make_default_chat_model(model_id: int, request: Request, db: Session = Depends(get_db)) -> RedirectResponse:
    admin = require_admin_or_redirect(request, db)
    if isinstance(admin, RedirectResponse):
        return admin

    data = await read_form(request)
    if not validate_csrf(request, data.get("csrf_token", "")):
        return redirect_admin("CSRF 校验失败，请刷新页面后重试。")

    model = db.get(ChatModel, model_id)
    if model is None:
        return redirect_admin("模型不存在或已被删除。")
    set_default_chat_model(db, model)
    sync_default_chat_model_setting(db, model)
    db.commit()
    return redirect_admin(f"{model.display_name} 已设为 {model.provider.upper()} 默认模型。")


@router.post("/admin/chat-models/{model_id}/toggle")
async def toggle_chat_model(model_id: int, request: Request, db: Session = Depends(get_db)) -> RedirectResponse:
    admin = require_admin_or_redirect(request, db)
    if isinstance(admin, RedirectResponse):
        return admin

    data = await read_form(request)
    if not validate_csrf(request, data.get("csrf_token", "")):
        return redirect_admin("CSRF 校验失败，请刷新页面后重试。")

    model = db.get(ChatModel, model_id)
    if model is None:
        return redirect_admin("模型不存在或已被删除。")

    if model.is_active:
        active_models = (
            db.query(ChatModel)
            .filter(
                ChatModel.provider == model.provider,
                ChatModel.is_active.is_(True),
                ChatModel.id != model.id,
            )
            .order_by(ChatModel.sort_order.asc(), ChatModel.id.asc())
            .all()
        )
        if not active_models:
            return redirect_admin("每个通道至少需要保留一个启用的模型。")
        if model.is_default:
            replacement = active_models[0]
            set_default_chat_model(db, replacement)
            sync_default_chat_model_setting(db, replacement)
        model.is_active = False
        model.is_default = False
        message = f"{model.display_name} 已停用。"
    else:
        model.is_active = True
        current_default = (
            db.query(ChatModel.id)
            .filter(ChatModel.provider == model.provider, ChatModel.is_default.is_(True))
            .first()
        )
        if current_default is None:
            set_default_chat_model(db, model)
            sync_default_chat_model_setting(db, model)
        message = f"{model.display_name} 已启用。"

    db.commit()
    return redirect_admin(message)


@router.post("/admin/chat-models/{model_id}/delete")
async def delete_chat_model(model_id: int, request: Request, db: Session = Depends(get_db)) -> RedirectResponse:
    admin = require_admin_or_redirect(request, db)
    if isinstance(admin, RedirectResponse):
        return admin

    data = await read_form(request)
    if not validate_csrf(request, data.get("csrf_token", "")):
        return redirect_admin("CSRF 校验失败，请刷新页面后重试。")

    model = db.get(ChatModel, model_id)
    if model is None:
        return redirect_admin("模型不存在或已被删除。")
    provider_models = db.query(ChatModel.id).filter(ChatModel.provider == model.provider).count()
    if provider_models <= 1:
        return redirect_admin("每个通道至少需要保留一个模型，无法删除最后一个。")

    if model.is_default:
        replacement = (
            db.query(ChatModel)
            .filter(
                ChatModel.provider == model.provider,
                ChatModel.is_active.is_(True),
                ChatModel.id != model.id,
            )
            .order_by(ChatModel.sort_order.asc(), ChatModel.id.asc())
            .first()
        )
        if replacement is None:
            return redirect_admin("请先启用另一个模型，再删除当前默认模型。")
        set_default_chat_model(db, replacement)
        sync_default_chat_model_setting(db, replacement)
    elif model.is_active:
        active_count = (
            db.query(ChatModel.id)
            .filter(ChatModel.provider == model.provider, ChatModel.is_active.is_(True))
            .count()
        )
        if active_count <= 1:
            return redirect_admin("每个通道至少需要保留一个启用的模型。")

    display_name = model.display_name
    db.delete(model)
    db.commit()
    return redirect_admin(f"{display_name} 已从模型目录删除。")


@router.post("/admin/users")
async def create_user(request: Request, db: Session = Depends(get_db)) -> RedirectResponse:
    admin = require_admin_or_redirect(request, db)
    if isinstance(admin, RedirectResponse):
        return admin

    data = await read_form(request)
    if not validate_csrf(request, data.get("csrf_token", "")):
        return redirect_admin("CSRF 校验失败，请刷新页面后重试。")

    name = data.get("name", "").strip()
    username = data.get("username", "").strip().lower()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "").strip()
    role = data.get("role", "member").strip()
    if not name or not username or not email or not password:
        return redirect_admin("姓名、用户名、邮箱和密码不能为空")
    if len(password) < 6:
        return redirect_admin("密码至少需要 6 位")
    if role not in {"admin", "member", "viewer"}:
        role = "member"
    existing = db.query(UserAccount).filter(or_(UserAccount.username == username, UserAccount.email == email)).first()
    if existing:
        return redirect_admin("用户名或邮箱已存在")
    db.add(
        UserAccount(
            username=username[:80],
            name=name[:120],
            email=email[:255],
            password_hash=hash_password(password),
            role=role,
        )
    )
    db.commit()
    return redirect_admin("用户已添加")


@router.post("/admin/users/{user_id}/toggle")
async def toggle_user(user_id: int, request: Request, db: Session = Depends(get_db)) -> RedirectResponse:
    admin = require_admin_or_redirect(request, db)
    if isinstance(admin, RedirectResponse):
        return admin

    data = await read_form(request)
    if not validate_csrf(request, data.get("csrf_token", "")):
        return redirect_admin("CSRF 校验失败，请刷新页面后重试。")

    user = db.get(UserAccount, user_id)
    if user:
        if user.id == admin.id and user.is_active:
            return redirect_admin("不能禁用当前登录的管理员账号。")
        user.is_active = not user.is_active
        db.commit()
    return redirect_admin("用户状态已更新")


@router.post("/admin/users/{user_id}/delete")
async def delete_user(user_id: int, request: Request, db: Session = Depends(get_db)) -> RedirectResponse:
    admin = require_admin_or_redirect(request, db)
    if isinstance(admin, RedirectResponse):
        return admin

    data = await read_form(request)
    if not validate_csrf(request, data.get("csrf_token", "")):
        return redirect_admin("CSRF 校验失败，请刷新页面后重试。")

    user = db.get(UserAccount, user_id)
    if user:
        if user.id == admin.id:
            return redirect_admin("不能删除当前登录的管理员账号。")
        db.delete(user)
        db.commit()
    return redirect_admin("用户已删除")
