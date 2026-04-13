import stripe

from app.config import settings

stripe.api_key = settings.stripe_secret_key

PRICE_TO_PLAN: dict[str, str] = {}


def init_price_to_plan() -> None:
    if settings.stripe_pro_price_id:
        PRICE_TO_PLAN[settings.stripe_pro_price_id] = "pro"
    if settings.stripe_enterprise_price_id:
        PRICE_TO_PLAN[settings.stripe_enterprise_price_id] = "enterprise"


def create_customer(email: str, clerk_user_id: str) -> stripe.Customer:
    return stripe.Customer.create(
        email=email,
        metadata={"clerk_user_id": clerk_user_id},
    )


def create_checkout_session(
    customer_id: str,
    price_id: str,
    success_url: str,
    cancel_url: str,
) -> stripe.checkout.Session:
    return stripe.checkout.Session.create(
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=success_url,
        cancel_url=cancel_url,
        locale="ja",
    )


def create_portal_session(customer_id: str, return_url: str) -> stripe.billing_portal.Session:
    return stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=return_url,
    )


def construct_webhook_event(payload: bytes, sig_header: str) -> stripe.Event:
    return stripe.Webhook.construct_event(
        payload, sig_header, settings.stripe_webhook_secret
    )


def get_plan_from_price(price_id: str) -> str:
    return PRICE_TO_PLAN.get(price_id, "unknown")
