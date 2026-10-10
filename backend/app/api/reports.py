import csv
import io

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse

from app.api.experiments import persisted_metrics, public, registry

router = APIRouter(prefix="/api/reports", tags=["reports"])


def report(experiment_id: str, request: Request) -> dict:
    experiment = registry(request).get(experiment_id)
    if not experiment:
        raise HTTPException(status_code=404, detail="experiment not found")
    metrics = request.app.state.gateway.metrics.snapshot(experiment_id)
    if not metrics["samples"]:
        metrics = persisted_metrics(request, experiment_id)
    return {"experiment": public(experiment), "metrics": metrics, "measurement_type": "mock" if request.app.state.settings.inference_mode == "mock" else "real"}


@router.get("/{experiment_id}/json")
async def json_report(experiment_id: str, request: Request) -> dict:
    return report(experiment_id, request)


@router.get("/{experiment_id}/csv")
async def csv_report(experiment_id: str, request: Request):
    result = report(experiment_id, request)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["experiment_id", "status", "measurement_type", "completed", "failed", "cancelled", "output_tokens"])
    metrics = result["metrics"]
    writer.writerow([experiment_id, result["experiment"]["status"], result["measurement_type"], metrics["completed"], metrics["failed"], metrics["cancelled"], metrics["output_tokens"]])
    return PlainTextResponse(output.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{experiment_id}.csv"'})
