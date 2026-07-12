import os
import random
import pandas as pd
import numpy as np
import pickle

# Set random seeds for reproducibility
random.seed(42)
np.random.seed(42)
from utils import logger, HIST_DATA_PATH, DATA_DIR, generate_synthetic_data

def calculate_seasonality_multipliers(df):
    """
    Computes monthly and weekly seasonality multipliers.
    Returns:
      monthly_map: {channel: {month: multiplier}}
      weekly_map: {channel: {weekday: multiplier}}
    """
    df = df.copy()
    df['date'] = pd.to_datetime(df['date'])
    df['month'] = df['date'].dt.month
    df['weekday'] = df['date'].dt.dayofweek
    
    # Blended aggregates for normalization
    overall_avg = df.groupby('channel')['revenue'].mean()
    
    # Monthly Seasonality
    monthly_avg = df.groupby(['channel', 'month'])['revenue'].mean()
    monthly_map = {}
    for chan in df['channel'].unique():
        monthly_map[chan] = {}
        chan_avg = overall_avg.get(chan, 1.0)
        for m in range(1, 13):
            try:
                monthly_map[chan][m] = float(monthly_avg.loc[(chan, m)] / (chan_avg + 1e-5))
            except KeyError:
                monthly_map[chan][m] = 1.0
                
    # Weekly Seasonality
    weekly_avg = df.groupby(['channel', 'weekday'])['revenue'].mean()
    weekly_map = {}
    for chan in df['channel'].unique():
        weekly_map[chan] = {}
        chan_avg = overall_avg.get(chan, 1.0)
        for w in range(7):
            try:
                weekly_map[chan][w] = float(weekly_avg.loc[(chan, w)] / (chan_avg + 1e-5))
            except KeyError:
                weekly_map[chan][w] = 1.0
                
    return monthly_map, weekly_map

