"""Vẽ icon extension (media/icon.png).

Vẽ ở 1024px rồi thu về 256px bằng LANCZOS — nét ở cả cỡ 32px trong danh sách
extension lẫn cỡ lớn trên marketplace. Chạy lại: python scripts/make-icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

S = 1024          # khung vẽ
OUT = 256         # kích thước xuất
R = int(S * 0.20)  # bo góc nền

NEN_TREN = (79, 70, 229)    # indigo #4F46E5
NEN_DUOI = (124, 58, 237)   # violet #7C3AED
CUA_SO = (15, 23, 42)       # navy #0F172A
THANH_TIEU_DE = (30, 41, 59)
CAM = (217, 119, 87)        # cam Claude #D97757
SANG = (232, 234, 240)
MO = (148, 163, 184)


def nen_gradient() -> Image.Image:
    """Nền dọc indigo → violet, bo góc."""
    grad = Image.new("RGB", (1, S))
    for y in range(S):
        t = y / (S - 1)
        grad.putpixel(
            (0, y),
            tuple(round(a + (b - a) * t) for a, b in zip(NEN_TREN, NEN_DUOI)),
        )
    grad = grad.resize((S, S)).convert("RGBA")

    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=R, fill=255)
    nen = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    nen.paste(grad, (0, 0), mask)
    return nen


def ve() -> Image.Image:
    img = nen_gradient()
    d = ImageDraw.Draw(img)

    # Cửa sổ SAU: nửa trong suốt — gợi ý "workspace giữ nhiều terminal", không phải một.
    lop = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(lop).rounded_rectangle(
        [S * 0.30, S * 0.16, S * 0.86, S * 0.60], radius=S * 0.055,
        fill=(255, 255, 255, 64),
    )
    img.alpha_composite(lop)

    # Cửa sổ TRƯỚC: khối terminal chính.
    x0, y0, x1, y1 = S * 0.14, S * 0.28, S * 0.78, S * 0.84
    d.rounded_rectangle([x0, y0, x1, y1], radius=S * 0.055, fill=CUA_SO)
    # Thanh tiêu đề + một chấm: đủ để đọc ra "cửa sổ", không rối ở cỡ 32px.
    d.rounded_rectangle([x0, y0, x1, y0 + S * 0.10], radius=S * 0.055, fill=THANH_TIEU_DE)
    d.rectangle([x0, y0 + S * 0.055, x1, y0 + S * 0.10], fill=THANH_TIEU_DE)
    d.ellipse(
        [x0 + S * 0.035, y0 + S * 0.028, x0 + S * 0.075, y0 + S * 0.068], fill=CAM,
    )

    # Dấu nhắc ">" — nét dày để còn đọc được khi thu nhỏ.
    cx, cy = x0 + S * 0.115, y0 + S * 0.26
    nhanh, cao = S * 0.105, S * 0.095
    d.line(
        [(cx, cy - cao), (cx + nhanh, cy), (cx, cy + cao)],
        fill=CAM, width=int(S * 0.042), joint="curve",
    )
    # Con trỏ đang nhập.
    d.rounded_rectangle(
        [cx + nhanh + S * 0.045, cy - S * 0.045,
         cx + nhanh + S * 0.155, cy + S * 0.045],
        radius=S * 0.014, fill=SANG,
    )

    # Hai dòng output mờ: gợi phiên đang chạy dở, được khôi phục lại.
    for i, rong in enumerate((0.38, 0.24)):
        top = cy + S * 0.135 + i * S * 0.10
        d.rounded_rectangle(
            [cx - S * 0.02, top, cx - S * 0.02 + S * rong, top + S * 0.055],
            radius=S * 0.027, fill=MO,
        )

    return img.resize((OUT, OUT), Image.LANCZOS)


if __name__ == "__main__":
    dich = Path(__file__).resolve().parent.parent / "media" / "icon.png"
    dich.parent.mkdir(parents=True, exist_ok=True)
    ve().save(dich, "PNG")
    print(f"Đã ghi {dich}")
