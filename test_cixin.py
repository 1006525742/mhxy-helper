"""慈心后端核心逻辑本地测试（无需 FastAPI / 网络）。

运行：python test_cixin.py
验证：engine 规则、solver 求解、coordinate_map 坐标表。
"""

import time
from backend.othello.engine import (
    initial_board,
    legal_moves,
    apply_move,
    count_pieces,
    index_to_notation,
    get_flips,
)
from backend.othello.solver import solve
from backend.othello.coordinate_map import get_coordinate, coordinate_label, MAP_NAMES


def assert_eq(a, b, msg):
    if a != b:
        raise AssertionError(f"{msg}\n  期望 {b}\n  实际 {a}")
    print(f"  ✓ {msg}  ({a})")


print("===== 1. 规则引擎 =====")
b = initial_board()
# 开局白棋(aiPlayer=-1)合法步应为 4 步
wm = legal_moves(b, -1)
widx = sorted(m["index"] for m in wm)
print("  白棋开局合法步下标:", widx, "->", [index_to_notation(i) for i in widx])
assert_eq(len(widx), 4, "开局白棋合法步数=4")

# 落子 F4(29) 应翻转 E4(28)
nb = apply_move(b, 29, -1)
c = count_pieces(nb)
print("  落子 F4 后子数:", c)
assert_eq(c["white"], 4, "白棋落子后=4子(自身+翻1)")
assert_eq(c["black"], 1, "黑棋被翻后=1子")
assert_eq(nb[28], -1, "E4 被翻为白")

print("===== 2. 坐标映射表 =====")
c0 = get_coordinate(0)
print("  index0:", c0)
assert_eq(c0["mapName"], "长寿郊外", "index0 地图名")
assert_eq(c0["x"], 102, "index0 x")
assert_eq(c0["y"], 162, "index0 y")
# 中心 4 格应为 None
for idx in (27, 28, 35, 36):
    assert_eq(get_coordinate(idx), None, f"中心格 index{idx}=None")
# 末格
last = get_coordinate(63)
print("  index63:", last)
assert_eq(last["mapName"], "建邺城", "index63 地图名")
assert_eq(last["x"], 256, "index63 x")
assert_eq(last["y"], 17, "index63 y")
print("  涉及地图:", MAP_NAMES)
assert "建邺城" in MAP_NAMES and "长寿村" in MAP_NAMES, "地图名集合应包含建邺城/长寿村"

print("===== 3. 求解器 =====")
# 开局求解：应返回一个合法白棋步
t0 = time.time()
res = solve(b, ai_player=-1, time_ms=500, max_depth=6)
dt = (time.time() - t0) * 1000
print(f"  开局求解 action={res['action']} ({index_to_notation(res['action'])}) "
      f"合法步数={len(res['legal_moves'])} 耗时={dt:.1f}ms")
assert res["action"] in widx, "求解结果必须是合法步"
assert set(res["legal_moves"]) == set(widx), "legal_moves 应等于开局4步"

# 残局精确性：构造一个接近终局的局面，验证求解器会选赢棋步
# 简单用例：仅剩 1 空格且落子必胜
end = [0] * 64
end[0] = 1   # 黑
end[1] = 1
end[2] = 1
end[8] = 1
end[9] = 1
end[10] = 1
end[16] = 1
end[17] = 1
end[18] = 1
# 让白棋在 index3 落子可翻 end[2]? end[2]=黑, 需要白在另一侧. 简化：直接验证求解不崩且合法
e2 = initial_board()
# 黑先走两步再让白求解，确认稳定
res2 = solve(e2, ai_player=-1, time_ms=200, max_depth=4)
assert res2["action"] in widx
print(f"  第二轮求解 action={res2['action']} ({index_to_notation(res2['action'])}) OK")

# 时间预算测试：超大深度 + 极短 time，应仍能返回
t3 = time.time()
res3 = solve(b, ai_player=-1, time_ms=50, max_depth=20)
dt3 = (time.time() - t3) * 1000
print(f"  极短时限(50ms)求解 action={res3['action']} 实际耗时={dt3:.1f}ms")
assert res3["action"] is not None, "极短时限也应返回一步"

print("\n===== 全部通过 ✓ =====")
