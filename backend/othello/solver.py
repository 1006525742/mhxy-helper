"""Othello AI 求解器 —— alpha-beta 剪枝 + 位置权重评估 + 残局精确穷举。

对外接口：
    solve(board, ai_player=-1, time_ms=1000, max_depth=6, boxes=None, strategy='winFirst')
        -> {"action": int, "legal_moves": [int, ...]}

设计要点：
- 迭代加深（depth 1..max_depth），每完成一层记录当前最优；
  超时(time_ms)则保留已完成层的最优结果，保证总能返回。
- 残局（空格 <= ENDGAME_EMPTIES）切换到"搜到终局 + 精确子差"评估，
  比启发式更准，且不依赖权重表。
- 评估函数：我方视角下 位置权重和 + 少量行动力(mobility)加权，
  让求解器既重位置又避免走进"子多但死"的局。
- 宝箱加成 (strategy='boxFirst' 时)：每持有一个宝箱 +BOX_BONUS，
  强信号鼓励先抢宝箱（实机校验：3 宝箱时最大加成 ≈ 一个好角 + 一些）。
- 速刷加成 (strategy='taskFirst' 时)：落子在「可落地直接刷任务」的地图
  （长寿村/朱紫国/傲来国）上加 TASK_BONUS，鼓励优先前往这些点。
"""

import time

from .engine import (
    BLACK,
    WHITE,
    EMPTY,
    legal_moves,
    apply_move,
    count_pieces,
)
from .weights import WEIGHTS
from .coordinate_map import get_coordinate

ENDGAME_EMPTIES = 12  # 空格数 <= 此值视为残局，精确搜索到终局
INF = float("inf")
BOX_BONUS = 60.0  # boxFirst 策略下，每持 1 个宝箱的额外分
# taskFirst 速刷加成：足够大以压过普通位置权重，使「落在任务地图」在评估中稳占上风
# （用户要求长寿村/朱紫国/傲来国 权重最高，速刷模式即优先前往这些点）
TASK_BONUS = 800.0  # taskFirst 速刷加成：落点在速刷地图（长寿村/朱紫国/傲来国）的这手额外分（根级偏好）

# 速刷模式优先地图：落地即可刷任务（用户指定）
TASK_PRIORITY_MAPS = frozenset({"长寿村", "朱紫国", "傲来国"})

# 预构建 index -> 地图名 映射，避免评估时反复查表
INDEX_MAPNAME: dict[int, str] = {}
for _i in range(64):
    _c = get_coordinate(_i)
    if _c:
        INDEX_MAPNAME[_i] = _c["mapName"]


class _Timeout(Exception):
    pass


def _evaluate(
    board: list[int],
    player: int,
    boxes: list[int] | None = None,
    strategy: str = "winFirst",
) -> float:
    """叶子节点启发式评估（player 视角，越大越好）。"""
    score = 0.0
    for i, v in enumerate(board):
        if v == player:
            score += WEIGHTS[i]
        elif v == -player:
            score -= WEIGHTS[i]
    # 行动力：能走的步数差，轻微加权（避免被堵死）
    my_moves = len(legal_moves(board, player))
    opp_moves = len(legal_moves(board, -player))
    score += 1.5 * (my_moves - opp_moves)
    # 宝箱加成：策略为 boxFirst 时，按当前持有宝箱数加权
    if boxes:
        for b in boxes:
            if board[b] == player:
                score += BOX_BONUS
            elif board[b] == -player:
                score -= BOX_BONUS
    return score


def _exact_diff(board: list[int], player: int) -> int:
    """终局精确子差（player 视角）。"""
    c = count_pieces(board)
    if player == BLACK:
        return c["black"] - c["white"]
    return c["white"] - c["black"]


