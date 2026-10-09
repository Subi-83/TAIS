from dataclasses import asdict, dataclass


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

    def __init__(self, min_replicas: int, max_replicas: int, dry_run: bool) -> None:
        self.state = ScalingState(min_replicas, max_replicas, min_replicas, min_replicas, dry_run)

    def evaluate(self, queued_requests: int, active_requests: int) -> dict:
        target = min(self.state.max_replicas, max(self.state.min_replicas, queued_requests + active_requests))
        self.state.desired_replicas = target
        self.state.last_reason = "dry-run capacity estimate" if self.state.dry_run else "no deployment manager configured"
        return asdict(self.state)

    def configure(self, min_replicas: int, max_replicas: int, dry_run: bool) -> dict:
        if min_replicas > max_replicas:
            raise ValueError("min_replicas cannot exceed max_replicas")
        self.state.min_replicas = min_replicas
        self.state.max_replicas = max_replicas
        self.state.dry_run = dry_run
        return asdict(self.state)

    def snapshot(self) -> dict:
        return asdict(self.state)
