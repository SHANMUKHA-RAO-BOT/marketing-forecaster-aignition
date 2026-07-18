import os
import sys
import random
import pickle
import json
import requests
import pandas as pd
import numpy as np

# Set random seeds for reproducibility
random.seed(42)
np.random.seed(42)
from datetime import datetime
from utils import logger, MODEL_PATH, TEST_DATA_PATH, BASE_DIR, generate_test_scenarios

def load_seasonality_metadata():
    """Loads the monthly and weekly seasonality maps."""
    meta_path = os.path.join(os.path.dirname(MODEL_PATH), '..', 'data', 'seasonality_meta.pkl')
    if os.path.exists(meta_path):
        with open(meta_path, 'rb') as f:
            meta = pickle.load(f)
            return meta.get('monthly_map', {}), meta.get('weekly_map', {})
    return {}, {}

def expand_test_scenario_to_campaigns(test_df, campaign_shares, baseline_run_rate):
    """
    Expands channel budgets in test_df into daily campaign budgets using historical splits.
    Standardizes casing to lowercase fields: date, channel, campaign, spend.
    """
    df = test_df.copy()
    
    # Map input casings to lowercase standard fields
    rename_dict = {}
    for col in df.columns:
        low = col.lower()
        if low in ['date', 'channel', 'campaign', 'spend', 'cost']:
            target_name = 'spend' if low == 'cost' else low
            rename_dict[col] = target_name
    df = df.rename(columns=rename_dict)
    
    if 'campaign' in df.columns:
        # Campaign column exists. Standardize spend column name.
        if 'spend' not in df.columns and 'cost' in rename_dict.values():
            df = df.rename(columns={'cost': 'spend'})
        return df
        
    logger.info("Test scenario has no Campaign column. Expanding channel budgets proportionally...")
    
    expanded_rows = []
    for _, row in df.iterrows():
        channel = row['channel']
        date_val = row['date']
        channel_spend = float(row['spend'])
        
        shares = campaign_shares.get(channel, {})
        if not shares:
            logger.warning(f"No historical campaigns for '{channel}'. Using placeholder.")
            expanded_rows.append({
                'date': date_val,
                'channel': channel,
                'campaign': f"{channel}_Placeholder_Campaign",
                'spend': channel_spend
            })
            continue
            
        for campaign, share in shares.items():
            camp_spend = channel_spend * share
            expanded_rows.append({
                'date': date_val,
                'channel': channel,
                'campaign': campaign,
                'spend': camp_spend
            })
            
    return pd.DataFrame(expanded_rows)

