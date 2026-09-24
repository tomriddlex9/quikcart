"""Dashboard page renderers.

Each page function receives a `GoldReaders` and the streamlit module (injected
so tests can exercise query logic without a streamlit runtime). Charts are
Plotly; every dataset comes from Gold/silver dimensions per the phase rule —
except the Approvals page (Phase 14), which reads action proposals from the
operational DB because that is where the approval gate lives.
"""

import plotly.express as px
import psycopg

from quickcart.db.connection import connect_dict

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


def page_overview(readers, st) -> None:
    kpis = readers.kpi_summary()
    cols = st.columns(4)
    cols[0].metric("GMV (₹)", f"{kpis['gmv']:,.0f}")
    cols[1].metric("Orders", f"{kpis['orders_placed']:,}")
    cols[2].metric("Cancellation rate", f"{kpis['cancellation_rate']:.1%}")
    cols[3].metric("Late delivery rate", f"{kpis['late_delivery_rate']:.1%}")
    st.caption(f"Products below reorder: {kpis['products_below_reorder']} · "
               f"Active customers: {kpis['active_customers']:,}")

    trend = _to_pandas(readers.orders_trend())
    if trend.empty:
        st.info("No Gold data yet — run `make lakehouse`.")
        return
    fig = px.line(trend, x="day", y=["orders", "cancelled"], title="Daily orders")
    st.plotly_chart(fig, use_container_width=True)


def page_stores(readers, st) -> None:
    comparison = _to_pandas(readers.store_comparison())
    if comparison.empty:
        st.info("No Gold data yet.")
        return
    fig = px.bar(comparison, x="store_id", y="gmv", title="GMV by store")
    st.plotly_chart(fig, use_container_width=True)

    store_id = int(
        st.selectbox("Store", comparison["store_id"].tolist())
    )
    hourly = _to_pandas(readers.store_hourly(store_id))
    if not hourly.empty:
        title = f"Store {store_id} hourly orders"
        fig2 = px.line(hourly, x="metric_hour", y="orders_placed", title=title)
        st.plotly_chart(fig2, use_container_width=True)
        fig3 = px.line(hourly, x="metric_hour", y="late_delivery_rate",
                       title=f"Store {store_id} late rate")
        st.plotly_chart(fig3, use_container_width=True)


def page_inventory(readers, st) -> None:
    risk = _to_pandas(readers.inventory_risk())
    st.subheader("Stockout risk (below reorder point)")
    if risk.empty:
        st.success("No products below reorder point.")
        return
    st.dataframe(risk, use_container_width=True)


def page_delivery(readers, st) -> None:
    stores = _to_pandas(readers.stores())
    store_id = st.selectbox("Store", ["All", *stores["store_id"].tolist()])
    chosen = None if store_id == "All" else int(store_id)
    perf = _to_pandas(readers.delivery_performance(chosen))
    if perf.empty:
        st.info("No delivery data.")
        return
    delivered = perf[perf["delivered_at"].notna()]
    fig = px.histogram(
        delivered, x="total_fulfillment_minutes", nbins=50, title="Fulfillment minutes"
    )
    st.plotly_chart(fig, use_container_width=True)
    late_rate = delivered["is_late"].mean() if len(delivered) else 0.0
    st.metric("Late delivery rate", f"{late_rate:.1%}")


def page_customers(readers, st) -> None:
    top = _to_pandas(readers.top_customers())
    if top.empty:
        st.info("No customer data.")
        return
    st.dataframe(
        top[
            ["customer_id", "lifetime_orders", "lifetime_spend", "cancel_rate",
             "days_since_last_order"]
        ],
        use_container_width=True,
    )


def page_products(readers, st) -> None:
    products = _to_pandas(readers.product_performance())
    if products.empty:
        st.info("No product data.")
        return
    fig = px.bar(
        products, x="sku", y="revenue", color="category", title="Product revenue"
    )
    st.plotly_chart(fig, use_container_width=True)


def page_quality(readers, st) -> None:
    summary = _to_pandas(readers.quality_summary())
    if summary.empty:
        st.info("No quality data.")
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
        st.warning(f"Operational DB unreachable — proposals cannot be loaded: {exc}")
        return
    if not rows:
        st.info(
            "No proposals yet. The agent or API creates them;"
            " approval/rejection is a human action (API or Next.js console)."
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
    st.dataframe(_fetch_audit(proposal_id), use_container_width=True)
    st.caption(
        "Approve/reject via POST /api/v1/proposals/{id}/approve|reject"
        " — the executor only ever acts on the stored proposal."
    )
