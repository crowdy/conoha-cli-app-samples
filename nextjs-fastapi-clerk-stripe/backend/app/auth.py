import logging

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User

logger = logging.getLogger(__name__)

security = HTTPBearer()

_jwk_client: PyJWKClient | None = None


def get_jwk_client() -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        _jwk_client = PyJWKClient(settings.clerk_jwks_url, cache_keys=True)
    return _jwk_client


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = credentials.credentials
    try:
        jwk_client = get_jwk_client()
        signing_key = jwk_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
        )
    except jwt.PyJWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
        )

    clerk_user_id = payload.get("sub")
    if not clerk_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing sub claim",
        )

    result = await db.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    user = result.scalar_one_or_none()
    if not user:
        # Auto-create user if webhook hasn't fired yet
        from app.services.stripe_service import create_customer

        email = payload.get("email", "") or ""
        try:
            customer = create_customer(email=email, clerk_user_id=clerk_user_id)
            stripe_customer_id = customer.id
        except Exception:
            logger.exception("Failed to create Stripe customer for %s", clerk_user_id)
            stripe_customer_id = None
        user = User(
            clerk_user_id=clerk_user_id,
            stripe_customer_id=stripe_customer_id,
            email=email,
        )
        db.add(user)
        try:
            await db.commit()
            await db.refresh(user)
        except IntegrityError:
            # Race condition: webhook created the user concurrently
            await db.rollback()
            result = await db.execute(
                select(User).where(User.clerk_user_id == clerk_user_id)
            )
            user = result.scalar_one()
    return user
