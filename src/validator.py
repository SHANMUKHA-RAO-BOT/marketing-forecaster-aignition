import os
import pandas as pd
import numpy as np
from utils import logger

REQUIRED_FIELDS = ['Date', 'Channel', 'CampaignType', 'CampaignName', 'Cost', 'Impressions', 'Clicks', 'Conversions', 'Revenue']

def validate_historical_data(df):
    """
    Validates dataset integrity and detects advertising campaign structural anomalies.
    Returns: (is_valid, errors_list, warnings_list, anomalies_list)
    """
    is_valid = True
    errors = []
    warnings = []
    anomalies = []
    
    if df is None or len(df) == 0:
        return False, ["No data found or CSV could not be parsed."], [], []
        
    # Header check
    missing_fields = [f for f in REQUIRED_FIELDS if f not in df.columns]
    if missing_fields:
        return False, [f"Missing required columns: {', '.join(missing_fields)}"], [], []
        
    # Row by row diagnostics
    df_clean = df.copy()
    
    # 1. Check Date column
    try:
        df_clean['Date'] = pd.to_datetime(df_clean['Date'])
    except Exception as e:
        errors.append(f"Invalid Date column values: {str(e)}")
        is_valid = False
        
    # Check negative cost/revenue
    negative_costs = df_clean[df_clean['Cost'] < 0]
    if not negative_costs.empty:
        errors.append(f"Cost cannot be negative (found {len(negative_costs)} negative rows)")
        is_valid = False
        
    negative_revenue = df_clean[df_clean['Revenue'] < 0]
    if not negative_revenue.empty:
        errors.append(f"Revenue cannot be negative (found {len(negative_revenue)} negative rows)")
        is_valid = False
        
    # Unique Channels & Naming variations check
    channels = df_clean['Channel'].unique()
    variations = ['google', 'meta', 'facebook', 'microsoft', 'bing']
    for v in variations:
        matches = [c for c in channels if v in str(c).lower()]
        if len(matches) > 1:
            warnings.append(f"Channel naming inconsistency: found duplicate variations for '{v}' ({', '.join(matches)})")
            
    # Calculate dataset timespan
    if is_valid:
        min_date = df_clean['Date'].min()
        max_date = df_clean['Date'].max()
        days_span = (max_date - min_date).days + 1
        if days_span < 60:
            warnings.append(f"Dataset covers only {days_span} days. Seasonality calculations and accuracy may be limited. Recommend at least 90+ days of history.")
            
    # Anomalies Detection
    for idx, row in df_clean.iterrows():
        line_num = idx + 2 # 1-based, +1 for header
        cost = float(row['Cost'])
        revenue = float(row['Revenue'])
        conversions = int(row['Conversions'])
        clicks = int(row['Clicks'])
        impressions = int(row['Impressions'])
        date_str = str(row['Date']).split(' ')[0]
        channel = row['Channel']
        campaign = row['CampaignName']
        
        # 1. Pixel/tracking failure: high spend, 0 conversions/revenue
        if cost > 300.0 and conversions == 0 and revenue == 0.0:
            anomalies.append({
                'date': date_str,
                'channel': channel,
                'campaign': campaign,
                'type': 'Tracking/Pixel Breakdown',
                'description': f"Campaign '{campaign}' spent ₹{cost:.2f} on {date_str} but reported 0 conversions and ₹0 revenue. Potential pixel outage.",
                'severity': 'High'
            })
            
        # 2. ROAS collapse / bid engine glitch
        if cost > 200.0 and revenue > 0.0 and (revenue / cost) < 0.15:
            roas = revenue / cost
            anomalies.append({
                'date': date_str,
                'channel': channel,
                'campaign': campaign,
                'type': 'ROAS Collapse / Bid Glitch',
                'description': f"Campaign '{campaign}' spent ₹{cost:.2f} on {date_str} but returned only ₹{revenue:.2f} revenue ({roas:.2f}x ROAS). Potential bid engine anomaly.",
                'severity': 'Medium'
            })
            
        # 3. CTR anomaly: click fraud or double tracking
        if impressions > 50 and clicks > 0:
            ctr = clicks / impressions
            if ctr > 0.45:
                anomalies.append({
                    'date': date_str,
                    'channel': channel,
                    'campaign': campaign,
                    'type': 'Abnormal CTR (Potential Click Fraud)',
                    'description': f"Campaign '{campaign}' reported {clicks} clicks out of {impressions} impressions ({(ctr * 100):.1f}% CTR) on {date_str}.",
                    'severity': 'Low'
                })
                
        # 4. Cost with zero impressions
        if cost > 50.0 and impressions == 0 and clicks > 0:
            anomalies.append({
                'date': date_str,
                'channel': channel,
                'campaign': campaign,
                'type': 'Incomplete Delivery Metrics',
                'description': f"Campaign '{campaign}' recorded {clicks} clicks and spent ₹{cost:.2f} on {date_str} but reported 0 impressions.",
                'severity': 'Low'
            })
            
    return is_valid, errors, warnings, anomalies

def run_diagnostics(file_path):
    """Utility runner to diagnose CSV file."""
    logger.info(f"Diagnosing data file: {file_path}")
    if not os.path.exists(file_path):
        logger.error(f"File not found: {file_path}")
        return False
        
    try:
        df = pd.read_csv(file_path)
        is_valid, errors, warnings, anomalies = validate_historical_data(df)
        
        logger.info(f"Integrity Check: {'PASSED' if is_valid else 'FAILED'}")
        for err in errors:
            logger.error(f"[Error] {err}")
        for warn in warnings:
            logger.warning(f"[Warning] {warn}")
            
        if anomalies:
            logger.warning(f"Detected {len(anomalies)} anomalies in data source:")
            for a in anomalies[:5]:  # print first 5
                logger.warning(f" - [{a['severity']}] {a['type']} on {a['date']} in {a['campaign']}: {a['description']}")
            if len(anomalies) > 5:
                logger.warning(f" ... and {len(anomalies)-5} more anomalies.")
                
        return is_valid
    except Exception as e:
        logger.error(f"Error reading file {file_path}: {str(e)}")
        return False
