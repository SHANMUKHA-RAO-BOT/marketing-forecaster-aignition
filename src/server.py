import os
import sys
import pickle
import pandas as pd
import numpy as np
from typing import Dict, List, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Add src to python path to resolve imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from utils import logger, DATA_DIR, MODEL_PATH, HIST_DATA_PATH, generate_test_scenarios
from validator import validate_historical_data
from predict import expand_test_scenario_to_campaigns, run_predictions_and_monte_carlo, call_gemini_api, generate_local_explanation

app = FastAPI(title="AdCast AI - Probabilistic Marketing Forecaster API")

# Application mode configurations: 'prediction' or 'development'
# Default mode is 'prediction' for compliance.
APP_MODE = os.environ.get("APP_MODE", "prediction").lower()
logger.info(f"AdCast AI initialized. Application Mode: {APP_MODE.upper()}")

# Startup validation: verify pre-trained model.pkl exists
if not os.path.exists(MODEL_PATH):
    logger.error(f"Startup validation failed: Pre-trained model artifact is missing at {MODEL_PATH}")
    raise RuntimeError(f"Startup validation failed: Pre-trained model artifact model.pkl is missing at {MODEL_PATH}. Evaluation requires a pre-existing model.")

# Enable CORS for local cross-origin frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. Pydantic Request & Response Schemas
class ForecastRequest(BaseModel):
    planningPeriod: int
    budgets: Dict[str, float]
    seasonalityWeight: float
    confidenceLevel: int
    geminiApiKey: Optional[str] = None

class AnomalyItem(BaseModel):
    date: str
    channel: str
    campaign: str
    type: str
    description: str
    severity: str

class ValidationResponse(BaseModel):
    isValid: bool
    errors: List[str]
    warnings: List[str]
    anomalies: List[AnomalyItem]
    stats: dict

