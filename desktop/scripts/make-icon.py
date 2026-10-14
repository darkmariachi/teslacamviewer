"""Draws build/icon.png, the app icon: the same ring and red dot as the web app's logo."""
from pathlib import Path
from PIL import Image, ImageDraw

SIZE = 1024
scale = 4  # draw large and shrink, for smooth edges
big = SIZE * scale
img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
u = big / 64  # the logo is drawn on a 64-unit grid
d.rounded_rectangle([0, 0, big - 1, big - 1], radius=14 * u, fill="#0a0a0b")
d.ellipse([(32 - 17) * u, (32 - 17) * u, (32 + 17) * u, (32 + 17) * u], outline="#f5f5f7", width=round(4 * u))
d.ellipse([(32 - 7) * u, (32 - 7) * u, (32 + 7) * u, (32 + 7) * u], fill="#e82127")
out = Path(__file__).resolve().parent.parent / "build" / "icon.png"
img.resize((SIZE, SIZE), Image.LANCZOS).save(out)
print(out)
