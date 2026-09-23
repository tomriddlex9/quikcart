"""Deterministic QuickCart business simulator (kit/03 §1.4, kit/05 §8).

`generate_reference` builds stable reference entities (stores, customers,
products, prices, riders, promotions). `generate_history` replays the same
reference deterministically and walks day by day through the historical
order stream, deriving payments, deliveries, inventory movements and support
tickets from one causal behavior model — never from independent random labels.

Generation is pure Python + numpy: no database I/O here. The loader adapter
(`quickcart.db.loader`) persists the row tuples this module produces.
"""

import hashlib
import json
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import numpy as np
from faker import Faker

from quickcart.simulator import behavior
from quickcart.simulator.config import SimulatorConfig

CENT = Decimal("0.01")
INR = "INR"

CITIES: list[tuple[str, float, float]] = [
    ("Mumbai", 19.076, 72.877),
    ("Delhi", 28.613, 77.209),
    ("Bengaluru", 12.972, 77.594),
    ("Hyderabad", 17.385, 78.487),
    ("Pune", 18.52, 73.856),
    ("Chennai", 13.083, 80.27),
    ("Kolkata", 22.573, 88.364),
    ("Gurugram", 28.459, 77.026),
    ("Jaipur", 26.912, 75.787),
    ("Ahmedabad", 23.023, 72.571),
]
STORE_NAME_SUFFIXES = [
    "Central", "Market", "Station", "Heights", "Nagar",
    "Extension", "Plaza", "Garden", "Point", "Crossing",
]

CATEGORIES: dict[str, dict[str, Any]] = {
    "Fruits & Vegetables": {
        "subcategories": ["Fresh Fruits", "Fresh Vegetables", "Leafy Greens"],
        "brands": ["FreshFarm", "NatureBest", "HarvestOne"],
        "price_band": (30, 180),
        "units": [(500, "g"), (1, "kg"), (250, "g"), (2, "kg")],
    },
    "Dairy & Eggs": {
        "subcategories": ["Milk", "Curd & Yogurt", "Eggs", "Cheese"],
        "brands": ["DairyPure", "MorningCup", "FarmNest"],
        "price_band": (30, 350),
        "units": [(500, "ml"), (1, "L"), (6, "pcs"), (200, "g")],
    },
    "Snacks": {
        "subcategories": ["Chips", "Biscuits", "Namkeen", "Chocolate"],
        "brands": ["CrunchWorks", "SnackUp", "GoldenBite"],
        "price_band": (10, 150),
        "units": [(75, "g"), (150, "g"), (200, "g"), (1, "pack")],
    },
    "Beverages": {
        "subcategories": ["Soft Drinks", "Juices", "Tea & Coffee", "Energy Drinks"],
        "brands": ["SipRight", "CoolBolt", "BrewDay"],
        "price_band": (20, 300),
        "units": [(250, "ml"), (500, "ml"), (1, "L"), (6, "pcs")],
    },
    "Staples": {
        "subcategories": ["Rice & Grains", "Atta & Flour", "Pulses", "Sugar & Salt"],
        "brands": ["GrainHouse", "PureHarvest", "DailyStaple"],
        "price_band": (40, 400),
        "units": [(1, "kg"), (5, "kg"), (500, "g"), (2, "kg")],
    },
    "Personal Care": {
        "subcategories": ["Shampoo", "Soap", "Toothpaste", "Skin Care"],
        "brands": ["GlowMatters", "PureSkin", "FreshDent"],
        "price_band": (30, 400),
        "units": [(100, "ml"), (200, "ml"), (100, "g"), (1, "pcs")],
    },
    "Home Care": {
        "subcategories": ["Detergent", "Cleaners", "Dishwash"],
        "brands": ["CleanForce", "SparkleHome", "FreshNest"],
        "price_band": (40, 350),
        "units": [(500, "g"), (1, "kg"), (500, "ml"), (1, "L")],
    },
    "Instant Food": {
        "subcategories": ["Noodles", "Ready Meals", "Sauces"],
        "brands": ["QuickBowl", "HeatEat", "WokThisWay"],
        "price_band": (20, 250),
        "units": [(70, "g"), (140, "g"), (300, "g"), (1, "pack")],
    },
    "Frozen": {
        "subcategories": ["Frozen Veg", "Ice Cream", "Frozen Snacks"],
        "brands": ["FrostKeep", "ChillBite", "ArcticFresh"],
        "price_band": (60, 400),
        "units": [(200, "g"), (500, "g"), (750, "ml"), (1, "pack")],
    },
    "Baby Care": {
        "subcategories": ["Diapers", "Baby Food", "Wipes"],
        "brands": ["TinyCare", "SoftBaby", "GentleNest"],
        "price_band": (80, 600),
        "units": [(20, "pcs"), (40, "pcs"), (200, "g"), (500, "g")],
    },
}