# Helper function to convert campaign-level results back to channel results for frontend
def aggregate_forecast_results(aggregate_df, daily_df, planning_period, confidence_level):
    """
    Constructs the response payload from the pre-aggregated aggregate_df
    and includes daily_df for timeline drill-down.
    """
    # 1. Blended aggregate row
    blended_row = aggregate_df[(aggregate_df['channel'] == 'blended') & (aggregate_df['campaign'] == 'blended')].iloc[0]
    
    # 2. Channels aggregate rows
    channels_data = {}
    chan_rows = aggregate_df[(aggregate_df['campaign'] == 'blended') & (aggregate_df['channel'] != 'blended')]
    for _, row in chan_rows.iterrows():
        chan = row['channel']
        channels_data[chan] = {
            'budget': float(row['cost']),
            'revenue': {
                'pLow': float(row['predicted_revenue_p10']),
                'pMedian': float(row['predicted_revenue_p50']),
                'pHigh': float(row['predicted_revenue_p90'])
            },
            'roas': {
                'pLow': float(row['predicted_roas_p10']),
                'pMedian': float(row['predicted_roas_p50']),
                'pHigh': float(row['predicted_roas_p90'])
            }
        }
        
    # 3. Campaign aggregate rows
    campaigns_data = {}
    camp_rows = aggregate_df[(aggregate_df['campaign'] != 'blended') & (aggregate_df['channel'] != 'blended')]
    
    # Load campaign-to-type mapping from historical data if available
    campaign_to_type = {}
    if os.path.exists(HIST_DATA_PATH):
        try:
            hist_df = pd.read_csv(HIST_DATA_PATH)
            if 'CampaignName' in hist_df.columns and 'CampaignType' in hist_df.columns:
                campaign_to_type = hist_df.groupby('CampaignName')['CampaignType'].first().to_dict()
            elif 'campaign' in hist_df.columns and 'campaign_type' in hist_df.columns:
                campaign_to_type = hist_df.groupby('campaign')['campaign_type'].first().to_dict()
        except Exception as e:
            logger.warning(f"Could not load campaign-to-type mapping from historical data: {e}")
            
    for _, row in camp_rows.iterrows():
        camp = row['campaign']
        camp_type = campaign_to_type.get(camp, 'Search/Shopping/PMax')
        campaigns_data[camp] = {
            'budget': float(row['cost']),
            'channel': str(row['channel']),
            'type': camp_type,
            'revenue': {
                'pLow': float(row['predicted_revenue_p10']),
                'pMedian': float(row['predicted_revenue_p50']),
                'pHigh': float(row['predicted_revenue_p90'])
            },
            'roas': {
                'pLow': float(row['predicted_roas_p10']),
                'pMedian': float(row['predicted_roas_p50']),
                'pHigh': float(row['predicted_roas_p90'])
            }
        }
        
    # 4. Campaign Types aggregate calculations
    campaign_types_data = {}
    for camp, c_data in campaigns_data.items():
        c_type = c_data['type']
        if c_type not in campaign_types_data:
            campaign_types_data[c_type] = {
                'budget': 0.0,
                'channel': c_data['channel'],
                'revenue': {'pLow': 0.0, 'pMedian': 0.0, 'pHigh': 0.0},
                'roas': {'pLow': 0.0, 'pMedian': 0.0, 'pHigh': 0.0}
            }
        campaign_types_data[c_type]['budget'] += c_data['budget']
        campaign_types_data[c_type]['revenue']['pLow'] += c_data['revenue']['pLow']
        campaign_types_data[c_type]['revenue']['pMedian'] += c_data['revenue']['pMedian']
        campaign_types_data[c_type]['revenue']['pHigh'] += c_data['revenue']['pHigh']
        
    for ct, info in campaign_types_data.items():
        b = info['budget']
        info['roas']['pLow'] = float(info['revenue']['pLow'] / b if b > 0.0 else 0.0)
        info['roas']['pMedian'] = float(info['revenue']['pMedian'] / b if b > 0.0 else 0.0)
        info['roas']['pHigh'] = float(info['revenue']['pHigh'] / b if b > 0.0 else 0.0)
        
    # 5. Extract daily forecasts for timeline drill-down
    daily_records = daily_df.to_dict(orient='records')
    
    return {
        'planningPeriod': planning_period,
        'totalFutureBudget': float(blended_row['cost']),
        'seasonalityFactor': 1.0,  # Seasonality factor is baked into monthly multipliers
        'blended': {
            'revenue': {
                'pLow': float(blended_row['predicted_revenue_p10']),
                'pMedian': float(blended_row['predicted_revenue_p50']),
                'pHigh': float(blended_row['predicted_revenue_p90'])
            },
            'roas': {
                'pLow': float(blended_row['predicted_roas_p10']),
                'pMedian': float(blended_row['predicted_roas_p50']),
                'pHigh': float(blended_row['predicted_roas_p90'])
            }
        },
        'channels': channels_data,
        'campaignTypes': campaign_types_data,
        'campaigns': campaigns_data,
        'dailyForecasts': daily_records,
        'metadata': {
            'confidenceLevel': confidence_level
        }
    }


# 2. REST API Endpoints

@app.post("/api/upload", response_model=ValidationResponse)
async def upload_csv_file(file: UploadFile = File(...)):
    """Receives, parses, validates, and stores raw campaign data CSV on the server."""
    logger.info(f"Received API file upload: {file.filename}")
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted.")
        
    try:
        content = await file.read()
        csv_text = content.decode('utf-8')
        
        # Parse into pandas dataframe
        from io import StringIO
        df = pd.read_csv(StringIO(csv_text))
        
        # Run diagnostics
        is_valid, errors, warnings, anomalies = validate_historical_data(df)
        
        if is_valid:
            # Overwrite historical data file
            df.to_csv(HIST_DATA_PATH, index=False)
            logger.info(f"Saved uploaded historical data to {HIST_DATA_PATH}")
            logger.info("Automatic feature generation and model retraining is disabled during upload. Use POST /api/train in development mode to retrain.")
            
        # Parse stats details
        stats = {}
        if is_valid:
            df['Date'] = pd.to_datetime(df['Date'])
            stats = {
                'totalRows': len(df),
                'channels': list(df['Channel'].unique()),
                'campaigns': {
                    'size': int(df['CampaignName'].nunique())
                },
                'dateRange': {
                    'min': df['Date'].min().strftime('%Y-%m-%d'),
                    'max': df['Date'].max().strftime('%Y-%m-%d'),
                    'days': int((df['Date'].max() - df['Date'].min()).days + 1)
                },
                'totalSpend': float(df['Cost'].sum()),
                'totalRevenue': float(df['Revenue'].sum())
            }
            
        return {
            'isValid': is_valid,
            'errors': errors,
            'warnings': warnings,
            'anomalies': anomalies,
            'stats': stats
        }
    except Exception as e:
        logger.error(f"Error handling file upload: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to process CSV file: {str(e)}")

