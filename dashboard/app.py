"""QuickCart operations dashboard (kit/03 Phase 10).

Thin Streamlit shell over `quickcart.lakehouse.readers.GoldReaders` — all
data access lives in src/ so FastAPI (Phase 14) can serve the same readers.
Run: ``uv run streamlit run dashboard/app.py``.
"""

import streamlit as st

from quickcart.config.settings import get_settings
from quickcart.dashboard_pages import PAGE_REGISTRY, render_page
from quickcart.lakehouse.common.spark import build_spark
from quickcart.lakehouse.readers import GoldReaders


@st.cache_resource
def get_readers() -> GoldReaders:
    spark = build_spark("quickcart-dashboard")
    return GoldReaders(spark, get_settings().data_root)


def main() -> None:
    st.set_page_config(page_title="QuickCart Intelligence", layout="wide")
    st.title("QuickCart Intelligence Platform")
    st.caption("Operations dashboard — Gold layer only (kit/03 Phase 10)")

    readers = get_readers()
    page = st.sidebar.selectbox("Page", [name for name, _ in PAGE_REGISTRY])
    render_page(page, readers, st)


if __name__ == "__main__":
    main()
