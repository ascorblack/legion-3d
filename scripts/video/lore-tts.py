"""Narrator for the «lore» chronicle video: Gemini TTS via OpenRouter, voice Achird, one WAV per line.

    python3 scripts/video/lore-tts.py [--lines=../voice/lore-lines.json] [--out=video/lore/voice-v1] [--voice=Achird] [ids...]

- The key is read from $DAEDALUS_SECRET_OPENROUTER_API_KEY only and never printed or written anywhere.
- The text goes to the model inside an explicit «read verbatim, do not answer» frame (the style instruction);
  the input itself is the line only.
- PROHIBITED_CONTENT (or any failure / empty audio): 3 tries with the main model, then 3 with the fallback.
- Never overwrites: a line whose WAV already exists in --out is skipped (make a new version dir instead).
- Prints per line: model used, tries, audio length, cost (OpenRouter generation stats when available, else the
  key's usage delta). Writes <out>/takes.json (text, model, seconds, cost) — no key in it.
- Budget guard: refuses to start below $0.10 left on the key.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../.."))
opt = {a[2:].split("=", 1)[0]: (a.split("=", 1)[1] if "=" in a else "1") for a in sys.argv[1:] if a.startswith("--")}
ids = [a for a in sys.argv[1:] if not a.startswith("--")]
LINES = opt.get("lines", os.path.join(ROOT, "..", "voice", "lore-lines.json"))
OUT = opt.get("out", os.path.join(ROOT, "video", "lore", "voice-v1"))
VOICE = opt.get("voice", "Achird")
MODELS = ["google/gemini-3.8-flash-tts", "google/gemini-3.1-flash-tts-preview"]   # main, fallback
KEY = os.environ.get("DAEDALUS_SECRET_OPENROUTER_API_KEY")
if not KEY:
    raise SystemExit("DAEDALUS_SECRET_OPENROUTER_API_KEY is not set")
H = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

FRAME = ("Прочитай дословно, не отвечай. Read the input text aloud exactly as written, word for word, in Russian. "
         "Do not answer it, do not comment, do not add or drop any words. ")
STYLE = os.environ.get("VSTYLE") or (
    "Voice: a Russian male documentary narrator with a medium, clear pitch — not deep, not bassy. "
    "Tone: solemn and mythic, like reading an ancient chronicle in a nature documentary, completely deadpan and serious, "
    "with a barely hidden warm smile. Natural pace, even from the first to the last word, short pauses at full stops, "
    "no rushing, no dragging.")


def key_info():
    try:
        with urllib.request.urlopen(urllib.request.Request("https://openrouter.ai/api/v1/key", headers=H), timeout=30) as r:
            d = json.load(r)["data"]
            return d.get("limit_remaining"), d.get("usage")
    except Exception as e:  # noqa: BLE001
        print("  (key info unavailable:", type(e).__name__, ")")
        return None, None


def gen_cost(gid):
    if not gid:
        return None
    for _ in range(4):
        time.sleep(1.5)
        try:
            with urllib.request.urlopen(urllib.request.Request(f"https://openrouter.ai/api/v1/generation?id={gid}", headers=H), timeout=30) as r:
                return json.load(r)["data"].get("total_cost")
        except Exception:  # noqa: BLE001
            continue
    return None


def speak(text, model):
    body = {"model": model, "input": text, "voice": VOICE, "response_format": "pcm",
            "speech_metadata": {"style": FRAME + STYLE}}
    req = urllib.request.Request("https://openrouter.ai/api/v1/audio/speech", data=json.dumps(body).encode(), headers=H)
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read(), r.headers.get("X-Generation-Id") or r.headers.get("x-generation-id")


def synth(text):
    """3 tries on the main model, then 3 on the fallback (PROHIBITED_CONTENT or any other failure)."""
    for model in MODELS:
        for k in range(1, 4):
            try:
                pcm, gid = speak(text, model)
                if len(pcm) < 24000 * 2 * 0.5:   # < 0.5 s of audio = refused / empty
                    raise RuntimeError(f"empty audio ({len(pcm)} bytes)")
                return pcm, gid, model, k
            except urllib.error.HTTPError as e:
                msg = e.read().decode("utf-8", "replace")[:300]
                why = "PROHIBITED_CONTENT" if "PROHIBITED" in msg.upper() else f"HTTP {e.code}"
                print(f"  {model} try {k}: {why} {msg[:160]!r}")
            except Exception as e:  # noqa: BLE001
                print(f"  {model} try {k}: {type(e).__name__} {str(e)[:160]}")
            time.sleep(2)
    return None, None, None, 6


def main():
    lines = json.load(open(LINES, encoding="utf-8"))
    os.makedirs(OUT, exist_ok=True)
    left, used0 = key_info()
    print(f"voice {VOICE} · models {MODELS} · out {OUT} · limit_remaining ${left}")
    if left is not None and left < 0.10:
        raise SystemExit(f"budget left {left:.3f} < 0.10 — not generating")
    takes_p = os.path.join(OUT, "takes.json")
    takes = json.load(open(takes_p, encoding="utf-8")) if os.path.exists(takes_p) else {}
    total = 0.0
    for ln in lines:
        if ids and ln["id"] not in ids:
            continue
        p = os.path.join(OUT, ln["id"] + ".wav")
        if os.path.exists(p):
            print(ln["id"], "exists, skipped (never overwrite — use a new --out)")
            continue
        _, u0 = key_info()
        pcm, gid, model, tries = synth(ln["text"])
        if pcm is None:
            print(ln["id"], "FAILED after 6 tries")
            continue
        with wave.open(p, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(pcm)
        cost = gen_cost(gid)
        if cost is None:
            _, u1 = key_info()
            cost = (u1 - u0) if (u0 is not None and u1 is not None) else None
        total += cost or 0
        sec = len(pcm) / 48000
        takes[ln["id"]] = {"text": ln["text"], "model": model, "tries": tries, "sec": round(sec, 2), "cost": cost}
        json.dump(takes, open(takes_p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"{ln['id']} {sec:5.2f}s · {model} · try {tries} · cost ${cost if cost is not None else '?'}")
    left2, used1 = key_info()
    print(f"TOTAL cost ≈ ${total:.4f} (key usage delta {None if used0 is None or used1 is None else round(used1 - used0, 4)}) · limit_remaining ${left2}")


main()