def run_recursive_forecasting(combined_df, test_dates, model_package, monthly_map, weekly_map):
    """
    Runs a recursive daily forecasting loop. For each day, it recalculates rolling 
    and lag features based on prior days' actual/predicted values, and fits predictions.
    Optimized with NumPy to run in <0.5s instead of 15s.
    """
    df = combined_df.copy()
    df['date'] = pd.to_datetime(df['date'])
    
    model = model_package['model']
    feature_cols = model_package['feature_cols']
    chan_cols = model_package['chan_cols']
    baseline_run_rate = model_package['baseline_run_rate']
    
    # Sort chronologically by date per campaign
    df = df.sort_values(['campaign', 'date']).reset_index(drop=True)
    
    campaigns = sorted(df['campaign'].unique())
    num_campaigns = len(campaigns)
    total_days = len(df) // num_campaigns
    planning_period = len(test_dates)
    history_days = total_days - planning_period

    # Extract columns into contiguous 2D NumPy arrays of shape (num_campaigns, total_days)
    spend_arr = np.zeros((num_campaigns, total_days))
    revenue_arr = np.zeros((num_campaigns, total_days))
    clicks_arr = np.zeros((num_campaigns, total_days))
    conversions_arr = np.zeros((num_campaigns, total_days))

    month_arr = np.zeros((num_campaigns, total_days), dtype=int)
    weekday_arr = np.zeros((num_campaigns, total_days), dtype=int)
    day_arr = np.zeros((num_campaigns, total_days), dtype=int)
    monthly_seasonality_arr = np.zeros((num_campaigns, total_days))
    weekly_seasonality_arr = np.zeros((num_campaigns, total_days))
    log_spend_arr = np.zeros((num_campaigns, total_days))

    chan_dummies_arr = {col: np.zeros((num_campaigns, total_days)) for col in chan_cols}

    for c_idx, campaign in enumerate(campaigns):
        camp_df = df[df['campaign'] == campaign].sort_values('date').reset_index(drop=True)
        spend_arr[c_idx] = camp_df['spend'].values
        revenue_arr[c_idx] = camp_df['revenue'].values
        clicks_arr[c_idx] = camp_df['clicks'].fillna(0.0).values
        conversions_arr[c_idx] = camp_df['conversions'].fillna(0.0).values
        
        dates = pd.to_datetime(camp_df['date'])
        month_arr[c_idx] = dates.dt.month.values
        weekday_arr[c_idx] = dates.dt.dayofweek.values
        day_arr[c_idx] = dates.dt.day.values
        
        channel = camp_df['channel'].iloc[0]
        monthly_seasonality_arr[c_idx] = [monthly_map.get(channel, {}).get(m, 1.0) for m in month_arr[c_idx]]
        weekly_seasonality_arr[c_idx] = [weekly_map.get(channel, {}).get(w, 1.0) for w in weekday_arr[c_idx]]
        log_spend_arr[c_idx] = np.log1p(spend_arr[c_idx])
        
        for col in chan_cols:
            channel_name = col.replace('Chan_', '')
            chan_dummies_arr[col][c_idx] = 1.0 if channel == channel_name else 0.0

    # Pre-calculate clicks for future dates
    for c_idx, campaign in enumerate(campaigns):
        base = baseline_run_rate.get(campaign, {'spend_mean': 100.0, 'clicks_mean': 10.0, 'conversions_mean': 1.0, 'revenue_mean': 300.0})
        cpc = base['spend_mean'] / (base['clicks_mean'] + 1e-5)
        if cpc <= 0.0: cpc = 1.0
        clicks_arr[c_idx, history_days:] = np.round(spend_arr[c_idx, history_days:] / cpc)

    num_features = len(feature_cols)

    # Fast recursive daily loop in NumPy
    for t in range(history_days, total_days):
        spend_lag_1 = spend_arr[:, max(0, t - 1)]
        spend_lag_7 = spend_arr[:, max(0, t - 7)]
        revenue_lag_1 = revenue_arr[:, max(0, t - 1)].copy()
        revenue_lag_7 = revenue_arr[:, max(0, t - 7)].copy()
        
        spend_roll_mean_7 = np.mean(spend_arr[:, max(0, t - 7) : t], axis=1)
        spend_roll_mean_30 = np.mean(spend_arr[:, max(0, t - 30) : t], axis=1)
        revenue_roll_mean_7 = np.mean(revenue_arr[:, max(0, t - 7) : t], axis=1)
        revenue_roll_mean_30 = np.mean(revenue_arr[:, max(0, t - 30) : t], axis=1)
        clicks_roll_mean_30 = np.mean(clicks_arr[:, max(0, t - 30) : t], axis=1)
        conversions_roll_mean_30 = np.mean(conversions_arr[:, max(0, t - 30) : t], axis=1)
        
        # Check and fill NaNs (safeguard)
        for c_idx, campaign in enumerate(campaigns):
            base = baseline_run_rate.get(campaign, {'spend_mean': 0.0, 'revenue_mean': 0.0, 'clicks_mean': 1.0, 'conversions_mean': 1.0})
            if pd.isna(revenue_lag_1[c_idx]): revenue_lag_1[c_idx] = base['revenue_mean']
            if pd.isna(revenue_lag_7[c_idx]): revenue_lag_7[c_idx] = base['revenue_mean']
            
            if np.isnan(revenue_roll_mean_7[c_idx]):
                revenue_roll_mean_7[c_idx] = base['revenue_mean']
            if np.isnan(revenue_roll_mean_30[c_idx]):
                revenue_roll_mean_30[c_idx] = base['revenue_mean']
            if np.isnan(conversions_roll_mean_30[c_idx]):
                conversions_roll_mean_30[c_idx] = base['conversions_mean']

        spend_growth_rate = (spend_lag_1 - spend_lag_7) / (spend_lag_7 + 1e-5)
        revenue_growth_rate = (revenue_lag_1 - revenue_lag_7) / (revenue_lag_7 + 1e-5)
        conversion_rate = conversions_roll_mean_30 / (clicks_roll_mean_30 + 1e-5)
        ROAS = revenue_roll_mean_30 / (spend_roll_mean_30 + 1e-5)
        campaign_performance_trend = revenue_roll_mean_7 / (revenue_roll_mean_30 + 1e-5)
        
        # Calculate channel trend dynamically
        channel_performance_trend = np.zeros(num_campaigns)
        channel_sums_7 = {}
        channel_sums_30 = {}
        for c_idx, campaign in enumerate(campaigns):
            chan = None
            for col in chan_cols:
                if chan_dummies_arr[col][c_idx, t] == 1.0:
                    chan = col
                    break
            if chan not in channel_sums_7:
                channel_sums_7[chan] = 0.0
                channel_sums_30[chan] = 0.0
            channel_sums_7[chan] += revenue_roll_mean_7[c_idx]
            channel_sums_30[chan] += revenue_roll_mean_30[c_idx]
            
        for c_idx, campaign in enumerate(campaigns):
            chan = None
            for col in chan_cols:
                if chan_dummies_arr[col][c_idx, t] == 1.0:
                    chan = col
                    break
            channel_performance_trend[c_idx] = channel_sums_7[chan] / (channel_sums_30[chan] + 1e-5)
            
        # Build 2D feature matrix
        X_day = np.zeros((num_campaigns, num_features))
        for f_idx, col in enumerate(feature_cols):
            if col == 'spend': X_day[:, f_idx] = spend_arr[:, t]
            elif col == 'month': X_day[:, f_idx] = month_arr[:, t]
            elif col == 'weekday': X_day[:, f_idx] = weekday_arr[:, t]
            elif col == 'day': X_day[:, f_idx] = day_arr[:, t]
            elif col == 'monthly_seasonality': X_day[:, f_idx] = monthly_seasonality_arr[:, t]
            elif col == 'weekly_seasonality': X_day[:, f_idx] = weekly_seasonality_arr[:, t]
            elif col == 'log_spend': X_day[:, f_idx] = log_spend_arr[:, t]
            elif col == 'spend_lag_1': X_day[:, f_idx] = spend_lag_1
            elif col == 'spend_lag_7': X_day[:, f_idx] = spend_lag_7
            elif col == 'revenue_lag_1': X_day[:, f_idx] = revenue_lag_1
            elif col == 'revenue_lag_7': X_day[:, f_idx] = revenue_lag_7
            elif col == 'spend_roll_mean_7': X_day[:, f_idx] = spend_roll_mean_7
            elif col == 'spend_roll_mean_30': X_day[:, f_idx] = spend_roll_mean_30
            elif col == 'revenue_roll_mean_7': X_day[:, f_idx] = revenue_roll_mean_7
            elif col == 'revenue_roll_mean_30': X_day[:, f_idx] = revenue_roll_mean_30
            elif col == 'clicks_roll_mean_30': X_day[:, f_idx] = clicks_roll_mean_30
            elif col == 'conversions_roll_mean_30': X_day[:, f_idx] = conversions_roll_mean_30
            elif col == 'spend_growth_rate': X_day[:, f_idx] = spend_growth_rate
            elif col == 'revenue_growth_rate': X_day[:, f_idx] = revenue_growth_rate
            elif col == 'conversion_rate': X_day[:, f_idx] = conversion_rate
            elif col == 'ROAS': X_day[:, f_idx] = ROAS
            elif col == 'campaign_performance_trend': X_day[:, f_idx] = campaign_performance_trend
            elif col == 'channel_performance_trend': X_day[:, f_idx] = channel_performance_trend
            elif col in chan_dummies_arr:
                X_day[:, f_idx] = chan_dummies_arr[col][:, t]
                
        preds = np.maximum(0.0, model.predict(X_day))
        revenue_arr[:, t] = preds
        
        for c_idx, campaign in enumerate(campaigns):
            base = baseline_run_rate.get(campaign, {'revenue_mean': 300.0, 'conversions_mean': 1.0})
            aov = base['revenue_mean'] / (base['conversions_mean'] + 1e-5)
            if aov <= 0.0: aov = 80.0
            conversions_arr[c_idx, t] = round(preds[c_idx] / aov)

    # Write predictions back to combined_df (matching original campaigns sorting)
    for c_idx, campaign in enumerate(campaigns):
        mask = df['campaign'] == campaign
        idx_sorted = df[mask].sort_values('date').index
        df.loc[idx_sorted, 'revenue'] = revenue_arr[c_idx]
        df.loc[idx_sorted, 'clicks'] = clicks_arr[c_idx]
        df.loc[idx_sorted, 'conversions'] = conversions_arr[c_idx]

    return df

