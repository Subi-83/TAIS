import random

from app.models.requests import InferenceRequest


PROFILES = {"short_interactive", "mixed", "long_context", "high_output", "burst", "sustained"}


def generate(profile: str, count: int, model: str, seed: int) -> list[InferenceRequest]:
    if profile not in PROFILES:
        raise ValueError(f"unknown workload profile '{profile}'")
    rng = random.Random(seed)
    items = []
    for index in range(count):
        if profile == "short_interactive":
            words, output = rng.randint(4, 15), rng.randint(16, 64)
        elif profile == "long_context":
            words, output = rng.randint(500, 1500), rng.randint(32, 128)
        elif profile == "high_output":
            words, output = rng.randint(10, 50), rng.randint(500, 1000)
        elif profile == "mixed":
            words, output = (rng.randint(5, 30), rng.randint(16, 80)) if index % 2 else (rng.randint(200, 500), rng.randint(200, 500))
        else:
            words, output = rng.randint(8, 100), rng.randint(32, 200)
        prompt = " ".join([f"w{index}"] * words)
        items.append(InferenceRequest(model=model, prompt=prompt, max_output_tokens=output, expected_output_tokens=output))
    return items
