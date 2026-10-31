"""Mix and mux the «lore» video (video-skills video-audio rules + the owner's preferences).

    python3 scripts/video/lore-mix.py --video=video/lore/lore-v1.video.mp4 --out=video/lore/lore-v1.mp4
           [--music=video/lore/music-v1.wav] [--timeline=video/lore/timeline.json] [--duck=6] [--music-under=12]

- Phrases are placed by their speech onset: the clips are the trimmed takes (lore-plan.py), so the onset is the file start.
- Voice: high-pass 80 Hz + gentle compression; never stretched, never sped up.
- Music: set to (voice loudness − music-under LU) measured on the phrases only, ducked by --duck dB under every phrase
  (owner: ~6 dB; down over 0.25 s starting 0.35 s before the phrase, back over 0.45 s after), faded with the picture.
- The sum gets ONE static gain to −16 LUFS + a limiter; the true peak is measured on the ENCODED file and the
  limiter ceiling is lowered until it is ≤ −1 dBTP. The video stream is copied (-c:v copy), never re-encoded.
- Never overwrites --out. Writes <out>.mix.json with every number.
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../.."))
opt = {a[2:].split("=", 1)[0]: a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--") and "=" in a}
VIDEO, OUT = opt["video"], opt["out"]
MUSIC = opt.get("music", "video/lore/music-v1.wav")
TLP = opt.get("timeline", "video/lore/timeline.json")
DUCK, UNDER = float(opt.get("duck", 6)), float(opt.get("music_under", opt.get("music-under", 12)))
if os.path.exists(OUT):
    raise SystemExit(f"{OUT} exists — never overwrite, pick a new version name")
TL = json.load(open(TLP, encoding="utf-8"))
TMP = OUT + ".mixwork"; os.makedirs(TMP, exist_ok=True)


def run(a):
    r = subprocess.run(a, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit("ffmpeg failed: " + r.stderr[-800:])
    return r.stderr


def probe(p, what="format=duration"):
    return subprocess.run(["ffprobe", "-v", "error", "-show_entries", what, "-of", "csv=p=0", p], capture_output=True, text=True).stdout.strip()


def loud(inp, af=""):
    err = run(["ffmpeg", "-hide_banner", "-nostats", *inp, "-af", (af + "," if af else "") + "ebur128=peak=true", "-f", "null", "-"])
    i = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1]); tp = float(re.findall(r"Peak:\s+(-?[\d.inf]+) dBFS", err)[-1])
    return i, tp


VDUR = float(probe(VIDEO))
clips = [{"id": c["id"], "start": c["g_start"], "end": s["start"] + c["end"], "wav": os.path.join(ROOT, c["wav"])} for s in TL["segments"] for c in s["clips"]]
print(f"config: video {VIDEO} ({VDUR:.3f} s) · music {MUSIC} · {len(clips)} clips · duck {DUCK} dB · music {UNDER} LU under the voice · target −16 LUFS, ≤ −1 dBTP")
# voice track
inp, f = [], []
for i, c in enumerate(clips):
    inp += ["-i", c["wav"]]; ms = int(round(c["start"] * 1000))
    f.append(f"[{i}:a]aresample=48000,highpass=f=80,acompressor=threshold=-22dB:ratio=2.5:attack=6:release=90:makeup=1,adelay={ms}|{ms}[v{i}]")
f.append("".join(f"[v{i}]" for i in range(len(clips))) + f"amix=inputs={len(clips)}:normalize=0,apad=whole_dur={VDUR}[vo]")
voice = os.path.join(TMP, "voice.wav")
run(["ffmpeg", "-y", *inp, "-filter_complex", ";".join(f), "-map", "[vo]", "-ar", "48000", "-ac", "1", "-t", f"{VDUR:.3f}", voice])
# voice loudness on the phrases only (concatenated, same processing)
f2 = [f"[{i}:a]aresample=48000,highpass=f=80,acompressor=threshold=-22dB:ratio=2.5:attack=6:release=90:makeup=1[p{i}]" for i in range(len(clips))]
f2.append("".join(f"[p{i}]" for i in range(len(clips))) + f"concat=n={len(clips)}:v=0:a=1[c]")
cat = os.path.join(TMP, "phrases.wav")
run(["ffmpeg", "-y", *inp, "-filter_complex", ";".join(f2), "-map", "[c]", cat])
v_i, _ = loud(["-i", cat])
m_i, _ = loud(["-i", MUSIC])
m_gain = (v_i - UNDER) - m_i
# duck envelope (0 = no duck, 1 = full duck)
terms = [f"min(clip((t-{c['start'] - 0.35:.3f})/0.25,0,1),clip(({c['end'] + 0.45:.3f}-t)/0.45,0,1))" for c in clips]
mx = terms[0]
for tm in terms[1:]:
    mx = f"max({mx},{tm})"
duck = f"1-{1 - 10 ** (-DUCK / 20):.4f}*({mx})"
mus = os.path.join(TMP, "music.wav")
run(["ffmpeg", "-y", "-i", MUSIC, "-af", f"aresample=48000,volume={m_gain:.2f}dB,volume='{duck}':eval=frame,afade=t=out:st={VDUR - 2.2:.3f}:d=2.0",
     "-t", f"{VDUR:.3f}", "-ac", "2", mus])
pre = os.path.join(TMP, "pre.wav")
run(["ffmpeg", "-y", "-i", voice, "-i", mus, "-filter_complex", "[0:a]pan=stereo|c0=c0|c1=c0[v];[v][1:a]amix=inputs=2:normalize=0,afade=t=out:st=" + f"{VDUR - 0.25:.3f}:d=0.25[m]",
     "-map", "[m]", "-ar", "48000", pre])
mix_i, _ = loud(["-i", pre])
gain = -16.0 - mix_i
# under-phrase ratio check: music level inside the phrases vs the voice
mus_dk, _ = loud(["-i", mus], "aselect='" + "+".join(f"between(t,{c['start']:.2f},{c['end']:.2f})" for c in clips) + "',asetpts=N/SR/TB")
ceil, res = -1.5, None
for attempt in range(5):
    lim = 10 ** (ceil / 20)
    final = os.path.join(TMP, f"final{attempt}.wav")
    run(["ffmpeg", "-y", "-i", pre, "-af", f"volume={gain:.2f}dB,alimiter=limit={lim:.4f}:attack=3:release=60:level=disabled", final])
    enc = os.path.join(TMP, f"enc{attempt}.mp4")
    run(["ffmpeg", "-y", "-i", VIDEO, "-i", final, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000",
         "-shortest", "-movflags", "+faststart", enc])
    I, TP = loud(["-i", enc])
    print(f"  attempt {attempt}: limiter ceiling {ceil:.1f} dBFS → encoded {I:.1f} LUFS, true peak {TP:.1f} dBTP")
    res = (enc, I, TP, ceil)
    if TP <= -1.0:
        break
    ceil -= max(0.3, TP + 1.0 + 0.1)
enc, I, TP, ceil = res
os.replace(enc, OUT)
rep = {"out": OUT, "video": VIDEO, "music": MUSIC, "duration_video": VDUR, "duration_out": float(probe(OUT)),
       "voice_phrases_LUFS": round(v_i, 2), "music_LUFS_src": round(m_i, 2), "music_gain_dB": round(m_gain, 2),
       "music_under_phrases_LUFS": round(mus_dk + gain, 2), "music_unducked_vs_voice_LU": -UNDER, "duck_dB": DUCK,
       "static_gain_dB": round(gain, 2), "limiter_ceiling_dBFS": ceil, "encoded_LUFS": I, "encoded_truePeak_dBTP": TP,
       "voice_vs_music_under_phrases_LU": round(v_i - mus_dk, 2),
       "clips": clips}
json.dump(rep, open(OUT + ".mix.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"FINAL {OUT} · {rep['duration_out']:.3f} s · {I:.1f} LUFS · TP {TP:.1f} dBTP · voice−music under phrases {rep['voice_vs_music_under_phrases_LU']:.1f} LU")
