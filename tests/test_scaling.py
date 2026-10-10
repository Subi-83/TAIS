from app.scaling.controller import ScalingController


def test_capacity_counts_queued_and_active_work():
    controller = ScalingController(1, 8, False, queue_per_replica=20)
    assert controller.capacity(19, 1) == 1
    assert controller.capacity(20, 1) == 2
    assert controller.capacity(39, 2) == 3


def test_capacity_never_scales_below_active_requests():
    controller = ScalingController(1, 8, False, queue_per_replica=20)

    assert controller.capacity(0, 4) == 4


def test_one_request_per_replica_activates_parallel_capacity():
    controller = ScalingController(1, 5, False, queue_per_replica=1)

    assert controller.capacity(5, 0) == 5
    assert controller.capacity(2, 3) == 5
