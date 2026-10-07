"""Response contracts for the business API (``/api/v1/b/*``).

Everything a page needs is already in plain language: labels and display
strings come from the semantic registry, and every metric carries a status
(good / watch / bad / unknown) so the console never decides what "bad" means.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

Status = Literal["good", "watch", "bad", "unknown"]
DataSource = Literal["serving", "live_sql", "unavailable"]


class Meta(BaseModel):
    """Where the numbers came from and which day they describe."""

    as_of_day: date | None = None
    is_today: bool = False
    source: DataSource = "unavailable"
    snapshot_run_id: int | None = None
    snapshot_finished_at: datetime | None = None
    generated_at: datetime
    compare_label: str = "the same day last week"
    note: str | None = None


class MetricValue(BaseModel):
    key: str
    label: str
    value: float | None = None
    display: str
    unit: Literal["inr", "pct", "count", "minutes"]
    status: Status = "unknown"
    direction: Literal["higher_better", "lower_better"]
    baseline_value: float | None = None
    baseline_display: str | None = None
    delta_pct: float | None = None
    compare_to: str
    compare_label: str
    explanation: str
    plain_description: str
    is_partial: bool = False
    as_of: date | None = None


class AttentionItem(BaseModel):
    id: str
    severity: Literal["watch", "bad"]
    title: str
    detail: str
    metric_key: str | None = None
    store_id: int | None = None
    store_name: str | None = None


class TodayResponse(BaseModel):
    meta: Meta
    summary: str
    headline: list[MetricValue]
    more: list[MetricValue]
    attention: list[AttentionItem]


class StoreScorecard(BaseModel):
    store_id: int
    store_name: str
    city: str | None = None
    status: Status
    metrics: dict[str, MetricValue]
    attention: list[str] = Field(default_factory=list)


class StoreScorecardsResponse(BaseModel):
    meta: Meta
    stores: list[StoreScorecard]


class TrendPoint(BaseModel):
    at: datetime | date
    sales: float | None = None
    orders: int | None = None


class ProductRow(BaseModel):
    product_id: int
    sku: str
    name: str
    category: str
    store_id: int | None = None
    store_name: str | None = None
    on_hand_qty: int | None = None
    reorder_point: int | None = None
    units_sold: int | None = None
    revenue: float | None = None
    revenue_display: str | None = None
    stock_cover_hours: float | None = None
    status: Status = "unknown"
    note: str


class ProductsResponse(BaseModel):
    meta: Meta
    tab: Literal["running_low", "bestsellers", "slow"]
    title: str
    description: str
    items: list[ProductRow]


class StoreDetail(BaseModel):
    meta: Meta
    scorecard: StoreScorecard
    hourly_trend: list[TrendPoint]
    daily_trend: list[TrendPoint]
    running_low: list[ProductRow]


class DeliveryStoreRow(BaseModel):
    store_id: int
    store_name: str
    status: Status
    on_time_rate: MetricValue
    avg_delivery_minutes: MetricValue


class DeliveryHealthResponse(BaseModel):
    meta: Meta
    metrics: list[MetricValue]
    by_store: list[DeliveryStoreRow]
    in_progress: dict[str, int] = Field(default_factory=dict)
    riders: dict[str, int] = Field(default_factory=dict)


class CustomerRow(BaseModel):
    customer_code: str
    orders: int
    spend: float
    spend_display: str
    last_order_at: datetime | None = None


class CustomersHealthResponse(BaseModel):
    meta: Meta
    metrics: list[MetricValue]
    new_customers: int | None = None
    total_customers: int | None = None
    top_customers: list[CustomerRow] = Field(default_factory=list)


class CategoryMoney(BaseModel):
    category: str
    sales: float
    sales_display: str
    share_pct: float | None = None  # 0..1 fraction of category sales
    units: int


class MoneyResponse(BaseModel):
    meta: Meta
    sales: MetricValue
    average_basket: MetricValue
    discounts: float | None = None
    discounts_display: str
    discount_share_pct: float | None = None  # 0..1 fraction of (gross + discounts)
    refunds: float | None = None
    refunds_display: str
    net_sales: float | None = None
    net_sales_display: str
    cogs: float | None = None
    cogs_display: str | None = None
    contribution_margin: float | None = None
    contribution_margin_display: str | None = None
    margin_pct: float | None = None
    by_category: list[CategoryMoney]
    daily_trend: list[TrendPoint]


class TargetRow(BaseModel):
    scope_type: str
    scope_value: str
    scope_label: str
    metric_key: str
    metric_label: str
    period_type: str
    period_start: date
    target_value: float
    target_display: str
    actual_value: float | None = None
    actual_display: str | None = None
    pace_pct: float | None = None
    status: Status = "unknown"
    set_by: str = "system"


class TargetsResponse(BaseModel):
    meta: Meta
    period_start: date | None = None
    period_label: str = "This month"
    items: list[TargetRow] = Field(default_factory=list)
    note: str | None = None


class AlertsResponse(BaseModel):
    meta: Meta
    items: list[AttentionItem] = Field(default_factory=list)
    note: str = "Alerts come from stock risks and suggestions waiting on you."


class ReportRow(BaseModel):
    report_id: int
    title: str
    created_at: datetime | None = None
    schedule: str | None = None


class ReportsResponse(BaseModel):
    meta: Meta
    items: list[ReportRow] = Field(default_factory=list)
    note: str | None = "Saved reports appear here after you save an answer or weekly review."


class ReportCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    spec: dict = Field(default_factory=dict)


class MetricDefinition(BaseModel):
    key: str
    label: str
    plain_description: str
    formula_text: str
    unit: str
    direction: str
    gold_source: str
    synonyms: list[str]
    compare_default: str
    watch_at: float | None = None
    bad_at: float | None = None
    is_partial: bool = False
    partial_note: str | None = None


class MetricsCatalogResponse(BaseModel):
    metrics: list[MetricDefinition]


class MetricExplainResponse(BaseModel):
    definition: MetricDefinition
    current: MetricValue
    meta: Meta


class JourneySummary(BaseModel):
    id: str
    title: str
    audience: str
    summary: str
    step_count: int


class JourneyStep(BaseModel):
    journey_id: str
    n: int
    total: int
    title: str
    body: str
    link: str | None = None
    metric_keys: list[str] = Field(default_factory=list)
    next_n: int | None = None
    prev_n: int | None = None
