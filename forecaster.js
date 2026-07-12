/**
 * AdCast AI - Probabilistic Marketing Forecasting Engine
 * Performs saturation curve fitting, seasonality extraction, and Monte Carlo simulation.
 */
(function() {
  const Forecaster = {
    /**
     * Run a probabilistic forecast based on historical data and future parameters
     * @param {Array<Object>} historicalData - Parsed historical daily campaign records
     * @param {Object} options - Configuration parameters
     * @param {number} options.planningPeriod - 30, 60, or 90 days
     * @param {Object} options.budgets - { 'Google Ads': number, 'Meta Ads': number, 'Microsoft Ads': number }
     * @param {number} options.seasonalityWeight - 0.0 to 1.5 (intensity slider)
     * @param {number} options.simulationsCount - number of Monte Carlo runs (e.g. 1000)
     * @param {number} options.confidenceLevel - e.g. 80 or 90 (represented as range, e.g. 10th to 90th percentile)
     */
    run(historicalData, options) {
      const {
        planningPeriod = 30,
        budgets = { 'Google Ads': 15000, 'Meta Ads': 12000, 'Microsoft Ads': 2000 },
        seasonalityWeight = 1.0,
        simulationsCount = 1000,
        confidenceLevel = 80 // 80% CI means 10th to 90th percentile
      } = options;

      // 1. Analyze historical dataset totals
      const channelTotals = {};
      const campaignTypeTotals = {};
      const campaignTotals = {};
      let totalHistoricalSpend = 0;
      let totalHistoricalRevenue = 0;
      
      // Track daily revenues and spends to compute variance
      const dailyTotals = {};
      const channelDailyTotals = {};

      // Find date bounds of historical data
      let minDate = new Date();
      let maxDate = new Date(0);
      
      historicalData.forEach(row => {
        const d = new Date(row.Date);
        if (d < minDate) minDate = d;
        if (d > maxDate) maxDate = d;

        const dateStr = row.Date;
        if (!dailyTotals[dateStr]) {
          dailyTotals[dateStr] = { spend: 0, revenue: 0 };
        }
        dailyTotals[dateStr].spend += row.Cost;
        dailyTotals[dateStr].revenue += row.Revenue;

        // Initialize channel totals
        const chan = row.Channel;
        if (!channelTotals[chan]) {
          channelTotals[chan] = { spend: 0, revenue: 0, campaigns: new Set(), types: new Set() };
        }
        channelTotals[chan].spend += row.Cost;
        channelTotals[chan].revenue += row.Revenue;
        channelTotals[chan].campaigns.add(row.CampaignName);
        channelTotals[chan].types.add(row.CampaignType);

        if (!channelDailyTotals[chan]) {
          channelDailyTotals[chan] = {};
        }
        if (!channelDailyTotals[chan][dateStr]) {
          channelDailyTotals[chan][dateStr] = { spend: 0, revenue: 0 };
        }
        channelDailyTotals[chan][dateStr].spend += row.Cost;
        channelDailyTotals[chan][dateStr].revenue += row.Revenue;

        // Initialize campaign type totals
        const type = row.CampaignType;
        if (!campaignTypeTotals[type]) {
          campaignTypeTotals[type] = { spend: 0, revenue: 0, channel: chan };
        }
        campaignTypeTotals[type].spend += row.Cost;
        campaignTypeTotals[type].revenue += row.Revenue;

        // Initialize campaign-level totals
        const camp = row.CampaignName;
        if (!campaignTotals[camp]) {
          campaignTotals[camp] = { spend: 0, revenue: 0, type: type, channel: chan };
        }
        campaignTotals[camp].spend += row.Cost;
        campaignTotals[camp].revenue += row.Revenue;

        totalHistoricalSpend += row.Cost;
        totalHistoricalRevenue += row.Revenue;
      });

      const totalDays = Math.round((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1;
      
      // Calculate historical ROAS
      const blendedHistoricalRoas = totalHistoricalSpend > 0 ? totalHistoricalRevenue / totalHistoricalSpend : 0;

      // 2. Extract monthly seasonality multipliers
      const monthlyRevenue = Array(12).fill(0);
      const monthlyDays = Array(12).fill(0);
      
      Object.keys(dailyTotals).forEach(dateStr => {
        const d = new Date(dateStr);
        const m = d.getMonth(); // 0 to 11
        monthlyRevenue[m] += dailyTotals[dateStr].revenue;
        monthlyDays[m] += 1;
      });

      // Calculate monthly averages
      const monthlyAverages = [];
      let activeMonths = 0;
      let sumOfAverages = 0;
      
      for (let m = 0; m < 12; m++) {
        if (monthlyDays[m] > 0) {
          const avg = monthlyRevenue[m] / monthlyDays[m];
          monthlyAverages.push(avg);
          sumOfAverages += avg;
          activeMonths++;
        } else {
          monthlyAverages.push(null);
        }
      }
      
      const overallDailyAverage = activeMonths > 0 ? (sumOfAverages / activeMonths) : 1;
      
      // Seasonal index per month
      const seasonalIndices = monthlyAverages.map(avg => {
        if (avg === null) return 1.0;
        return avg / overallDailyAverage;
      });

      // 3. Determine the forecast window seasonality factor
      // We assume the forecast starts the day after the max historical date
      const forecastStartDate = new Date(maxDate);
      forecastStartDate.setDate(maxDate.getDate() + 1);
      
      let totalSeasonalMultiplier = 0;
      for (let day = 0; day < planningPeriod; day++) {
        const targetDate = new Date(forecastStartDate);
        targetDate.setDate(forecastStartDate.getDate() + day);
        const m = targetDate.getMonth();
        
        // Blend seasonal factor with baseline 1.0 according to user seasonalityWeight slider
        const seasonalFactor = seasonalIndices[m];
        const blendedFactor = 1.0 + (seasonalFactor - 1.0) * seasonalityWeight;
        totalSeasonalMultiplier += blendedFactor;
      }
      const periodSeasonalityFactor = totalSeasonalMultiplier / planningPeriod;

      // 4. Calculate historical daily standard deviation (volatility) for Monte Carlo noise
      // We calculate volatility (coefficient of variation = standard deviation / mean)
      const dailyRevenues = Object.values(dailyTotals).map(t => t.revenue);
      const meanRevenue = dailyRevenues.reduce((a, b) => a + b, 0) / dailyRevenues.length;
      const varianceRevenue = dailyRevenues.reduce((a, b) => a + Math.pow(b - meanRevenue, 2), 0) / dailyRevenues.length;
      const stdDevRevenue = Math.sqrt(varianceRevenue);
      const blendedVolatility = meanRevenue > 0 ? stdDevRevenue / meanRevenue : 0.15; // default 15% volatility

      // Calculate volatility per channel
      const channelVolatility = {};
      Object.keys(channelDailyTotals).forEach(chan => {
        const revs = Object.values(channelDailyTotals[chan]).map(t => t.revenue);
        const mean = revs.reduce((a, b) => a + b, 0) / revs.length;
        const variance = revs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / revs.length;
        const stdDev = Math.sqrt(variance);
        channelVolatility[chan] = mean > 0 ? stdDev / mean : 0.20;
      });

      // 5. Fit saturation curves and run Monte Carlo simulations
      // Define a Helper function for Box-Muller transform to get Gaussian normal random numbers
      function randomNormal(mean = 0, stdDev = 1) {
        let u = 0, v = 0;
        while(u === 0) u = Math.random(); 
        while(v === 0) v = Math.random();
        const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        return num * stdDev + mean;
      }

      // We will perform forecasts at: Blended, Channel, Campaign Type, and Campaign levels.
      const simulatedBlendedRevenues = [];
      const channelSimulations = {};
      const campaignTypeSimulations = {};
      const campaignSimulations = {};

      // Initialize simulation arrays
      Object.keys(budgets).forEach(chan => {
        channelSimulations[chan] = [];
      });
      Object.keys(campaignTypeTotals).forEach(type => {
        campaignTypeSimulations[type] = [];
      });
      Object.keys(campaignTotals).forEach(camp => {
        campaignSimulations[camp] = [];
      });

      // Distribute channel budgets to campaign types and campaigns proportionally based on historical spend ratios
      const campaignTypeBudgetShare = {};
      const campaignBudgetShare = {};

      Object.keys(campaignTypeTotals).forEach(type => {
        const chan = campaignTypeTotals[type].channel;
        const chanHistSpend = channelTotals[chan] ? channelTotals[chan].spend : 0;
        const typeHistSpend = campaignTypeTotals[type].spend;
        campaignTypeBudgetShare[type] = chanHistSpend > 0 ? typeHistSpend / chanHistSpend : 0;
      });

      Object.keys(campaignTotals).forEach(camp => {
        const chan = campaignTotals[camp].channel;
        const chanHistSpend = channelTotals[chan] ? channelTotals[chan].spend : 0;
        const campHistSpend = campaignTotals[camp].spend;
        campaignBudgetShare[camp] = chanHistSpend > 0 ? campHistSpend / chanHistSpend : 0;
      });

      // Diminishing returns curve curvature parameter (k)
      // Meta Ads saturates fast, Google Ads moderately, MS Ads is more linear
      const channelSaturationParams = {
        'Google Ads': 1.0,
        'Meta Ads': 1.6,
        'Microsoft Ads': 0.4
      };

      // Run Monte Carlo loops
      for (let sim = 0; sim < simulationsCount; sim++) {
        let simBlendedRevenue = 0;
        const simChannelRevs = {};

        // A. Forecast at Channel Level
        Object.keys(budgets).forEach(chan => {
          const budget = budgets[chan];
          const histSpend = channelTotals[chan] ? channelTotals[chan].spend : 0;
          const histRevenue = channelTotals[chan] ? channelTotals[chan].revenue : 0;
          
          // Scale historical baseline to match the forecast planning period
          const scaledHistSpend = (histSpend / totalDays) * planningPeriod;
          const scaledHistRevenue = (histRevenue / totalDays) * planningPeriod;

          let expectedRev = 0;
          if (budget > 0 && scaledHistSpend > 0) {
            // Apply Saturation Curve: R(B) = R_avg * ln(1 + k * B / C_avg) / ln(1 + k)
            const k = channelSaturationParams[chan] || 1.0;
            const saturationRatio = Math.log(1 + k * (budget / scaledHistSpend)) / Math.log(1 + k);
            expectedRev = scaledHistRevenue * saturationRatio;
          } else if (budget > 0 && scaledHistSpend === 0) {
            // If channel has no historical spend but budget is allocated, assume a default ROAS
            const defaultRoas = chan === 'Meta Ads' ? 2.5 : chan === 'Google Ads' ? 2.2 : 2.0;
            expectedRev = budget * defaultRoas;
          }

          // Apply Seasonality
          expectedRev = expectedRev * periodSeasonalityFactor;

          // Add uncertainty/volatility noise
          const volatility = channelVolatility[chan] || blendedVolatility;
          
          // Scaling standard deviation down for aggregate planning periods (longer periods are more stable than daily)
          // Aggregation reduces daily volatility by sqrt(N)
          const adjustedVolatility = volatility / Math.sqrt(planningPeriod / 10); 
          const simRev = Math.max(0, expectedRev * (1 + randomNormal(0, adjustedVolatility)));
          
          simChannelRevs[chan] = simRev;
          channelSimulations[chan].push(simRev);
          simBlendedRevenue += simRev;
        });

        simulatedBlendedRevenues.push(simBlendedRevenue);

        // B. Forecast at Campaign Type Level
        Object.keys(campaignTypeTotals).forEach(type => {
          const chan = campaignTypeTotals[type].channel;
          const typeBudget = budgets[chan] * campaignTypeBudgetShare[type];
          
          const histSpend = campaignTypeTotals[type].spend;
          const histRevenue = campaignTypeTotals[type].revenue;
          const scaledHistSpend = (histSpend / totalDays) * planningPeriod;
          const scaledHistRevenue = (histRevenue / totalDays) * planningPeriod;

          let expectedRev = 0;
          if (typeBudget > 0 && scaledHistSpend > 0) {
            // Saturation parameter based on campaign type (Prospecting & PMax saturate faster, Retargeting/Search slower)
            let typeK = 1.0;
            if (type.toLowerCase().includes('prospect') || type.toLowerCase().includes('pmax')) typeK = 1.4;
            if (type.toLowerCase().includes('retarget') || type.toLowerCase().includes('brand')) typeK = 0.6;
            
            const saturationRatio = Math.log(1 + typeK * (typeBudget / scaledHistSpend)) / Math.log(1 + typeK);
            expectedRev = scaledHistRevenue * saturationRatio;
          }
          
          expectedRev = expectedRev * periodSeasonalityFactor;
          const volatility = blendedVolatility * 1.2; // campaigns have higher volatility than channels
          const adjustedVolatility = volatility / Math.sqrt(planningPeriod / 10);
          const simRev = Math.max(0, expectedRev * (1 + randomNormal(0, adjustedVolatility)));
          
          campaignTypeSimulations[type].push(simRev);
        });

        // C. Forecast at Campaign Level
        Object.keys(campaignTotals).forEach(camp => {
          const chan = campaignTotals[camp].channel;
          const campBudget = budgets[chan] * campaignBudgetShare[camp];
          
          const histSpend = campaignTotals[camp].spend;
          const histRevenue = campaignTotals[camp].revenue;
          const scaledHistSpend = (histSpend / totalDays) * planningPeriod;
          const scaledHistRevenue = (histRevenue / totalDays) * planningPeriod;

          let expectedRev = 0;
          if (campBudget > 0 && scaledHistSpend > 0) {
            // Saturation param at campaign level
            const campK = 1.2;
            const saturationRatio = Math.log(1 + campK * (campBudget / scaledHistSpend)) / Math.log(1 + campK);
            expectedRev = scaledHistRevenue * saturationRatio;
          }

          expectedRev = expectedRev * periodSeasonalityFactor;
          const volatility = blendedVolatility * 1.5; // individual campaigns are even noisier
          const adjustedVolatility = volatility / Math.sqrt(planningPeriod / 10);
          const simRev = Math.max(0, expectedRev * (1 + randomNormal(0, adjustedVolatility)));
          
          campaignSimulations[camp].push(simRev);
        });
      }

      // 6. Aggregate results and extract confidence percentiles
      const totalFutureBudget = Object.values(budgets).reduce((a, b) => a + b, 0);

      // Helper function to calculate stats (10th, 50th, 90th percentile)
      function getPercentiles(simArray, budgetVal) {
        simArray.sort((a, b) => a - b);
        
        // Calculate indices based on confidence level
        // For 80% CI: 10th and 90th percentile
        // For 90% CI: 5th and 95th percentile
        const pLowIndex = Math.floor(simArray.length * (0.5 - (confidenceLevel / 200)));
        const pMedianIndex = Math.floor(simArray.length * 0.5);
        const pHighIndex = Math.floor(simArray.length * (0.5 + (confidenceLevel / 200))) - 1;

        const pLow = simArray[pLowIndex] || 0;
        const pMedian = simArray[pMedianIndex] || 0;
        const pHigh = simArray[pHighIndex] || 0;

        const roasLow = budgetVal > 0 ? pLow / budgetVal : 0;
        const roasMedian = budgetVal > 0 ? pMedian / budgetVal : 0;
        const roasHigh = budgetVal > 0 ? pHigh / budgetVal : 0;

        return {
          revenue: {
            pLow: Math.round(pLow * 100) / 100,
            pMedian: Math.round(pMedian * 100) / 100,
            pHigh: Math.round(pHigh * 100) / 100
          },
          roas: {
            pLow: Math.round(roasLow * 100) / 100,
            pMedian: Math.round(roasMedian * 100) / 100,
            pHigh: Math.round(roasHigh * 100) / 100
          }
        };
      }

      const blendedStats = getPercentiles(simulatedBlendedRevenues, totalFutureBudget);

      // Calculate channel level results
      const channelResults = {};
      Object.keys(budgets).forEach(chan => {
        channelResults[chan] = {
          budget: budgets[chan],
          ...getPercentiles(channelSimulations[chan], budgets[chan])
        };
      });

      // Calculate campaign type level results
      const campaignTypeResults = {};
      Object.keys(campaignTypeTotals).forEach(type => {
        const chan = campaignTypeTotals[type].channel;
        const typeBudget = budgets[chan] * campaignTypeBudgetShare[type];
        campaignTypeResults[type] = {
          budget: Math.round(typeBudget * 100) / 100,
          channel: chan,
          ...getPercentiles(campaignTypeSimulations[type], typeBudget)
        };
      });

      // Calculate campaign level results
      const campaignResults = {};
      Object.keys(campaignTotals).forEach(camp => {
        const chan = campaignTotals[camp].channel;
        const campBudget = budgets[chan] * campaignBudgetShare[camp];
        campaignResults[camp] = {
          budget: Math.round(campBudget * 100) / 100,
          channel: chan,
          type: campaignTotals[camp].type,
          ...getPercentiles(campaignSimulations[camp], campBudget)
        };
      });

      // Prepare daily forecasts for timeline drill-down
      const dailyForecasts = [];
      const fStartDate = new Date(maxDate);
      fStartDate.setDate(maxDate.getDate() + 1);
      
      for (let day = 0; day < planningPeriod; day++) {
        const targetDate = new Date(fStartDate);
        targetDate.setDate(fStartDate.getDate() + day);
        const dateStr = targetDate.toISOString().split('T')[0];
        
        Object.keys(campaignResults).forEach(camp => {
          const c = campaignResults[camp];
          const dailyCost = c.budget / planningPeriod;
          const dailyRevP50 = c.revenue.pMedian / planningPeriod;
          const dailyRevP10 = c.revenue.pLow / planningPeriod;
          const dailyRevP90 = c.revenue.pHigh / planningPeriod;
          
          dailyForecasts.push({
            date: dateStr,
            channel: c.channel,
            campaign: camp,
            cost: dailyCost,
            predicted_revenue_p10: dailyRevP10,
            predicted_revenue_p50: dailyRevP50,
            predicted_revenue_p90: dailyRevP90,
            predicted_roas_p10: dailyCost > 0 ? dailyRevP10 / dailyCost : 0,
            predicted_roas_p50: dailyCost > 0 ? dailyRevP50 / dailyCost : 0,
            predicted_roas_p90: dailyCost > 0 ? dailyRevP90 / dailyCost : 0
          });
        });
      }

      return {
        planningPeriod,
        totalFutureBudget,
        seasonalityFactor: periodSeasonalityFactor,
        blended: blendedStats,
        channels: channelResults,
        campaignTypes: campaignTypeResults,
        campaigns: campaignResults,
        dailyForecasts,
        metadata: {
          historicalDaysCount: totalDays,
          blendedHistoricalRoas,
          overallDailyAverageRevenue: overallDailyAverage
        }
      };
    }
  };

  window.Forecaster = Forecaster;
})();
