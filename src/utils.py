import os
import sys
import random
import logging
from datetime import datetime, timedelta
import pandas as pd
import numpy as np

# Set random seeds for reproducibility
random.seed(42)
np.random.seed(42)

# Configure path variables
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
PICKLE_DIR = os.path.join(BASE_DIR, 'pickle')

MODEL_PATH = os.path.join(PICKLE_DIR, 'model.pkl')
HIST_DATA_PATH = os.path.join(DATA_DIR, 'historical_data.csv')
TEST_DATA_PATH = os.path.join(DATA_DIR, 'test.csv')

# Ensure directories exist
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(PICKLE_DIR, exist_ok=True)

def setup_logger(name="forecaster_backend"):
    """Sets up a standardized logger for the pipeline."""
    logger = logging.getLogger(name)
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        handler = logging.StreamHandler()
        formatter = logging.Formatter('[%(asctime)s] %(levelname)s [%(name)s]: %(message)s', '%Y-%m-%d %H:%M:%S')
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    return logger

logger = setup_logger()

def log_reproducibility_info(caller_name):
    import pandas as pd
    import numpy as np
    import xgboost as xgb
    import sklearn
    
    logger.info(f"=== REPRODUCIBILITY LAYER STARTUP LOG [{caller_name.upper()}] ===")
    logger.info(f"Python Version: {sys.version.split()[0]}")
    logger.info(f"Pandas Version: {pd.__version__}")
    logger.info(f"Numpy Version:  {np.__version__}")
    logger.info(f"XGBoost Version: {xgb.__version__}")
    logger.info(f"Scikit-Learn Version: {sklearn.__version__}")
    logger.info(f"Global Random Seed Value: 42 (Deterministic)")
    logger.info("==================================================")

# Log reproducibility startup details automatically on module import
caller_script = os.path.basename(sys.argv[0]) if sys.argv else "unknown"
log_reproducibility_info(caller_script)

# Define campaign configurations mimicking dataset.js
CAMPAIGN_DEFS = [
    {'channel': 'Google Ads', 'type': 'Search', 'name': 'GG_Search_Brand', 'base_cost': 150.0, 'base_roas': 4.2},
    {'channel': 'Google Ads', 'type': 'Search', 'name': 'GG_Search_Generic', 'base_cost': 400.0, 'base_roas': 2.1},
    {'channel': 'Google Ads', 'type': 'PMax', 'name': 'GG_PMax_Performance', 'base_cost': 800.0, 'base_roas': 3.5},
    {'channel': 'Google Ads', 'type': 'Shopping', 'name': 'GG_Shopping_Top_Products', 'base_cost': 500.0, 'base_roas': 3.8},
    {'channel': 'Meta Ads', 'type': 'Prospecting', 'name': 'FB_Prospecting_Broad', 'base_cost': 600.0, 'base_roas': 2.8},
    {'channel': 'Meta Ads', 'type': 'Prospecting', 'name': 'FB_Prospecting_Lookalikes', 'base_cost': 400.0, 'base_roas': 3.2},
    {'channel': 'Meta Ads', 'type': 'Retargeting', 'name': 'FB_Retargeting_Catalog', 'base_cost': 200.0, 'base_roas': 5.5},
    {'channel': 'Microsoft Ads', 'type': 'Search', 'name': 'MS_Search_Brand', 'base_cost': 50.0, 'base_roas': 4.8},
    {'channel': 'Microsoft Ads', 'type': 'Shopping', 'name': 'MS_Shopping_Feed', 'base_cost': 100.0, 'base_roas': 2.5}
]

