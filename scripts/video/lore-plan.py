"""Pace the «lore» picture to the narrator (video-skills: the voice sets the time; phrases placed by speech onset).

    python3 scripts/video/lore-plan.py [--take=video/lore/voice-v1]

1. Trims every take to its speech (silence at both ends, −42 dB) → <take>/trim/<id>.wav (originals untouched) and
   splits two takes at their own pauses (silencedetect, ≥ 0.18 s at −38 dB): L05 before «И ему было лень» (a deadpan
   beat), L07 before «Но Заквиель мешает» (the cut to the foes).
2. Lays the clips into the shots: a shot's first phrase starts LEAD s after the shot's crossfade began, phrases inside
   a shot are GAP s apart (or their own gap), the shot holds HOLD s after its last phrase before the next crossfade.
3. Writes scripts/video/lore-timeline.json (bundled into the page: shot lengths, phrase moments, verse plates) and
   video/lore/timeline.json (the same + global times, the record for the mix).
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../.."))
opt = {a[2:].split("=", 1)[0]: a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--") and "=" in a}
# takes: the first folder that has a line wins (voice-v2 = the lines added later; v1 stays as it was)
TAKES = [os.path.join(ROOT, x) for x in opt.get("takes", "video/lore/voice-v2,video/lore/voice-v1").split(",")]
TAKE = TAKES[-1]
OUTV = opt.get("trim", "video/lore/trim-v2")
LINES = {x["id"]: x for x in json.load(open(os.path.join(ROOT, "..", "voice", "lore-lines.json"), encoding="utf-8"))}
XF, LEAD, HOLD, GAP = 0.7, 0.8, 0.75, 0.55
TRIM = os.path.join(ROOT, OUTV)
os.makedirs(TRIM, exist_ok=True)


def src_of(lid):
    for d in TAKES:
        p = os.path.join(d, lid + ".wav")
        if os.path.exists(p):
            return p
    raise SystemExit(f"no take for {lid} in {TAKES}")

# shot → clips; a clip is a line id or (line id, part) of a take split at a pause; per-clip gap before it
SHOTS = [
    ("lore-01", [("L01", None, 1.7)]),          # first phrase after the black fade + title
    ("lore-02", [("L02", None, None)]),
    ("lore-02b", [("L13", None, None)]),
    ("lore-03", [("L03", None, None)]),
    ("lore-04", [("L04", None, None), ("L14", None, 0.6)]),
    ("lore-05", [("L05", 0, None)]),
    ("lore-05b", [("L05", 1, 0.55)]),           # deadpan beat: short hold before, short lead after
    ("lore-06", [("L06", None, None)]),
    ("lore-07", [("L07", 0, None)]),
    ("lore-08", [("L07", 1, None)]),
    ("lore-09", [("L08", None, None), ("L09", None, 0.6)]),
    ("lore-09b", [("L10", None, None), ("L15", None, 0.7)]),
    ("lore-10", [("L11", None, None)]),
    ("lore-11", [("L12", None, None)]),
]
HOLD_OF = {"lore-05": 0.25}
XF_OF = {"lore-09": 0.25}   # shot / reverse shot of the same crowd: a near-cut, a long dissolve reads as a double exposure
SPLIT_AFTER = {"L05": 1.9, "L07": 6.0}   # the split pause is the first ≥0.18 s pause after this take time
END_HOLD = 4.0                            # last shot: end card + fade to black after the last phrase


def run(a):
    return subprocess.run(a, check=True, capture_output=True, text=True).stderr


def dur(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], capture_output=True, text=True).stdout)


def trim(src, dst, a=None, b=None):
    cut = (["-ss", f"{a:.3f}"] if a is not None else []) + (["-to", f"{b:.3f}"] if b is not None else [])
    run(["ffmpeg", "-y", "-hide_banner", "-i", src, *cut, "-af",
         "silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.02,areverse,"
         "silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.05,areverse,afade=t=in:d=0.01,areverse,afade=t=in:d=0.02,areverse",
         "-ar", "48000", "-ac", "1", dst])
    return dur(dst)


def pause_after(src, t0):
    err = run(["ffmpeg", "-hide_banner", "-nostats", "-i", src, "-af", "silencedetect=n=-38dB:d=0.18", "-f", "null", "-"])
    st = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", err)]
    en = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", err)]
    for a, b in zip(st, en):
        if a >= t0:
            return (a + b) / 2, a, b
    raise SystemExit(f"no pause after {t0} in {src}")


clips = {}
for lid in LINES:
    src = src_of(lid)
    if lid in SPLIT_AFTER:
        mid, a, b = pause_after(src, SPLIT_AFTER[lid])
        clips[(lid, 0)] = {"path": os.path.join(TRIM, lid + "a.wav"), "cut": [0, round(mid, 3)], "pause": [round(a, 3), round(b, 3)]}
        clips[(lid, 0)]["dur"] = trim(src, clips[(lid, 0)]["path"], None, mid)
        clips[(lid, 1)] = {"path": os.path.join(TRIM, lid + "b.wav"), "cut": [round(mid, 3), None]}
        clips[(lid, 1)]["dur"] = trim(src, clips[(lid, 1)]["path"], mid, None)
    else:
        p = os.path.join(TRIM, lid + ".wav")
        clips[(lid, None)] = {"path": p, "dur": trim(src, p)}

segs, t0 = [], 0.0
for i, (sid, items) in enumerate(SHOTS):
    t, out = LEAD, []
    for k, (lid, part, gap) in enumerate(items):
        if k == 0 and gap is not None:
            t = gap
        elif k > 0:
            t += gap if gap is not None else GAP
        c = clips[(lid, part)]
        cid = lid + ("" if part is None else "ab"[part])
        verse = LINES[lid].get("verse") if (part in (None, 0) and lid not in ("L01", "L12")) else None
        out.append({"id": cid, "start": round(t, 3), "end": round(t + c["dur"], 3), "verse": verse,
                    "text": LINES[lid]["text"] if part is None else f"{LINES[lid]['text']} [part {part + 1}]",
                    "wav": os.path.relpath(c["path"], ROOT), "g_start": round(t0 + t, 3)})
        t += c["dur"]
    last = i == len(SHOTS) - 1
    xf = XF_OF.get(sid, XF)
    d = round(t + (END_HOLD if last else HOLD_OF.get(sid, HOLD) + xf), 3)
    segs.append({"id": sid, "dur": d, "xfade": 0 if last else xf, "start": round(t0, 3), "clips": out})
    t0 += d - (0 if last else xf)

total = round(t0, 3)
for s in segs:
    print(f"{s['id']} start {s['start']:6.2f} dur {s['dur']:5.2f} | " + " ".join(f"{c['id']}@{c['g_start']:.2f}-{s['start'] + c['end']:.2f}" for c in s["clips"]))
print(f"TOTAL {total:.2f} s · speech {sum(c['dur'] for c in clips.values()):.2f} s · splits " +
      ", ".join(f"{k[0]} at {v['cut'][1]} (pause {v['pause']})" for k, v in clips.items() if k[1] == 0))
page = {"segments": [{k: s[k] for k in ("id", "dur", "xfade")} | {"clips": [{k: c[k] for k in ("id", "start", "end", "verse", "text")} for c in s["clips"]]} for s in segs]}
json.dump(page, open(os.path.join(HERE, "lore-timeline.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
os.makedirs(os.path.join(ROOT, "video", "lore"), exist_ok=True)
json.dump({"takes": [os.path.relpath(x, ROOT) for x in TAKES], "trim": OUTV, "total": total, "xfade": XF, "lead": LEAD, "hold": HOLD, "segments": segs},
          open(os.path.join(ROOT, "video", "lore", "timeline.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("wrote scripts/video/lore-timeline.json, video/lore/timeline.json")
