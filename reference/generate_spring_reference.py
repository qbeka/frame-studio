"""Independent reference values for Frame's spring evaluator.

This shares no formula with packages/runtime/src/spring.ts. The runtime uses the closed forms of
the three damping regimes. This file writes the system as x' = A x with
A = [[0, 1], [-k/m, -c/m]] and uses a 50 digit matrix exponential, which never asks which regime
it is in. Retargeting is stepped piecewise: position and velocity at the end of one leg are the
start of the next. The output is checked in, so the test suite needs no Python.

Run: uv run --with mpmath==1.3.0 python reference/generate_spring_reference.py
"""
import hashlib
import json
import pathlib
import mpmath as mp

mp.mp.dps = 50


def step(spring, d, v, seconds):
    """Advance displacement d and velocity v by seconds, using expm(A * seconds)."""
    k, c, m = spring["stiffness"], spring["damping"], spring["mass"]
    a = mp.matrix([[0, 1], [-mp.mpf(k) / m, -mp.mpf(c) / m]])
    out = mp.expm(a * mp.mpf(seconds)) * mp.matrix([d, v])
    return out[0], out[1]


SPRINGS = {
    "underdamped": {"stiffness": 380, "damping": 24, "mass": 1},
    "lightly-underdamped": {"stiffness": 900, "damping": 6, "mass": 1},
    "critical": {"stiffness": 400, "damping": 40, "mass": 1},
    "overdamped": {"stiffness": 200, "damping": 80, "mass": 1},
    "heavy": {"stiffness": 300, "damping": 30, "mass": 2.5},
    "near-critical-below": {"stiffness": 400, "damping": 39.9999999, "mass": 1},
    "near-critical-above": {"stiffness": 400, "damping": 40.0000001, "mass": 1},
}

STARTS = [
    {"from": 0, "velocity": 0, "to": 100},
    {"from": 100, "velocity": 0, "to": 0},
    {"from": 40, "velocity": -900, "to": 240},
    {"from": 12.5, "velocity": 3000, "to": 12.5},
]

TIMES_MS = [0, 1, 8.333, 16.667, 50, 123.456, 250, 500, 1000, 2500]


def points():
    rows = []
    for name, spring in SPRINGS.items():
        for start in STARTS:
            for ms in TIMES_MS:
                d, v = step(spring, mp.mpf(start["from"]) - start["to"], start["velocity"], mp.mpf(ms) / 1000)
                rows.append({
                    "spring": name, "from": start["from"], "velocityIn": start["velocity"],
                    "to": start["to"], "ms": ms,
                    "position": float(d + start["to"]), "velocity": float(v),
                })
    return rows


def last_outside_ms(spring, start, px, px_per_s, grid_ms=0.25, horizon_ms=8000):
    """Latest grid time at which the true path is outside either threshold."""
    d = mp.mpf(start["from"]) - start["to"]
    v = mp.mpf(start["velocity"])
    k, c, m = spring["stiffness"], spring["damping"], spring["mass"]
    a = mp.matrix([[0, 1], [-mp.mpf(k) / m, -mp.mpf(c) / m]])
    e = mp.expm(a * (mp.mpf(grid_ms) / 1000))
    e00, e01, e10, e11 = float(e[0, 0]), float(e[0, 1]), float(e[1, 0]), float(e[1, 1])
    d, v = float(d), float(v)
    last = -1.0
    for i in range(int(horizon_ms / grid_ms) + 1):
        if abs(d) > px or abs(v) > px_per_s:
            last = i * grid_ms
        d, v = e00 * d + e01 * v, e10 * d + e11 * v
    return last


def settle_cases():
    rows = []
    for name, spring in SPRINGS.items():
        for start in STARTS:
            rows.append({
                "spring": name, "from": start["from"], "velocityIn": start["velocity"], "to": start["to"],
                "px": 0.1, "pxPerSecond": 5,
                "lastOutsideMs": last_outside_ms(spring, start, 0.1, 5),
            })
    return rows


SEQUENCES = [
    {
        "name": "reversal halfway",
        "start": 0,
        "legs": [
            {"atMs": 0, "to": 300, "spring": "underdamped"},
            {"atMs": 120, "to": 0, "spring": "underdamped"},
        ],
    },
    {
        "name": "reversal into a stiffer spring",
        "start": 0,
        "legs": [
            {"atMs": 0, "to": 300, "spring": "underdamped"},
            {"atMs": 90, "to": 0, "spring": "lightly-underdamped"},
        ],
    },
    {
        "name": "repeated retargeting across regimes",
        "start": 10,
        "legs": [
            {"atMs": 0, "to": 200, "spring": "critical"},
            {"atMs": 40, "to": -50, "spring": "overdamped"},
            {"atMs": 95.5, "to": 400, "spring": "underdamped"},
            {"atMs": 111, "to": 120, "spring": "heavy"},
            {"atMs": 300, "to": 121, "spring": "lightly-underdamped"},
        ],
    },
]


def sequences():
    out = []
    for sequence in SEQUENCES:
        legs = sequence["legs"]
        x = mp.mpf(sequence["start"])
        v = mp.mpf(0)
        samples = []
        for i, leg in enumerate(legs):
            spring = SPRINGS[leg["spring"]]
            end = legs[i + 1]["atMs"] if i + 1 < len(legs) else leg["atMs"] + 2000
            for offset in [j * (end - leg["atMs"]) / 8 for j in range(8)]:
                d, u = step(spring, x - leg["to"], v, mp.mpf(offset) / 1000)
                samples.append({"ms": leg["atMs"] + offset, "position": float(d + leg["to"]), "velocity": float(u)})
            d, u = step(spring, x - leg["to"], v, mp.mpf(end - leg["atMs"]) / 1000)
            x, v = d + leg["to"], u
        out.append({**sequence, "samples": samples})
    return out


if __name__ == "__main__":
    here = pathlib.Path(__file__).parent
    result = {
        "method": "mpmath 1.3.0 matrix exponential at 50 digits, stepped piecewise",
        "springs": SPRINGS,
        "points": points(),
        "settle": settle_cases(),
        "sequences": sequences(),
    }
    text = json.dumps(result, indent=1) + "\n"
    (here / "spring-reference.json").write_text(text)
    print("points", len(result["points"]), "settle", len(result["settle"]), "sha256", hashlib.sha256(text.encode()).hexdigest()[:16])
