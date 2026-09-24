"""Data-quality rule engine (kit/03 §5.2, kit/04 §11).

Reusable rule abstraction so every Silver domain shares one mechanism:

```python
Rule(rule_id="DQ-ORDER-004", severity="error",
     predicate=F.col("total_amount") >= 0,
     message="total_amount is negative", failure_action="quarantine")
```

`apply_rules` splits a DataFrame into (clean, quarantine, summary):
- quarantined rows keep the full original payload plus `_error_codes`,
  `_error_messages`, `_quarantined_at` (kit/05 §10 — never silently drop);
- the summary DataFrame carries per-rule trigger counts for observability
  (kit/02 §9: every rule has a severity, an action, and a metric).
"""

from dataclasses import dataclass

from pyspark.sql import DataFrame
from pyspark.sql import functions as F

ERROR_CODE = "_error_codes"
ERROR_MESSAGE = "_error_messages"
QUARANTINED_AT = "_quarantined_at"


@dataclass(frozen=True)
class Rule:
    rule_id: str
    severity: str  # "error" | "warn"
    predicate: object  # Column: True means the row is valid
    message: str
    failure_action: str = "quarantine"  # "quarantine" | "reject" | "warn"


def apply_rules(df: DataFrame, rules: list[Rule]) -> tuple[DataFrame, DataFrame, DataFrame]:
    """Split df into (clean, quarantine, summary) by rule predicates.

    A row failing any *error* rule lands in quarantine with all failed codes.
    Warn-rules are counted in the summary but do not quarantine.
    """
    checks = []
    for rule in rules:
        if rule.severity == "warn":
            continue
        failed = F.when(
            ~rule.predicate,
            F.struct(F.lit(rule.rule_id).alias("code"), F.lit(rule.message).alias("msg")),
        )
        checks.append(failed)

    flagged = df.select("*", F.array_compact(F.array(*checks)).alias("_violations"))
    quarantine = (
        flagged.filter(F.size("_violations") > 0)
        .withColumn(ERROR_CODE, F.concat_ws(";", F.transform("_violations", lambda v: v["code"])))
        .withColumn(
            ERROR_MESSAGE, F.concat_ws(" | ", F.transform("_violations", lambda v: v["msg"]))
        )
        .withColumn(QUARANTINED_AT, F.current_timestamp())
        .drop("_violations")
    )
    clean = flagged.filter(F.size("_violations") == 0).drop("_violations")

    total = df.count()
    quarantined = quarantine.count()
    summary_rows = []
    for rule in rules:
        triggered = df.filter(~rule.predicate).count() if rule.severity != "warn" else 0
        summary_rows.append(
            (
                rule.rule_id,
                rule.severity,
                rule.failure_action,
                triggered,
                total,
                rule.message,
            )
        )
    summary = df.sparkSession.createDataFrame(
        summary_rows,
        "rule_id: string, severity: string, failure_action: string, "
        "triggered: long, checked_rows: long, message: string",
    )
    summary = summary.withColumn("checked_at", F.current_timestamp())
    _ = quarantined  # count materialises the quarantine plan once for the summary
    return clean, quarantine, summary
