# AdCast AI: Probabilistic Marketing Forecaster & Simulator

Interactive Evaluation Pipeline & Web Dashboard for E-Commerce Advertising

AdCast AI is a hybrid machine learning and probabilistic simulation forecasting system designed for e-commerce advertising. The system consumes campaign-level advertising spend metrics (Google Ads, Meta Ads, Microsoft Ads) and generates aggregated probabilistic future revenue projections (P10, P50, and P90 confidence intervals) for planning horizons (30, 60, or 90 Days).

It features a dual-engine architecture: a high-fidelity Python/FastAPI backend utilizing XGBoost and pandas feature pipelines, and a high-performance vanilla JavaScript client-side engine that functions as an offline simulator. Both engines are integrated into a premium, glassmorphic Web Dashboard offering scenario planning, data ingestion diagnostics, and AI-driven growth consultation.

---

## Model Artifact

The repository includes a pre-trained XGBoost model stored at:

pickle/model.pkl

Evaluation runs do not retrain this model.

Key compliance notes:
- `pickle/model.pkl` is pre-trained.
- Evaluation never retrains.
- Model must already exist.
- Prediction pipeline only loads model and performs inference.

---

## Key Features

1. **Dual Ingestion & Processing Engines**
   * **Python Server Pipeline**: Runs an XGBoost Regressor on advanced time-series features to generate predictions.
   * **JavaScript Frontend Client**: Executes mathematical simulation models client-side as a fallback.
2. **Automated Feature Engineering**
   * Computes calendar markers, monthly and weekly seasonality indexes, and logarithmic spend representations.
   * Generates rolling means (7-day and 30-day), lag features (1-day and 7-day spend and revenue), and campaign-level growth rates.
3. **Data Integrity Diagnostics & Anomaly Detector**
   * **Attribution and Pixel Outages**: Flags cases with high ad spend (> $300) but zero conversions/revenue.
   * **ROAS Collapses / Bid Glitches**: Spots instances where ROAS collapses (< 0.15x) despite high spend.
   * **CTR Anomalies / Click Fraud**: Flags click-through rates exceeding 45%.
   * **Naming Inconsistencies**: Detects channel variations and prompts consolidation.
4. **Probabilistic Uncertainty Modeling**
   * Computes campaign-level volatility coefficients (Std Dev of Revenue / Mean Revenue).
   * Runs 1,000 Monte Carlo simulation loops to build P10 (Pessimistic), P50 (Expected), and P90 (Optimistic) boundaries.
5. **Generative AI Causal Inference Layer**
   * Integrates Google Gemini API to analyze forecasts and explain budget efficiency, diminishing returns (saturation limits), anomalies, and strategic budget reallocations.
   * Features a local, rules-based growth analyst algorithm that generates Markdown advisory reports as a fallback if the API key is missing or offline.

---
 
## Repository Directory Structure

```markdown
marketing_forecaster/
├── index.html                  # Main Web Dashboard structure
├── styles.css                  # UI Design System (Glassmorphic dark mode, transitions)
├── app.js                      # UI Controller (Tab switching, chart management, API connections)
├── dataset.js                  # Frontend synthetic dataset generator
├── validator.js                # Frontend data validation & anomaly checks
├── forecaster.js               # Frontend offline Monte Carlo & saturation simulator
├── ai.js                       # Frontend AI consultation & fallback growth advisor
├── predictions.csv             # Exported planning-period aggregate predictions file
├── business_reasoning.md       # Exported business advisory explanation file
├── requirements.txt            # Python dependencies (pinned versions)
├── run.sh                      # Shell orchestrator for end-to-end evaluation
├── data/                       # Directory containing historical, test, and generated logs
│   ├── historical_data.csv     # Uploaded/generated raw historical logs
│   └── test.csv                # Future scenario targets / campaign budget plans
├── pickle/                     # Serialized artifacts
│   └── model.pkl               # Bundled XGBoost model, history tails, and volatilities
└── src/                        # Python application modules
    ├── server.py               # FastAPI server REST endpoints
    ├── generate_features.py    # Lag, growth, rolling, and seasonality feature engineering
    ├── monte_carlo_forecaster.py# XGBoost trainer & volatility parameterizer
    ├── predict.py              # Recursive forecast & Monte Carlo simulation engine
    ├── validator.py            # Backend data validation & anomaly checks
    └── utils.py                # Synthetic logs generator, path configs, and loggers
```

---

## Getting Started

### 1. Installation & Environment Setup

Ensure you have Python 3.10 to 3.13 installed. In your terminal, run:

```bash
pip install -r requirements.txt
```

### 2. Launching the Web Application

The FastAPI server acts as a unified hub: it runs prediction code, manages data uploads, and hosts the static frontend files. 

#### Application Modes
The server supports two execution modes specified via the `APP_MODE` environment variable:
* **Prediction Mode (`APP_MODE=prediction`, default)**: Used for evaluation. Accidental retraining is strictly blocked. The model training endpoint (`POST /api/train`) is disabled and returns a `403 Forbidden` response. The server relies exclusively on the pre-existing `pickle/model.pkl` file.
* **Development Mode (`APP_MODE=development`)**: Used for sandbox/developer setups. Enables manual model retraining via the `POST /api/train` endpoint or the dashboard UI.

Start the application with Uvicorn:

```bash
# Run in default prediction mode
uvicorn src.server:app --reload --port 8000

# Run in development mode (Unix/macOS)
APP_MODE=development uvicorn src.server:app --reload --port 8000

# Run in development mode (Windows PowerShell)
$env:APP_MODE="development"; uvicorn src.server:app --reload --port 8000
```

