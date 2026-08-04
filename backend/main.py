import os
import logging
import re
import time
import uuid
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from database.init_db import init_db
from routes import account, admin, arena, auth, chat, history, image, template_hub, workflow_runtime
from services.job_worker import job_worker

logger = logging.getLogger("uvicorn.error")
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,80}$")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    job_worker.start()
    try:
        yield
    finally:
        job_worker.stop(wait=False)


app = FastAPI(title="AIWeb API", version="1.0.0", lifespan=lifespan)

frontend_origins = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGIN",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+):3000$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Session-Id", "X-Request-ID", "X-Response-Time"],
)


@app.middleware("http")
async def request_observability(request, call_next):
    supplied_request_id = request.headers.get("X-Request-ID", "").strip()
    request_id = supplied_request_id if REQUEST_ID_PATTERN.fullmatch(supplied_request_id) else uuid.uuid4().hex
    request.state.request_id = request_id
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("request_failed request_id=%s method=%s path=%s", request_id, request.method, request.url.path)
        raise

    duration_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Response-Time"] = f"{duration_ms:.1f}ms"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    logger.info(
        "request_complete request_id=%s method=%s path=%s status=%s duration_ms=%.1f",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth.router)
app.include_router(account.router)
app.include_router(chat.router)
app.include_router(image.router)
app.include_router(history.router)
app.include_router(arena.router)
app.include_router(template_hub.router)
app.include_router(workflow_runtime.router)
app.include_router(admin.router)
