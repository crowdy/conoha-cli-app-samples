import httpx
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

app = FastAPI()
templates = Jinja2Templates(directory="templates")

OLLAMA_URL = "http://ollama:11434"
MODEL = "tinyllama"


class ChatRequest(BaseModel):
    message: str


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/chat")
async def chat(req: ChatRequest):
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": MODEL, "prompt": req.message, "stream": False},
        )
        response.raise_for_status()
        data = response.json()
    return {"response": data.get("response", "")}


@app.get("/health")
async def health():
    return {"status": "ok"}
