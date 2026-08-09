from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "pwa"
OUT.mkdir(parents=True, exist_ok=True)

INK = "#101a12"
LIME = "#c5f44d"
GREEN = "#263a29"
MUTED = "#aeb9af"


def font(size: int, bold: bool = True):
    windows = Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf")
    if windows.exists():
        return ImageFont.truetype(str(windows), size)
    return ImageFont.load_default()


def centered_text(draw: ImageDraw.ImageDraw, box, text: str, text_font, fill: str):
    left, top, right, bottom = box
    bounds = draw.textbbox((0, 0), text, font=text_font)
    width, height = bounds[2] - bounds[0], bounds[3] - bounds[1]
    draw.text(((left + right - width) / 2, (top + bottom - height) / 2 - bounds[1]), text, font=text_font, fill=fill)


def app_icon(size: int, maskable: bool = False):
    image = Image.new("RGB", (size, size), LIME if maskable else INK)
    draw = ImageDraw.Draw(image)
    if not maskable:
        draw.ellipse((size * .56, -size * .12, size * 1.05, size * .37), fill=GREEN)
        draw.ellipse((-size * .18, size * .72, size * .28, size * 1.18), fill="#1b2a1e")
    tile = (size * .22, size * .18, size * .78, size * .82)
    radius = int(size * .15)
    draw.rounded_rectangle(tile, radius=radius, fill=INK if maskable else LIME)
    centered_text(draw, tile, "N", font(int(size * .39)), LIME if maskable else INK)
    return image


def splash(width: int, height: int):
    image = Image.new("RGB", (width, height), INK)
    draw = ImageDraw.Draw(image)
    unit = min(width, height)
    draw.ellipse((width * .56, -unit * .13, width * 1.12, unit * .43), fill=GREEN)
    draw.ellipse((-unit * .28, height - unit * .28, unit * .30, height + unit * .30), fill="#1b2a1e")
    tile_size = int(unit * .26)
    center_y = int(height * .43)
    tile = ((width - tile_size) // 2, center_y - tile_size // 2, (width + tile_size) // 2, center_y + tile_size // 2)
    draw.rounded_rectangle(tile, radius=int(tile_size * .25), fill=LIME)
    centered_text(draw, tile, "N", font(int(tile_size * .61)), INK)
    title_font = font(int(unit * .085))
    label_font = font(int(unit * .025))
    title_y = tile[3] + int(unit * .07)
    centered_text(draw, (0, title_y, width, title_y + int(unit * .10)), "NEXO", title_font, "#ffffff")
    centered_text(draw, (0, title_y + int(unit * .095), width, title_y + int(unit * .14)), "F A N T A S Y", label_font, LIME)
    return image


app_icon(192).save(OUT / "icon-192.png", optimize=True)
app_icon(512).save(OUT / "icon-512.png", optimize=True)
app_icon(512, maskable=True).save(OUT / "icon-maskable-512.png", optimize=True)
app_icon(180).save(OUT / "apple-touch-icon.png", optimize=True)
app_icon(32).save(OUT / "favicon-32.png", optimize=True)

for width, height in ((1170, 2532), (1290, 2796), (2048, 2732)):
    splash(width, height).save(OUT / f"splash-{width}x{height}.png", optimize=True)

print(f"Generated PWA assets in {OUT}")