@app.post("/api/train")
async def execute_model_training():
    """
    Manually triggers model training and feature sync on the server.
    Loads raw historical data, generates features, and trains a new XGBoost model
    saved to pickle/model.pkl.
    """
    logger.info("Manual training request received via API.")
    if APP_MODE != "development":
        logger.warning(f"Training request rejected: manual training is disabled in {APP_MODE} mode.")
        raise HTTPException(
            status_code=403,
            detail="Manual model training is disabled in prediction mode. Set APP_MODE=development to enable manual training."
        )
        
    try:
        # Step 1: Sync features
        logger.info("Syncing features from historical data...")
        ret_features = os.system("python src/generate_features.py")
        if ret_features != 0:
            raise Exception("Feature generation script returned non-zero status code.")

        # Step 2: Train model
        logger.info("Training baseline XGBoost forecaster...")
        ret_train = os.system("python src/monte_carlo_forecaster.py")
        if ret_train != 0:
            raise Exception("Model training script returned non-zero status code.")
            
        logger.info("Manual training completed successfully.")
        return {"status": "success", "message": "Features generated and model.pkl trained successfully."}
    except Exception as e:
        logger.error(f"Manual training endpoint failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Training failed: {str(e)}")

@app.post("/api/forecast")
async def execute_forecast(req: ForecastRequest):
    """
    Accepts scenario parameters, generates test budget records, runs XGBoost 
    recursive predictions, performs Monte Carlo simulation, and returns blended and channel aggregates.
    """
    logger.info(f"Received API forecast request: Planning Horizon {req.planningPeriod} days")
    
    if not os.path.exists(MODEL_PATH):
        logger.error(f"Inference prediction aborted: Model package not found at {MODEL_PATH}")
        raise HTTPException(
            status_code=500,
            detail="Trained model package model.pkl not found on server. Set APP_MODE=development and run training first."
        )
        
    try:
        # Load model package and seasonality configs
        with open(MODEL_PATH, 'rb') as f:
            model_package = pickle.load(f)
            
        monthly_map = model_package.get('monthly_map', {})
        weekly_map = model_package.get('weekly_map', {})
        
        # 1. Generate future test scenarios from request budget splits
        test_rows = []
        import datetime
        now = datetime.datetime.now()
        
        for i in range(req.planningPeriod):
            dt = now + datetime.timedelta(days=i)
            date_str = dt.strftime('%Y-%m-%d')
            
            # Distribute total budget across planning period daily
            for channel, total_budget in req.budgets.items():
                daily_budget = total_budget / req.planningPeriod
                # Apply weekly variation
                variation = 1.0
                if dt.weekday() in [1, 2]: variation = 1.2
                elif dt.weekday() == 5: variation = 0.8
                
                test_rows.append({
                    'date': date_str,
                    'channel': channel,
                    'spend': round(daily_budget * variation, 2)
                })
                
        df_test = pd.DataFrame(test_rows)
        
        # 2. Expand budgets to campaigns
        expanded_df = expand_test_scenario_to_campaigns(
            df_test,
            model_package['campaign_shares'],
            model_package['baseline_run_rate']
        )
        
        if req.planningPeriod not in [30, 60, 90]:
            raise HTTPException(status_code=400, detail="Planning period must be 30, 60, or 90 days.")
            
        # Run predictions and Monte Carlo aggregate/daily simulations
        aggregate_df, daily_df = run_predictions_and_monte_carlo(expanded_df, model_package, monthly_map, weekly_map)
        
        # Aggregate results to the shape expected by app.js dashboard
        payload = aggregate_forecast_results(aggregate_df, daily_df, req.planningPeriod, req.confidenceLevel)
        return payload
    except Exception as e:
        logger.error(f"Inference simulation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Simulation error: {str(e)}")

