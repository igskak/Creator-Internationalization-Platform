#!/usr/bin/env python3
"""Synthesises a royalty-free placeholder beat (120 BPM) synced to the Reel's cuts. Pure Python, no deps.
usage: make-sound.py <out.wav> <cut-beats comma list, e.g. 3.5,3,4,...>  (durations of each scene in beats)"""
import array, math, random, sys, wave
SR = 44100; BEAT = 0.5
out, spec = sys.argv[1], [float(x) for x in sys.argv[2].split(",")]
flash = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0   # seconds of flash opener before scene 1 (variant B)
total_beats = sum(spec); dur = total_beats * BEAT + flash + 0.6
n = int(dur * SR); buf = [0.0] * n
random.seed(7)
def add(t0, samples, gain=1.0):
    i0 = int(t0 * SR)
    for k, v in enumerate(samples):
        if 0 <= i0 + k < n: buf[i0 + k] += v * gain
def kick():
    L = int(0.28 * SR); return [math.sin(2*math.pi*(48*(t:=k/SR) + 70*(1-math.exp(-t*30))/30*1.0)) * math.exp(-t*11) for k in range(L)]
def clap():
    L = int(0.16 * SR); return [(random.random()*2-1) * math.exp(-(k/SR)*28) * 0.8 for k in range(L)]
def hat(open_=False):
    L = int((0.12 if open_ else 0.035) * SR); d = 20 if open_ else 90
    prev = 0; r = []
    for k in range(L):                       # crude high-pass noise
        x = random.random()*2-1; r.append((x - prev) * math.exp(-(k/SR)*d) * 0.5); prev = x
    return r
def bass(f, length=0.22):
    L = int(length * SR); return [math.sin(2*math.pi*f*(k/SR)) * math.exp(-(k/SR)*7) * 0.9 for k in range(L)]
def pop(f=1400):
    L = int(0.07 * SR); return [math.sin(2*math.pi*f*(k/SR)) * math.exp(-(k/SR)*55) * 0.5 for k in range(L)]
def boom():
    L = int(0.9 * SR); return [math.sin(2*math.pi*(38 + 60*math.exp(-(k/SR)*9))*(k/SR)) * math.exp(-(k/SR)*3.2) * 1.2 for k in range(L)]
def riser(length):
    L = int(length * SR); r = []; ph = 0
    for k in range(L):
        p = k / L; ph += 2*math.pi*(300 + 2600*p*p) / SR
        r.append((math.sin(ph)*0.25 + (random.random()*2-1)*0.2) * p * 0.6)
    return r
# scene start times (in beats) and what plays
starts = []; b = 0.0
for d in spec: starts.append(b); b += d
t_off = flash
beat_i = 0
while beat_i < total_beats * 2:              # 8th-note grid
    t = t_off + beat_i * BEAT / 2
    on_beat = beat_i % 2 == 0; beat_no = beat_i // 2
    scene = max(i for i, s in enumerate(starts) if s <= beat_i / 2 + 1e-9)
    intro = scene == 0                       # hook scene: only hats and sub pulse (tension)
    if on_beat and not intro: add(t, kick(), 0.9)
    if on_beat and beat_no % 2 == 1 and not intro: add(t, clap(), 0.35)
    add(t, hat(open_=not on_beat), 0.22 if on_beat else 0.30)
    if not on_beat and not intro: add(t, bass(55 if (beat_no % 4) < 2 else 73.4), 0.55)
    if intro and on_beat: add(t, bass(55, 0.3), 0.55)
    beat_i += 1
for i, s in enumerate(starts):               # accent on every cut
    t = t_off + s * BEAT
    if i > 0: add(t, pop(1400 if i % 2 else 1800), 0.5)
add(t_off + starts[4] * BEAT - 0.02, boom(), 0.75)   # scene 5 = "TOAST IT FIRST." impact
if flash: add(0.0, riser(flash), 0.5)                # variant B: flash opener riser
# end: ring-out tail, fade
for k in range(n):
    f = 1.0
    tail = dur - 0.5
    if k / SR > tail: f = max(0.0, 1 - (k/SR - tail) / 0.5)
    buf[k] *= f
peak = max(abs(x) for x in buf) or 1
w = wave.open(out, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
w.writeframes(array.array("h", [int(max(-1, min(1, x / peak * 0.85)) * 32767) for x in buf]).tobytes()); w.close()
print("wrote", out, f"{dur:.2f}s")
