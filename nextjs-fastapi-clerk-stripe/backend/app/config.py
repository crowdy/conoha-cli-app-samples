from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://appuser:apppass@localhost:5432/appdb"
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_pro_price_id: str = ""
    stripe_enterprise_price_id: str = ""
    clerk_webhook_secret: str = ""
    clerk_jwks_url: str = ""


settings = Settings()
