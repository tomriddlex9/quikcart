#!/usr/bin/env bash
# Convenience wrapper: python3 infrastructure/debezium/register_connector.py "$@"
set -euo pipefail
exec python3 "$(dirname "$0")/register_connector.py" "$@"
