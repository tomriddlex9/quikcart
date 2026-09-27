"""Dashboard page renderers.

Each page function receives a `GoldReaders` and the streamlit module (injected
so tests can exercise query logic without a streamlit runtime). Charts are
Plotly; every dataset comes from Gold/silver dimensions per the phase rule —
except the Approvals page (Phase 14), which reads action proposals from the
operational DB because that is where the approval gate lives.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import plotly.express as px
import psycopg

from quickcart.db.connection import connect_dict
from quickcart.lakehouse.common.paths import table_path

PAGES = [
    "Overview",
    "Stores",
    "Inventory",
    "Delivery",
    "Customers",
    "Products",
    "Pipeline & Quality",
    "Approvals",
]
PAGE_REGISTRY = [(name, name) for name in PAGES]

EMPTY_GOLD_HELP = (
    "No Gold data yet. Run **`make lakehouse`** for a full batch build, "
    "or start the **live-worker** (`quickcart-live-worker`) and wait for "
    "Gold tables to populate."
)

# Primary signal that the Gold mart exists (local Delta layout).
_GOLD_MARKER_TABLE = ("gold", "gold_store_hourly_metrics")


def render_page(page: str, readers, st) -> None:
    dispatch = {
        "Overview": page_overview,
        "Stores": page_stores,
        "Inventory": page_inventory,
        "Delivery": page_delivery,
        "Customers": page_customers,
        "Products": page_products,
        "Pipeline & Quality": page_quality,
        "Approvals": page_approvals,
    }
    dispatch[page](readers, st)


def _to_pandas(df):
    return df.toPandas()


def _delta_table_exists(root: Path | None, layer: str, table: str) -> bool:
    return (table_path(layer, table, root) / "_delta_log").is_dir()


def gold_mart_available(readers) -> bool:
    """True when the headline Gold table is present on disk."""
    return _delta_table_exists(readers.root, *_GOLD_MARKER_TABLE)


def _show_empty_gold(st) -> None:
    st.info(EMPTY_GOLD_HELP)


def _safe_pandas(st, loader: Callable[[], Any]):
    """Run a Spark reader; on failure show the empty-Gold help and return None."""
    try:
        return _to_pandas(loader())
    except Exception:
        _show_empty_gold(st)
        return None


def _safe_kpi_summary(readers, st) -> dict | None:
    if not gold_mart_available(readers):
        _show_empty_gold(st)
        return None
    try:
        return readers.kpi_summary()
    except Exception:
        _show_empty_gold(st)
        return None


def page_overview(readers, st) -> None:
    kpis = _safe_kpi_summary(readers, st)
    if kpis is None:
        return
    cols = st.columns(4)
    cols[0].metric("GMV (₹)", f"{kpis['gmv']:,.0f}")
    cols[1].metric("Orders", f"{kpis['orders_placed']:,}")
    cols[2].metric("Cancellation rate", f"{kpis['cancellation_rate']:.1%}")
    cols[3].metric("Late delivery rate", f"{kpis['late_delivery_rate']:.1%}")
    st.caption(
        f"Products below reorder: {kpis['products_below_reorder']} · "
        f"Active customers: {kpis['active_customers']:,}"
    )

    trend = _safe_pandas(st, readers.orders_trend)
    if trend is None:
        return
    if trend.empty:
        st.info(
            "Gold tables exist but have no order metrics yet. "
            "Run **`make lakehouse`** or wait for the live-worker to catch up."
        )
        return
    fig = px.line(trend, x="day", y=["orders", "cancelled"], title="Daily orders")
    st.plotly_chart(fig, use_container_width=True)


def page_stores(readers, st) -> None:
    if not gold_mart_available(readers):
        _show_empty_gold(st)
        return
    comparison = _safe_pandas(st, readers.store_comparison)
    if comparison is None:
        return
    if comparison.empty:
        st.info(
            "Store metrics table is empty. Run **`make lakehouse`** or wait "
            "for the live-worker to publish **`gold_store_hourly_metrics`**."
        )
        return
    fig = px.bar(comparison, x="store_id", y="gmv", title="GMV by store")
    st.plotly_chart(fig, use_container_width=True)

    store_id = int(st.selectbox("Store", comparison["store_id"].tolist()))
    hourly = _safe_pandas(st, lambda: readers.store_hourly(store_id))
    if hourly is None or hourly.empty:
        if hourly is not None:
            st.caption(f"No hourly rows yet for store {store_id}.")
        return
    title = f"Store {store_id} hourly orders"
    fig2 = px.line(hourly, x="metric_hour", y="orders_placed", title=title)
    st.plotly_chart(fig2, use_container_width=True)
    fig3 = px.line(
        hourly, x="metric_hour", y="late_delivery_rate", title=f"Store {store_id} late rate"
    )
    st.plotly_chart(fig3, use_container_width=True)


def page_inventory(readers, st) -> None:
    st.subheader("Stockout risk (below reorder point)")
    if not gold_mart_available(readers):
        _show_empty_gold(st)
        return
    risk = _safe_pandas(st, readers.inventory_risk)
    if risk is None:
        return
    if risk.empty:
        st.success("No products below reorder point (or inventory Gold is still empty).")
        return
    st.dataframe(risk, use_container_width=True)


def page_delivery(readers, st) -> None:
    if not gold_mart_available(readers):
        _show_empty_gold(st)
        return
    stores = _safe_pandas(st, readers.stores)
    if stores is None:
        return
    store_options: list[str | int] = ["All"]
    if not stores.empty and "store_id" in stores.columns:
        store_options.extend(stores["store_id"].tolist())
    store_id = st.selectbox("Store", store_options)
    chosen = None if store_id == "All" else int(store_id)
    perf = _safe_pandas(st, lambda: readers.delivery_performance(chosen))
    if perf is None:
        return
    if perf.empty:
        st.info(
            "No delivery rows yet. Run **`make lakehouse`** or wait for the "
            "live-worker to populate **`gold_delivery_performance`**."
        )
        return
    if "delivered_at" not in perf.columns:
        st.warning("Delivery table is missing expected columns; check Gold schema.")
        return
    delivered = perf[perf["delivered_at"].notna()]
    if delivered.empty:
        st.info("No completed deliveries in Gold yet.")
        return
    fig = px.histogram(
        delivered, x="total_fulfillment_minutes", nbins=50, title="Fulfillment minutes"
    )
    st.plotly_chart(fig, use_container_width=True)
    late_rate = delivered["is_late"].mean() if len(delivered) else 0.0
    st.metric("Late delivery rate", f"{late_rate:.1%}")


def page_customers(readers, st) -> None:
    if not gold_mart_available(readers):
        _show_empty_gold(st)
        return
    top = _safe_pandas(st, readers.top_customers)
    if top is None:
        return
    if top.empty:
        st.info(
            "No customer 360 rows yet. Run **`make lakehouse`** or wait for "
            "the live-worker to populate **`gold_customer_360`**."
        )
        return
    st.dataframe(
        top[
            [
                "customer_id",
                "lifetime_orders",
                "lifetime_spend",
                "cancel_rate",
                "days_since_last_order",
            ]
        ],
        use_container_width=True,
    )


def page_products(readers, st) -> None:
    if not gold_mart_available(readers):
        _show_empty_gold(st)
        return
    products = _safe_pandas(st, readers.product_performance)
    if products is None:
        return
    if products.empty:
        st.info(
            "No product performance rows yet. Run **`make lakehouse`** or wait "
            "for the live-worker to populate **`gold_product_performance`**."
        )
        return
    fig = px.bar(
        products, x="sku", y="revenue", color="category", title="Product revenue"
    )
    st.plotly_chart(fig, use_container_width=True)


def page_quality(readers, st) -> None:
    quarantine_path = table_path("quarantine", "quality_summary", readers.root)
    if not _delta_table_exists(readers.root, "quarantine", "quality_summary"):
        st.info(
            "No quality summary yet. Run **`make lakehouse`** (pipeline writes "
            "quarantine/quality_summary) or wait for the next quality-gate run."
        )
        st.caption(f"Expected table path: {quarantine_path}")
        return
    summary = _safe_pandas(st, readers.quality_summary)
    if summary is None:
        return
    if summary.empty:
        st.info("Quality summary table is empty — no pipeline runs recorded yet.")
        return
    failed = summary[summary["triggered"] > 0]
    if failed.empty:
        st.success("All quality rules passed in the last run.")
    else:
        st.warning("Rules with failures:")
        st.dataframe(failed, use_container_width=True)
    st.dataframe(summary, use_container_width=True)


def _fetch_proposals() -> list[dict]:
    """Proposal queue from the operational DB (kit/03 §14 exit criteria:
    dashboard/API shows the pending proposal)."""
    with connect_dict() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT proposal_id, proposal_type, entity_scope, recommended_action, reason,"
            " validation_status, status, created_at, approved_by"
            " FROM proposals ORDER BY created_at DESC, proposal_id DESC LIMIT 100"
        )
        return cur.fetchall()


def _fetch_audit(proposal_id: int) -> list[dict]:
    with connect_dict() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT from_status, to_status, actor, detail, correlation_id, created_at"
            " FROM proposal_audit WHERE proposal_id = %s ORDER BY created_at, audit_id",
            (proposal_id,),
        )
        return cur.fetchall()


def page_approvals(readers, st) -> None:
    st.subheader("Action proposals — human approval gate (Phase 14)")
    try:
        rows = _fetch_proposals()
    except psycopg.OperationalError as exc:
        st.warning(
            "Operational DB unreachable — proposals cannot be loaded. "
            "Start PostgreSQL (`make compose-up` or your demo stack) and retry."
        )
        st.caption(str(exc))
        return
    if not rows:
        st.info(
            "No proposals yet. The agent or API creates them; "
            "approval/rejection is a human action (API or Next.js console)."
        )
        return
    flattened = []
    for row in rows:
        scope = row.get("entity_scope") or {}
        flattened.append(
            {
                "proposal_id": row["proposal_id"],
                "type": row["proposal_type"],
                "store_id": scope.get("store_id"),
                "product_id": scope.get("product_id"),
                "quantity": scope.get("quantity"),
                "recommended_action": row["recommended_action"],
                "reason": row["reason"],
                "validation": row["validation_status"],
                "status": row["status"],
                "created_at": row["created_at"],
                "approved_by": row["approved_by"],
            }
        )
    st.dataframe(flattened, use_container_width=True)
    proposal_id = int(st.selectbox("Audit trail for proposal", [r["proposal_id"] for r in rows]))
    try:
        audit_rows = _fetch_audit(proposal_id)
    except psycopg.OperationalError as exc:
        st.warning("Could not load audit trail.")
        st.caption(str(exc))
        return
    st.dataframe(audit_rows, use_container_width=True)
    st.caption(
        "Approve/reject via POST /api/v1/proposals/{id}/approve|reject"
        " — the executor only ever acts on the stored proposal."
    )