def generate_synthetic_data(days=365):
    """
    Generates realistic historical daily campaign-level marketing data.
    Ported directly from frontend dataset.js for equivalence in testing.
    """
    data = []
    now = datetime.now()
    
    # Weekly seasonality factors (Mon=0, Tue=1, ..., Sun=6 in python: Monday/Tuesday are highest, Saturday is lowest)
    # Javascript date.getDay() returns 0 for Sunday, 1 for Monday, etc.
    # In JS: weeklyFactor = 1.0 + [0.05, 0.15, 0.10, 0.05, 0.0, -0.10, -0.25][dayOfWeek] (where Sunday is 0)
    # Translate Sunday (6 in python weekday) -> index 0, Monday (0 in python weekday) -> index 1, etc.
    def get_weekly_factor(dt):
        js_day = (dt.weekday() + 1) % 7 # Sunday is 0, Monday is 1...
        factors = [0.05, 0.15, 0.10, 0.05, 0.0, -0.10, -0.25]
        return 1.0 + factors[js_day]

    # Monthly factor (Jan is 0)
    monthly_factors = [0.90, 0.95, 1.00, 1.05, 1.00, 0.85, 0.80, 0.85, 0.95, 1.05, 1.40, 1.60]

    for i in range(days, 0, -1):
        dt = now - timedelta(days=i)
        date_str = dt.strftime('%Y-%m-%d')
        
        weekly_factor = get_weekly_factor(dt)
        monthly_factor = monthly_factors[dt.month - 1]
        
        # Holiday factors
        holiday_factor = 1.0
        day_of_month = dt.day
        month_idx = dt.month - 1
        
        if month_idx == 10:  # November
            if 23 <= day_of_month <= 29:
                holiday_factor = 3.0 + random.random() * 0.5
        elif month_idx == 11:  # December
            if 10 <= day_of_month <= 20:
                holiday_factor = 1.8 + random.random() * 0.3
            elif 24 <= day_of_month <= 26:
                holiday_factor = 0.5
                
        combined_multiplier = weekly_factor * monthly_factor * holiday_factor
        
        for camp in CAMPAIGN_DEFS:
            noise = 0.85 + random.random() * 0.30
            seasonal_cost_factor = 1.0 + (combined_multiplier - 1.0) * 0.6
            cost = camp['base_cost'] * seasonal_cost_factor * noise
            
            cpc = 1.2 if camp['channel'] == 'Google Ads' else (0.8 if camp['channel'] == 'Meta Ads' else 0.6)
            ctr = 0.04 if camp['type'] == 'Search' else (0.02 if camp['type'] == 'PMax' else 0.015)
            
            clicks = round(cost / cpc)
            impressions = round(clicks / ctr)
            
            # Saturation factor
            saturation_factor = np.log(1.0 + (cost / camp['base_cost'])) / 0.693
            expected_roas = camp['base_roas'] * (1.0 - (saturation_factor - 1.0) * 0.12)
            expected_roas = expected_roas * (1.0 + (combined_multiplier - 1.0) * 0.4)
            
            revenue = cost * expected_roas * noise
            aov = 80.0
            conversions = round(revenue / aov)
            
            if cost < 1.0:
                cost, clicks, impressions, conversions, revenue = 0.0, 0, 0, 0, 0.0
                
            # Inject Anomalies (Anomalies A, B, C from dataset.js)
            days_ago = i
            # Anomaly A: Meta tracking pixel failure
            if camp['channel'] == 'Meta Ads' and 88 <= days_ago <= 90:
                conversions = 0
                revenue = 0.0
                
            # Anomaly B: Microsoft Ads billing error
            if camp['channel'] == 'Microsoft Ads' and 176 <= days_ago <= 180:
                cost, clicks, impressions, conversions, revenue = 0.0, 0, 0, 0, 0.0
                
            # Anomaly C: Google search generic bid glitch
            if camp['name'] == 'GG_Search_Generic' and (days_ago == 44 or days_ago == 45):
                cost = camp['base_cost'] * 3.5
                clicks = round(cost / cpc)
                impressions = round(clicks / ctr)
                revenue = cost * 0.4 * (0.9 + random.random() * 0.2)
                conversions = round(revenue / aov)
                
            conversions = max(0, conversions)
            revenue = round(revenue, 2)
            cost = round(cost, 2)
            
            data.append({
                'Date': date_str,
                'Channel': camp['channel'],
                'CampaignType': camp['type'],
                'CampaignName': camp['name'],
                'Cost': cost,
                'Impressions': impressions,
                'Clicks': clicks,
                'Conversions': conversions,
                'Revenue': revenue
            })
            
    return pd.DataFrame(data)

def generate_test_scenarios(days=30):
    """
    Generates a future prediction scenario (test set) where we want to project
    revenue for a planned budget.
    """
    data = []
    now = datetime.now()
    # Baseline future budget per day: scaled averages
    # Google Ads: $1500/day, Meta Ads: $1200/day, Microsoft Ads: $200/day
    budgets = {
        'Google Ads': 1500.0,
        'Meta Ads': 1200.0,
        'Microsoft Ads': 200.0
    }
    
    for i in range(days):
        dt = now + timedelta(days=i)
        date_str = dt.strftime('%Y-%m-%d')
        for channel, budget_val in budgets.items():
            # Add some scenario variations (e.g. higher budget mid-week)
            variation = 1.0
            if dt.weekday() in [1, 2]: # Tue/Wed increase budget by 20%
                variation = 1.2
            elif dt.weekday() == 5: # Saturday decrease budget by 20%
                variation = 0.8
                
            cost = round(budget_val * variation, 2)
            data.append({
                'Date': date_str,
                'Channel': channel,
                'Cost': cost
            })
            
    return pd.DataFrame(data)
