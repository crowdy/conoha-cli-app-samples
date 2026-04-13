from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user
from app.config import settings
from app.models import User
from app.services.stripe_service import create_checkout_session, create_portal_session

PLAN_TO_PRICE = {
    "pro": lambda: settings.stripe_pro_price_id,
    "enterprise": lambda: settings.stripe_enterprise_price_id,
}

router = APIRouter()


class CheckoutRequest(BaseModel):
    price_id: str
    success_url: str
    cancel_url: str


class PortalRequest(BaseModel):
    return_url: str


@router.post("/api/checkout")
async def checkout(
    body: CheckoutRequest,
    user: User = Depends(get_current_user),
):
    if not user.stripe_customer_id:
        raise HTTPException(status_code=400, detail="Stripe customer not found")

    # Resolve plan name to actual Stripe Price ID
    price_id = body.price_id
    if price_id in PLAN_TO_PRICE:
        price_id = PLAN_TO_PRICE[price_id]()
    if not price_id:
        raise HTTPException(status_code=400, detail="Invalid price_id")

    session = create_checkout_session(
        customer_id=user.stripe_customer_id,
        price_id=price_id,
        success_url=body.success_url,
        cancel_url=body.cancel_url,
    )
    return {"url": session.url}


@router.post("/api/portal")
async def portal(
    body: PortalRequest,
    user: User = Depends(get_current_user),
):
    if not user.stripe_customer_id:
        raise HTTPException(status_code=400, detail="Stripe customer not found")

    session = create_portal_session(
        customer_id=user.stripe_customer_id,
        return_url=body.return_url,
    )
    return {"url": session.url}
