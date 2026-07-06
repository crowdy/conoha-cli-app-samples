from fastapi import APIRouter

from app.core import shapes as S

router = APIRouter()


@router.get("/shapes")
def list_shapes() -> list[dict]:
    return [
        {"kind": k, "defaults": S.defaults(k), "ranges": S.ranges(k)}
        for k in S.kinds()
    ]
