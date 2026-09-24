"""FastAPI application factory (kit/03 §14.1): the service boundary over Gold
readers, ML predictions, the Phase 13 agent, and the human-approved proposal
flow. All analytics reads go through GoldReaders (module-cached Spark); the
operational DB is touched only by ProposalService.
"""

import contextlib
import importlib.metadata
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any

import structlog
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F

from quickcart.api.models import (
    ApproveRequest,
    ChatRequest,
    ChatResponse,
    ProposalCreate,
    ProposalOut,
    ProposalStatus,
    RejectRequest,
)
from quickcart.api.proposals import ProposalError, ProposalService
from quickcart.api.status import build_system_status
from quickcart.config.settings import get_settings
from quickcart.lakehouse.common.paths import table_path
from quickcart.lakehouse.common.spark import build_spark
from quickcart.lakehouse.readers import GoldReaders
from quickcart.logging import configure_logging

log = structlog.get_logger(__name__)

try:
    __version__ = importlib.metadata.version("quickcart-intelligence")
except importlib.metadata.PackageNotFoundError:  # source tree without install
    __version__ = "0.1.0-dev"

ANOMALIES_TABLE = "gold_anomalies"
DELIVERY_PREDICTIONS_TABLE = "gold_delivery_predictions"
DEMAND_FORECASTS_TABLE = "gold_demand_forecasts"


@lru_cache
def _build_api_spark() -> SparkSession:
    """Module-level cached Spark for the readers (one session per process)."""
    return build_spark("quickcart-api")


@lru_cache
def _get_agent_service() -> Any | None:
    """Phase 13 agent interface; None until `quickcart.agents.service` exists."""
    try:
        from quickcart.agents import service as agent_service
    except ImportError:
        return None
    return agent_service if hasattr(agent_service, "chat") else None


def _collect(df: DataFrame, limit: int | None = None) -> list[dict[str, Any]]:
    rows = df.limit(limit).collect() if limit is not None else df.collect()
    return [row.asDict() for row in rows]


def _readers(request: Request) -> GoldReaders:
    state = request.app.state
    if state.spark is None:
        state.spark = _build_api_spark()
        state.spark_owned = True
    if state.readers is None:
        state.readers = GoldReaders(state.spark, state.data_root)
    return state.readers


def _service(request: Request) -> ProposalService:
    return request.app.state.proposal_service

ReadersDep = Annotated[GoldReaders, Depends(_readers)]


def _translate(error: ProposalError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail)


@contextlib.asynccontextmanager
async def _lifespan(app: FastAPI):
    configure_logging(get_settings().log_level)
    log.info("api.startup", service="quickcart-api", version=__version__)
    yield
    spark = app.state.spark
    if app.state.spark_owned and spark is not None:
        log.info("api.shutdown", stopping_spark=True)
        spark.stop()