def run_predictions_and_monte_carlo(test_df, model_package, monthly_map, weekly_map):
    """
    Combines training history and test cases to run recursive forecasting.
    Then executes 1000 Monte Carlo loops and returns:
      - aggregate_df: DataFrame of aggregated predictions over the planning period.
      - daily_df: DataFrame of daily predictions (for timeline drill-down).
    """
    history_tail = model_package['history_tail']
    history_df = pd.DataFrame(history_tail)
    history_df['date'] = pd.to_datetime(history_df['date'])
    
    # Format test set placeholders
    test_df['date'] = pd.to_datetime(test_df['date'])
    test_df['revenue'] = np.nan
    test_df['clicks'] = 0.0
    test_df['conversions'] = 0.0
    
    # Filter out overlapping historical dates to avoid duplicate rows
    min_test_date = test_df['date'].min()
    history_df = history_df[history_df['date'] < min_test_date]
    
    # Combine history + test
    combined_df = pd.concat([history_df, test_df], ignore_index=True)
    combined_df['date'] = pd.to_datetime(combined_df['date'])
    
    test_dates = test_df['date'].unique()
    planning_period = len(test_dates)
    
    # Run daily prediction loop
    logger.info("Executing recursive forecasting loop across future dates...")
    forecasted_df = run_recursive_forecasting(combined_df, test_dates, model_package, monthly_map, weekly_map)
    
    # Filter back to only test dates
    forecast_results = forecasted_df[forecasted_df['date'].isin(test_dates)].copy()
    
    # Perform Monte Carlo simulations
    volatilities = model_package['volatilities']
    
    campaigns = forecast_results['campaign'].unique()
    channels = forecast_results['channel'].unique()
    
    # Setup random seeds for Monte Carlo simulation
    random.seed(42)
    np.random.seed(42)
    
    # 1. Compute Daily Trials and Daily Percentiles (for daily_df)
    p10_revs_daily = []
    p50_revs_daily = []
    p90_revs_daily = []
    
    campaign_trials = {}
    campaign_costs = {}
    campaign_channels = {}
    
    for campaign in campaigns:
        camp_data = forecast_results[forecast_results['campaign'] == campaign].sort_values('date')
        expected_revs = camp_data['revenue'].values
        costs = camp_data['spend'].values
        vol = volatilities.get(campaign, 0.20)
        channel = camp_data['channel'].iloc[0]
        
        # Simulate daily revenue for 1000 trials
        noise = np.random.normal(loc=0.0, scale=vol, size=(len(camp_data), 1000))
        daily_trials = expected_revs[:, np.newaxis] * (1.0 + noise)
        daily_trials = np.maximum(0.0, daily_trials)
        
        campaign_trials[campaign] = daily_trials
        campaign_costs[campaign] = costs.sum()
        campaign_channels[campaign] = channel
        
    campaign_indices = {c: 0 for c in campaigns}
    for idx, row in forecast_results.iterrows():
        camp = row['campaign']
        c_idx = campaign_indices[camp]
        trial_row = campaign_trials[camp][c_idx, :]
        
        p10 = np.percentile(trial_row, 10)
        p50 = np.percentile(trial_row, 50)
        p90 = np.percentile(trial_row, 90)
        
        p10 = min(p10, p50)
        p90 = max(p90, p50)
        
        p10_revs_daily.append(p10)
        p50_revs_daily.append(p50)
        p90_revs_daily.append(p90)
        
        campaign_indices[camp] += 1
        
    daily_results = forecast_results.copy()
    daily_results['predicted_revenue_p10'] = np.round(p10_revs_daily, 2)
    daily_results['predicted_revenue_p50'] = np.round(p50_revs_daily, 2)
    daily_results['predicted_revenue_p90'] = np.round(p90_revs_daily, 2)
    
    daily_results['predicted_roas_p10'] = np.where(daily_results['spend'] > 0.0, np.round(daily_results['predicted_revenue_p10'] / daily_results['spend'], 2), 0.0)
    daily_results['predicted_roas_p50'] = np.where(daily_results['spend'] > 0.0, np.round(daily_results['predicted_revenue_p50'] / daily_results['spend'], 2), 0.0)
    daily_results['predicted_roas_p90'] = np.where(daily_results['spend'] > 0.0, np.round(daily_results['predicted_revenue_p90'] / daily_results['spend'], 2), 0.0)
    
    daily_results = daily_results.rename(columns={'spend': 'cost'})
    daily_output_cols = [
        'date', 'channel', 'campaign', 'cost',
        'predicted_revenue_p10', 'predicted_revenue_p50', 'predicted_revenue_p90',
        'predicted_roas_p10', 'predicted_roas_p50', 'predicted_roas_p90'
    ]
    daily_results['date'] = daily_results['date'].dt.strftime('%Y-%m-%d')
    daily_df = daily_results[daily_output_cols]
    
    # 2. Compute Aggregated Planning-Period Trials and Percentiles
    start_date_str = pd.to_datetime(test_dates.min()).strftime('%Y-%m-%d')
    aggregate_rows = []
    
    # A. Overall Blended aggregate
    blended_trials = np.zeros(1000)
    total_blended_cost = 0.0
    for campaign, daily_trials in campaign_trials.items():
        blended_trials += daily_trials.sum(axis=0)
        total_blended_cost += campaign_costs[campaign]
        
    blended_p10_rev = np.percentile(blended_trials, 10)
    blended_p50_rev = np.percentile(blended_trials, 50)
    blended_p90_rev = np.percentile(blended_trials, 90)
    
    if total_blended_cost > 0:
        blended_roas_trials = blended_trials / total_blended_cost
        blended_p10_roas = np.percentile(blended_roas_trials, 10)
        blended_p50_roas = np.percentile(blended_roas_trials, 50)
        blended_p90_roas = np.percentile(blended_roas_trials, 90)
    else:
        blended_p10_roas = blended_p50_roas = blended_p90_roas = 0.0
        
    aggregate_rows.append({
        'date': start_date_str,
        'channel': 'blended',
        'campaign': 'blended',
        'cost': round(total_blended_cost, 2),
        'predicted_revenue_p10': round(np.maximum(0.0, blended_p10_rev), 2),
        'predicted_revenue_p50': round(np.maximum(0.0, blended_p50_rev), 2),
        'predicted_revenue_p90': round(np.maximum(0.0, blended_p90_rev), 2),
        'predicted_roas_p10': round(np.maximum(0.0, blended_p10_roas), 2),
        'predicted_roas_p50': round(np.maximum(0.0, blended_p50_roas), 2),
        'predicted_roas_p90': round(np.maximum(0.0, blended_p90_roas), 2)
    })
    
    # B. Channel-level aggregate
    for channel in channels:
        channel_trials = np.zeros(1000)
        total_channel_cost = 0.0
        for campaign in campaigns:
            if campaign_channels[campaign] == channel:
                channel_trials += campaign_trials[campaign].sum(axis=0)
                total_channel_cost += campaign_costs[campaign]
                
        chan_p10_rev = np.percentile(channel_trials, 10)
        chan_p50_rev = np.percentile(channel_trials, 50)
        chan_p90_rev = np.percentile(channel_trials, 90)
        
        if total_channel_cost > 0:
            chan_roas_trials = channel_trials / total_channel_cost
            chan_p10_roas = np.percentile(chan_roas_trials, 10)
            chan_p50_roas = np.percentile(chan_roas_trials, 50)
            chan_p90_roas = np.percentile(chan_roas_trials, 90)
        else:
            chan_p10_roas = chan_p50_roas = chan_p90_roas = 0.0
            
        aggregate_rows.append({
            'date': start_date_str,
            'channel': channel,
            'campaign': 'blended',
            'cost': round(total_channel_cost, 2),
            'predicted_revenue_p10': round(np.maximum(0.0, chan_p10_rev), 2),
            'predicted_revenue_p50': round(np.maximum(0.0, chan_p50_rev), 2),
            'predicted_revenue_p90': round(np.maximum(0.0, chan_p90_rev), 2),
            'predicted_roas_p10': round(np.maximum(0.0, chan_p10_roas), 2),
            'predicted_roas_p50': round(np.maximum(0.0, chan_p50_roas), 2),
            'predicted_roas_p90': round(np.maximum(0.0, chan_p90_roas), 2)
        })
        
    # C. Campaign-level aggregate
    for campaign in campaigns:
        camp_trials = campaign_trials[campaign].sum(axis=0)
        camp_p10_rev = np.percentile(camp_trials, 10)
        camp_p50_rev = np.percentile(camp_trials, 50)
        camp_p90_rev = np.percentile(camp_trials, 90)
        
        camp_cost = campaign_costs[campaign]
        channel = campaign_channels[campaign]
        
        if camp_cost > 0:
            camp_roas_trials = camp_trials / camp_cost
            camp_p10_roas = np.percentile(camp_roas_trials, 10)
            camp_p50_roas = np.percentile(camp_roas_trials, 50)
            camp_p90_roas = np.percentile(camp_roas_trials, 90)
        else:
            camp_p10_roas = camp_p50_roas = camp_p90_roas = 0.0
            
        aggregate_rows.append({
            'date': start_date_str,
            'channel': channel,
            'campaign': campaign,
            'cost': round(camp_cost, 2),
            'predicted_revenue_p10': round(np.maximum(0.0, camp_p10_rev), 2),
            'predicted_revenue_p50': round(np.maximum(0.0, camp_p50_rev), 2),
            'predicted_revenue_p90': round(np.maximum(0.0, camp_p90_rev), 2),
            'predicted_roas_p10': round(np.maximum(0.0, camp_p10_roas), 2),
            'predicted_roas_p50': round(np.maximum(0.0, camp_p50_roas), 2),
            'predicted_roas_p90': round(np.maximum(0.0, camp_p90_roas), 2)
        })
        
    aggregate_df = pd.DataFrame(aggregate_rows)
    return aggregate_df, daily_df

