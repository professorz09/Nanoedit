"""Real Short frames for Nanoedit's Shorts style picker — one per option, made by Movievideomaker's own renderer
(pipeline.shorts_split for Studio, assemble.build_shorts_final for Classic/Boxed) on the MrBeast podcast clip."""
import random, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
# run with a Movievideomaker checkout: MVM=/path/to/Movievideomaker python3 scripts/render_shorts_looks.py
import os
sys.path.insert(0, os.environ.get("MVM", str(Path(__file__).parent / "mvm")))
from pipeline import shorts_split, assemble

SCR = Path(__file__).resolve().parent.parent
OUT = SCR / "public" / "shorts-looks"
WORK = Path("/tmp/shorts-looks-work")

RAW = SCR / "public" / "home" / "podcast-long.mp4"
SIZE = assemble.PORTRAIT_SIZE
DUR = 3.2
AT = 2.1  # the whole first line is on screen by now
CROP = 0.25  # MrBeast's half of the side-by-side podcast frame
TITLE = ["How MrBeast Hid $1,000,000", "In A Super Bowl Commercial"]
TITLE_EMPH = [{"words": [{"word": "$1,000,000", "color": "green"}]},
              {"words": [{"word": "Super", "color": "green"}, {"word": "Bowl", "color": "green"}]}]
TEXT = [("We hid one million dollars", ["million", "dollars"]), ("inside the Super Bowl ad", ["Super", "Bowl"])]


def groups():
    out, t = [], 0.15
    for sent, keys in TEXT:
        ws = []
        for w in sent.split():
            ws.append({"word": w, "start": round(t, 2), "end": round(t + 0.3, 2)}); t += 0.32
        ws[-1]["end"] = round(t + 1.0, 2)  # the line stays up for the frame grab
        out.append((ws, {"words": keys})); t += 1.3
    return out


def clip() -> Path:
    WORK.mkdir(parents=True, exist_ok=True)
    c = WORK / "raw.mp4"
    if not c.exists():
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", "0.5", "-t", str(DUR), "-i", str(RAW),
                        "-c:v", "libx264", "-c:a", "aac", str(c)], check=True)
    return c


def frame(mp4: Path, name: str, at: float = AT) -> None:
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(at), "-i", str(mp4), "-frames:v", "1",
                    "-vf", "scale=360:-2", "-c:v", "libwebp", "-quality", "78", str(OUT / f"{name}.webp")], check=True)


def studio(name: str, bg: str = "white", preset: str | None = "hormozi.pop", captions: bool = True, seed: int = 7,
           fx: dict | None = None, at: float = AT, **extra):
    presets = [preset] if preset else None
    look = shorts_split.pick_look(random.Random(seed), bg=bg, caption_presets=presets, fx=[])
    look.update(card_in="none", side="right", fx=fx or {}, emoji=False)
    mp4 = WORK / f"{name}.mp4"
    shorts_split.build(clip(), mp4, TITLE, TITLE_EMPH, groups() if captions else [], SIZE, DUR, (854, 480), CROP,
                       assemble._encode_args(False), assemble.AUDIO_ENCODE_ARGS, assemble.TARGET_FPS, look=look, **extra)
    frame(mp4, name, at)


# the Effects popup's cards: its effects on the same clip (the B-roll picture: scripts/shorts-looks-src/cash.jpg,
# CC0 from Wikimedia Commons; the sticker: the Noto money-bag emoji, Apache 2.0)
SRC = SCR / "scripts" / "shorts-looks-src"
FACT = [{"start": 0.3, "kind": "stat", "title": "Super Bowl prize",
         "items": [{"label": "Hidden in a Super Bowl ad", "value": 1000000, "display": "$1,000,000"}]}]
BROLL = [{"start": 0.8, "word": "", "seconds": 2.0, "picture": "a case of cash", "labels": [],
          "image": str(SRC / "cash.jpg")}]
STICKER = [{"start": 0.35, "image": str(SRC / "money.png"), "motion": "pop", "size": "small", "word": ""}]


def simple(name: str, layout: str = "bar", sub_look: str | None = "bold_green", fit: str = "full"):
    mp4 = WORK / f"{name}.mp4"
    words = [ws for ws, _e in groups()] if sub_look else []
    assemble.build_shorts_final(clip(), mp4, TITLE, TITLE_EMPH, words, crop_center=CROP, target_size=SIZE,
                                layout=layout, fit=fit, sub_look=sub_look or "plain")
    frame(mp4, name)