PAYMENT_METHOD_WEIGHTS = [
    ("UPI", 0.45), ("CARD", 0.25), ("WALLET", 0.15), ("NETBANKING", 0.10), ("COD", 0.05),
]
FAILURE_CODES = ["INSUFFICIENT_FUNDS", "BANK_DECLINE", "GATEWAY_TIMEOUT", "OTP_TIMEOUT"]
SHIFTS = [("07:00", "15:00", 0.4), ("14:00", "22:00", 0.4), ("08:00", "20:00", 0.2)]


def money(value: float | Decimal) -> Decimal:
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def dt(day: date, hour: int, minute: int = 0, second: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, second, tzinfo=UTC)


@dataclass
class StoreMeta:
    store_id: int
    city: str
    lat: float
    lon: float
    demand_multiplier: float
    sla_minutes: int


@dataclass
class ProductMeta:
    product_id: int
    selling_price: Decimal
    popularity: float


@dataclass
class ReferenceData:
    stores: list[tuple] = field(default_factory=list)
    customers: list[tuple] = field(default_factory=list)
    addresses: list[tuple] = field(default_factory=list)
    products: list[tuple] = field(default_factory=list)
    prices: list[tuple] = field(default_factory=list)
    riders: list[tuple] = field(default_factory=list)
    promotions: list[tuple] = field(default_factory=list)
    store_meta: dict[int, StoreMeta] = field(default_factory=dict)
    product_meta: dict[int, ProductMeta] = field(default_factory=dict)
    customer_pool: dict[int, list[int]] = field(default_factory=dict)
    default_address: dict[int, int] = field(default_factory=dict)
    popularity_probs: np.ndarray | None = None
    riders_on_shift: dict[tuple[int, int], list[int]] = field(default_factory=dict)


@dataclass
class GeneratedHistory:
    reference: ReferenceData
    orders: list[tuple]
    order_items: list[tuple]
    payments: list[tuple]
    deliveries: list[tuple]
    movements: list[tuple]
    tickets: list[tuple]
    inventory: list[tuple]
    weather_series: list[tuple[date, int, str]]
    fingerprint: str
    store_fingerprint: str


def generate_reference(cfg: SimulatorConfig) -> ReferenceData:
    rng = np.random.default_rng(cfg.seed)
    faker = Faker("en_IN")
    faker.seed_instance(cfg.seed)
    ref = ReferenceData()
    _build_stores(cfg, rng, ref)
    _build_products(cfg, rng, faker, ref)
    _build_customers(cfg, rng, ref)
    _build_riders(cfg, rng, ref)
    _build_promotions(cfg, rng, ref)
    return ref


