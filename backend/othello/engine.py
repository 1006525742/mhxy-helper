"""标准 Reversi（黑白棋）规则引擎 —— 慈心模块专用，零依赖。

棋盘约定（与 mhxyai othelloGame 完全一致）：
- board: 长度 64 的 list[int]，取值 1=黑 / -1=白 / 0=空
- 下标 = row * 8 + col，row 0 在顶部，col 0 在最左（A 列）
- 开局：board[27]=-1(白) board[28]=1(黑) board[35]=1(黑) board[36]=-1(白)
- A1 记法：列号 A~H = chr(65 + col)，行号 1~8 = row + 1
"""

BLACK = 1
WHITE = -1
EMPTY = 0
SIZE = 8
DIRS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def initial_board() -> list[int]:
    """标准 Othello 开局（中间 4 子对角）。"""
    b = [EMPTY] * 64
    b[27] = WHITE
    b[28] = BLACK
    b[35] = BLACK
    b[36] = WHITE
    return b


def rc(index: int) -> tuple[int, int]:
    """index -> (row, col)。"""
    return divmod(index, 8)


def index_of(row: int, col: int) -> int:
    return row * 8 + col


def get_flips(board: list[int], index: int, player: int) -> list[int]:
    """计算在 index 落子 player 会翻转的所有对方棋子下标。非法落子返回 []。"""
    if not isinstance(board, list) or len(board) != 64:
        return []
    if index < 0 or index >= 64 or board[index] != EMPTY:
        return []
    row, col = rc(index)
    opp = -player
    flips: list[int] = []
    for dr, dc in DIRS:
        line: list[int] = []
        r, c = row + dr, col + dc
        while 0 <= r < 8 and 0 <= c < 8:
            v = board[r * 8 + c]
            if v == opp:
                line.append(r * 8 + c)
            elif v == player:
                if line:
                    flips.extend(line)
                break
            else:  # EMPTY
                break
            r += dr
            c += dc
    return flips


def legal_moves(board: list[int], player: int) -> list[dict]:
    """返回某方所有合法落子：[{'index': int, 'flips': [...]}, ...]。"""
    moves = []
    for i in range(64):
        if board[i] != EMPTY:
            continue
        flips = get_flips(board, i, player)
        if flips:
            moves.append({"index": i, "flips": flips})
    return moves


def apply_move(board: list[int], index: int, player: int) -> list[int]:
    """落子并翻子，返回新的棋盘副本。非法落子抛 ValueError。"""
    flips = get_flips(board, index, player)
    if not flips:
        raise ValueError(f"非法落子: {index}")
    nb = board[:]
    nb[index] = player
    for f in flips:
        nb[f] = player
    return nb


def count_pieces(board: list[int]) -> dict:
    black = sum(1 for v in board if v == BLACK)
    white = sum(1 for v in board if v == WHITE)
    return {"black": black, "white": white}


def is_terminal(board: list[int]) -> bool:
    """双方都无合法步时终局。"""
    return not legal_moves(board, BLACK) and not legal_moves(board, WHITE)


def winner(board: list[int]) -> int | None:
    """终局时返回胜负：0=平, 1=黑胜, -1=白胜；未终局返回 None。"""
    if not is_terminal(board):
        return None
    c = count_pieces(board)
    if c["black"] == c["white"]:
        return 0
    return BLACK if c["black"] > c["white"] else WHITE


def index_to_notation(index: int) -> str:
    """下标 -> A1 记法（如 0->A1, 27->D4）。"""
    if index < 0 or index >= 64:
        return "PASS"
    row, col = rc(index)
    return f"{chr(65 + col)}{row + 1}"


def notation_to_index(notation: str) -> int:
    """A1 记法 -> 下标，非法返回 -1。"""
    if len(notation) != 2:
        return -1
    col = ord(notation[0].upper()) - 65
    if not (0 <= col < 8) or not notation[1].isdigit():
        return -1
    row = int(notation[1]) - 1
    if not (0 <= row < 8):
        return -1
    return index_of(row, col)
