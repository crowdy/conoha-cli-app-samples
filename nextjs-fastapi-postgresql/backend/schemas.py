from datetime import datetime

from pydantic import BaseModel


class PostCreate(BaseModel):
    title: str
    body: str


class PostUpdate(BaseModel):
    title: str
    body: str


class PostResponse(BaseModel):
    id: int
    title: str
    body: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