def _build_stores(cfg: SimulatorConfig, rng: np.random.Generator, ref: ReferenceData) -> None:
    chosen = rng.choice(len(CITIES), size=cfg.stores, replace=False)
    for i, idx in enumerate(chosen):
        city, base_lat, base_lon = CITIES[int(idx)]
        lat = Decimal(str(round(base_lat + float(rng.normal(0, 0.05)), 6))).quantize(
            Decimal("0.000001")
        )
        lon = Decimal(str(round(base_lon + float(rng.normal(0, 0.05)), 6))).quantize(
            Decimal("0.000001")
        )
        opened = dt(date(2024, 6, 1) + timedelta(days=int(rng.integers(0, 550))), 9)
        store_id = i + 1
        ref.stores.append(
            (
                store_id,
                f"STORE-{store_id:03d}",
                f"{city} {STORE_NAME_SUFFIXES[i % len(STORE_NAME_SUFFIXES)]}",
                city,
                lat,
                lon,
                money(float(rng.uniform(3.0, 6.0))),
                opened,
                True,
                opened,
                opened,
            )
        )
        ref.store_meta[store_id] = StoreMeta(
            store_id=store_id,
            city=city,
            lat=float(lat),
            lon=float(lon),
            demand_multiplier=float(rng.lognormal(0.0, 0.22)),
            sla_minutes=int(rng.integers(25, 41)),
        )
    ref.customer_pool = {s: [] for s in ref.store_meta}


def _build_products(
    cfg: SimulatorConfig, rng: np.random.Generator, faker: Faker, ref: ReferenceData
) -> None:
    categories = list(CATEGORIES)
    popularity_raw = rng.zipf(1.6, size=cfg.products).astype(float)
    catalog_created = dt(cfg.start_date, 0) - timedelta(days=90)
    for i in range(cfg.products):
        category = categories[i % len(categories)]
        spec = CATEGORIES[category]
        subcategory = spec["subcategories"][i % len(spec["subcategories"])]
        brand = spec["brands"][int(rng.integers(0, len(spec["brands"])))]
        variant = faker.word().capitalize()
        unit_size, unit_name = spec["units"][int(rng.integers(0, len(spec["units"])))]
        lo, hi = spec["price_band"]
        mrp = money(float(rng.uniform(lo, hi)))
        selling = money(mrp * Decimal(str(float(rng.uniform(0.72, 0.97)))))
        product_id = i + 1
        ref.products.append(
            (
                product_id,
                f"SKU-{product_id:05d}",
                f"{brand} {variant}",
                category,
                subcategory,
                brand,
                Decimal(str(unit_size)).quantize(Decimal("0.001")),
                unit_name,
                True,
                catalog_created,
                catalog_created,
            )
        )
        ref.prices.append(
            (product_id, product_id, None, mrp, selling, catalog_created, None, catalog_created)
        )
        ref.product_meta[product_id] = ProductMeta(
            product_id=product_id, selling_price=selling, popularity=float(popularity_raw[i])
        )
    ref.popularity_probs = popularity_raw / popularity_raw.sum()


def _build_customers(cfg: SimulatorConfig, rng: np.random.Generator, ref: ReferenceData) -> None:
    store_ids = list(ref.store_meta)
    city_to_stores: dict[str, list[int]] = {}
    for s in store_ids:
        city_to_stores.setdefault(ref.store_meta[s].city, []).append(s)
    all_cities = [c for c, _, _ in CITIES]
    address_id = 1
    for i in range(cfg.customers):
        customer_id = i + 1
        created = dt(
            cfg.start_date - timedelta(days=int(rng.integers(30, 240))),
            int(rng.integers(8, 23)),
        )
        ref.customers.append((customer_id, f"CUST-{customer_id:06d}", created, created, True))
        n_addresses = 2 if rng.random() < 0.15 else 1
        for a in range(n_addresses):
            if rng.random() < 0.85:
                city = all_cities[int(rng.integers(0, len(all_cities)))]
                pool_stores = city_to_stores.get(city, store_ids)
            else:
                pool_stores = store_ids
            home_store = int(pool_stores[int(rng.integers(0, len(pool_stores)))])
            meta = ref.store_meta[home_store]
            is_default = a == 0
            ref.addresses.append(
                (
                    address_id,
                    customer_id,
                    meta.city,
                    f"{int(rng.integers(110001, 899999))}",
                    Decimal(str(round(meta.lat + float(rng.normal(0, 0.03)), 6))).quantize(
                        Decimal("0.000001")
                    ),
                    Decimal(str(round(meta.lon + float(rng.normal(0, 0.03)), 6))).quantize(
                        Decimal("0.000001")
                    ),
                    is_default,
                    created,
                    None,
                    created,
                    created,
                )
            )
            if is_default:
                ref.default_address[customer_id] = address_id
                ref.customer_pool[home_store].append(customer_id)
            address_id += 1
    for s in store_ids:
        if not ref.customer_pool[s]:
            ref.customer_pool[s] = list(range(1, cfg.customers + 1))