def tile(name: str, sub_look: str):
    """A Subtitles tile: just the caption ("To / get started") on the dark tile, fully typed in, 360x180."""
    w, h = 720, 360
    words = [{"word": "To", "start": 0.0, "end": 0.3}, {"word": "get", "start": 0.3, "end": 0.6},
             {"word": "started", "start": 0.6, "end": 2.0}]
    ass = WORK / f"{name}.ass"
    ass.write_text("[Script Info]\nScriptType: v4.00+\nPlayResX: %d\nPlayResY: %d\nScaledBorderAndShadow: yes\n\n"
                   "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
                   "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, "
                   "Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
                   "Style: Sub,Montserrat,60,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,"
                   "0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
                   % (w, h) + "".join(assemble._shorts_subtitle_events([words], w, h // 2, 110, sub_look)))
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=0x2A2A2A:s={w}x{h}:d=2.2",
                    "-vf", f"ass={ass}:fontsdir={assemble.FONTS_DIR if hasattr(assemble, 'FONTS_DIR') else shorts_split.FONTS_DIR},scale=360:-2",
                    "-ss", "1.6", "-frames:v", "1", "-c:v", "libwebp", "-quality", "82", str(OUT / f"{name}.webp")],
                   check=True)


STUDIO_CAPS = ["sticky_blue", "underline_swipe", "chalkboard", "hormozi", "mrbeast", "neon_green", "glass", "red_box",
               "black_box", "karaoke", "highlighter", "comic", "fire", "ice", "gold", "typewriter", "sticker",
               "chat_bubble", "sticky_note", "news_bar", "pop_art", "rgb_split", "minimal",
               "cine_red", "cine_green", "cine_blue"]
BGS = [b for b in shorts_split.BG_OPTIONS if b not in ("ai", "random")]

JOBS = {
    "style-split": lambda: studio("style-split"),
    "style-classic": lambda: simple("style-classic", "bar"),
    "style-boxed": lambda: simple("style-boxed", "box"),
    **{f"bg-{b}": (lambda b=b: studio(f"bg-{b}", bg=b)) for b in BGS},
    **{f"cap-{c}": (lambda c=c: studio(f"cap-{c}", preset=f"{c}.pop")) for c in STUDIO_CAPS},
    "cap-auto": lambda: studio("cap-auto", preset=None, seed=3),
    "cap-poster_words": lambda: studio("cap-poster_words", preset="poster_words"),
    "cap-off": lambda: studio("cap-off", captions=False),
    "simple-auto": lambda: simple("simple-auto", sub_look="karaoke"),
    "simple-animated": lambda: simple("simple-animated", sub_look="bold_green"),
    "simple-simple": lambda: simple("simple-simple", sub_look="plain"),
    "simple-off": lambda: simple("simple-off", sub_look=None),
    **{f"simple-{k}": (lambda k=k: tile(f"simple-{k}", k)) for k in assemble.SHORTS_TYPE_LOOKS},
    **{f"fit-{f}": (lambda f=f: simple(f"fit-{f}", fit=f)) for f in ("full", "zoom", "track")},
    "fx-auto": lambda: studio("fx-auto", preset="sticky_blue.pop", fx={"marker": "swipe", "progress": "top_line", "zoom_punch": "punch"}),
    "fx-explain": lambda: studio("fx-explain", fx={"facts": "bold"}, fact_cards=FACT),
    "fx-broll": lambda: studio("fx-broll", fx={"info_images": "card"}, info_images=BROLL, at=2.0),
    "fx-stickers": lambda: studio("fx-stickers", fx={"stickers": "emoji_3d"}, stickers=STICKER, at=1.4),
}

if __name__ == "__main__":
    want = sys.argv[1:] or list(JOBS)
    clip()
    def run(k):
        try:
            JOBS[k](); return k, None
        except Exception as e:  # noqa: BLE001
            return k, repr(e)[:300]
    # one at a time: Classic/Boxed renders share a working file name
    with ThreadPoolExecutor(1) as pool:
        for k, err in pool.map(run, want):
            print(("FAIL " if err else "ok   ") + k + (f"  {err}" if err else ""), flush=True)