Once running, navigate your web browser to: **[http://localhost:8000](http://localhost:8000)**.

* **Loading Demo Data**: In the UI, click **"Load E-Commerce Demo"** to generate 365 days of synthetic historical records, validate it, and display diagnostics. In development mode, you can manually trigger model training after loading.
* **Custom Data**: Upload your own CSV file. The system will validate it on the fly and report errors, warnings, or anomalies instantly. Decoupled from automatic retraining to prevent data contamination.

## Evaluation Command

To evaluate the pipeline, run the shell orchestrator with the three positional arguments:

```bash
# Provide execute permissions on Unix/macOS if necessary
chmod +x run.sh

# Run the end-to-end evaluation command
./run.sh ./data ./pickle/model.pkl ./output/predictions.csv
```

### Compliance Verification

You can verify submission compliance at any time using the automated audit tool:

```bash
python src/compliance_check.py
```

This utility verifies file/directory presence, dependency pinning, absolute path safety, output schema layout, exact column name matching, and offline runtime capability.

---

## API Documentation

FastAPI exposes the following endpoints (available at `http://localhost:8000/docs`):

### 1. `POST /api/upload`
Uploads a raw advertising CSV. Validates data integrity and saves it to `data/historical_data.csv`. To ensure evaluation compliance, this does NOT trigger feature generation or model training.
* **Payload**: `multipart/form-data` containing the CSV file.
* **Response**: Data schema metrics, validation status, hygiene warnings, and detected anomalies.

### 2. `POST /api/train`
Triggers advanced feature generation (`generate_features.py`) and model training (`monte_carlo_forecaster.py`), saving the new pipeline package to `pickle/model.pkl`.
* **Access**: Restricted to Development Mode (`APP_MODE=development`). Returns `403 Forbidden` in Prediction Mode.
* **Response**: `{"status": "success", "message": "..."}`

### 3. `POST /api/forecast`
Loads the existing `pickle/model.pkl` and runs the recursive forecast modeling loop and Monte Carlo simulations. Returns aggregate forecasts and timeline drill-down arrays.
* **Validation**: Returns `500 Internal Server Error` if `pickle/model.pkl` is missing.
* **Payload**:
  ```json
  {
    "planningPeriod": 60,
    "budgets": {
      "Google Ads": 30000,
      "Meta Ads": 24000,
      "Microsoft Ads": 4000
    },
    "seasonalityWeight": 1.0,
    "confidenceLevel": 80
  }
  ```
* **Response**: Aggregated blended ROAS/Revenue stats and campaign-level forecast matrices.

### 4. `POST /api/ai_insights`
Generates a markdown advisory report using Gemini API or local rules.
* **Validation**: Returns `500 Internal Server Error` if `pickle/model.pkl` is missing.
* **Response**: `{"markdown": "..."}`

---

## Tabular Output Schema

Predictions are exported to `predictions.csv` with lowercased fields. In compliance with the AIgnition 3.0 hackathon, the final outputs are aggregated over the planning period (30, 60, or 90 Days) and provided at three granularity levels (Overall Blended, Channel-level, and Campaign-level):

* **Blended Row**: `channel="blended"`, `campaign="blended"`
* **Channel Rows**: `channel="Google Ads"|"Meta Ads"|"Microsoft Ads"`, `campaign="blended"`
* **Campaign Rows**: `channel="<ChannelName>"`, `campaign="<CampaignName>"`

| Column Header | Type | Description |
| :--- | :--- | :--- |
| `date` | YYYY-MM-DD | Start date of the planning period |
| `channel` | string | Channel name or "blended" |
| `campaign` | string | Campaign name or "blended" |
| `predicted_revenue_p10` | float | Pessimistic scenario aggregate revenue (10th percentile) |
| `predicted_revenue_p50` | float | Expected median scenario aggregate revenue (50th percentile) |
| `predicted_revenue_p90` | float | Optimistic scenario aggregate revenue (90th percentile) |
| `predicted_roas_p10` | float | Blended ROAS under pessimistic conditions |
| `predicted_roas_p50` | float | Blended ROAS under expected median conditions |
| `predicted_roas_p90` | float | Blended ROAS under optimistic conditions |

---

## Hackathon Validation Rules

When evaluating this pipeline in sandbox settings:
1. **Directory Constraints**: Ensure `pickle/model.pkl` is checked in, as the prediction phase (`predict.py`) loads it to compute recursive dependencies.
2. **Output Format**: Predictions output must strictly write a fresh CSV file (`.csv`) containing exactly the 9 lowercase columns defined in the Tabular Output Schema.
3. **Execution Safety**: Decoupled from automated retraining to ensure evaluations are fully reproducible using static, pre-existing coefficients.
4. **Offline Compatibility**: All pipeline operations execute successfully without internet access by relying on local advisory algorithms.

---

## Reproducibility

To guarantee 100% deterministic evaluation results across sandbox execution runs:
- **Fixed Random Seeds**: Global random seed values are initialized to `42` across the `random`, `numpy`, `xgboost` (via `random_state=42`), and `scikit-learn` libraries.
- **Deterministic Monte Carlo Simulations**: The Monte Carlo uncertainty simulation seeds are reset before generation loops, ensuring that running predictions repeatedly on identical inputs yields binary-identical outputs.
- **Offline Reliability (No Internet Dependency)**: The pipeline operates entirely offline. AI Consultation falls back onto a local, rules-based advisory model if no API key or network access is detected.
- **No Runtime Downloads**: Package versions are fully pinned and frozen. No libraries, configurations, or parameters are fetched dynamically at runtime.
- **Evaluation-Safe Execution**: Decoupled from automated retraining to safeguard pipeline evaluations against data corruption.