def _build_riders(cfg: SimulatorConfig, rng: np.random.Generator, ref: ReferenceData) -> None:
    store_ids = list(ref.store_meta)
    weights = np.array([ref.store_meta[s].demand_multiplier for s in store_ids])
    weights = weights / weights.sum()
    for i in range(cfg.riders):
        rider_id = i + 1
        home_store = int(rng.choice(store_ids, p=weights))
        roll = rng.random()
        cumulative = 0.0
        shift_start, shift_end = SHIFTS[-1][0], SHIFTS[-1][1]
        for start_s, end_s, p in SHIFTS:
            cumulative += p
            if roll <= cumulative:
                shift_start, shift_end = start_s, end_s
                break
        created = dt(cfg.start_date - timedelta(days=int(rng.integers(30, 200))), 8)
        ref.riders.append(
            (
                rider_id,
                home_store,
                "OFFLINE",
                time.fromisoformat(shift_start),
                time.fromisoformat(shift_end),
                created,
                created,
            )
        )
    for s in store_ids:
        for hour in range(24):
            ref.riders_on_shift[(s, hour)] = [
                r[0]
                for r in ref.riders
                if r[1] == s
                and time.fromisoformat(str(r[3])) <= time(hour, 59)
                < time.fromisoformat(str(r[4]))
            ]


def _build_promotions(cfg: SimulatorConfig, rng: np.random.Generator, ref: ReferenceData) -> None:
    days = behavior.day_range(cfg.start_date, cfg.end_date)
    specs = [
        (
            "Weekend Flat 50", "FLAT_OFF", Decimal("50.00"), 0.25, 0.0,
            Decimal("299.00"), Decimal("50.00"),
        ),
        (
            "Monsoon Fresh 20", "PERCENT_OFF", Decimal("20.00"), 0.30, 60.0,
            Decimal("199.00"), Decimal("120.00"),
        ),
        (
            "UPI Tuesdays 10", "PERCENT_OFF", Decimal("10.00"), 0.12, 0.0,
            Decimal("149.00"), Decimal("80.00"),
        ),
        (
            "Free Delivery Week", "FREE_DELIVERY", Decimal("0.00"), 0.20, 0.0,
            Decimal("99.00"), None,
        ),
        (
            "Pantry Saver 15", "PERCENT_OFF", Decimal("15.00"), 0.35, 30.0,
            Decimal("499.00"), Decimal("150.00"),
        ),
        (
            "New Join Treat 30", "FLAT_OFF", Decimal("30.00"), 0.18, 0.0,
            Decimal("199.00"), Decimal("30.00"),
        ),
        (
            "Snack Attack 25", "PERCENT_OFF", Decimal("25.00"), 0.22, 90.0,
            Decimal("99.00"), Decimal("90.00"),
        ),
        (
            "Big Basket Booster 12", "PERCENT_OFF", Decimal("12.00"), 0.40, 150.0,
            Decimal("799.00"), Decimal("200.00"),
        ),
    ]
    for i, (name, promo_type, value, frac, offset_days, min_order, max_disc) in enumerate(specs):
        window = max(7, int(len(days) * frac))
        latest_start = len(days) - window
        start_idx = int(offset_days) + int(rng.integers(0, max(1, latest_start - int(offset_days))))
        start_idx = max(0, min(start_idx, latest_start))
        starts, ends = days[start_idx], days[start_idx + window - 1]
        ref.promotions.append(
            (
                i + 1,
                name,
                promo_type,
                value,
                dt(starts, 0),
                dt(ends, 23, 59, 59),
                min_order,
                max_disc,
                dt(ends, 23, 59, 59) >= dt(cfg.end_date, 23),
            )
        )


