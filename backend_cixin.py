"""慈心黑白棋后端（独立模块，端口 8005，不复用 ghost/baotu 等后端能力）。

启动：uvicorn backend_cixin:app --port 8005 --reload
路由：
  GET  /health                      健康检查
  GET  /api/othello/status         镜像 mhxyai 状态接口（棋盘维度/说明）
  POST /api/othello/move           求解白棋最优落点
        body: {board[64], aiPlayer, timeMs, maxDepth, boxes?, strategy?}
        ->   {action, notation, legal_moves, coordinate, coordinate_label, board_str}
        boxes    - 检测到的宝箱格 index 列表（最多 3 个）
        strategy - "winFirst"(默认) / "boxFirst"(优先抢宝箱) / "taskFirst"(速刷：优先落地刷任务的地图)
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.othello.engine import (
    BLACK,
    WHITE,
    index_to_notation,
    initial_board,
)
from backend.othello.solver import solve
from backend.othello.coordinate_map import get_coordinate, coordinate_label

app = FastAPI(title="mhxy-helper 慈心后端")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class MoveRequest(BaseModel):
    board: list[int]
    aiPlayer: int = WHITE
    timeMs: int = 1000
    maxDepth: int = 6
    boxes: list[int] | None = None
    strategy: str = "winFirst"


@app.get("/health")
def health():
    return {"status": "ok", "module": "cixin-othello", "port": 8005}


@app.get("/api/othello/status")
def othello_status():
    b = initial_board()
    return {
        "size": 8,
        "initial_board": b,
        "note": "标准 Reversi；board 长度 64，1=黑/-1=白/0=空，index=row*8+col",
    }


@app.post("/api/othello/move")
def othello_move(req: MoveRequest):
    if len(req.board) != 64 or any(v not in (BLACK, WHITE, 0) for v in req.board):
        raise HTTPException(status_code=400, detail="board 必须为长度 64、元素∈{-1,0,1}")
    # 校验 boxes：长度 <= 3，每个元素 ∈ [0,64)，对应位置必须为空
    boxes = req.boxes or []
    if len(boxes) > 3:
        raise HTTPException(status_code=400, detail="boxes 最多 3 个")
    for b in boxes:
        if not isinstance(b, int) or b < 0 or b >= 64:
            raise HTTPException(status_code=400, detail=f"boxes 索引越界: {b}")
        if req.board[b] != 0:
            raise HTTPException(status_code=400, detail=f"boxes[{b}] 对应位置非空")
    try:
        result = solve(
            req.board,
            ai_player=req.aiPlayer,
            time_ms=req.timeMs,
            max_depth=req.maxDepth,
            boxes=boxes,
            strategy=req.strategy,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    action = result["action"]
    coord = get_coordinate(action) if action is not None else None
    return {
        "action": action,
        "notation": index_to_notation(action) if action is not None else "PASS",
        "legal_moves": result["legal_moves"],
        "coordinate": coord,
        "coordinate_label": coordinate_label(coord),
        "board_str": "".join(
            "." if v == 0 else ("X" if v == BLACK else "O") for v in req.board
        ),
        "strategy": req.strategy,
        "boxes": boxes,
    }
