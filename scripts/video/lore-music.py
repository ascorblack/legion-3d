# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy>=1.26"]
# ///
"""Our own music for «Книга Руины» (procedural, no samples, no API): a sacral drone + wordless choir pad that changes
chord on every shot of video/lore/timeline.json, a temple bell on the title, the chains and the end card, and a small
deadpan comic motif (pizzicato + a lazy tuba sigh) on «и ему было лень», the crowd's dispute and «базовыми знаниями».

    uv run scripts/video/lore-music.py [--timeline=video/lore/timeline.json] [--out=video/lore/music-v1.wav]

Deterministic (seeded); refuses to overwrite an existing --out (new version = new file). Prints the configuration,
the chord per shot and the events it placed, then peak / length.
"""
import argparse
import json
import os
import wave

import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--timeline", default="video/lore/timeline.json")
ap.add_argument("--out", default="video/lore/music-v1.wav")
a = ap.parse_args()
if os.path.exists(a.out):
    raise SystemExit(f"{a.out} exists — never overwrite, pass a new --out")
TL = json.load(open(a.timeline, encoding="utf-8"))
SR = 48000
T = TL["total"] + 0.5
N = int(T * SR)
t = np.arange(N) / SR
rng = np.random.default_rng(20261031)
L = np.zeros(N); R = np.zeros(N)
segs = TL["segments"]
print(f"config: {SR} Hz stereo · {T:.2f} s · {len(segs)} shots · seed 20261031 → {a.out}")

hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)   # noqa: E731
# D minor, «church» progression; one chord per shot (MIDI notes of the choir; the drone stays on D)
CH = {
    "lore-01": ("Dm", [50, 57, 62, 65]), "lore-02": ("Dm", [50, 57, 62, 65]), "lore-02b": ("Eb", [51, 58, 63, 67]), "lore-03": ("Bb", [46, 58, 62, 65]),
    "lore-04": ("F", [53, 57, 60, 65]), "lore-05": ("Gm", [55, 58, 62, 67]), "lore-05b": ("Gm", [55, 58, 62, 67]), "lore-06": ("A", [57, 61, 64, 69]),
    "lore-07": ("Dm", [50, 57, 62, 65]), "lore-08": ("Bb", [46, 58, 62, 65]), "lore-09": ("C", [48, 55, 60, 64]), "lore-09b": ("Am", [45, 57, 60, 64]),
    "lore-10": ("F", [53, 57, 60, 65]), "lore-11": ("Dm", [50, 57, 62, 69]),
}


def env_seg(a0, a1, fi, fo):
    e = np.clip((t - a0) / fi, 0, 1) * np.clip((a1 - t) / fo, 0, 1)
    return e * e * (3 - 2 * e)


def choir_voice(f0, vowel, det, tt):
    """Additive «aah/ooh»: harmonics weighted by two formants, slow vibrato, detuned copy."""
    F = {"a": (730, 1090), "o": (520, 900)}[vowel]
    vib = 1 + 0.004 * np.sin(2 * np.pi * (4.7 + det) * tt + det * 9)
    ph = 2 * np.pi * (f0 * (1 + det * 0.002) * tt[0] + np.cumsum(f0 * (1 + det * 0.002) * vib) / SR)
    y = np.zeros(len(tt))
    for k in range(1, 16):
        fk = f0 * k
        if fk > 5000:
            break
        w = np.exp(-((fk - F[0]) / 160) ** 2) + 0.6 * np.exp(-((fk - F[1]) / 200) ** 2) + 0.25 / k
        y += w * np.sin(k * ph)
    return y


# choir: chord per shot, crossfaded across the shot joins (the joins are the picture's crossfades)
choir = np.zeros(N)
for i, s in enumerate(segs):
    a0 = s["start"] - (0.6 if i else 0); a1 = s["start"] + s["dur"] + 0.6
    name, notes = CH[s["id"]]
    e = env_seg(a0, a1, 1.6 if i else 3.0, 1.6)
    i0, i1 = max(0, int(a0 * SR)), min(N, int(a1 * SR) + 1)
    tt = t[i0:i1]
    mix = np.zeros(i1 - i0)
    for j, m in enumerate(notes):
        for det in (-1.0, 1.0):
            mix += choir_voice(hz(m), "o" if j % 2 else "a", det + j * 0.3, tt) * (0.8 if j == 0 else 0.55)
    choir[i0:i1] += mix * e[i0:i1]
    print(f"  {s['id']} {s['start']:6.2f} {name}")
choir *= 0.5 + 0.5 * (0.5 + 0.5 * np.sin(2 * np.pi * t / 11.0))   # slow breathing

# drone: D1 + D2 + A2, soft saw through a one-pole low-pass, slow swell
def saw(f):
    ph = (f * t) % 1.0
    return 2 * ph - 1


def lp(x, fc):
    k = np.exp(-2 * np.pi * fc / SR); y = np.empty_like(x); acc = 0.0
    for n in range(len(x)):
        acc = (1 - k) * x[n] + k * acc; y[n] = acc
    return y


drone_src = saw(hz(26)) * 0.5 + saw(hz(38) * 1.001) * 0.6 + saw(hz(45) * 0.999) * 0.35
# one-pole low-pass, vectorised by a short FIR approximation (fast enough, deterministic)
kern = np.exp(-np.arange(400) / 60.0); kern /= kern.sum()
drone = np.convolve(drone_src, kern, mode="same")
drone *= env_seg(0.2, T - 0.3, 4.0, 3.0) * (0.75 + 0.25 * np.sin(2 * np.pi * t / 17.0))