def create_app(
    *,
    spark: SparkSession | None = None,
    data_root: Path | None = None,
    proposal_service: ProposalService | None = None,
) -> FastAPI:
    """Application factory. Parameters exist so tests can inject the shared
    test Spark session, a tmp data root, and a service bound to the test DB."""
    app = FastAPI(title="QuickCart Intelligence API", version=__version__, lifespan=_lifespan)
    app.state.spark = spark
    app.state.spark_owned = spark is None
    app.state.data_root = data_root
    app.state.readers = None
    app.state.proposal_service = proposal_service or ProposalService()

    from quickcart.observability import CorrelationIdMiddleware

    app.add_middleware(CorrelationIdMiddleware)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "quickcart-api", "version": __version__}

    # --- analytics (Gold via readers) -------------------------------------------
    @app.get("/api/v1/overview/kpis")
    def overview_kpis(readers: ReadersDep) -> dict[str, Any]:
        return readers.kpi_summary()

    @app.get("/api/v1/trends/orders")
    def orders_trend(readers: ReadersDep) -> list[dict[str, Any]]:
        return _collect(readers.orders_trend(), limit=365)

    @app.get("/api/v1/stores")
    def stores(readers: ReadersDep) -> list[dict[str, Any]]:
        return _collect(readers.stores())

    @app.get("/api/v1/stores/{store_id}/metrics")
    def store_metrics(store_id: int, readers: ReadersDep) -> dict[str, Any]:
        comparison = readers.store_comparison().filter(F.col("store_id") == store_id).first()
        hourly = readers.store_hourly(store_id)
        return {
            "store_id": store_id,
            "comparison": comparison.asDict() if comparison else None,
            "hourly_sample": _collect(hourly, limit=168),
        }

    @app.get("/api/v1/inventory/risks")
    def inventory_risks(
        readers: ReadersDep, store_id: int | None = None
    ) -> list[dict[str, Any]]:
        cap = 10_000 if store_id is not None else 200
        df = readers.inventory_risk(limit=cap)
        if store_id is not None:
            df = df.filter(F.col("store_id") == store_id)
        return _collect(df)

    @app.get("/api/v1/orders/{order_id}")
    def get_order(order_id: int, readers: ReadersDep) -> dict[str, Any]:
        orders = readers.spark.read.format("delta").load(
            str(table_path("silver", "silver_orders", readers.root))
        )
        order = orders.filter(F.col("order_id") == order_id).first()
        if order is None:
            raise HTTPException(status_code=404, detail=f"order {order_id} not found")
        deliveries = readers.spark.read.format("delta").load(
            str(table_path("silver", "silver_deliveries", readers.root))
        )
        delivery = deliveries.filter(F.col("order_id") == order_id).first()
        return {
            "order": order.asDict(),
            "delivery": delivery.asDict() if delivery else None,
        }

    @app.get("/api/v1/anomalies")
    def anomalies(readers: ReadersDep) -> Response:
        path = table_path("gold", ANOMALIES_TABLE, readers.root)
        if not path.exists():
            return JSONResponse(
                content=[],
                headers={
                    "X-Data-Warning": f"{ANOMALIES_TABLE} not built yet"
                    " (run the Phase 11 anomaly model)"
                },
            )
        df = readers.spark.read.format("delta").load(str(path))
        return JSONResponse(content=_collect(df.orderBy(F.desc("observed_on")), limit=100))

    @app.get("/api/v1/predictions/delivery/{order_id}")
    def delivery_prediction(
        order_id: int, readers: ReadersDep
    ) -> dict[str, Any]:
        path = table_path("gold", DELIVERY_PREDICTIONS_TABLE, readers.root)
        if not path.exists():
            raise HTTPException(status_code=404, detail="delivery predictions not built yet")
        df = readers.spark.read.format("delta").load(str(path))
        row = df.filter(F.col("order_id") == order_id).first()
        if row is None:
            raise HTTPException(
                status_code=404, detail=f"no delivery prediction for order {order_id}"
            )
        return row.asDict()

    @app.get("/api/v1/predictions/demand")
    def demand_predictions(
        readers: ReadersDep,
        store_id: int | None = None,
        category: str | None = None,
    ) -> Response:
        path = table_path("gold", DEMAND_FORECASTS_TABLE, readers.root)
        if not path.exists():
            return JSONResponse(
                content=[],
                headers={
                    "X-Data-Warning": f"{DEMAND_FORECASTS_TABLE} not built yet"
                    " (run the Phase 11 demand model)"
                },
            )
        df = readers.spark.read.format("delta").load(str(path))
        if store_id is not None:
            df = df.filter(F.col("store_id") == store_id)
        if category is not None:
            df = df.filter(F.col("category") == category)
        return JSONResponse(content=_collect(df, limit=500))

    # --- system map (frontend) ----------------------------------------------------
    @app.get("/api/v1/system/status")
    def system_status(request: Request) -> dict[str, Any]:
        return build_system_status(request.app.state.data_root)

    # --- agent (Phase 13 owns the service) -----------------------------------------
    @app.post("/api/v1/agent/chat", response_model=ChatResponse)
    def agent_chat(body: ChatRequest) -> ChatResponse:
        service = _get_agent_service()
        if service is None:
            raise HTTPException(status_code=503, detail="agent not available")
        result = service.chat(message=body.message, session_id=body.session_id)
        return ChatResponse(**result)

    # --- proposals (human-approved actions) ------------------------------------------
    @app.post("/api/v1/proposals", response_model=ProposalOut, status_code=201)
    def create_proposal(body: ProposalCreate, request: Request) -> dict[str, Any]:
        try:
            return _service(request).create(body)
        except ProposalError as exc:
            raise _translate(exc) from exc

    @app.get("/api/v1/proposals", response_model=list[ProposalOut])
    def list_proposals(
        request: Request, status: ProposalStatus | None = None
    ) -> list[dict[str, Any]]:
        try:
            return _service(request).list_proposals(status=status)
        except ProposalError as exc:
            raise _translate(exc) from exc

    @app.get("/api/v1/proposals/{proposal_id}", response_model=ProposalOut)
    def get_proposal(proposal_id: int, request: Request) -> dict[str, Any]:
        try:
            row = _service(request).get(proposal_id)
        except ProposalError as exc:
            raise _translate(exc) from exc
        if row is None:
            raise HTTPException(status_code=404, detail=f"proposal {proposal_id} not found")
        return row

    @app.post("/api/v1/proposals/{proposal_id}/approve", response_model=ProposalOut)
    def approve_proposal(
        proposal_id: int, body: ApproveRequest, request: Request
    ) -> dict[str, Any]:
        try:
            return _service(request).approve(proposal_id, body.approver)
        except ProposalError as exc:
            raise _translate(exc) from exc

    @app.post("/api/v1/proposals/{proposal_id}/reject", response_model=ProposalOut)
    def reject_proposal(proposal_id: int, body: RejectRequest, request: Request) -> dict[str, Any]:
        try:
            return _service(request).reject(proposal_id, body.approver, body.reason)
        except ProposalError as exc:
            raise _translate(exc) from exc

    @app.get("/api/v1/proposals/{proposal_id}/audit")
    def proposal_audit(proposal_id: int, request: Request) -> list[dict[str, Any]]:
        try:
            return _service(request).audit_trail(proposal_id)
        except ProposalError as exc:
            raise _translate(exc) from exc

    return app
