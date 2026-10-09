import asyncio


class HealthMonitor:
    def __init__(self, app, interval: float) -> None:
        self.app, self.interval, self.healthy, self._task = app, interval, None, None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def close(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self) -> None:
        while True:
            try:
                adapter = self.app.state.real_adapter if self.app.state.settings.inference_mode == "real" else self.app.state.mock_adapter
                await adapter.health_check()
                self.healthy = True
            except Exception:
                self.healthy = False
            await asyncio.sleep(self.interval)