@app.post("/api/ai_insights")
async def generate_ai_insights(req: Dict):
    """
    Generates growth analysis markdown reports using Gemini API key 
    or local rule-based heuristics.
    """
    logger.info("Received API AI insights request")
    
    gemini_key = os.environ.get("GEMINI_API_KEY")
    if not os.path.exists(MODEL_PATH):
        logger.error(f"AI insights generation aborted: Model package not found at {MODEL_PATH}")
        raise HTTPException(
            status_code=500,
            detail="Trained model package model.pkl not found on server. Set APP_MODE=development and run training first."
        )
        
    try:
        with open(MODEL_PATH, 'rb') as f:
            model_package = pickle.load(f)
            
        # Call explainability engines
        # Payload carries predictions and validations
        forecast_df = pd.DataFrame(req.get('forecast_summary', []))
        if forecast_df.empty:
            # Fallback to local heuristic
            logger.warning("Empty forecast metrics sent. Using local default insights.")
            # Mock data structure
            pred_summary = pd.DataFrame([{
                'predicted_revenue_p10': 0.0,
                'predicted_revenue_p50': 0.0,
                'predicted_revenue_p90': 0.0
            }])
            explanation = generate_local_explanation(pred_summary, pd.DataFrame([{'spend': 0.0}]), model_package)
            return {"markdown": explanation}
            
        # Parse metric sums
        total_planned_cost = forecast_df['cost'].sum() if 'cost' in forecast_df.columns else 0.0
        total_p10 = forecast_df['predicted_revenue_p10'].sum() if 'predicted_revenue_p10' in forecast_df.columns else 0.0
        total_p50 = forecast_df['predicted_revenue_p50'].sum() if 'predicted_revenue_p50' in forecast_df.columns else 0.0
        total_p90 = forecast_df['predicted_revenue_p90'].sum() if 'predicted_revenue_p90' in forecast_df.columns else 0.0
        
        if gemini_key:
            logger.info("GEMINI_API_KEY found. Calling Gemini API...")
            prompt = f"""You are a Senior Growth Marketing Analyst & Causal Inference Expert.
Explain the following e-commerce marketing forecast predictions:

### FORECAST METRICS SUMMARY
- Total planned cost: ₹{total_planned_cost:,.2f}
- Predicted P50 Revenue: ₹{total_p50:,.2f}
- Predicted P10 (Pessimistic) Revenue: ₹{total_p10:,.2f}
- Predicted P90 (Optimistic) Revenue: ₹{total_p90:,.2f}

Provide a structured growth marketing report explaining:
1. Executive Summary of the budget allocation efficiency.
2. How daily campaign-level volatilities model uncertainty in Monte Carlo simulations.
3. Actionable budget optimization strategies.
"""
            explanation = call_gemini_api(gemini_key, prompt)
            if not explanation:
                # Fallback
                pred_summary = pd.DataFrame([{
                    'predicted_revenue_p10': total_p10,
                    'predicted_revenue_p50': total_p50,
                    'predicted_revenue_p90': total_p90
                }])
                explanation = generate_local_explanation(pred_summary, pd.DataFrame([{ 'spend': total_planned_cost }]), model_package)
        else:
            logger.info("GEMINI_API_KEY not found. Calling local explanation engine...")
            pred_summary = pd.DataFrame([{
                'predicted_revenue_p10': total_p10,
                'predicted_revenue_p50': total_p50,
                'predicted_revenue_p90': total_p90
            }])
            explanation = generate_local_explanation(pred_summary, pd.DataFrame([{ 'spend': total_planned_cost }]), model_package)
            
        return {"markdown": explanation}
    except Exception as e:
        logger.error(f"Failed to generate AI insights: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Insights generation failed: {str(e)}")

# Mount static files to serve the dashboard UI at the root "/"
# StaticFiles expects absolute directory path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app.mount("/", StaticFiles(directory=BASE_DIR, html=True), name="static")
