# shellcheck shell=bash
# shellcheck disable=SC2034  # 読み込み側で使う定義集なので、このファイル内では未使用に見える
# Panda 配色の単一ソース。
#
# 値は ANSI truecolor 用の "R G B"。hex は隣のコメントに併記する。
# 設定ファイル側で hex が要るようになったら、この表を出どころにする。
#
# 正準は ghostty 公式 Panda の 16 色。
# *_LIFT は暗背景(#242526)で沈む色を底上げした意図的変種。

PANDA_BG="36 37 38"        # #242526
PANDA_BG_DIM="41 42 43"    # #292a2b
PANDA_FG="230 230 230"     # #e6e6e6
PANDA_WHITE="255 255 255"  # #ffffff
PANDA_SELECTION="62 66 80" # #3e4250
PANDA_SUBTLE="103 107 121" # #676b79

PANDA_PINK="255 117 181"   # #ff75b5
PANDA_MINT="25 249 216"    # #19f9d8
PANDA_ORANGE="255 184 108" # #ffb86c
PANDA_RED="255 75 130"     # #ff4b82
PANDA_BLUE="69 169 249"    # #45a9f9
PANDA_CYAN="111 193 255"   # #6fc1ff

PANDA_BLUE_LIFT="149 208 255"   # #95d0ff
PANDA_PURPLE_LIFT="205 191 255" # #cdbfff
PANDA_GRAY_LIFT="164 168 184"   # #a4a8b8
