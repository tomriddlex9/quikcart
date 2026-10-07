"""Routes under ``/api/v1/b/`` — the business console's plain-language API.

Access is gated by B1's ``require_permission``: ``kpi:read`` for everything and
``drill:store`` for a single store. With ``auth_enforce`` off (the default) an
anonymous caller is a synthetic admin, so the console keeps working unauthenticated;
with it on, a session cookie with the permission is required.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Annotated, Any, Literal

import psycopg
import structlog
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from quickcart.api.business import service as svc
from quickcart.api.business.readmodel import ReadModel
from quickcart.api.business.schemas import (
    AlertsResponse,
    CustomersHealthResponse,
    DeliveryHealthResponse,
    JourneyStep,
    JourneySummary,
    MetricExplainResponse,
    MetricsCatalogResponse,
    MoneyResponse,
    ProductsResponse,
    ReportCreate,
    ReportRow,
    ReportsResponse,
    StoreDetail,
    StoreScorecardsResponse,
    TargetsResponse,
    TodayResponse,
)
from quickcart.api.deps import CurrentPrincipal, require_permission
from quickcart.db.connection import connect

log = structlog.get_logger(__name__)


def get_readmodel(request: Request) -> Iterator[ReadModel]:
    """One read-only connection per request, closed when the response is done."""
    factory: Callable[..., psycopg.Connection] = getattr(
        request.app.state, "connect_factory", connect
    )
    try:
        conn = factory()
    except psycopg.OperationalError as exc:
        log.warning("business.db_unavailable", error=str(exc))
        raise HTTPException(503, "The data store is not reachable right now.") from exc
    with conn:
        conn.read_only = True
        yield ReadModel(conn)


ReadModelDep = Annotated[ReadModel, Depends(get_readmodel)]

router = APIRouter(
    prefix="/api/v1/b",
    tags=["business"],
    dependencies=[Depends(require_permission("kpi:read"))],
)


@router.get("/today")
def today(rm: ReadModelDep) -> TodayResponse:
    return svc.BusinessService(rm).today()


@router.get("/stores/scorecards")
def store_scorecards(rm: ReadModelDep) -> StoreScorecardsResponse:
    return svc.BusinessService(rm).store_scorecards()


@router.get("/stores/{store_id}", dependencies=[Depends(require_permission("drill:store"))])
def store_detail(store_id: int, rm: ReadModelDep) -> StoreDetail:
    return svc.BusinessService(rm).store_detail(store_id)


@router.get("/products")
def products(
    rm: ReadModelDep,
    tab: Literal["running_low", "bestsellers", "slow"] = "running_low",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> ProductsResponse:
    return svc.BusinessService(rm).products(tab, limit)


@router.get("/delivery/health")
def delivery_health(rm: ReadModelDep) -> DeliveryHealthResponse:
    return svc.BusinessService(rm).delivery_health()


@router.get("/customers/health")
def customers_health(rm: ReadModelDep) -> CustomersHealthResponse:
    return svc.BusinessService(rm).customers_health()


@router.get("/money")
def money(rm: ReadModelDep) -> MoneyResponse:
    return svc.BusinessService(rm).money()


@router.get("/targets")
def targets(rm: ReadModelDep) -> TargetsResponse:
    return svc.BusinessService(rm).targets()


@router.get("/alerts")
def alerts(rm: ReadModelDep) -> AlertsResponse:
    return svc.BusinessService(rm).alerts()


@router.get("/reports")
def reports(rm: ReadModelDep) -> ReportsResponse:
    return svc.BusinessService(rm).reports()


@router.post("/reports", status_code=201)
def create_report(
    body: ReportCreate,
    rm: ReadModelDep,
    principal: CurrentPrincipal,
) -> ReportRow:
    uid = principal.user_id if principal.user_id > 0 else None
    return svc.BusinessService(rm).create_report(body, user_id=uid)


@router.get("/metrics")
def metrics_catalog() -> MetricsCatalogResponse:
    return svc.BusinessService.metrics_catalog()


@router.get("/metrics/{key}/explain")
def explain_metric(key: str, rm: ReadModelDep) -> MetricExplainResponse:
    return svc.BusinessService(rm).explain_metric(key)


@router.get("/journeys")
def journeys() -> list[JourneySummary]:
    return svc.list_journeys()


@router.get("/journeys/{journey_id}/steps/{n}")
def journey_step(journey_id: str, n: int) -> JourneyStep:
    return svc.journey_step(journey_id, n)


def _not_found(_: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


def _db_unavailable(_: Request, exc: Exception) -> JSONResponse:
    log.warning("business.db_error", error=str(exc))
    return JSONResponse(
        status_code=503, content={"detail": "The data store is not reachable right now."}
    )


def register_business_routes(app: FastAPI) -> None:
    """Mount the business router and its error mapping on ``app``."""
    handlers: dict[type[Exception], Any] = {
        svc.NotFoundError: _not_found,
        psycopg.OperationalError: _db_unavailable,
    }
    for exc_type, handler in handlers.items():
        app.add_exception_handler(exc_type, handler)
    app.include_router(router)
