from fastapi import FastAPI

app = FastAPI(title="opencascade-fem")


@app.get("/health")
def health() -> dict:
    return {"ok": True}
