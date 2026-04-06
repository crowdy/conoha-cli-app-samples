"""
Login/Consent provider and protected API for Ory Hydra.

This app serves three roles:
1. Login provider  - handles Hydra's login challenges
2. Consent provider - handles Hydra's consent challenges
3. Protected API   - validates OAuth2 tokens via Hydra's introspection endpoint
"""

import os

import httpx
from fastapi import FastAPI, Form, Header, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

app = FastAPI()
templates = Jinja2Templates(directory="templates")

HYDRA_ADMIN_URL = os.environ.get("HYDRA_ADMIN_URL", "http://hydra:4445/admin")


# --- Login provider ---


@app.get("/login", response_class=HTMLResponse)
async def login_get(request: Request, login_challenge: str):
    """Show login form or skip if session exists."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{HYDRA_ADMIN_URL}/oauth2/auth/requests/login",
            params={"login_challenge": login_challenge},
        )
        data = resp.json()

    # Skip login if user already authenticated in this session
    if data.get("skip"):
        async with httpx.AsyncClient() as client:
            resp = await client.put(
                f"{HYDRA_ADMIN_URL}/oauth2/auth/requests/login/accept",
                params={"login_challenge": login_challenge},
                json={"subject": data["subject"]},
            )
            body = resp.json()
        return RedirectResponse(body["redirect_to"], status_code=302)

    return templates.TemplateResponse(
        "login.html",
        {"request": request, "challenge": login_challenge},
    )


@app.post("/login")
async def login_post(login_challenge: str = Form(...), username: str = Form(...), password: str = Form(...)):
    """Accept or reject the login challenge."""
    # Demo: accept any login where username == password
    if username != password:
        return HTMLResponse("<h1>Login failed</h1><p>Hint: username must equal password</p>", status_code=401)

    async with httpx.AsyncClient() as client:
        resp = await client.put(
            f"{HYDRA_ADMIN_URL}/oauth2/auth/requests/login/accept",
            params={"login_challenge": login_challenge},
            json={
                "subject": username,
                "remember": True,
                "remember_for": 3600,
            },
        )
        body = resp.json()

    return RedirectResponse(body["redirect_to"], status_code=302)


# --- Consent provider ---


@app.get("/consent", response_class=HTMLResponse)
async def consent_get(request: Request, consent_challenge: str):
    """Show consent form or auto-approve for trusted clients."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{HYDRA_ADMIN_URL}/oauth2/auth/requests/consent",
            params={"consent_challenge": consent_challenge},
        )
        data = resp.json()

    # Auto-approve if user already consented or client is trusted
    if data.get("skip"):
        async with httpx.AsyncClient() as client:
            resp = await client.put(
                f"{HYDRA_ADMIN_URL}/oauth2/auth/requests/consent/accept",
                params={"consent_challenge": consent_challenge},
                json={
                    "grant_scope": data.get("requested_scope", []),
                    "grant_access_token_audience": data.get("requested_access_token_audience", []),
                },
            )
            body = resp.json()
        return RedirectResponse(body["redirect_to"], status_code=302)

    return templates.TemplateResponse(
        "consent.html",
        {
            "request": request,
            "challenge": consent_challenge,
            "scopes": data.get("requested_scope", []),
            "client_name": data.get("client", {}).get("client_name", data.get("client", {}).get("client_id", "unknown")),
        },
    )


@app.post("/consent")
async def consent_post(consent_challenge: str = Form(...), grant_scope: list[str] = Form(default=[])):
    """Accept the consent challenge with selected scopes."""
    async with httpx.AsyncClient() as client:
        resp = await client.put(
            f"{HYDRA_ADMIN_URL}/oauth2/auth/requests/consent/accept",
            params={"consent_challenge": consent_challenge},
            json={
                "grant_scope": grant_scope,
                "grant_access_token_audience": [],
                "remember": True,
                "remember_for": 3600,
            },
        )
        body = resp.json()

    return RedirectResponse(body["redirect_to"], status_code=302)


# --- Protected API ---


@app.get("/api/me")
async def api_me(authorization: str = Header(default="")):
    """Protected endpoint — validates the Bearer token via Hydra introspection."""
    token = authorization.replace("Bearer ", "").strip()
    if not token:
        return JSONResponse({"error": "missing authorization header"}, status_code=401)

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{HYDRA_ADMIN_URL}/oauth2/introspect",
            data={"token": token},
        )
        data = resp.json()

    if not data.get("active"):
        return JSONResponse({"error": "invalid or expired token"}, status_code=401)

    return {
        "subject": data.get("sub"),
        "scope": data.get("scope"),
        "client_id": data.get("client_id"),
        "token_type": data.get("token_type"),
    }


@app.get("/api/public")
async def api_public():
    """Public endpoint — no authentication required."""
    return {"message": "This is a public endpoint. No token needed."}


@app.get("/callback")
async def callback(request: Request, code: str = "", error: str = "", error_description: str = "", state: str = ""):
    """OAuth2 callback — receives the authorization code or error."""
    if error:
        return JSONResponse({"error": error, "error_description": error_description}, status_code=400)
    return {"authorization_code": code, "state": state, "hint": "Exchange this code for a token via POST /oauth2/token on Hydra"}


@app.get("/health")
async def health():
    return {"status": "ok"}