def _mark_refunded(rows: list[tuple], refunded_at: datetime) -> list[tuple]:
    """Flip CAPTURED payment rows to REFUNDED with a new updated_at."""
    return [
        (*p[:3], "REFUNDED", *p[4:9], refunded_at) if p[3] == "CAPTURED" else p
        for p in rows
    ]


def generate_history(cfg: SimulatorConfig) -> GeneratedHistory:
    """Replay the deterministic reference and generate the full order history."""
    rng = np.random.default_rng(cfg.seed)
    faker = Faker("en_IN")
    faker.seed_instance(cfg.seed)
    ref = ReferenceData()
    _build_stores(cfg, rng, ref)
    _build_products(cfg, rng, faker, ref)
    _build_customers(cfg, rng, ref)
    _build_riders(cfg, rng, ref)
    _build_promotions(cfg, rng, ref)

    days = behavior.day_range(cfg.start_date, cfg.end_date)
    store_ids = list(ref.store_meta)

    day_weights = np.array([behavior.weekend_multiplier(d) for d in days])
    day_weights = day_weights / day_weights.sum()
    day_counts = _largest_remainder(day_weights, cfg.orders)
    store_weights = np.array([ref.store_meta[s].demand_multiplier for s in store_ids])
    store_weights = store_weights / store_weights.sum()
    hour_weights = np.array(behavior.HOUR_MULTIPLIERS)
    hour_weights = hour_weights / hour_weights.sum()

    inventory_qty: dict[tuple[int, int], int] = {}
    for s in store_ids:
        for pid, meta in ref.product_meta.items():
            if meta.popularity >= 20:
                on_hand = int(rng.integers(60, 121))
            elif meta.popularity >= 5:
                on_hand = int(rng.integers(30, 61))
            else:
                on_hand = int(rng.integers(8, 26))
            inventory_qty[(s, pid)] = on_hand
    reorder_point = {
        key: (
            25
            if ref.product_meta[key[1]].popularity >= 20
            else 12 if ref.product_meta[key[1]].popularity >= 5 else 4
        )
        for key in inventory_qty
    }

    active_promotions = [
        (p[0], p[2], p[3], p[4], p[5], p[6], p[7])
        for p in ref.promotions
    ]

    orders: list[tuple] = []
    order_items: list[tuple] = []
    payments: list[tuple] = []
    deliveries: list[tuple] = []
    movements: list[tuple] = []
    tickets: list[tuple] = []
    weather_series: list[tuple[date, int, str]] = []
    pending_receipts: dict[date, list[tuple[int, int, int]]] = {}
    pending_receipt_keys: set[tuple[int, int]] = set()

    order_id = 0
    order_item_id = 0
    payment_id = 0
    delivery_id = 0
    movement_id = 0
    ticket_id = 0
    avg_hourly = {
        s: (cfg.orders * store_weights[i]) / (len(days) * 24) for i, s in enumerate(store_ids)
    }

    for d, day in enumerate(days):
        for store_id, product_id, qty in pending_receipts.pop(day, []):
            inventory_qty[(store_id, product_id)] += qty
            pending_receipt_keys.discard((store_id, product_id))
            movement_id += 1
            occurred = dt(day, 6, int(rng.integers(0, 59)))
            movements.append(
                (
                    movement_id,
                    store_id,
                    product_id,
                    "RECEIPT",
                    qty,
                    "AUTO_RESTOCK",
                    None,
                    occurred,
                    occurred,
                )
            )

        store_counts = rng.multinomial(day_counts[d], store_weights)
        weather_today = {s: behavior.draw_weather(rng, day) for s in store_ids}
        for s in store_ids:
            weather_series.append((day, s, weather_today[s]))

        for s, count in zip(store_ids, store_counts, strict=True):
            if count == 0:
                continue
            hour_counts = rng.multinomial(count, hour_weights)
            pool = ref.customer_pool[s]
            meta = ref.store_meta[s]
            weather = weather_today[s]
            for hour, hour_count in enumerate(hour_counts):
                if hour_count == 0:
                    continue
                peak = hour in behavior.PEAK_HOURS
                riders = ref.riders_on_shift.get((s, hour), [])
                effective_riders = (
                    len(riders) * (0.55 if peak else 0.9) * (0.8 if weather == "RAIN" else 1.0)
                )
                demand_index = max(0.5, hour_count / max(avg_hourly[s], 1e-9))
                shortage = behavior.rider_shortage_factor(int(effective_riders), demand_index)
                queue_factor = min(1.0, hour_count / max(1.0, 4.0 * avg_hourly[s]))
                active_here = [p for p in active_promotions if p[3] <= dt(day, hour) <= p[4]]

                for _ in range(hour_count):
                    customer_id = int(pool[int(rng.integers(0, len(pool)))])
                    placed = dt(day, hour, int(rng.integers(0, 60)), int(rng.integers(0, 60)))

                    basket = behavior.basket_size(rng)
                    picks = rng.choice(
                        len(ref.product_meta),
                        size=min(basket, len(ref.product_meta)),
                        replace=False,
                        p=ref.popularity_probs,
                    )
                    lines: list[tuple[int, int]] = []
                    for idx in picks:
                        pid = int(idx) + 1
                        qty = 1 if rng.random() < 0.72 else 2 if rng.random() < 0.75 else 3
                        available = inventory_qty[(s, pid)]
                        if available <= 0:
                            continue
                        lines.append((pid, min(qty, available)))
                    if not lines or (len(lines) < 2 and basket >= 3):
                        continue  # unserved demand: stockout-squeezed basket

                    subtotal = money(
                        sum(
                            (ref.product_meta[pid].selling_price * qty for pid, qty in lines),
                            Decimal("0.00"),
                        )
                    )

                    promo_discount = Decimal("0.00")
                    delivery_fee = money(30)
                    promotion_id = None
                    if active_here:
                        promo = active_here[int(rng.integers(0, len(active_here)))]
                        promo_id, promo_type, value, _, _, min_order, max_disc = promo
                        if subtotal >= (min_order or Decimal("0.00")):
                            promotion_id = int(promo_id)
                            if promo_type == "PERCENT_OFF":
                                promo_discount = money(subtotal * value / Decimal("100"))
                                if max_disc is not None:
                                    promo_discount = min(promo_discount, max_disc)
                            elif promo_type == "FLAT_OFF":
                                promo_discount = min(value, subtotal)
                            elif promo_type == "FREE_DELIVERY":
                                delivery_fee = Decimal("0.00")

                    taxable = max(Decimal("0.00"), subtotal - promo_discount)
                    tax = money(taxable * Decimal("0.05"))
                    total = money(subtotal - promo_discount + delivery_fee + tax)

                    order_id += 1
                    updated_at = placed
                    status = "DELIVERED"

                    method = _draw_payment_method(rng)
                    payment_rows: list[tuple] = []
                    captured = False
                    if method == "COD":
                        payment_id += 1
                        payment_rows.append(
                            (
                                payment_id, order_id, "COD", "CAPTURED", total,
                                INR, 1, None, placed, placed,
                            )
                        )
                        captured = True
                    else:
                        attempt_method = method
                        for attempt in (1, 2):
                            p_fail = behavior.payment_failure_probability(attempt_method, attempt)
                            if rng.random() < p_fail:
                                payment_id += 1
                                payment_rows.append(
                                    (
                                        payment_id,
                                        order_id,
                                        attempt_method,
                                        "FAILED",
                                        total,
                                        INR,
                                        attempt,
                                        FAILURE_CODES[int(rng.integers(0, len(FAILURE_CODES)))],
                                        placed,
                                        placed,
                                    )
                                )
                                attempt_method = "UPI" if rng.random() < 0.7 else "CARD"
                            else:
                                payment_id += 1
                                payment_rows.append(
                                    (
                                        payment_id,
                                        order_id,
                                        attempt_method,
                                        "CAPTURED",
                                        total,
                                        INR,
                                        attempt,
                                        None,
                                        placed,
                                        placed,
                                    )
                                )
                                captured = True
                                break

                    delivery_row = None
                    movement_row = None
                    if not captured:
                        status = "CANCELLED"
                        updated_at = placed + timedelta(minutes=int(rng.integers(3, 10)))
                        payment_rows = _mark_refunded(payment_rows, updated_at)
                        if rng.random() < 0.05:
                            ticket_id += 1
                            tickets.append(
                                (
                                    ticket_id,
                                    customer_id,
                                    order_id,
                                    "PAYMENT_ISSUE",
                                    "MEDIUM",
                                    "CLOSED",
                                    f"Payment failed for order {order_id}",
                                    "Customer reported repeated payment failure at checkout.",
                                    updated_at,
                                    updated_at,
                                )
                            )
                    else:
                        distance = money(behavior.draw_distance_km(rng))
                        units = sum(qty for _, qty in lines)
                        pick = behavior.pick_minutes(rng, units, queue_factor)
                        wait = behavior.assign_wait_minutes(rng, shortage)
                        ride = behavior.ride_minutes(rng, distance, shortage, weather)
                        promised = placed + timedelta(minutes=meta.sla_minutes)
                        assigned = placed + timedelta(minutes=wait)
                        picked_up = assigned + timedelta(minutes=pick)
                        delivered_at = picked_up + timedelta(minutes=ride)

                        cancel_p = behavior.cancellation_probability(
                            weather=weather, peak=peak, shortage=shortage
                        )
                        if delivered_at - placed > timedelta(minutes=1.6 * meta.sla_minutes):
                            cancel_p += 0.03
                        rider_id = (
                            int(riders[int(rng.integers(0, len(riders)))]) if riders else None
                        )

                        if rng.random() < cancel_p:
                            status = "CANCELLED"
                            cancelled_at = assigned + timedelta(
                                minutes=float(rng.uniform(0.3, max(0.4, pick * 0.8)))
                            )
                            updated_at = cancelled_at
                            delivery_row = (
                                delivery_id + 1,
                                order_id,
                                rider_id,
                                promised,
                                assigned,
                                None,
                                None,
                                cancelled_at,
                                distance,
                                "CANCELLED",
                                placed,
                                cancelled_at,
                            )
                            payment_rows = _mark_refunded(payment_rows, cancelled_at)
                            if rng.random() < 0.04:
                                ticket_id += 1
                                tickets.append(
                                    (
                                        ticket_id,
                                        customer_id,
                                        order_id,
                                        "ORDER_CANCELLED",
                                        "HIGH",
                                        "CLOSED",
                                        f"Order {order_id} cancelled",
                                        "Customer cancelled after a long rider wait.",
                                        cancelled_at,
                                        cancelled_at,
                                    )
                                )
                        else:
                            updated_at = delivered_at
                            is_refund = rng.random() < 0.004
                            if is_refund:
                                status = "REFUNDED"
                                payment_rows = _mark_refunded(payment_rows, delivered_at)
                            late_minutes = (delivered_at - promised).total_seconds() / 60.0
                            delivery_row = (
                                delivery_id + 1,
                                order_id,
                                rider_id,
                                promised,
                                assigned,
                                picked_up,
                                delivered_at,
                                None,
                                distance,
                                "DELIVERED",
                                placed,
                                delivered_at,
                            )
                            sold_qty = 0
                            for pid, qty in lines:
                                inventory_qty[(s, pid)] -= qty
                                sold_qty += qty
                                key = (s, pid)
                                tomorrow = day + timedelta(days=1)
                                if (
                                    inventory_qty[key] < reorder_point[key]
                                    and key not in pending_receipt_keys
                                    and tomorrow <= cfg.end_date
                                ):
                                    pending_receipts.setdefault(tomorrow, []).append(
                                        (s, pid, max(2 * reorder_point[key], 20))
                                    )
                                    pending_receipt_keys.add(key)
                            movement_id += 1
                            movement_row = (
                                movement_id,
                                s,
                                lines[0][0],
                                "SALE",
                                -sold_qty,
                                "ORDER",
                                str(order_id),
                                delivered_at,
                                delivered_at,
                            )
                            if late_minutes > 0 and rng.random() < 0.025:
                                ticket_id += 1
                                priority = "URGENT" if late_minutes > 30 else "HIGH"
                                tickets.append(
                                    (
                                        ticket_id,
                                        customer_id,
                                        order_id,
                                        "LATE_DELIVERY",
                                        priority,
                                        "RESOLVED",
                                        f"Order {order_id} arrived late",
                                        f"Delivered {late_minutes:.0f} minutes past the promise.",
                                        delivered_at,
                                        delivered_at,
                                    )
                                )
                            if is_refund:
                                ticket_id += 1
                                tickets.append(
                                    (
                                        ticket_id,
                                        customer_id,
                                        order_id,
                                        "REFUND_REQUEST",
                                        "HIGH",
                                        "CLOSED",
                                        f"Refund for order {order_id}",
                                        "Quality complaint; refund issued after delivery.",
                                        delivered_at,
                                        delivered_at,
                                    )
                                )

                    orders.append(
                        (
                            order_id,
                            customer_id,
                            s,
                            ref.default_address[customer_id],
                            promotion_id,
                            status,
                            subtotal,
                            Decimal("0.00"),
                            promo_discount,
                            delivery_fee,
                            tax,
                            total,
                            INR,
                            placed,
                            updated_at,
                        )
                    )
                    for pid, qty in lines:
                        order_item_id += 1
                        unit_price = ref.product_meta[pid].selling_price
                        order_items.append(
                            (
                                order_item_id,
                                order_id,
                                pid,
                                qty,
                                unit_price,
                                Decimal("0.00"),
                                money(unit_price * qty),
                                placed,
                            )
                        )
                    payments.extend(payment_rows)
                    if delivery_row is not None:
                        delivery_id += 1
                        deliveries.append(delivery_row)
                    if movement_row is not None:
                        movements.append(movement_row)

    inventory_rows = [
        (s, pid, qty, 0, reorder_point[(s, pid)], dt(cfg.end_date, 23, 59, 59))
        for (s, pid), qty in inventory_qty.items()
    ]

    return GeneratedHistory(
        reference=ref,
        orders=orders,
        order_items=order_items,
        payments=payments,
        deliveries=deliveries,
        movements=movements,
        tickets=tickets,
        inventory=inventory_rows,
        weather_series=weather_series,
        fingerprint=_fingerprint(orders, order_items, payments, deliveries, movements),
        store_fingerprint=_store_fingerprint(orders),
    )