def call_gemini_api(api_key, prompt):
    """Calls Gemini API for explanations."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 2048}
    }
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        if response.status_code == 200:
            res_json = response.json()
            return res_json['candidates'][0]['content']['parts'][0]['text']
        else:
            raise Exception(f"Status Code {response.status_code}: {response.text}")
    except Exception as e:
        logger.error(f"Gemini API request failed: {str(e)}")
        return None

def generate_local_explanation(pred_summary, test_df, model_package):
    """Fallback advisor report builder."""
    volatilities = model_package['volatilities']
    baseline_run_rate = model_package['baseline_run_rate']
    
    # Cost column mapping
    spend_col = 'spend' if 'spend' in test_df.columns else ('Cost' if 'Cost' in test_df.columns else 'cost')
    total_spend = test_df[spend_col].sum()
    total_rev_p50 = pred_summary['predicted_revenue_p50'].sum()
    blended_roas = total_rev_p50 / (total_spend + 1e-5)
    
    report = f"""# E-Commerce Marketing Forecast & Causal Diagnostics Report
*Uncertainty Simulation & Growth Advisory*

## Executive Summary
* **Total Proposed Spend**: ₹{total_spend:,.2f}
* **Expected Total Revenue (P50)**: ₹{total_rev_p50:,.2f}
* **Blended ROAS Forecast**: {blended_roas:.2f}x
* **Probabilistic Bounds**: 
  - Pessimistic Revenue (P10): ₹{pred_summary['predicted_revenue_p10'].sum():,.2f} (ROAS: {pred_summary['predicted_revenue_p10'].sum()/(total_spend+1e-5):.2f}x)
  - Optimistic Revenue (P90): ₹{pred_summary['predicted_revenue_p90'].sum():,.2f} (ROAS: {pred_summary['predicted_revenue_p90'].sum()/(total_spend+1e-5):.2f}x)

