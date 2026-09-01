"""アプリのアイコンを生成する。

ホーム画面に置いたときに何のアプリか分かるよう、企業のつながりを表す
ノードとエッジの図案にする。iOS はアイコンの角丸を自前で付けるので、
こちらは角丸なしの正方形で書き出す（重ねると二重になるため）。

    python scripts/make_icons.py
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "frontend" / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

BG_TOP = (10, 132, 255)      # systemBlue（ダーク）
BG_BOTTOM = (88, 86, 214)    # systemIndigo
NODE = (255, 255, 255)
EDGE = (255, 255, 255, 130)


def draw_icon(size: int, padding_ratio: float = 0.0) -> Image.Image:
    # 4倍で描いてから縮小し、縁を滑らかにする
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 背景の縦グラデーション
    for y in range(s):
        t = y / max(s - 1, 1)
        d.line([(0, y), (s, y)], fill=(
            round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
            round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
            round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t), 255))

    # maskable 用に図案を内側へ寄せる余白
    inset = s * padding_ratio
    cx = cy = s / 2
    span = (s / 2 - inset) * 0.62

    # 中心から放射する5つのノード。中心が「いま見ている会社」を表す
    outer = []
    for i in range(5):
        a = -math.pi / 2 + i * 2 * math.pi / 5
        outer.append((cx + span * math.cos(a), cy + span * math.sin(a)))

    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for p in outer:
        ld.line([(cx, cy), p], fill=EDGE, width=int(s * 0.022))
    # 近傍どうしのつながりも1本だけ描き、放射状に見えないようにする
    ld.line([outer[1], outer[2]], fill=EDGE, width=int(s * 0.016))
    img.alpha_composite(layer)

    r_out = s * 0.062
    for p in outer:
        d.ellipse([p[0] - r_out, p[1] - r_out, p[0] + r_out, p[1] + r_out], fill=NODE)
    r_in = s * 0.115
    d.ellipse([cx - r_in, cy - r_in, cx + r_in, cy + r_in], fill=NODE)

    return img.resize((size, size), Image.LANCZOS)


def main():
    # 通常アイコン。iOS の apple-touch-icon は 180px
    for size in (180, 192, 512):
        draw_icon(size).convert("RGB").save(OUT / f"icon-{size}.png")
    # maskable は端が切られるので図案を内側に寄せる
    draw_icon(512, padding_ratio=0.14).convert("RGB").save(OUT / "icon-512-maskable.png")
    for p in sorted(OUT.glob("*.png")):
        print(f"  {p.name:26} {p.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
