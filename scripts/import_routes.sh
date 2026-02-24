#!/bin/bash

# Import Bus Routes into Database
# Run this script from within the database container or with local database access
# Usage: ./scripts/import_routes.sh [operator_code]
# Example: ./scripts/import_routes.sh ARCT
# Note: Requires VPN/campus access to transport.scc.lancs.ac.uk

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_SCRIPT="$PROJECT_DIR/postgres/import_bus_routes.py"

echo "======================================"
echo "Bus Route Importer"
echo "======================================"
echo ""

# Check if running in container or locally
if [ -f "/.dockerenv" ]; then
    echo "Running inside Docker container"
    python3 "$PYTHON_SCRIPT" "$@"
else
    echo "Running locally (requires database access)"
    
    # Try running via Docker exec into the backend container
    if command -v podman &> /dev/null; then
        echo "Using Podman to execute script in backend container"
        podman exec -it group1-backend sh -c "cd /app && python3 /app/postgres/import_bus_routes.py $@" || {
            echo "Failed to run in backend container. Trying direct connection..."
            python3 "$PYTHON_SCRIPT" "$@"
        }
    else
        echo "Running script directly (ensure database is accessible)"
        python3 "$PYTHON_SCRIPT" "$@"
    fi
fi

echo ""
echo "✓ Route import complete!"
echo "You can now test route finding:"
echo "  curl 'http://localhost:5000/api/routes?start=250012161&end=250010001'"