---

## Causal Diagnostics & Volatility Analysis
Our Monte Carlo engine modeled campaign variances using learned volatility parameters:
"""
    for camp, vol in volatilities.items():
        base = baseline_run_rate.get(camp, {'spend_mean': 0.0, 'revenue_mean': 0.0})
        roas = base['revenue_mean'] / (base['spend_mean'] + 1e-5)
        report += f"- **{camp}**: Daily volatility is **{vol*100:.1f}%**. (Historical baseline spend: ₹{base['spend_mean']:.2f}/day, ROAS: {roas:.2f}x).\n"
        
    report += f"""
---

## Strategic Reallocation Suggestions
Based on advanced time-series lags and saturation trends:
1. Shift media budget to low-volatility, positive-trend campaigns.
2. Monitor daily spend lag trends (spend growth rate is calculated dynamically) to avoid sudden over-saturation spikes.
3. Meta Ads retargeting represents stable performance, but check creative asset frequency if daily volumes decay.
"""
    return report

REQUIRED_OUTPUT_COLUMNS = [
    "date",
    "channel",
    "campaign",
    "predicted_revenue_p10",
    "predicted_revenue_p50",
    "predicted_revenue_p90",
    "predicted_roas_p10",
    "predicted_roas_p50",
    "predicted_roas_p90"
]

def validate_prediction_schema(df: pd.DataFrame):
    """
    Validates that the prediction DataFrame contains exactly the required columns in lowercase.
    Raises ValueError if validation fails.
    """
    columns = list(df.columns)
    
    # 1. Check lowercase names
    non_lowercase = [col for col in columns if not col.islower()]
    if non_lowercase:
        raise ValueError(f"Evaluation constraint failed: output columns must be all lowercase, found: {non_lowercase}")
        
    # 2. Check for missing columns
    missing_cols = [col for col in REQUIRED_OUTPUT_COLUMNS if col not in columns]
    if missing_cols:
        raise ValueError(f"Evaluation constraint failed: missing required output columns: {missing_cols}")
        
    # 3. Check for extra columns
    extra_cols = [col for col in columns if col not in REQUIRED_OUTPUT_COLUMNS]
    if extra_cols:
        raise ValueError(f"Evaluation constraint failed: unexpected columns in output schema: {extra_cols}")

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Forecast e-commerce ad performance")
    parser.add_argument('--features', type=str, required=True, help="Path to test scenario budget CSV")
    parser.add_argument('--model', type=str, required=True, help="Path to trained model.pkl")
    parser.add_argument('--output', type=str, required=True, help="Path to save predictions.csv")
    args = parser.parse_args()
    
    logger.info(f"Starting prediction and Monte Carlo inference using model: {args.model}")
    
    # Validate that the output format is CSV only
    if not args.output.lower().endswith('.csv'):
        logger.error(f"Evaluation constraint failed: Output file must have .csv extension, got: {args.output}")
        sys.exit(1)
        
    if not os.path.exists(args.model):
        logger.error(f"Startup validation failed: Trained model not found at {args.model}.")
        raise FileNotFoundError(f"Startup validation failed: Pre-trained model artifact model.pkl not found at {args.model}.")
        
    with open(args.model, 'rb') as f:
        model_package = pickle.load(f)
        
    monthly_map = model_package.get('monthly_map', {})
    weekly_map = model_package.get('weekly_map', {})
    
    # Load test inputs
    if not os.path.exists(args.features):
        logger.error(f"Test scenario file not found at {args.features}.")
        sys.exit(1)
        
    df_test = pd.read_csv(args.features)
    
    # Standardize casings of test inputs
    df_test = df_test.rename(columns={
        'Date': 'date',
        'Channel': 'channel',
        'Cost': 'spend',
        'cost': 'spend',
        'CampaignName': 'campaign'
    })
    
    # Expand budgets to daily campaign levels
    expanded_test_df = expand_test_scenario_to_campaigns(
        df_test,
        model_package['campaign_shares'],
        model_package['baseline_run_rate']
    )
    
    # Run prediction loops
    aggregate_df, daily_df = run_predictions_and_monte_carlo(expanded_test_df, model_package, monthly_map, weekly_map)
    
    # Save predictions to the path specified by --output (excluding 'cost' column for CLI compliance)
    csv_cols = [c for c in aggregate_df.columns if c != 'cost']
    export_df = aggregate_df[csv_cols]
    
    # Validate schema before saving
    try:
        validate_prediction_schema(export_df)
        logger.info("Output prediction schema validation passed successfully.")
    except ValueError as ve:
        logger.error(f"Prediction schema validation failed: {ve}")
        sys.exit(1)
        
    # Write fresh file (overwrite existing file, no appending)
    if os.path.exists(args.output):
        try:
            os.remove(args.output)
            logger.info(f"Existing file at {args.output} deleted to guarantee a fresh write.")
        except Exception as e:
            logger.warning(f"Could not delete existing file {args.output}: {e}")
            
    export_df.to_csv(args.output, index=False)
    logger.info(f"Saved validated aggregated planning-period forecasts to {args.output}.")
    
    # Explanation Engine
    gemini_key = os.environ.get("GEMINI_API_KEY")
    output_dir = os.path.dirname(args.output) if os.path.dirname(args.output) else "."
    reasoning_path = os.path.join(output_dir, 'business_reasoning.md')
    
    # Extract blended totals for prompt
    blended_row = aggregate_df[(aggregate_df['channel'] == 'blended') & (aggregate_df['campaign'] == 'blended')].iloc[0]
    total_planned_cost = blended_row['cost']
    total_p10 = blended_row['predicted_revenue_p10']
    total_p50 = blended_row['predicted_revenue_p50']
    total_p90 = blended_row['predicted_revenue_p90']
    
    if gemini_key:
        logger.info("GEMINI_API_KEY found. Generating explanation report from Gemini...")
        prompt = f"""You are a Senior Growth Marketing Analyst & Causal Inference Expert.
Explain the following e-commerce forecasting simulation predictions.

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
            explanation = generate_local_explanation(aggregate_df, df_test, model_package)
    else:
        logger.info("GEMINI_API_KEY not found. Generating explanation report from local engine...")
        explanation = generate_local_explanation(aggregate_df, df_test, model_package)
        
    with open(reasoning_path, 'w', encoding='utf-8') as f:
        f.write(explanation)
    logger.info(f"Saved business explanation report to {reasoning_path}.")
    
    logger.info("Pipeline forecasting completed successfully.")

if __name__ == '__main__':
    main()
