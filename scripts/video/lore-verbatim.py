# /// script
# requires-python = ">=3.10"
# dependencies = ["faster-whisper>=1.1", "av<19"]
# ///
"""Verbatim check of the lore narrator takes with a local faster-whisper (no API, no key).

    uv run scripts/video/lore-verbatim.py --take=video/lore/voice-v1 --model=small [--lines=../voice/lore-lines.json]

Per line: recognised text, word-level diff against the script (normalised: lower case, ё→е, no punctuation),
a similarity ratio, speech onset / end (first / last word), and the pauses ≥ 0.18 s between words (cut points).
Writes <take>/verbatim-<model>.json.
"""
import argparse
import difflib
import json
import os
import re

from faster_whisper import WhisperModel

ap = argparse.ArgumentParser()
ap.add_argument("--take", default="video/lore/voice-v1")
ap.add_argument("--model", default="small")
ap.add_argument("--noprompt", action="store_true")
ap.add_argument("--lines", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../voice/lore-lines.json"))
a = ap.parse_args()
lines = json.load(open(a.lines, encoding="utf-8"))
norm = lambda s: re.sub(r"[^a-zа-я0-9 ]", " ", s.lower().replace("ё", "е")).split()
print(f"config: model {a.model} cpu int8 · take {a.take} · {len(lines)} lines")
m = WhisperModel(a.model, device="cpu", compute_type="int8")
prompt = None if a.noprompt else "Руина, Зак, Заквиель, Закхуэль, Клод, руинизм, злобог."
rep = []
for ln in lines:
    p = os.path.join(a.take, ln["id"] + ".wav")
    segs, _ = m.transcribe(p, language="ru", word_timestamps=True, beam_size=5, initial_prompt=prompt, vad_filter=False)
    words = [w for s in segs for w in s.words]
    heard = "".join(w.word for w in words).strip()
    A, B = norm(ln["text"]), norm(heard)
    ratio = difflib.SequenceMatcher(None, A, B).ratio()
    diff = [d for d in difflib.ndiff(A, B) if d[0] in "+-"]
    pauses = [[round(words[i].end, 2), round(words[i + 1].start, 2), words[i].word.strip()] for i in range(len(words) - 1) if words[i + 1].start - words[i].end >= 0.18]
    r = {"id": ln["id"], "ratio": round(ratio, 3), "heard": heard, "diff": diff, "onset": round(words[0].start, 2) if words else None,
         "end": round(words[-1].end, 2) if words else None, "pauses": pauses}
    rep.append(r)
    print(f"{ln['id']} {ratio:.2f} | {heard} | diff: {' '.join(diff) or '—'}")
json.dump(rep, open(os.path.join(a.take, f"verbatim-{a.model}{'-noprompt' if a.noprompt else ''}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("SUMMARY", " ".join(f"{r['id']}={r['ratio']:.2f}" for r in rep))
