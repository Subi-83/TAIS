from app.experiments.workload_generator import generate


def test_workloads_are_reproducible_for_same_seed():
    first = generate("mixed", 4, "mock-echo-1", 7)
    second = generate("mixed", 4, "mock-echo-1", 7)
    assert [item.model_dump() for item in first] == [item.model_dump() for item in second]