def _draw_payment_method(rng: np.random.Generator) -> str:
    roll = rng.random()
    cumulative = 0.0
    for method, p in PAYMENT_METHOD_WEIGHTS:
        cumulative += p
        if roll <= cumulative:
            return method
    return "UPI"


def _largest_remainder(weights: np.ndarray, total: int) -> np.ndarray:
    """Allocate an exact integer total across cells proportional to weights."""
    exact = weights * total
    floor = np.floor(exact).astype(int)
    remainder = total - int(floor.sum())
    if remainder > 0:
        order = np.argsort(-(exact - floor))
        for i in range(remainder):
            floor[order[i % len(order)]] += 1
    return floor


def _fingerprint(
    orders: list[tuple],
    order_items: list[tuple],
    payments: list[tuple],
    deliveries: list[tuple],
    movements: list[tuple],
) -> str:
    def total(rows: list[tuple], idx: int) -> str:
        return str(sum((r[idx] for r in rows), Decimal("0.00")))

    payload = {
        "orders": len(orders),
        "order_items": len(order_items),
        "payments": len(payments),
        "deliveries": len(deliveries),
        "movements": len(movements),
        "gmv": total(orders, 11),
        "units_sold": -sum(m[4] for m in movements if m[3] == "SALE"),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def _store_fingerprint(orders: list[tuple]) -> str:
    per_store: dict[int, list[Any]] = {}
    for r in orders:
        bucket = per_store.setdefault(r[2], [0, Decimal("0.00")])
        bucket[0] += 1
        bucket[1] += r[11]
    rows = [
        {"store_id": s, "orders": v[0], "gmv": str(v[1])}
        for s, v in sorted(per_store.items())
    ]
    return hashlib.sha256(json.dumps(rows).encode()).hexdigest()