# temple bell: inharmonic partials, long decay
def bell(at, f, g=1.0):
    y = np.zeros(N); i0 = int(at * SR); n = min(N - i0, int(7 * SR)); tt = np.arange(n) / SR
    for r, amp, dec in ((0.5, 0.6, 3.5), (1.0, 1.0, 2.6), (1.19, 0.5, 2.0), (1.56, 0.35, 1.6), (2.0, 0.4, 1.2), (2.74, 0.2, 0.8), (3.0, 0.15, 0.6)):
        y[i0:i0 + n] += amp * np.sin(2 * np.pi * f * r * tt) * np.exp(-tt / dec)
    y[i0:i0 + n] *= np.clip(tt / 0.004, 0, 1)
    return y * g


# Karplus–Strong pizzicato (seeded noise)
def pluck(at, m, g=1.0, dec=0.996):
    f = hz(m); p = int(SR / f); n = int(1.2 * SR); i0 = int(at * SR)
    buf = rng.uniform(-1, 1, p); out = np.zeros(n)
    for k in range(n):
        out[k] = buf[k % p]; buf[k % p] = dec * 0.5 * (buf[k % p] + buf[(k + 1) % p])
    out = np.convolve(out, np.ones(6) / 6, mode="same")
    y = np.zeros(N); m2 = min(n, N - i0); y[i0:i0 + m2] = out[:m2] * g
    return y


# lazy tuba sigh: a soft saw glide down a fourth with a slow attack
def sigh(at, m0, m1, d, g=1.0):
    i0 = int(at * SR); n = int(d * SR); tt = np.arange(n) / SR
    f = hz(m0) * (hz(m1) / hz(m0)) ** np.clip((tt - d * 0.35) / (d * 0.5), 0, 1)
    ph = np.cumsum(f) / SR
    x = sum(np.sin(2 * np.pi * k * ph) / k ** 1.3 for k in range(1, 9))
    e = np.clip(tt / 0.12, 0, 1) * np.clip((d - tt) / 0.35, 0, 1)
    y = np.zeros(N); y[i0:i0 + n] = x * e * g
    return y


seg = {s["id"]: s for s in segs}
clip = {c["id"]: (seg_id, s["start"] + c["start"], s["start"] + c["end"]) for seg_id, s in seg.items() for c in s["clips"]}
fx = np.zeros(N); ev = []
# title bell as the title card lights up (lore-01: t ≈ 0.6 + 0.45)
bt = seg["lore-01"]["start"] + 1.0; fx += bell(bt, hz(62), 0.55); ev.append(("bell title", bt))
# chains: two low bells as the camera comes down to the padlock (lore-06, ~ 0.55 of the shot)
s6 = seg["lore-06"]; b6 = s6["start"] + s6["dur"] * 0.5
fx += bell(b6, hz(45), 0.5); ev.append(("bell chains", b6))
# «И ему было лень»: three slow pizzicati falling, then the tuba sigh after the phrase
_, a5, e5 = clip["L05b"]
for k, m in enumerate((62, 60, 57)):
    fx += pluck(a5 - 0.05 + k * 0.42, m, 0.55); ev.append((f"pizz {m}", a5 - 0.05 + k * 0.42))
fx += sigh(e5 + 0.05, 45, 40, 1.5, 0.45); ev.append(("tuba sigh", e5 + 0.05))
# the dispute: a pizzicato «bickering» figure in the gaps between the crowd's phrases
for cid in ("L08", "L09", "L10", "L15"):
    _, _, ce = clip[cid]
    for k, m in enumerate((69, 65, 69, 64)):
        fx += pluck(ce + 0.08 + k * 0.13, m, 0.32); ev.append((f"pizz {cid}", ce + 0.08 + k * 0.13)) if k == 0 else None
# «базовыми знаниями»: a smug little cadence after the phrase
_, _, e11 = clip["L11"]
for k, m in enumerate((65, 64, 62, 69)):
    fx += pluck(e11 + 0.1 + k * 0.2, m, 0.4)
ev.append(("cadence L11", e11 + 0.1))
# end card: the big bell on «СЛАВА РУИНЕ»
_, _, e12 = clip["L12"]; fx += bell(e12 + 0.2, hz(50), 0.75); ev.append(("bell end", e12 + 0.2))

# mix: drone + choir centred with a little width, fx slightly panned
w = 0.0025
dl = int(w * SR)
ch_l = choir; ch_r = np.concatenate([np.zeros(dl), choir[:-dl]])
L = 0.32 * drone + 0.11 * ch_l + 0.9 * fx
R = 0.32 * drone + 0.11 * ch_r + 0.9 * np.concatenate([np.zeros(int(0.0012 * SR)), fx[:-int(0.0012 * SR)]])
# simple room: two feedback-free echoes for space
for d, g in ((0.043, 0.22), (0.071, 0.16), (0.113, 0.11)):
    k = int(d * SR)
    L[k:] += g * R[:-k]; R[k:] += g * L[:-k]
out = np.stack([L, R], 1)
fade = np.clip((T - 0.4 - t) / 2.5, 0, 1)[:, None]
out *= fade
pk = np.abs(out).max(); out *= 0.5 / pk   # headroom only; loudness is set in the mix with one static gain
os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
with wave.open(a.out, "wb") as f:
    f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR)
    f.writeframes((np.clip(out, -1, 1) * 32767).astype("<i2").tobytes())
for name, at in ev:
    print(f"  event {name:12s} @ {at:6.2f}")
print(f"wrote {a.out} · {T:.2f} s · peak normalised to −6 dBFS")
