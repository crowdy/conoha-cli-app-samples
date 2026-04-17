from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

from app.config import settings

app = FastAPI()


class InviteRequest(BaseModel):
    to_email: EmailStr
    to_name: str = ""
    message: str = ""


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/invite")
def invite(req: InviteRequest):
    to_name = req.to_name or req.to_email
    body = (
        f"{settings.from_name} からの招待\n"
        f"\n"
        f"{to_name} 様\n"
        f"\n"
        f"{settings.from_name} があなたをメンバーとして招待しています。\n"
    )
    if req.message:
        body += f"\n{req.message}\n"
    body += f"\n---\nこのメールは {settings.from_name} から送信されました。\n"

    message = Mail(
        from_email=(settings.from_email, settings.from_name),
        to_emails=req.to_email,
        subject=f"{settings.from_name} からの招待",
        plain_text_content=body,
    )

    try:
        sg = SendGridAPIClient(settings.sendgrid_api_key)
        response = sg.send(message)
        if response.status_code not in (200, 201, 202):
            raise HTTPException(status_code=502, detail="Failed to send email")
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=502, detail=str(e))

    return {"success": True}
