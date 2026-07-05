from html import escape
from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import desc, or_
from sqlalchemy.orm import Session

from database.models import UserAccount
from database.session import get_db
from services.settings_service import (
    SETTING_OPENAI_API_KEY,
    SETTING_OPENAI_BASE_URL,
    SETTING_OPENAI_IMAGE_MODEL,
    SETTING_OPENAI_TEXT_MODEL,
    get_setting,
    mask_secret,
    set_setting,
)
from services.auth_service import hash_password

router = APIRouter(tags=["admin"])


async def read_form(request: Request) -> dict[str, str]:
    body = (await request.body()).decode("utf-8")
    parsed = parse_qs(body, keep_blank_values=True)
    return {key: values[-1] if values else "" for key, values in parsed.items()}


def redirect_admin(message: str = "") -> RedirectResponse:
    suffix = f"?message={message}" if message else ""
    return RedirectResponse(url=f"/admin{suffix}", status_code=303)


def render_users(users: list[UserAccount]) -> str:
    if not users:
        return """
        <div class="empty">
          <div class="empty-icon">◎</div>
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
                  <button class="ghost" type="submit">{toggle_text}</button>
                </form>
                <form method="post" action="/admin/users/{user.id}/delete">
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


@router.get("/admin", response_class=HTMLResponse)
def admin_page(request: Request, db: Session = Depends(get_db)) -> HTMLResponse:
    base_url = get_setting(db, SETTING_OPENAI_BASE_URL, "")
    api_key = get_setting(db, SETTING_OPENAI_API_KEY, "")
    text_model = get_setting(db, SETTING_OPENAI_TEXT_MODEL, "")
    image_model = get_setting(db, SETTING_OPENAI_IMAGE_MODEL, "")
    env_hint = "后台已配置" if api_key else "将回退到 .env 中的 OPENAI_API_KEY"
    users = db.query(UserAccount).order_by(desc(UserAccount.created_at)).all()
    message = request.query_params.get("message", "")

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
          --card: rgba(255,255,255,.84);
          --text: #1a1a1a;
          --muted: #808080;
          --line: #e3e7f0;
          --primary: #5b7cff;
          --primary-hover: #466bff;
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
        a {{ color: inherit; text-decoration: none; }}
        .layout {{ display: grid; min-height: 100vh; grid-template-columns: 280px 1fr; }}
        .sidebar {{
          position: sticky;
          top: 0;
          height: 100vh;
          padding: 28px 22px;
          border-right: 1px solid var(--line);
          background: rgba(255,255,255,.56);
          backdrop-filter: blur(24px);
        }}
        .brand {{ display: flex; align-items: center; gap: 12px; margin-bottom: 44px; }}
        .logo {{
          width: 44px; height: 44px; border-radius: 18px;
          display: grid; place-items: center;
          background: #1a1a1a; color: #fff; box-shadow: var(--shadow);
        }}
        .brand strong {{ display: block; font-size: 18px; }}
        .brand span {{ color: var(--muted); font-size: 12px; }}
        .nav {{ display: grid; gap: 10px; }}
        .nav-item {{
          display: flex; align-items: center; gap: 10px;
          height: 46px; padding: 0 14px; border-radius: 16px;
          color: #4b5563; font-weight: 650; font-size: 14px;
        }}
        .nav-item.active {{
          color: #fff;
          background: linear-gradient(135deg, var(--primary), var(--accent));
          box-shadow: 0 16px 40px rgba(91,124,255,.25);
        }}
        .safe-box {{
          position: absolute; left: 22px; right: 22px; bottom: 24px;
          padding: 16px; border: 1px solid var(--line); border-radius: 20px;
          background: rgba(246,247,251,.72);
        }}
        .safe-box strong {{ font-size: 14px; }}
        .safe-box p {{ margin: 8px 0 0; color: var(--muted); font-size: 12px; line-height: 1.7; }}
        main {{ padding: 28px 36px 48px; min-width: 0; }}
        .topbar {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }}
        .eyebrow {{ margin: 0 0 6px; font-size: 12px; letter-spacing: .22em; font-weight: 800; color: #4b5563; }}
        h1 {{ margin: 0; font-size: 32px; letter-spacing: 0; }}
        .badge {{
          display: inline-flex; align-items: center; height: 38px; padding: 0 14px;
          border: 1px solid var(--line); border-radius: 999px; background: rgba(255,255,255,.66);
          color: #4b5563; font-size: 13px; font-weight: 650;
        }}
        .grid {{ display: grid; grid-template-columns: minmax(360px, .78fr) 1.22fr; gap: 22px; align-items: start; }}
        .card {{
          border: 1px solid var(--line);
          border-radius: 28px;
          background: var(--card);
          box-shadow: var(--shadow);
          backdrop-filter: blur(24px);
          overflow: hidden;
          animation: fade .35s ease-out both;
        }}
        .card-head {{ padding: 22px 24px 0; }}
        .card-head h2 {{ margin: 0; font-size: 19px; }}
        .card-head p {{ margin: 8px 0 0; color: var(--muted); font-size: 14px; line-height: 1.7; }}
        .card-body {{ padding: 22px 24px 24px; }}
        label {{ display: block; margin-bottom: 8px; font-size: 13px; font-weight: 700; }}
        input, select {{
          width: 100%;
          height: 46px;
          border: 1px solid var(--line);
          border-radius: 16px;
          padding: 0 14px;
          outline: none;
          background: rgba(255,255,255,.78);
          color: var(--text);
          transition: border .2s, box-shadow .2s;
        }}
        input:focus, select:focus {{ border-color: var(--primary); box-shadow: 0 0 0 4px rgba(91,124,255,.12); }}
        .field {{ margin-bottom: 16px; }}
        .hint {{ margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 1.6; }}
        .button {{
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          width: 100%; height: 46px; border: 0; border-radius: 16px;
          color: #fff; font-weight: 800; cursor: pointer;
          background: linear-gradient(135deg, var(--primary), var(--accent));
          box-shadow: 0 16px 38px rgba(91,124,255,.25);
          transition: transform .18s, background .18s;
        }}
        .button:hover {{ transform: translateY(-1px) scale(1.01); background: var(--primary-hover); }}
        .stats {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 22px; }}
        .stat {{ padding: 18px; border: 1px solid var(--line); border-radius: 22px; background: rgba(255,255,255,.68); }}
        .stat span {{ color: var(--muted); font-size: 12px; }}
        .stat strong {{ display: block; margin-top: 8px; font-size: 24px; }}
        .table-wrap {{ overflow-x: auto; }}
        table {{ width: 100%; border-collapse: collapse; }}
        th, td {{ padding: 15px 16px; border-bottom: 1px solid var(--line); text-align: left; font-size: 14px; }}
        th {{ color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }}
        .user-cell {{ display: flex; align-items: center; gap: 12px; }}
        .avatar {{
          width: 40px; height: 40px; border-radius: 16px; display: grid; place-items: center;
          color: #fff; font-weight: 850; background: linear-gradient(135deg, var(--primary), var(--accent));
        }}
        .user-cell span {{ display: block; margin-top: 2px; color: var(--muted); font-size: 12px; }}
        .pill {{ display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 800; }}
        .pill.ok {{ color: #047857; background: #d1fae5; }}
        .pill.muted {{ color: #6b7280; background: #f3f4f6; }}
        .pill.role {{ color: #4f46e5; background: #eef2ff; }}
        .actions {{ display: flex; gap: 8px; align-items: center; }}
        .actions form {{ margin: 0; }}
        .ghost, .danger {{
          height: 34px; border-radius: 12px; padding: 0 12px; cursor: pointer;
          border: 1px solid var(--line); background: #fff; font-weight: 750;
        }}
        .danger {{ color: var(--danger); }}
        .message {{
          margin-bottom: 16px;
          border: 1px solid rgba(91,124,255,.22);
          border-radius: 18px;
          background: rgba(91,124,255,.08);
          padding: 12px 14px;
          color: #3854d8;
          font-size: 14px;
          font-weight: 700;
        }}
        .empty {{ display: grid; place-items: center; min-height: 260px; text-align: center; color: var(--muted); }}
        .empty-icon {{ width: 54px; height: 54px; display: grid; place-items: center; border-radius: 18px; margin-bottom: 12px; background: rgba(91,124,255,.1); color: var(--primary); font-size: 24px; }}
        .empty h3 {{ margin: 0; color: var(--text); }}
        .empty p {{ margin: 8px 0 0; font-size: 14px; }}
        @keyframes fade {{ from {{ opacity: 0; transform: translateY(10px); }} to {{ opacity: 1; transform: translateY(0); }} }}
        @media (max-width: 980px) {{
          .layout {{ grid-template-columns: 1fr; }}
          .sidebar {{ position: relative; height: auto; }}
          .safe-box {{ position: static; margin-top: 18px; }}
          main {{ padding: 22px 16px 36px; }}
          .grid, .stats {{ grid-template-columns: 1fr; }}
          .topbar {{ align-items: flex-start; gap: 14px; flex-direction: column; }}
        }}
      </style>
    </head>
    <body>
      <div class="layout">
        <aside class="sidebar">
          <a class="brand" href="/admin">
            <div class="logo">✦</div>
            <div><strong>AIWeb Admin</strong><span>Backend Console</span></div>
          </a>
          <nav class="nav">
            <a class="nav-item active" href="/admin">⚙ API 配置</a>
            <a class="nav-item" href="#users">👤 用户管理</a>
            <a class="nav-item" href="/docs">⌁ API Docs</a>
            <a class="nav-item" href="/api/health">◇ Health</a>
          </nav>
          <div class="safe-box">
            <strong>密钥安全</strong>
            <p>API Key 只保存在后端 SQLite 或环境变量中，前端项目不会读取。</p>
          </div>
        </aside>

        <main>
          <div class="topbar">
            <div>
              <p class="eyebrow">AIWEB BACKEND</p>
              <h1>后端管理控制台</h1>
            </div>
            <div class="badge">FastAPI · SQLite · OpenAI</div>
          </div>

          {f'<div class="message">{escape(message)}</div>' if message else ''}

          <div class="stats">
            <div class="stat"><span>API 地址</span><strong>{escape(base_url or "默认")}</strong></div>
            <div class="stat"><span>API Key</span><strong>{escape(mask_secret(api_key))}</strong></div>
            <div class="stat"><span>用户数</span><strong>{len(users)}</strong></div>
          </div>

          <div class="grid">
            <section class="card">
              <div class="card-head">
                <h2>OpenAI API 设置</h2>
                <p>配置 OpenAI 或兼容服务的 Base URL 与 API Key。留空 API Key 时会使用环境变量。</p>
              </div>
              <div class="card-body">
                <form method="post" action="/admin/settings">
                  <div class="field">
                    <label for="base_url">API 地址</label>
                    <input id="base_url" name="base_url" value="{escape(base_url)}" placeholder="https://api.openai.com/v1" />
                    <div class="hint">用于 OpenAI SDK 的 base_url，可填写兼容接口地址。</div>
                  </div>
                  <div class="field">
                    <label for="api_key">API Key</label>
                    <input id="api_key" name="api_key" type="password" placeholder="不修改则留空" />
                    <div class="hint">当前状态：{escape(env_hint)}。提交空值不会覆盖已有 Key。</div>
                  </div>
                  <div class="field">
                    <label for="text_model">文字模型</label>
                    <input id="text_model" name="text_model" value="{escape(text_model)}" placeholder="例如：gpt-4o-mini 或你的账号支持的模型" />
                    <div class="hint">留空时使用 .env 中的 OPENAI_TEXT_MODEL。</div>
                  </div>
                  <div class="field">
                    <label for="image_model">生图模型</label>
                    <input id="image_model" name="image_model" value="{escape(image_model)}" placeholder="例如：gpt-image-1" />
                    <div class="hint">留空时使用 .env 中的 OPENAI_IMAGE_MODEL。</div>
                  </div>
                  <button class="button" type="submit">保存 API 设置</button>
                </form>
              </div>
            </section>

            <section class="card" id="users">
              <div class="card-head">
                <h2>用户管理</h2>
                <p>添加、启用、禁用或删除后台用户记录。后续可以接入登录鉴权和权限控制。</p>
              </div>
              <div class="card-body">
                <form method="post" action="/admin/users">
                  <div class="grid" style="grid-template-columns: 1fr 1fr 1fr 160px; gap: 12px;">
                    <div class="field">
                      <label for="name">姓名</label>
                      <input id="name" name="name" required maxlength="120" placeholder="例如：Admin" />
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
              {render_users(users)}
            </section>
          </div>
        </main>
      </div>
    </body>
    </html>
    """
    return HTMLResponse(html)


