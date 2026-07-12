#!/bin/bash
# Fail loudly on any error, unset variable, or pipe failure
set -euo pipefail

if command -v python >/dev/null 2>&1; then
    PYTHON="python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON="python3"
elif command -v py >/dev/null 2>&1; then
    PYTHON="py"
else
    echo "ERROR: Python 3 interpreter not found."
    exit 1
fi

echo "Using Python interpreter: $PYTHON"

# Capture arguments with defaults using relative paths
DATA_DIR=${1:-"./data"}
MODEL_PATH=${2:-"./pickle/model.pkl"}
OUTPUT_PATH=${3:-"./output/predictions.csv"}

echo "=== Running NetElixir AIgnition 3.0 Hackathon Pipeline ==="
echo "DATA_DIR:    $DATA_DIR"
echo "MODEL_PATH:  $MODEL_PATH"
echo "OUTPUT_PATH: $OUTPUT_PATH"
echo "=========================================================="

# Verify input data directory exists
if [ ! -d "$DATA_DIR" ]; then
    echo "ERROR: Data directory not found at $DATA_DIR." >&2
    exit 1
fi

# -----------------------------------------------------------------------
# AUTO-DETECTION: If judges pass their own directory, find their CSV and
# map it to the expected filename (historical_data.csv) automatically.
# -----------------------------------------------------------------------
HIST_FILE="$DATA_DIR/historical_data.csv"

if [ ! -f "$HIST_FILE" ]; then
    echo "INFO: historical_data.csv not found in $DATA_DIR. Searching for a compatible CSV..."

    # Find any CSV in the data directory (excluding test.csv and features.csv)
    CANDIDATE=$(find "$DATA_DIR" -maxdepth 1 -name "*.csv" \
        ! -name "test.csv" \
        ! -name "features.csv" \
        | head -n 1)

    if [ -z "$CANDIDATE" ]; then
        echo "ERROR: No CSV file found in $DATA_DIR. Please provide historical campaign data." >&2
        echo "Expected columns: Date, Channel, CampaignType, CampaignName, Cost, Impressions, Clicks, Conversions, Revenue" >&2
        exit 1
    fi

    echo "INFO: Found candidate dataset: $CANDIDATE"

    # Validate required columns exist in the candidate file
    HEADER=$(head -n 1 "$CANDIDATE")
    REQUIRED_COLS=("Date" "Channel" "Cost" "Revenue")
    MISSING=""

    for col in "${REQUIRED_COLS[@]}"; do
        if ! echo "$HEADER" | grep -q "$col"; then
            MISSING="$MISSING $col"
        fi
    done

    if [ -n "$MISSING" ]; then
        echo "ERROR: Candidate CSV is missing required columns:$MISSING" >&2
        echo "Found header: $HEADER" >&2
        echo "Expected at minimum: Date, Channel, Cost, Revenue" >&2
        exit 1
    fi

    echo "INFO: Column validation passed. Registering $CANDIDATE as historical_data.csv..."
    cp "$CANDIDATE" "$HIST_FILE"
    echo "INFO: Copied $CANDIDATE -> $HIST_FILE"
fi

# Verify historical data file is now present
if [ ! -f "$HIST_FILE" ]; then
    echo "ERROR: historical_data.csv could not be located or created in $DATA_DIR." >&2
    exit 1
fi

echo "INFO: Using historical dataset: $HIST_FILE ($(wc -l < "$HIST_FILE") rows)"

# -----------------------------------------------------------------------
# AUTO-GENERATE test.csv if missing or stale
# Generates a sensible 30-day forward budget scenario based on historical
# channel-level spend averages from the provided historical_data.csv.
# -----------------------------------------------------------------------
if [ ! -f "$DATA_DIR/test.csv" ]; then
    echo "INFO: test.csv not found. Auto-generating a 30-day budget scenario from historical averages..."

    $PYTHON - <<'PYEOF'
import sys
import csv
import os
from datetime import date, timedelta
from collections import defaultdict

data_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('DATA_DIR', './data')
hist_path = os.path.join(data_dir, 'historical_data.csv')
test_path  = os.path.join(data_dir, 'test.csv')

channel_spend = defaultdict(float)
channel_days  = defaultdict(set)

with open(hist_path, newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        ch = row.get('Channel', '').strip()
        try:
            cost = float(row.get('Cost', 0) or 0)
        except ValueError:
            cost = 0.0
        d = row.get('Date', '').strip()
        if ch and d:
            channel_spend[ch] += cost
            channel_days[ch].add(d)

if not channel_spend:
    print("ERROR: No channel data found in historical_data.csv", file=sys.stderr)
    sys.exit(1)

start = date.today()
planning_days = 30

rows = []
for day_offset in range(planning_days):
    dt = (start + timedelta(days=day_offset)).isoformat()
    weekday = (start + timedelta(days=day_offset)).weekday()  # 0=Mon, 6=Sun
    # Apply a simple weekly variation: Tue/Wed +20%, Sat -20%, else normal
    if weekday in (1, 2):
        variation = 1.20
    elif weekday == 5:
        variation = 0.80
    else:
        variation = 1.00

    for ch, total_spend in sorted(channel_spend.items()):
        n_days = len(channel_days[ch]) or 1
        daily_avg = total_spend / n_days
        budget = round(daily_avg * variation, 2)
        rows.append({'Date': dt, 'Channel': ch, 'Cost': budget})

with open(test_path, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=['Date', 'Channel', 'Cost'])
    writer.writeheader()
    writer.writerows(rows)

print(f"INFO: Generated test.csv with {len(rows)} rows ({planning_days} days × {len(channel_spend)} channels)")
PYEOF
    DATA_DIR="$DATA_DIR" $PYTHON -c "
import sys, os
data_dir = os.environ.get('DATA_DIR', './data')
test_path = os.path.join(data_dir, 'test.csv')
if os.path.exists(test_path):
    print('INFO: test.csv created at', test_path)
else:
    print('ERROR: test.csv was not created', file=sys.stderr)
    sys.exit(1)
"
fi

# Verify test.csv is present
if [ ! -f "$DATA_DIR/test.csv" ]; then
    echo "ERROR: test.csv not found at $DATA_DIR/test.csv and could not be auto-generated." >&2
    exit 1
fi

# Verify model file exists
if [ ! -f "$MODEL_PATH" ]; then
    echo "ERROR: Model file not found at $MODEL_PATH." >&2
    echo "Please ensure the pre-trained model.pkl exists before running inference." >&2
    exit 1
fi

# Verify output path format
if [[ ! "$OUTPUT_PATH" =~ \.csv$ ]]; then
    echo "ERROR: Invalid output path '$OUTPUT_PATH'. Output must be a .csv file." >&2
    exit 1
fi

# Create the output directory if missing
OUTPUT_DIR=$(dirname "$OUTPUT_PATH")
mkdir -p "$OUTPUT_DIR"

# Step 1: Generate features
echo ""
echo "Step 1/2: Generating advanced features from historical data..."
$PYTHON src/generate_features.py --data_dir "$DATA_DIR"

# Step 2: Produce predictions using model.pkl and test.csv
echo ""
echo "Step 2/2: Executing Monte Carlo predictions using loaded model..."
$PYTHON src/predict.py --features "$DATA_DIR/test.csv" --model "$MODEL_PATH" --output "$OUTPUT_PATH"

echo ""
echo "=========================================================="
echo "Pipeline execution finished successfully!"
echo "Predictions saved to: $OUTPUT_PATH"
echo "=========================================================="