def compute_row_features(df, monthly_map, weekly_map):
    """
    Computes lags, rolling averages, growth rates, and trends.
    Uses shift(1) for target-dependent rolling metrics to avoid training data leakage.
    """
    # Sort to ensure lag operations are correct
    df = df.sort_values(['campaign', 'date']).reset_index(drop=True)
    
    # 1. Calendar Attributes
    df['month'] = df['date'].dt.month
    df['weekday'] = df['date'].dt.dayofweek
    df['day'] = df['date'].dt.day
    
    # 2. Map Monthly & Weekly Seasonality Factors
    df['monthly_seasonality'] = df.apply(lambda r: monthly_map.get(r['channel'], {}).get(r['month'], 1.0), axis=1)
    df['weekly_seasonality'] = df.apply(lambda r: weekly_map.get(r['channel'], {}).get(r['weekday'], 1.0), axis=1)
    
    # 3. Saturation Spend Response
    df['log_spend'] = np.log1p(df['spend'])
    
    # 4. Lag Features (Shifted by 1 day)
    df['spend_lag_1'] = df.groupby('campaign')['spend'].shift(1)
    df['spend_lag_7'] = df.groupby('campaign')['spend'].shift(7)
    df['revenue_lag_1'] = df.groupby('campaign')['revenue'].shift(1)
    df['revenue_lag_7'] = df.groupby('campaign')['revenue'].shift(7)
    
    # Fill lag NaNs with overall campaign averages
    df['spend_lag_1'] = df['spend_lag_1'].fillna(df.groupby('campaign')['spend'].transform('mean'))
    df['spend_lag_7'] = df['spend_lag_7'].fillna(df.groupby('campaign')['spend'].transform('mean'))
    df['revenue_lag_1'] = df['revenue_lag_1'].fillna(df.groupby('campaign')['revenue'].transform('mean'))
    df['revenue_lag_7'] = df['revenue_lag_7'].fillna(df.groupby('campaign')['revenue'].transform('mean'))
    
    # 5. Spend & Revenue Growth Rates (Shifted to prevent leakage)
    df['spend_growth_rate'] = (df['spend_lag_1'] - df['spend_lag_7']) / (df['spend_lag_7'] + 1e-5)
    df['revenue_growth_rate'] = (df['revenue_lag_1'] - df['revenue_lag_7']) / (df['revenue_lag_7'] + 1e-5)
    
    # 6. Rolling Averages (Shifted by 1 day to prevent leakage)
    df['spend_roll_mean_7'] = df.groupby('campaign')['spend'].transform(
        lambda x: x.shift(1).rolling(window=7, min_periods=1).mean()
    )
    df['spend_roll_mean_30'] = df.groupby('campaign')['spend'].transform(
        lambda x: x.shift(1).rolling(window=30, min_periods=1).mean()
    )
    df['revenue_roll_mean_7'] = df.groupby('campaign')['revenue'].transform(
        lambda x: x.shift(1).rolling(window=7, min_periods=1).mean()
    )
    df['revenue_roll_mean_30'] = df.groupby('campaign')['revenue'].transform(
        lambda x: x.shift(1).rolling(window=30, min_periods=1).mean()
    )
    
    # Rolling clicks & conversions for robust conversion rate lookback
    df['clicks_roll_mean_30'] = df.groupby('campaign')['clicks'].transform(
        lambda x: x.shift(1).rolling(window=30, min_periods=1).mean()
    )
    df['conversions_roll_mean_30'] = df.groupby('campaign')['conversions'].transform(
        lambda x: x.shift(1).rolling(window=30, min_periods=1).mean()
    )
    
    # Fill rolling averages NaNs
    df['spend_roll_mean_7'] = df['spend_roll_mean_7'].fillna(df.groupby('campaign')['spend'].transform('mean'))
    df['spend_roll_mean_30'] = df['spend_roll_mean_30'].fillna(df.groupby('campaign')['spend'].transform('mean'))
    df['revenue_roll_mean_7'] = df['revenue_roll_mean_7'].fillna(df.groupby('campaign')['revenue'].transform('mean'))
    df['revenue_roll_mean_30'] = df['revenue_roll_mean_30'].fillna(df.groupby('campaign')['revenue'].transform('mean'))
    df['clicks_roll_mean_30'] = df['clicks_roll_mean_30'].fillna(df.groupby('campaign')['clicks'].transform('mean'))
    df['conversions_roll_mean_30'] = df['conversions_roll_mean_30'].fillna(df.groupby('campaign')['conversions'].transform('mean'))
    
    # 7. Performance Ratios
    # Conversion Rate (Conversions / Clicks) based on 30-day lookback for stability
    df['conversion_rate'] = df['conversions_roll_mean_30'] / (df['clicks_roll_mean_30'] + 1e-5)
    # ROAS based on 30-day average
    df['ROAS'] = df['revenue_roll_mean_30'] / (df['spend_roll_mean_30'] + 1e-5)
    
    # 8. Campaign Performance Trend (7d average relative to 30d average)
    df['campaign_performance_trend'] = df['revenue_roll_mean_7'] / (df['revenue_roll_mean_30'] + 1e-5)
    
    # 9. Channel Performance Trend
    # Compute rolling channel sums
    chan_rev_7 = df.groupby(['channel', 'date'])['revenue_roll_mean_7'].transform('sum')
    chan_rev_30 = df.groupby(['channel', 'date'])['revenue_roll_mean_30'].transform('sum')
    df['channel_performance_trend'] = chan_rev_7 / (chan_rev_30 + 1e-5)
    
    # 10. Channel Dummy Variables
    channels_encoded = pd.get_dummies(df['channel'], prefix='Chan')
    df = pd.concat([df, channels_encoded], axis=1)
    
    return df

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Generate advanced marketing features")
    parser.add_argument('--data_dir', type=str, default=DATA_DIR, help="Path to data directory")
    args = parser.parse_args()
    
    logger.info(f"Starting advanced feature generation step using directory: {args.data_dir}")
    os.makedirs(args.data_dir, exist_ok=True)
    
    hist_data_path = os.path.join(args.data_dir, 'historical_data.csv')
    
    # Ensure historical raw data exists
    if not os.path.exists(hist_data_path):
        logger.info(f"Historical data not found at {hist_data_path}. Generating synthetic logs...")
        df_raw = generate_synthetic_data(days=365)
        df_raw.to_csv(hist_data_path, index=False)
    else:
        df_raw = pd.read_csv(hist_data_path)
        
    # Standardize column casing to lowercase as requested
    df_raw = df_raw.rename(columns={
        'Date': 'date',
        'Channel': 'channel',
        'CampaignName': 'campaign',
        'Cost': 'spend',
        'Impressions': 'impressions',
        'Clicks': 'clicks',
        'Conversions': 'conversions',
        'Revenue': 'revenue'
    })
    df_raw['date'] = pd.to_datetime(df_raw['date'])
    
    # Daily aggregation at Campaign-level
    df_daily = df_raw.groupby(['date', 'channel', 'campaign']).agg({
        'spend': 'sum',
        'clicks': 'sum',
        'conversions': 'sum',
        'revenue': 'sum'
    }).reset_index()
    
    # Compute seasonality maps
    monthly_map, weekly_map = calculate_seasonality_multipliers(df_daily)
    
    # Build advanced features
    df_features = compute_row_features(df_daily, monthly_map, weekly_map)
    
    # Save features.csv
    features_path = os.path.join(args.data_dir, 'features.csv')
    df_features.to_csv(features_path, index=False)
    logger.info(f"Saved advanced features to {features_path}.")
    
    # Save seasonality and feature config
    meta_path = os.path.join(args.data_dir, 'seasonality_meta.pkl')
    with open(meta_path, 'wb') as f:
        pickle.dump({'monthly_map': monthly_map, 'weekly_map': weekly_map}, f)
    logger.info("Saved seasonality multiplier structures.")
    
    logger.info("Feature engineering completed successfully.")

if __name__ == '__main__':
    main()
