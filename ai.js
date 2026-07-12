/**
 * AdCast AI - AI-Assisted Causal Inference Layer
 * Handles direct Gemini API requests and implements the fallback growth analyst report engine.
 */
(function() {
  const AICausalLayer = {
    /**
     * Generates a growth marketing insight report using Gemini API or rule-based fallback
     * @param {Object} data - Context object containing historical stats, budgets, forecast, and anomalies
     * @param {string} apiKey - Gemini API Key (optional)
     * @returns {Promise<string>} Markdown-formatted report
     */
    async generateInsights(data, apiKey) {
      // Re-map campaign-level predicted outcomes to match backend InsightsRequest schema
      const payload = {
        forecast_summary: Object.keys(data.forecast.campaigns).map(camp => {
          const c = data.forecast.campaigns[camp];
          return {
            campaign: camp,
            channel: c.channel,
            cost: c.budget,
            predicted_revenue_p10: c.revenue.pLow,
            predicted_revenue_p50: c.revenue.pMedian,
            predicted_revenue_p90: c.revenue.pHigh
          };
        })
      };

      try {
        const response = await fetch('/api/ai_insights', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`Server returned status ${response.status}`);
        }

        const resJson = await response.json();
        return resJson.markdown;
      } catch (error) {
        console.error("FastAPI AI insights failed, falling back to local analyst:", error);
        
        // Fallback to client-side direct Gemini call if API key exists, otherwise local heuristic
        if (apiKey && apiKey.trim()) {
          try {
            return await this.callGemini(data, apiKey.trim());
          } catch (gemError) {
            return this.generateFallbackReport(data, `*(Note: Server-side API and client-side Gemini requests failed. Loaded client-side heuristic instead.)*\n\n`);
          }
        }
        return this.generateFallbackReport(data, `*(Note: Server-side API request failed. Loaded client-side heuristic instead.)*\n\n`);
      }
    },

    /**
     * Calls Gemini API via standard fetch request
     */
    async callGemini(data, apiKey) {
      const prompt = this.buildPrompt(data);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2048
          }
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        const errMsg = errJson.error?.message || response.statusText;
        throw new Error(errMsg);
      }

      const resJson = await response.json();
      if (resJson.candidates && resJson.candidates[0] && resJson.candidates[0].content && resJson.candidates[0].content.parts[0]) {
        return resJson.candidates[0].content.parts[0].text;
      } else {
        throw new Error("Invalid response format received from Gemini API.");
      }
    },

    /**
     * Builds structured prompt for Gemini
     */
    buildPrompt(data) {
      const { historical, forecast, validation } = data;
      
      // Format anomalies list
      const anomalyText = validation.anomalies.length > 0 
        ? validation.anomalies.map(a => `- [${a.type}] on ${a.date} in ${a.campaign}: ${a.description} (Severity: ${a.severity})`).join('\n')
        : 'None detected.';

      // Format channel allocations
      const channelLines = Object.keys(forecast.channels).map(c => {
        const f = forecast.channels[c];
        const histChan = historical.channels[c] || { spend: 0, revenue: 0 };
        const histDailySpend = (histChan.spend / historical.days) * forecast.planningPeriod;
        const histDailyRoas = histChan.spend > 0 ? (histChan.revenue / histChan.spend) : 0;
        
        return `- **${c}**: Proposed budget of ₹${f.budget.toLocaleString()} (Historical baseline for equivalent period: ₹${Math.round(histDailySpend).toLocaleString()}). 
  * Expected Revenue: ₹${f.revenue.pMedian.toLocaleString()} (Range: ₹${f.revenue.pLow.toLocaleString()} to ₹${f.revenue.pHigh.toLocaleString()})
  * Expected ROAS: ${f.roas.pMedian.toFixed(2)}x (Range: ${f.roas.pLow.toFixed(2)}x to ${f.roas.pHigh.toFixed(2)}x, Hist ROAS: ${histDailyRoas.toFixed(2)}x)`;
      }).join('\n');

      return `You are a Senior Growth Marketing Analyst & Causal Inference Expert. 
Analyze the following e-commerce marketing forecast performance data and output a comprehensive growth audit and advisory report in Markdown.

### HISTORICAL BASELINE INFO
- Days of Historical Data analyzed: ${historical.days} days
- Historical Blended Spend: ₹${Math.round(historical.totalSpend).toLocaleString()}
- Historical Blended Revenue: ₹${Math.round(historical.totalRevenue).toLocaleString()}
- Historical Blended ROAS: ${(historical.totalRevenue / historical.totalSpend).toFixed(2)}x

### FORECAST TARGET CONFIGURATION
- Forecast Window: ${forecast.planningPeriod} days
- Future Blended Budget: ₹${forecast.totalFutureBudget.toLocaleString()}
- Calculated Seasonal Multiplier: ${forecast.seasonalityFactor.toFixed(2)}x (Values >1.0 indicate positive peak seasonality, <1.0 indicate off-season dip)
- Sensitivity / Confidence Band: 10th percentile (Pessimistic) to 90th percentile (Optimistic)

### DETECTED HISTORICAL DATA ANOMALIES
${anomalyText}

### PROPOSED BUDGETS & PROJECTED OUTCOMES
- **Expected Blended Revenue**: ₹${forecast.blended.revenue.pMedian.toLocaleString()}
  * Pessimistic (10th Percentile): ₹${forecast.blended.revenue.pLow.toLocaleString()}
  * Optimistic (90th Percentile): ₹${forecast.blended.revenue.pHigh.toLocaleString()}
- **Expected Blended ROAS**: ${forecast.blended.roas.pMedian.toFixed(2)}x
  * Pessimistic (10th Percentile): ${forecast.blended.roas.pLow.toFixed(2)}x
  * Optimistic (90th Percentile): ${forecast.blended.roas.pHigh.toFixed(2)}x

Channel breakdown details:
${channelLines}

### YOUR OBJECTIVE
Write a structured report containing:
1. **Executive Summary**: A concise growth analyst view of the forecast. Is this budget plan efficient? Will it meet expectations?
2. **Causal Performance Analysis**: Explain *why* the blended ROAS and Revenue are changing. Specifically:
   - Quantify the effect of **Seasonality** (using the calculated factor of ${forecast.seasonalityFactor.toFixed(2)}x).
   - Explain the impact of **Diminishing Returns (Saturation Curves)**. Identify which channels are being pushed past their efficiency peaks and which have room to scale.
3. **Historical Anomalies Interpretation**: Analyze the detected anomalies. How did they affect historical baselines? What does that mean for forecast trust? (e.g. did a pixel breakdown make Meta Ads look worse than it is? Did a Google bidding glitch inflate CPA?)
4. **Strategic Budget Recommendations**: Provide action-oriented budget adjustments. Recommend exactly how to reallocate the ₹${forecast.totalFutureBudget.toLocaleString()} to optimize blended ROAS. Explain the math-backed reasoning.
5. **Operational Risk Assessment**: Detail key operational risks (e.g., ad fatigue, inventory strain in peak season, competitor bid wars) and mitigation plans.

Keep your response extremely professional, data-driven, strategic, and direct. Avoid generic marketing platitudes; cite specific numbers and calculations from the prompt. Format the report using clear markdown headers, bold values, and list items.`;
    },

    /**
     * Local heuristic rule-based growth analyst report generator
     */
    generateFallbackReport(data, prefix = '') {
      const { historical, forecast, validation } = data;
      
      const overallHistRoas = historical.totalSpend > 0 ? (historical.totalRevenue / historical.totalSpend) : 0;
      const proposedRoas = forecast.blended.roas.pMedian;
      const roasDiff = proposedRoas - overallHistRoas;
      
      let summaryHeadline = '';
      let summaryDesc = '';
      
      if (roasDiff > 0.15) {
        summaryHeadline = " Efficiency Expansion Forecasted";
        summaryDesc = `The proposed budget of **₹${forecast.totalFutureBudget.toLocaleString()}** is expected to yield an improved blended ROAS of **${proposedRoas.toFixed(2)}x** (up from ${overallHistRoas.toFixed(2)}x historical). This is primarily driven by positive seasonal trends and efficient distribution of spend.`;
      } else if (roasDiff < -0.15) {
        summaryHeadline = " Diminishing Returns Warning";
        summaryDesc = `The proposed budget of **₹${forecast.totalFutureBudget.toLocaleString()}** is projected to cause a blended ROAS contraction to **${proposedRoas.toFixed(2)}x** (down from ${overallHistRoas.toFixed(2)}x historical). Higher budget saturation on core paid channels is outpacing conversions.`;
      } else {
        summaryHeadline = " Stable Performance Projections";
        summaryDesc = `The proposed budget of **₹${forecast.totalFutureBudget.toLocaleString()}** will maintain a stable blended ROAS of **${proposedRoas.toFixed(2)}x** (compared to ${overallHistRoas.toFixed(2)}x historical). Conversion trajectories are aligned with historical baselines.`;
      }

      // Generate Causal Analysis
      const seasonalAnalysis = forecast.seasonalityFactor > 1.05
        ? `The calculation identifies a **positive seasonality tailwind (+${Math.round((forecast.seasonalityFactor - 1) * 100)}%)** during the forecast period. Demand is expected to rise, boosting overall ROAS and lowering effective CPAs across all channels.`
        : forecast.seasonalityFactor < 0.95
        ? `The calculation identifies an **off-season demand headwind (-${Math.round((1 - forecast.seasonalityFactor) * 100)}%)**. During this slump, conversion rates typically soften, requiring defensive bidding to protect ROAS.`
        : `Seasonality remains neutral (**${forecast.seasonalityFactor.toFixed(2)}x** factor). Performance will be primarily governed by budget sizing and individual channel efficiency curves rather than macro calendar trends.`;

      // Analyse Saturation per Channel
      const saturationNotes = [];
      Object.keys(forecast.channels).forEach(c => {
        const f = forecast.channels[c];
        const histChan = historical.channels[c] || { spend: 0, revenue: 0 };
        const histScaleSpend = (histChan.spend / historical.days) * forecast.planningPeriod;
        const histRoas = histChan.spend > 0 ? (histChan.revenue / histChan.spend) : 0;
        
        if (f.budget > histScaleSpend * 1.3 && f.budget > 0) {
          saturationNotes.push(`- **${c} budget increased by ${Math.round((f.budget/histScaleSpend - 1)*100)}%**: This scale is triggers **diminishing marginal returns**. Projected ROAS drops to **${f.roas.pMedian.toFixed(2)}x** compared to the historical baseline of **${histRoas.toFixed(2)}x**. The marginal cost of acquisition is rising.`);
        } else if (f.budget < histScaleSpend * 0.7 && f.budget > 0) {
          saturationNotes.push(`- **${c} budget restricted by ${Math.round((1 - f.budget/histScaleSpend)*100)}%**: Scaling down spend improves efficiency. Projected ROAS rises to **${f.roas.pMedian.toFixed(2)}x** (historical baseline: **${histRoas.toFixed(2)}x**). However, total channel revenue contribution drops, forfeiting market share.`);
        } else if (f.budget > 0) {
          saturationNotes.push(`- **${c} budget is stable** within +-30% of historical run-rates. Performance remains close to the historical benchmark (**${f.roas.pMedian.toFixed(2)}x** expected ROAS vs **${histRoas.toFixed(2)}x** historical).`);
        }
      });

      // Anomaly Analysis
      let anomalyAnalysisText = "";
      if (validation.anomalies.length > 0) {
        const pixelOutages = validation.anomalies.filter(a => a.type.toLowerCase().includes('pixel') || a.type.toLowerCase().includes('tracking'));
        const bidGlitches = validation.anomalies.filter(a => a.type.toLowerCase().includes('glitch') || a.type.toLowerCase().includes('roas'));
        
        anomalyAnalysisText += `We detected **${validation.anomalies.length} anomaly events** in the historical source data. Here is the operational impact on forecasts:\n`;
        
        if (pixelOutages.length > 0) {
          anomalyAnalysisText += `- **Tracking Outages**: The ${pixelOutages[0].channel} tracking outage on ${pixelOutages[0].date} caused conversions and revenue to register as zero while spend continued. This artificially deflates the historical baseline metrics. Our modeling filters out these severe tracking outages to avoid penalizing the forecast, but agencies should ensure tag health going forward.\n`;
        }
        if (bidGlitches.length > 0) {
          anomalyAnalysisText += `- **Bid Glitches / Cost Spikes**: An abnormal CPA spike occurred on ${bidGlitches[0].date} for campaign \`${bidGlitches[0].campaign}\`. This indicates short-term delivery malfunctions (e.g. automated bidding learning phase error). While it represents wasted spend historically, our probabilistic modeling treats it as a high-variance outlier to prevent skewed forward estimates.\n`;
        }
      } else {
        anomalyAnalysisText = "No major tracking or bidding anomalies were detected in the historical period. The data provides a highly clean baseline for forward predictions.";
      }

      // Budget Recommendations
      let budgetRecs = "";
      const channelEntries = Object.keys(forecast.channels).map(c => ({ name: c, ...forecast.channels[c] }));
      const highestRoasChan = channelEntries.sort((a,b) => b.roas.pMedian - a.roas.pMedian)[0];
      const lowestRoasChan = channelEntries.sort((a,b) => a.roas.pMedian - b.roas.pMedian)[0];
      
      if (highestRoasChan.name !== lowestRoasChan.name && lowestRoasChan.budget > (forecast.totalFutureBudget * 0.15)) {
        const reallocateAmt = Math.round(lowestRoasChan.budget * 0.20);
        budgetRecs = `Based on saturation curves and channel efficiencies, we recommend a **budget re-allocation of ₹${reallocateAmt.toLocaleString()}**:\n` +
          `1. **Reduce ${lowestRoasChan.name} spend** by **₹${reallocateAmt.toLocaleString()}**. The channel is showing saturation, and marginal returns are flattening out.\n` +
          `2. **Shift this ₹${reallocateAmt.toLocaleString()} to ${highestRoasChan.name}**, which displays superior conversion efficiency and has headroom before hitting severe diminishing returns.\n` +
          `*Expected Impact: Shifting this budget is projected to increase blended revenue by approx. **₹${Math.round(reallocateAmt * (highestRoasChan.roas.pMedian - lowestRoasChan.roas.pMedian)).toLocaleString()}**, adding **+0.1x to +0.25x** to your Blended ROAS.*`;
      } else {
        budgetRecs = `The current budget allocation is well-balanced across channels. We recommend maintaining the current splits. \n` +
          `- **Google Ads** should serve as the volume anchor (steady Search/Shopping).\n` +
          `- **Meta Ads** should capture high-intent creative conversions (Prospecting/Retargeting).\n` +
          `- **Microsoft Ads** should lock in stable, high-intent desktop queries at low CPAs.`;
      }

      return `${prefix}#  Growth Analyst Advisory Report
*AI-Assisted Causal Forecast Review*

## Executive Summary: ${summaryHeadline}
${summaryDesc}

---

##  Causal Performance Analysis
### 1. Seasonal Impact (Factor: **${forecast.seasonalityFactor.toFixed(2)}x**)
${seasonalAnalysis}

### 2. Diminishing Returns & Budget Saturation
Paid media channels behave non-linearly. Our saturation modeling outputs the following dynamics for this proposal:
${saturationNotes.join('\n')}

---

##  Historical Anomalies & Ingest Diagnostics
${anomalyAnalysisText}

---

##  Strategic Budget Recommendations
${budgetRecs}

---

##  Operational Risk Assessment & Mitigation
1. **Creative Fatigue (Meta Ads)**: If scaling Meta Ads budget, CTR and ROAS will decay quickly unless creative assets are refreshed weekly. Build a visual asset pipeline.
2. **Search Term Cannibalization (Google Ads)**: Monitor Google Search Brand vs. Generic splits. Avoid bidding aggressively on brand keywords that organic search already ranks #1 for.
3. **Inventory & Shipping Bottlenecks (Q4 Seasonality)**: If forecasting for a peak period (Seasonality Factor > 1.2), ensure warehousing and inventory levels can support the expected order volume spike to prevent customer complaints.
`;
    }
  };

  window.AICausalLayer = AICausalLayer;
})();
