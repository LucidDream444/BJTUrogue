"""Generate the 60 BPM, four-bar performance loop used by 演奏家大鹅.

The output is an exact 16-second mono PCM WAV. Keeping the loop uncompressed
avoids MP3 encoder padding and makes the loop point sample-exact.
"""

from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path


SAMPLE_RATE = 22_050
BPM = 60
BEAT_SECONDS = 60 / BPM
BARS = 4
TOTAL_SECONDS = BARS * 4 * BEAT_SECONDS
FRAME_COUNT = round(TOTAL_SECONDS * SAMPLE_RATE)
OUTPUT = Path(__file__).resolve().parents[5] / "public/assets/audio/bgm/bgm_performer_stage_loop_4bar_60bpm.wav"

ROOTS = [130.8128, 110.0, 87.3071, 98.0]
CHORDS = [
    [261.6256, 329.6276, 392.0, 493.8833],
    [220.0, 261.6256, 329.6276, 392.0],
    [174.6141, 220.0, 261.6256, 329.6276],
    [196.0, 246.9417, 293.6648, 349.2282],
]
MELODY = [
    1046.502, 1318.51, 1567.982, 1318.51,
    880.0, 1046.502, 1318.51, 1567.982,
    698.456, 880.0, 1046.502, 1318.51,
    783.991, 987.767, 1174.659, 1396.913,
]


def envelope(time_s: float, duration_s: float, attack_s: float, release_s: float) -> float:
    if time_s < 0 or time_s >= duration_s:
        return 0.0
    attack = min(1.0, time_s / max(attack_s, 1e-6))
    release = min(1.0, (duration_s - time_s) / max(release_s, 1e-6))
    return max(0.0, min(attack, release))


def pluck(time_s: float, frequency: float, duration_s: float, brightness: float) -> float:
    env = envelope(time_s, duration_s, 0.008, 0.20)
    if env <= 0:
        return 0.0
    return env * (
        math.sin(2 * math.pi * frequency * time_s)
        + brightness * math.sin(2 * math.pi * frequency * 2 * time_s + 0.3)
        + 0.3 * brightness * math.sin(2 * math.pi * frequency * 3 * time_s)
    )


def pad(time_s: float, frequencies: list[float]) -> float:
    env = envelope(time_s, BEAT_SECONDS * 4, 0.12, 0.22)
    if env <= 0:
        return 0.0
    return env * sum(
        math.sin(2 * math.pi * frequency * time_s + index * 0.22)
        for index, frequency in enumerate(frequencies)
    ) / len(frequencies)


def beat_click(local_s: float, accent: bool) -> float:
    click_env = math.exp(-local_s * 34.0) if local_s >= 0 else 0.0
    kick_env = math.exp(-local_s * 18.0) if local_s >= 0 else 0.0
    wood = math.sin(2 * math.pi * (960 if accent else 760) * local_s)
    kick = math.sin(2 * math.pi * (68 if accent else 62) * local_s)
    return click_env * wood * (0.19 if accent else 0.13) + kick_env * kick * (0.22 if accent else 0.12)


def main() -> None:
    rng = random.Random(602026)
    samples: list[int] = []
    noise_buffer = [rng.uniform(-1.0, 1.0) for _ in range(2048)]

    for frame in range(FRAME_COUNT):
        t = frame / SAMPLE_RATE
        beat_index = min(15, int(t / BEAT_SECONDS))
        beat_local = t - beat_index * BEAT_SECONDS
        bar = min(BARS - 1, beat_index // 4)
        bar_local = t - bar * 4 * BEAT_SECONDS

        root = pluck(bar_local, ROOTS[bar], BEAT_SECONDS * 0.82, 0.20) * 0.20
        chord = pad(bar_local, CHORDS[bar]) * 0.09
        melody = pluck(beat_local, MELODY[beat_index], BEAT_SECONDS * 0.86, 0.42) * 0.18
        click = beat_click(beat_local, beat_index % 4 == 0)

        # A closed high-hat on every beat keeps the one-second grid audible even
        # when the melodic phrase sustains.
        hat_env = math.exp(-beat_local * 78.0)
        hat = noise_buffer[(frame * 7) % len(noise_buffer)] * hat_env * 0.035

        # The last 35 ms fades into silence, so looping back to sample zero has
        # no discontinuity.
        loop_fade = envelope(t, TOTAL_SECONDS, 0.004, 0.035)
        mixed = (root + chord + melody + click + hat) * loop_fade
        samples.append(max(-32767, min(32767, round(mixed * 32767))))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUTPUT), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(struct.pack("<" + "h" * len(samples), *samples))
    print(f"wrote {OUTPUT} ({OUTPUT.stat().st_size} bytes, {TOTAL_SECONDS:.3f}s @ {BPM} BPM)")


if __name__ == "__main__":
    main()
