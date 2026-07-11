from html import escape
from urllib.parse import parse_qs, quote

from fastapi import APIRouter, Depends, Request

from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy import desc, or_
from sqlalchemy.orm import Session

from database.models import UserAccount
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
from services.settings_service import (
    SETTING_GORK_API_KEY,
    SETTING_GORK_BASE_URL,
    SETTING_GORK_IMAGE_MODEL,
    SETTING_GORK_TEXT_MODEL,
    SETTING_OPENAI_API_KEY,
    SETTING_OPENAI_BASE_URL,
    SETTING_OPENAI_IMAGE_MODEL,
    SETTING_OPENAI_TEXT_MODEL,
    get_setting,
    mask_secret,
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
              <div class="hint">填写 sub2 或兼容 OpenAI SDK 的 Base URL，一般只填到 /v1。</div>
            </div>
            <div class="field">
              <label for="{prefix}_api_key">API Key</label>
              <input id="{prefix}_api_key" name="api_key" type="password" placeholder="留空则不覆盖现有 Key" />
              <div class="hint">当前状态：{escape(mask_secret(api_key))}</div>
            </div>
            <div class="field">
              <label for="{prefix}_text_model">聊天模型</label>
              <input id="{prefix}_text_model" name="text_model" value="{escape(text_model)}" placeholder="{escape(text_placeholder)}" />
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

    gork_base_url = get_setting(db, SETTING_GORK_BASE_URL, "")
    gork_api_key = get_setting(db, SETTING_GORK_API_KEY, "")
    gork_text_model = get_setting(db, SETTING_GORK_TEXT_MODEL, "")
    gork_image_model = get_setting(db, SETTING_GORK_IMAGE_MODEL, "")

    users = db.query(UserAccount).order_by(desc(UserAccount.created_at)).all()
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
    gork_card = render_provider_card(
        "Gork",
        "通过 sub2 中转的 Gork/Grok 兼容通道配置。前端选择 Gork 时会使用这里的 Key 和模型。",
        "gork",
        gork_base_url,
        gork_api_key,
        gork_text_model,
        gork_image_model,
        "https://你的-sub2-地址/v1",
        "grok-3-mini 或 sub2 映射模型名",
        "grok-2-image 或 sub2 映射模型名",
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
        .empty {{ display: grid; place-items: center; min-height: 180px; text-align: center; color: var(--muted); }}
        @media (max-width: 980px) {{
          .layout, .grid, .user-form-grid {{ grid-template-columns: 1fr; }}
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
            <a href="#users">用户管理</a>
            <a href="/docs">API Docs</a>
            <a href="/api/health">Health</a>
          </nav>
          <div class="safe-box">
            <strong>密钥安全</strong>

            <p>OpenAI 与 Gork API Key 都只保存在后端 SQLite 或环境变量中，前端不会读取。管理台已启用管理员会话鉴权与 CSRF 防护。</p>
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
            {gork_card}

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

    provider = data.get("provider", "openai").strip().lower()
    base_url = data.get("base_url", "").strip()
    api_key = data.get("api_key", "").strip()
    text_model = data.get("text_model", "").strip()
    image_model = data.get("image_model", "").strip()

    if provider == "gork":
        set_setting(db, SETTING_GORK_BASE_URL, base_url)
        set_setting(db, SETTING_GORK_TEXT_MODEL, text_model)
        set_setting(db, SETTING_GORK_IMAGE_MODEL, image_model)
        if api_key:
            set_setting(db, SETTING_GORK_API_KEY, api_key)
        db.commit()
        return redirect_admin("Gork 配置已保存")

    set_setting(db, SETTING_OPENAI_BASE_URL, base_url)
    set_setting(db, SETTING_OPENAI_TEXT_MODEL, text_model)
    set_setting(db, SETTING_OPENAI_IMAGE_MODEL, image_model)
    if api_key:
        set_setting(db, SETTING_OPENAI_API_KEY, api_key)
    db.commit()
    return redirect_admin("OpenAI 配置已保存")


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
