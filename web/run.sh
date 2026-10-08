#!/usr/bin/env bash
# Prefer the project-root launcher: ../run.sh or ../../run.sh
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/run.sh"
