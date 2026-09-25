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

PAGE_NAMES = [name for name, _ in PAGE_REGISTRY]


@st.cache_resource
def get_readers() -> GoldReaders:
    spark = build_spark("quickcart-dashboard")
    return GoldReaders(spark, get_settings().data_root)


def _query_value(name: str) -> str | None:
    value = st.query_params.get(name)
    if isinstance(value, list):
        return value[0] if value else None
    return value


def main() -> None:
    st.set_page_config(page_title="QuickCart Intelligence", layout="wide")
    preferred_page = _query_value("page")
    page = preferred_page if preferred_page in PAGE_NAMES else PAGE_NAMES[0]
    embedded = _query_value("embed") == "true"

    if embedded:
        st.markdown(
            """
            <style>
                [data-testid="stHeader"],
                [data-testid="stSidebar"],
                [data-testid="stToolbar"],
                [data-testid="stDecoration"],
                #MainMenu,
                footer {
                    display: none !important;
                }
                .block-container {
                    padding-top: 0.75rem;
                    padding-bottom: 0.75rem;
                }
            </style>
            """,
            unsafe_allow_html=True,
        )
    else:
        st.title("QuickCart Intelligence Platform")
        st.caption("Operations dashboard — Gold layer only (kit/03 Phase 10)")
        page = st.sidebar.selectbox(
            "Page",
            PAGE_NAMES,
            index=PAGE_NAMES.index(page),
        )

    readers = get_readers()
    render_page(page, readers, st)


if __name__ == "__main__":
    main()