@router.post("/admin/settings")
async def update_settings(request: Request, db: Session = Depends(get_db)) -> RedirectResponse:
    data = await read_form(request)
    base_url = data.get("base_url", "").strip()
    api_key = data.get("api_key", "").strip()
    text_model = data.get("text_model", "").strip()
    image_model = data.get("image_model", "").strip()
    set_setting(db, SETTING_OPENAI_BASE_URL, base_url)
    set_setting(db, SETTING_OPENAI_TEXT_MODEL, text_model)
    set_setting(db, SETTING_OPENAI_IMAGE_MODEL, image_model)
    if api_key:
        set_setting(db, SETTING_OPENAI_API_KEY, api_key)
    db.commit()
    return redirect_admin("API 设置已保存")


@router.post("/admin/users")
async def create_user(request: Request, db: Session = Depends(get_db)) -> RedirectResponse:
    data = await read_form(request)
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
    db.add(UserAccount(username=username[:80], name=name[:120], email=email[:255], password_hash=hash_password(password), role=role))
    db.commit()
    return redirect_admin("用户已添加")


@router.post("/admin/users/{user_id}/toggle")
def toggle_user(user_id: int, db: Session = Depends(get_db)) -> RedirectResponse:
    user = db.get(UserAccount, user_id)
    if user:
        user.is_active = not user.is_active
        db.commit()
    return redirect_admin("用户状态已更新")


@router.post("/admin/users/{user_id}/delete")
def delete_user(user_id: int, db: Session = Depends(get_db)) -> RedirectResponse:
    user = db.get(UserAccount, user_id)
    if user:
        db.delete(user)
        db.commit()
    return redirect_admin("用户已删除")
