"""Draw the two shop potion icons as exact 16x16 pixel art, exported at 2x."""

from pathlib import Path

from PIL import Image, ImageDraw


CLIENT = Path(__file__).resolve().parents[5]
OUT = CLIENT / "public" / "assets" / "ui" / "shop"
PREVIEW = CLIENT / "artifacts" / "shop-potions" / "preview.png"

ROWS = [
    "................",
    "......OOOO......",
    ".....OCCCOO.....",
    ".....OCCCOO.....",
    ".....OOGGOO.....",
    "....OOGGGGOO....",
    "...OOGGLLGGOO...",
    "...OGGLLLLGGO...",
    "...OWLLHLLLGO...",
    "...OWLLHLLLGO...",
    "...OGLLLLLLGO...",
    "...OGLSLLSLGO...",
    "...OGGLLLGGGO...",
    "....OGGGGGGO....",
    "....OOOOOOOO....",
    "................",
]

PALETTE = {
    ".": (0, 0, 0, 0),
    "O": (27, 20, 40, 255),
    "C": (178, 111, 61, 255),
    "G": (201, 235, 246, 255),
    "W": (248, 255, 255, 255),
}

LIQUIDS = {
    "health": {
        "L": (228, 53, 78, 255),
        "H": (255, 126, 143, 255),
        "S": (153, 20, 57, 255),
    },
    "energy": {
        "L": (38, 121, 231, 255),
        "H": (109, 205, 255, 255),
        "S": (22, 70, 165, 255),
    },
}


def draw_potion(liquid: dict[str, tuple[int, int, int, int]]) -> Image.Image:
    canvas = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    pixels = canvas.load()
    palette = {**PALETTE, **liquid}
    for y, row in enumerate(ROWS):
        if len(row) != 16:
            raise ValueError(f"row {y} is {len(row)} pixels, expected 16")
        for x, symbol in enumerate(row):
            pixels[x, y] = palette[symbol]
    return canvas.resize((32, 32), Image.Resampling.NEAREST)


def checkerboard(width: int, height: int, cell: int = 8) -> Image.Image:
    image = Image.new("RGBA", (width, height), (36, 40, 49, 255))
    draw = ImageDraw.Draw(image)
    for y in range(0, height, cell):
        for x in range(0, width, cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(51, 57, 69, 255))
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    health = draw_potion(LIQUIDS["health"])
    energy = draw_potion(LIQUIDS["energy"])
    health.save(OUT / "ui_shop_health_potion_base.png")
    energy.save(OUT / "ui_shop_energy_potion_base.png")

    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    preview = checkerboard(640, 360)
    draw = ImageDraw.Draw(preview)
    for index, (name, image) in enumerate((("HEALTH", health), ("ENERGY", energy))):
        enlarged = image.resize((256, 256), Image.Resampling.NEAREST)
        x = 64 + index * 320
        preview.alpha_composite(enlarged, (x, 48))
        draw.text((x + 96, 318), name, fill=(247, 232, 190, 255))
    preview.save(PREVIEW)


if __name__ == "__main__":
    main()