def _alphabeta(board, player, current, depth, alpha, beta, deadline, boxes, strategy):
    if time.time() * 1000 > deadline:
        raise _Timeout

    moves = legal_moves(board, current)
    if not moves:
        # 当前方无步可走
        if not legal_moves(board, -current):
            # 双方都无步 -> 终局，返回精确子差
            return float(_exact_diff(board, player))
        # 跳过（pass）给对手，不消耗深度
        return _alphabeta(board, player, -current, depth, alpha, beta, deadline, boxes, strategy)

    empties = board.count(EMPTY)
    # 残局：忽略深度限制，搜到终局用精确子差
    if empties <= ENDGAME_EMPTIES:
        depth = INF  # 一路搜到底
    elif depth <= 0:
        return _evaluate(board, player, boxes, strategy)

    maximizing = current == player
    best = -INF if maximizing else INF
    # 走法排序：给剪枝加速。
    # 速刷模式额外优先「落点在速刷地图」的步，使搜索整体偏向优先地图。
    if strategy == "taskFirst":
        moves.sort(
            key=lambda m: (
                0 if INDEX_MAPNAME.get(m["index"]) in TASK_PRIORITY_MAPS else 1,
                -WEIGHTS[m["index"]],
            )
        )
    else:
        moves.sort(key=lambda m: WEIGHTS[m["index"]], reverse=maximizing)
    for m in moves:
        nb = apply_move(board, m["index"], current)
        val = _alphabeta(nb, player, -current, depth - 1, alpha, beta, deadline, boxes, strategy)
        if maximizing:
            if val > best:
                best = val
            if best > alpha:
                alpha = best
        else:
            if val < best:
                best = val
            if best < beta:
                beta = best
        if beta <= alpha:
            break  # 剪枝
    return best


def solve(
    board: list[int],
    ai_player: int = WHITE,
    time_ms: int = 1000,
    max_depth: int = 6,
    boxes: list[int] | None = None,
    strategy: str = "winFirst",
) -> dict:
    """给定棋盘，求 ai_player 的最优落点。

    返回：
        {"action": int|None, "legal_moves": [int, ...]}
    action 为最优落点下标；无合法步时 action=None。

    参数：
        boxes    - 检测到的宝箱格 index 列表（最多 3 个）
        strategy - "winFirst"(默认) / "boxFirst"(抢宝箱) / "taskFirst"(速刷：优先落地刷任务的地图)
    """
    if len(board) != 64:
        raise ValueError("board 必须是长度 64 的列表")
    if ai_player not in (BLACK, WHITE):
        raise ValueError("ai_player 必须是 1(黑) 或 -1(白)")
    if strategy not in ("winFirst", "boxFirst", "taskFirst"):
        raise ValueError("strategy 必须为 'winFirst' / 'boxFirst' / 'taskFirst'")
    # 仅在 boxFirst 且提供了 boxes 时启用宝箱加成
    use_boxes = boxes if (strategy == "boxFirst" and boxes) else None

    moves = legal_moves(board, ai_player)
    # 速刷模式：把「落点在速刷地图」的步排到前面，根级 tie-break 偏向优先地图
    if strategy == "taskFirst":
        moves.sort(
            key=lambda m: (
                0 if INDEX_MAPNAME.get(m["index"]) in TASK_PRIORITY_MAPS else 1,
                -WEIGHTS[m["index"]],
            )
        )
    legal = [m["index"] for m in moves]
    if not legal:
        return {"action": None, "legal_moves": []}

    deadline = time.time() * 1000 + max(time_ms, 50)
    best_action = legal[0]

    # 若只有一步，无需搜索
    if len(legal) == 1:
        return {"action": best_action, "legal_moves": legal}

    try:
        for depth in range(1, max_depth + 1):
            best_val = -INF
            cur_best = best_action
            for m in moves:
                nb = apply_move(board, m["index"], ai_player)
                val = _alphabeta(
                    nb, ai_player, -ai_player, depth - 1, -INF, INF, deadline, use_boxes, strategy
                )
                # 速刷模式：落点在「速刷地图」的这手额外加权（根级偏好，不受后续翻转影响）
                if strategy == "taskFirst" and INDEX_MAPNAME.get(m["index"]) in TASK_PRIORITY_MAPS:
                    val += TASK_BONUS
                if val > best_val:
                    best_val = val
                    cur_best = m["index"]
            best_action = cur_best
    except _Timeout:
        # 保留已完成层的最优结果
        pass

    return {"action": best_action, "legal_moves": legal}
