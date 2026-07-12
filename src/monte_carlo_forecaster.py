import os
import random
import pickle
import pandas as pd
import numpy as np
import xgboost as xgb

# Set random seeds for reproducibility
random.seed(42)
np.random.seed(42)
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from utils import logger, MODEL_PATH, DATA_DIR

def train_campaign_model(df):
    """
    Trains the XGBoost Regressor model on campaign-level advanced features
    and collects parameters for Monte Carlo simulation.
    """
    df['date'] = pd.to_datetime(df['date'])
    df = df.sort_values('date').reset_index(drop=True)
    
    # Chronological validation split (last 45 days)
    max_date = df['date'].max()
    split_date = max_date - pd.Timedelta(days=45)
    
    train_df = df[df['date'] <= split_date].copy()
    val_df = df[df['date'] > split_date].copy()
    
    if len(val_df) == 0:
        split_date = max_date - pd.Timedelta(days=30)
        train_df = df[df['date'] <= split_date].copy()
        val_df = df[df['date'] > split_date].copy()
        
    logger.info(f"Training campaign rows: {len(train_df)} | Validation rows: {len(val_df)}")
    
    # Advanced feature columns list
    feature_cols = [
        'spend', 'log_spend', 'month', 'weekday', 'day',
        'monthly_seasonality', 'weekly_seasonality',
        'spend_lag_1', 'spend_lag_7', 'revenue_lag_1', 'revenue_lag_7',
        'spend_growth_rate', 'revenue_growth_rate',
        'spend_roll_mean_7', 'spend_roll_mean_30',
        'revenue_roll_mean_7', 'revenue_roll_mean_30',
        'clicks_roll_mean_30', 'conversions_roll_mean_30',
        'conversion_rate', 'ROAS',
        'campaign_performance_trend', 'channel_performance_trend'
    ]
    chan_cols = [col for col in df.columns if col.startswith('Chan_')]
    feature_cols.extend(chan_cols)
    
    X_train = train_df[feature_cols]
    y_train = train_df['revenue']
    X_val = val_df[feature_cols]
    y_val = val_df['revenue']
    
    # Initialize XGBoost Regressor
    model = xgb.XGBRegressor(
        n_estimators=250,
        max_depth=6,
        learning_rate=0.03,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42
    )
    model.fit(X_train, y_train)
    
    # Evaluate performance
    val_preds = np.maximum(0.0, model.predict(X_val))
    val_mae = mean_absolute_error(y_val, val_preds)
    val_rmse = np.sqrt(mean_squared_error(y_val, val_preds))
    val_r2 = r2_score(y_val, val_preds)
    logger.info(f"Model validation score -> MAE: ${val_mae:.2f} | RMSE: ${val_rmse:.2f} | R²: {val_r2:.4f}")
    
    # Extract volatilities per campaign (from training split)
    volatilities = {}
    for campaign in df['campaign'].unique():
        camp_data = train_df[train_df['campaign'] == campaign]
        revs = camp_data[camp_data['revenue'] > 0.0]['revenue']
        
        if len(revs) >= 10:
            vol = revs.std() / (revs.mean() + 1e-5)
        else:
            chan_name = df[df['campaign'] == campaign]['channel'].iloc[0]
            chan_revs = train_df[(train_df['channel'] == chan_name) & (train_df['revenue'] > 0.0)]['revenue']
            vol = chan_revs.std() / (chan_revs.mean() + 1e-5) if len(chan_revs) >= 10 else 0.20
            
        volatilities[campaign] = float(np.clip(vol, 0.05, 1.0))
        
    # Calculate campaign budget shares
    channel_totals = train_df.groupby('channel')['spend'].sum()
    campaign_totals = train_df.groupby(['channel', 'campaign'])['spend'].sum()
    
    campaign_shares = {}
    for idx, share_val in campaign_totals.items():
        channel, campaign = idx
        chan_total = channel_totals.get(channel, 0.0)
        share = share_val / chan_total if chan_total > 0.0 else 0.0
        
        if channel not in campaign_shares:
            campaign_shares[channel] = {}
        campaign_shares[channel][campaign] = float(share)
        
    for channel, shares in campaign_shares.items():
        total_share = sum(shares.values())
        if total_share > 0.0:
            for camp in shares:
                shares[camp] /= total_share
        else:
            count = len(shares)
            for camp in shares:
                shares[camp] = 1.0 / count
                
    # Extract baseline historical run-rates from the last 30 days of training data
    last_30_days_df = df[df['date'] > (max_date - pd.Timedelta(days=30))]
    baseline_run_rate = {}
    for campaign in df['campaign'].unique():
        camp_data = last_30_days_df[last_30_days_df['campaign'] == campaign]
        if len(camp_data) == 0:
            camp_data = df[df['campaign'] == campaign]
            
        baseline_run_rate[campaign] = {
            'spend_mean': float(camp_data['spend'].mean()),
            'revenue_mean': float(camp_data['revenue'].mean()),
            'clicks_mean': float(camp_data['clicks'].mean() if 'clicks' in camp_data.columns else 10.0),
            'conversions_mean': float(camp_data['conversions'].mean() if 'conversions' in camp_data.columns else 1.0),
            'channel': str(df[df['campaign'] == campaign]['channel'].iloc[0])
        }
        
    # Save training history tails (last 30 rows per campaign) to carry forward lag features in prediction
    # This is essential for calculating lag features dynamically during prediction!
    history_tail = df.sort_values(['campaign', 'date']).groupby('campaign').tail(30).to_dict(orient='records')
    
    model_metadata = {
        'model': model,
        'feature_cols': feature_cols,
        'chan_cols': chan_cols,
        'volatilities': volatilities,
        'campaign_shares': campaign_shares,
        'baseline_run_rate': baseline_run_rate,
        'history_tail': history_tail
    }
    
    return model_metadata

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Train forecasting model on advanced features")
    parser.add_argument('--data_dir', type=str, default=DATA_DIR, help="Path to data directory")
    parser.add_argument('--model', type=str, default=MODEL_PATH, help="Path to save trained model pickle")
    args = parser.parse_args()
    
    logger.info(f"Starting model training on advanced features using directory: {args.data_dir}")
    
    features_path = os.path.join(args.data_dir, 'features.csv')
    meta_path = os.path.join(args.data_dir, 'seasonality_meta.pkl')
    if not os.path.exists(features_path):
        logger.error(f"Features file not found at {features_path}. Run generate_features.py first.")
        return
        
    df = pd.read_csv(features_path)
    model_package = train_campaign_model(df)
    
    # Load seasonality metadata and pack inside the model package
    if os.path.exists(meta_path):
        with open(meta_path, 'rb') as f:
            seasonality_data = pickle.load(f)
            model_package['monthly_map'] = seasonality_data.get('monthly_map', {})
            model_package['weekly_map'] = seasonality_data.get('weekly_map', {})
            logger.info("Integrated seasonality maps into model package.")
    else:
        model_package['monthly_map'] = {}
        model_package['weekly_map'] = {}
        logger.warning("Seasonality meta file not found. Packed empty seasonality maps.")
        
    # Ensure parent directory of model path exists
    model_dir = os.path.dirname(args.model)
    if model_dir:
        os.makedirs(model_dir, exist_ok=True)
        
    with open(args.model, 'wb') as f:
        pickle.dump(model_package, f)
        
    logger.info(f"Saved advanced trained model package to {args.model}.")
    logger.info("Training completed.")

if __name__ == '__main__':
    main()
