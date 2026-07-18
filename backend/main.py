import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database.init_db import init_db
from routes import account, admin, auth, chat, history, image
from services.job_worker import job_worker

load_dotenv()


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
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth.router)
app.include_router(account.router)
app.include_router(chat.router)
app.include_router(image.router)
app.include_router(history.router)
app.include_router(admin.router)
