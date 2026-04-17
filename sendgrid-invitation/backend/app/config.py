from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    sendgrid_api_key: str = ""
    from_email: str = ""
    from_name: str = ""


settings = Settings()
