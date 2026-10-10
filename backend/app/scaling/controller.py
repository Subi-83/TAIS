from dataclasses import asdict, dataclass
from math import ceil


@dataclass
class ScalingState:
    min_replicas: int
    max_replicas: int
    desired_replicas: int
    actual_replicas: int
    dry_run: bool
    last_reason: str = "initial"


class ScalingController:
    """Capacity planner only; it never launches GPU replicas without a deployment manager."""

    def __init__(self, min_replicas: int, max_replicas: int, dry_run: bool, queue_per_replica: int = 20) -> None:
        self.state = ScalingState(min_replicas, max_replicas, min_replicas, min_replicas, dry_run)
        self.queue_per_replica = queue_per_replica

    def evaluate(self, queued_requests: int, active_requests: int) -> dict:
        # Keep enough capacity for both waiting and in-flight work. Capacity
        # never drops below active work, preventing an in-use worker from being
        # deactivated by a concurrent scaling decision.
        work = queued_requests + active_requests
        target = min(
            self.state.max_replicas,
            max(
                self.state.min_replicas,
                active_requests,
                ceil(work / self.queue_per_replica) if work else self.state.min_replicas,
            ),
        )
        self.state.desired_replicas = target
        self.state.actual_replicas = target
        self.state.last_reason = f"work-based capacity: {self.queue_per_replica} queued/active requests per replica"
        return asdict(self.state)

    def capacity(self, queued_requests: int, active_requests: int) -> int:
        return self.evaluate(queued_requests, active_requests)["actual_replicas"]

    def configure(self, min_replicas: int, max_replicas: int, dry_run: bool) -> dict:
        if min_replicas > max_replicas:
            raise ValueError("min_replicas cannot exceed max_replicas")
        self.state.min_replicas = min_replicas
        self.state.max_replicas = max_replicas
        self.state.dry_run = dry_run
        return asdict(self.state)

    def snapshot(self) -> dict:
        return asdict(self.state)
