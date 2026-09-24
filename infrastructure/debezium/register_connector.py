#!/usr/bin/env python3
"""Register (or update) the Debezium connector via the Connect REST API.

Idempotent: PUT /connectors/{name}/config creates or replaces the config.
Database credentials are substituted from the environment (never hard-coded).

Usage: python3 infrastructure/debezium/register_connector.sh [config.json]
"""

import json
import os
import sys
import urllib.request

CONNECT = os.environ.get("DEBEZIUM_CONNECT_URL", "http://127.0.0.1:8083")
CONFIG_FILE = sys.argv[1] if len(sys.argv) > 1 else "infrastructure/debezium/connector_orders.json"


def substitute(value):
    if isinstance(value, str):
        for var in ("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"):
            value = value.replace("${" + var + "}", os.environ.get(var, ""))
        return value
    if isinstance(value, dict):
        return {key: substitute(item) for key, item in value.items()}
    return value


def main() -> int:
    with open(CONFIG_FILE, encoding="utf-8") as fh:
        body = substitute(json.load(fh))
    # PUT /connectors/{name}/config expects the config object only.
    payload = json.dumps(body["config"]).encode()
    request = urllib.request.Request(
        f"{CONNECT}/connectors/{body['name']}/config",
        data=payload,
        method="PUT",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        response.read()
    print(f"connector registered: {CONNECT}/connectors/{body['name']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
