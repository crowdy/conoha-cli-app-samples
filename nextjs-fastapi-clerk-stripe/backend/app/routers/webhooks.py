from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from svix.webhooks import Webhook, WebhookVerificationError

from app.config import settings
from app.database import get_db
from app.models import Subscription, User
from app.services.stripe_service import construct_webhook_event, create_customer, get_plan_from_price

router = APIRouter()


@router.post("/api/webhooks/clerk")
async def clerk_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    body = await request.body()
    headers = {
        "svix-id": request.headers.get("svix-id", ""),
        "svix-timestamp": request.headers.get("svix-timestamp", ""),
        "svix-signature": request.headers.get("svix-signature", ""),
    }

    try:
        wh = Webhook(settings.clerk_webhook_secret)
        event = wh.verify(body, headers)
    except WebhookVerificationError:
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    if event["type"] == "user.created":
        data = event["data"]
        clerk_user_id = data["id"]
        email = ""
        if data.get("email_addresses"):
            email = data["email_addresses"][0].get("email_address", "")

        existing = await db.execute(
            select(User).where(User.clerk_user_id == clerk_user_id)
        )
        if existing.scalar_one_or_none():
            return {"status": "already exists"}

        customer = create_customer(email=email, clerk_user_id=clerk_user_id)

        user = User(
            clerk_user_id=clerk_user_id,
            stripe_customer_id=customer.id,
            email=email,
        )
        db.add(user)
        await db.commit()

    return {"status": "ok"}


@router.post("/api/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(alias="stripe-signature"),
    db: AsyncSession = Depends(get_db),
):
    payload = await request.body()

    try:
        event = construct_webhook_event(payload, stripe_signature)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        customer_id = session["customer"]
        subscription_id = session["subscription"]

        result = await db.execute(
            select(User).where(User.stripe_customer_id == customer_id)
        )
        user = result.scalar_one_or_none()
        if not user:
            return {"status": "user not found"}

        await _fetch_and_save_subscription(db, user, subscription_id)

    elif event["type"] in (
        "customer.subscription.updated",
        "customer.subscription.deleted",
    ):
        sub_data = event["data"]["object"]
        subscription_id = sub_data["id"]

        result = await db.execute(
            select(Subscription).where(
                Subscription.stripe_subscription_id == subscription_id
            )
        )
        existing_sub = result.scalar_one_or_none()
        if existing_sub:
            price_id = sub_data["items"]["data"][0]["price"]["id"]
            existing_sub.stripe_price_id = price_id
            existing_sub.plan = get_plan_from_price(price_id)
            existing_sub.status = sub_data["status"]
            if sub_data.get("current_period_end"):
                existing_sub.current_period_end = datetime.fromtimestamp(
                    sub_data["current_period_end"], tz=timezone.utc
                )
            await db.commit()

    return {"status": "ok"}


async def _fetch_and_save_subscription(
    db: AsyncSession, user: User, subscription_id: str
) -> Subscription:
    import stripe

    # Idempotency: skip if subscription already saved (e.g. webhook retry)
    result = await db.execute(
        select(Subscription).where(
            Subscription.stripe_subscription_id == subscription_id
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        return existing

    sub_data = stripe.Subscription.retrieve(subscription_id)
    price_id = sub_data["items"]["data"][0]["price"]["id"]

    current_period_end = None
    if sub_data.get("current_period_end"):
        current_period_end = datetime.fromtimestamp(
            sub_data["current_period_end"], tz=timezone.utc
        )

    sub = Subscription(
        user_id=user.id,
        stripe_subscription_id=subscription_id,
        stripe_price_id=price_id,
        plan=get_plan_from_price(price_id),
        status=sub_data["status"],
        current_period_end=current_period_end,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return sub
