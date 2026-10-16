"""Draw the D3 campus enemy sprite sheets (Pillow; no network/API needed).

Run from any directory: python client/src/test/arenas/D3/tools/draw_campus_enemies.py
All animation frames use the same canvas and ground anchor. No collision geometry
or balance values are generated here. The user explicitly chose local pixel art.
"""

from pathlib import Path
import math

from PIL import Image, ImageDraw, ImageFont


CLIENT = Path(__file__).resolve().parents[5]
DEST = CLIENT / "public/assets/sprites/enemies"
OUTLINE = "#333e4b"
PAPER = "#f6f0d9"
LIGHT = "#fffceb"
CREASE = "#a6ada7"


def paper_ball(size=64, angle=0, squash=1.0, lift=0):
    im = Image.new("RGBA", (64, 64))
    d = ImageDraw.Draw(im)
    d.ellipse((12, 43, 53, 54), fill=(15, 26, 34, 54))
    ball = Image.new("RGBA", (48, 44))
    p = ImageDraw.Draw(ball)
    outline = [(5, 10), (11, 5), (18, 4), (22, 1), (31, 4), (34, 9),
               (40, 11), (43, 20), (41, 30), (35, 35), (27, 39), (15, 37),
               (8, 33), (3, 25), (2, 18)]
    p.polygon(outline, fill=PAPER, outline=OUTLINE, width=2)
    # Facets follow folds: irregular angular paper, no liquid silhouette or droplets.
    facets = [([(5, 11), (14, 10), (19, 5), (18, 19), (10, 21)], LIGHT),
              ([(22, 3), (30, 5), (34, 11), (26, 15), (18, 19)], "#e3dfc9"),
              ([(34, 11), (40, 13), (41, 22), (31, 25), (26, 15)], "#fff9e3"),
              ([(4, 21), (10, 22), (19, 30), (15, 36), (9, 31)], "#bfc5b7"),
              ([(19, 20), (28, 18), (31, 26), (24, 34), (19, 30)], "#e4e4ce"),
              ([(31, 26), (40, 23), (39, 29), (33, 34), (25, 37), (24, 34)], "#b7bdb0")]
    for poly, color in facets:
        p.polygon(poly, fill=color)
    for pts in [[(7, 11), (14, 11), (19, 7)], [(14, 11), (17, 20), (11, 23)],
                [(23, 6), (26, 15), (21, 20)], [(26, 15), (35, 12)],
                [(17, 20), (21, 27), (16, 32)], [(22, 27), (31, 25), (35, 19)],
                [(31, 25), (30, 32)], [(10, 29), (14, 33)]]:
        p.line(pts, fill=CREASE, width=1)
    p.line([(8, 15), (13, 14)], fill="#91b2bb")
    p.line([(28, 20), (33, 18)], fill="#91b2bb")
    p.line([(18, 33), (22, 34)], fill="#91b2bb")
    p.line([(7, 10), (11, 6), (18, 5)], fill=LIGHT)
    ball = ball.rotate(angle, resample=Image.Resampling.NEAREST)
    bw = round(48 / squash)
    bh = round(44 * squash)
    ball = ball.resize((bw, bh), Image.Resampling.NEAREST)
    im.alpha_composite(ball, ((64 - bw) // 2, 52 - bh - lift))
    if size != 64:
        im = im.resize((size, size), Image.Resampling.NEAREST)
    return im


def flat_paper(amount):
    """A crumpled page opens into an irregular, visibly creased sheet."""
    im = Image.new("RGBA", (64, 64))
    d = ImageDraw.Draw(im)
    d.ellipse((7, 45, 57, 55), fill=(15, 26, 34, 40))
    # Interpolate folded vertices toward a spread-out piece of ruled paper.
    folded = [(14, 26), (22, 21), (38, 23), (49, 34), (43, 47), (24, 50), (12, 43)]
    opened = [(5, 19), (27, 15), (47, 18), (59, 39), (48, 51), (22, 56), (4, 41)]
    pts = [(round(x + (u - x) * amount), round(y + (v - y) * amount))
           for (x, y), (u, v) in zip(folded, opened)]
    d.polygon(pts, fill=PAPER, outline=OUTLINE, width=2)
    d.polygon([pts[0], pts[1], (30, 35), pts[-1]], fill=LIGHT)
    d.polygon([(30, 35), pts[2], pts[3], pts[4]], fill="#d9dcc8")
    for point in pts:
        d.line([point, (30, 35)], fill=CREASE)
    d.line([(12, 28), (43, 23)], fill="#91b2bb")
    d.line([(12, 34), (47, 29)], fill="#91b2bb")
    d.line([(13, 41), (49, 35)], fill="#91b2bb")
    d.line([(20, 23), (22, 48)], fill="#cfaaa1")
    return im


def paper_death(children):
    frames = [paper_ball(), flat_paper(0.25), flat_paper(0.65), flat_paper(1)]
    for phase in range(4):
        im = Image.new("RGBA", (64, 64))
        d = ImageDraw.Draw(im)
        t = phase / 3
        for i in range(children):
            a = (i / children) * math.tau + math.pi / 6
            spread = 10 + 9 * t
            cx = 32 + math.cos(a) * spread
            cy = 36 + math.sin(a) * spread * 0.55
            if phase < 2:
                poly = [(cx - 10, cy - 5), (cx + 6, cy - 8), (cx + 10, cy + 5), (cx - 6, cy + 8)]
                d.polygon(poly, fill=PAPER, outline=OUTLINE)
                d.line([(cx - 8, cy - 3), (cx + 5, cy + 3)], fill=CREASE)
            else:
                ball = paper_ball(size=26 if children == 2 else 20, angle=i * 23)
                im.alpha_composite(ball, (round(cx - ball.width / 2), round(cy - ball.height / 2)))
        # The final frame fades into the real child actors; these copies never have bodies.
        if phase == 3:
            im.putalpha(im.getchannel("A").point(lambda a: a * 2 // 3))
        frames.append(im)
    return frames


def title_font():
    for path in [Path("C:/Windows/Fonts/simhei.ttf"), Path("C:/Windows/Fonts/msyh.ttc")]:
        if path.exists():
            return ImageFont.truetype(str(path), 10)
    raise RuntimeError("A CJK font is required to draw the exact cover title 计组")


FONT = title_font()


def book_body():
    """48px source, doubled with nearest-neighbor: a very thick closed textbook."""
    im = Image.new("RGBA", (48, 48))
    d = ImageDraw.Draw(im)
    # Back cover and the two page-block faces are drawn before the front cover.
    d.polygon([(9, 10), (34, 8), (44, 16), (44, 39), (20, 44), (10, 35)],
              fill="#174a59", outline=OUTLINE, width=1)
    d.polygon([(34, 7), (42, 13), (44, 37), (37, 32)], fill="#d9d2b5", outline=OUTLINE)
    d.polygon([(11, 33), (36, 29), (44, 37), (20, 42)], fill="#f3e9c9", outline=OUTLINE)
    # Many page edges, visibly 8-10 source pixels thick (16-20 final pixels).
    for k in range(1, 7):
        d.line([(36 + k, 10 + k), (38 + k, 30 + k)], fill="#b5b39f")
        d.line([(12 + k, 33 + k), (36 + k, 29 + k)], fill="#b9b9a3")
    d.line([(20, 42), (44, 37)], fill="#fff6dc")
    d.polygon([(7, 7), (32, 3), (37, 30), (12, 35)], fill="#327c8b", outline=OUTLINE, width=1)
    d.polygon([(7, 7), (11, 7), (16, 34), (12, 35)], fill="#1c5365", outline=OUTLINE)
    d.line([(12, 8), (31, 5), (35, 29)], fill="#73b4b0")
    d.line([(14, 32), (34, 29)], fill="#215b6c")
    d.polygon([(13, 10), (31, 8), (33, 24), (16, 27)], fill="#234f61", outline="#d2a34b")
    # Chinese is rasterized once on the cover and is never mirrored in gameplay.
    d.text((13, 12), "计组", font=FONT, fill="#ffd86b", stroke_width=0)
    d.line([(18, 23), (29, 22)], fill="#cda84f")
    # A tiny circuit trace ties the cover to computer organization without extra wording.
    d.line([(21, 28), (24, 27), (25, 30), (30, 29)], fill="#99c3b6")
    d.rectangle((23, 27, 25, 29), fill="#c7d9c0")
    d.polygon([(29, 36), (32, 35), (33, 42), (31, 40), (30, 43)], fill="#c87558", outline="#7d493f")
    # Worn cover corners and a restrained highlight.
    d.point((8, 8), fill="#aac4b3")
    d.line([(13, 33), (16, 33)], fill="#aac4b3")
    return im


BOOK = book_body()


def book_pose(lift=0, squash=1.0, tilt=0, impact=False):
    frame = Image.new("RGBA", (48, 48))
    d = ImageDraw.Draw(frame)
    shadow_width = round(30 - lift * 0.7)
    d.ellipse((24 - shadow_width // 2, 37, 24 + shadow_width // 2, 45),
              fill=(12, 24, 33, round(65 - lift * 2)))
    body = BOOK.rotate(tilt, resample=Image.Resampling.NEAREST)
    w, h = round(48 / squash), round(48 * squash)
    body = body.resize((w, h), Image.Resampling.NEAREST)
    frame.alpha_composite(body, ((48 - w) // 2, 46 - round(43 * squash) - lift))
    if impact:
        d = ImageDraw.Draw(frame)
        d.line([(3, 42), (0, 40)], fill="#dccca8")
        d.line([(42, 43), (46, 41)], fill="#dccca8")
        d.point((4, 39), fill="#f6efdc")
        d.point((45, 38), fill="#f6efdc")
    return frame.resize((96, 96), Image.Resampling.NEAREST)


def sheet(frames, columns=4):
    w, h = frames[0].size
    out = Image.new("RGBA", (w * columns, h * math.ceil(len(frames) / columns)))
    for i, frame in enumerate(frames):
        out.alpha_composite(frame, ((i % columns) * w, (i // columns) * h))
    return out


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    paper_idle = [paper_ball(angle=a, squash=s, lift=l) for a, s, l in
                  [(0, 1, 0), (-4, 0.97, 0), (-7, 1.02, 1), (-3, 1.04, 2),
                   (0, 1.02, 2), (4, 1, 1), (7, 0.97, 0), (3, 0.98, 0)]]
    # One atlas: idle 0-7, unfold -> two balls 8-15, unfold -> four balls 16-23,
    # final-generation unfold/fade 24-31. All three generations share these pixels.
    final = [paper_ball(), flat_paper(0.25), flat_paper(0.65), flat_paper(1)]
    for alpha in [190, 120, 55, 0]:
        f = flat_paper(1)
        f.putalpha(f.getchannel("A").point(lambda a, opacity=alpha: a * opacity // 255))
        final.append(f)
    paper_frames = paper_idle + paper_death(2) + paper_death(4) + final
    walk = [book_pose(lift=l, squash=s, tilt=t, impact=hit) for l, s, t, hit in
            [(0, 1, 0, False), (0, .93, -2, False), (1, 1.02, -3, False),
             (3, 1.03, -2, False), (5, 1, 0, False), (6, 1, 2, False),
             (6, 1, 2, False), (5, 1, 1, False), (3, 1.02, 0, False),
             (1, 1, -1, False), (0, .9, -2, True), (0, .93, -1, False),
             (0, 1, 0, False), (0, 1.02, 0, False), (0, 1, 0, False), (0, 1, 0, False)]]
    attack = [book_pose(lift=l, squash=s, tilt=t, impact=hit) for l, s, t, hit in
              [(0, 1, 0, False), (0, .97, -2, False), (0, .94, -3, False),
               (1, 1, -4, False), (3, 1.02, -4, False), (5, 1, -3, False),
               (6, 1, -2, False), (6, 1, 0, False), (0, .87, 0, True),
               (0, .9, 0, True), (0, .94, 0, False), (1, 1.03, -1, False),
               (1, 1.02, 0, False), (0, 1, 0, False), (0, 1, 0, False), (0, 1, 0, False)]]
    deliverables = {"enemy_splitter_paper.png": sheet(paper_frames),
                    "enemy_tank_textbook_walk.png": sheet(walk),
                    "enemy_tank_textbook_attack.png": sheet(attack)}
    for name, im in deliverables.items():
        im.save(DEST / name, optimize=True)
        print(f"{name}: {im.width}x{im.height}, RGBA")
    # A review image and animated previews are artifacts, never loaded by the game.
    previews = CLIENT.parent / "artifacts/d3-campus"
    previews.mkdir(parents=True, exist_ok=True)
    review = Image.new("RGB", (768, 480), "#172831")
    d = ImageDraw.Draw(review)
    d.text((24, 16), "D3 / CAMPUS ENEMIES / LOCAL PIXEL ART", fill="#f4edd8")
    samples = [(paper_idle[0], 32, 65, 3), (flat_paper(1), 252, 65, 3),
               (walk[0], 464, 62, 3), (sheet(paper_death(2), 8), 24, 290, 1)]
    for im, x, y, scale in samples:
        review.paste(im.resize((im.width * scale, im.height * scale), Image.Resampling.NEAREST), (x, y),
                     im.resize((im.width * scale, im.height * scale), Image.Resampling.NEAREST))
    d.text((32, 270), "PAPER BALL", fill="#bed6ce")
    d.text((252, 270), "UNFOLD", fill="#bed6ce")
    d.text((530, 365), "THICK TEXTBOOK", fill="#bed6ce")
    d.text((24, 370), "DEATH: UNFOLD -> TEAR -> SMALLER BALLS", fill="#bed6ce")
    review.save(previews / "sprites-preview.png")
    for name, frames, duration in [("paper-split", paper_death(2), 80),
                                   ("textbook-hop", walk, 75), ("textbook-slam", attack, 85)]:
        gif_frames = []
        for f in frames:
            bg = Image.new("RGB", f.size, "#172831")
            bg.paste(f, (0, 0), f)
            gif_frames.append(bg.resize((f.width * 3, f.height * 3), Image.Resampling.NEAREST))
        gif_frames[0].save(previews / f"{name}.gif", save_all=True, append_images=gif_frames[1:],
                           duration=duration, loop=0, disposal=2)


if __name__ == "__main__":
    main()
