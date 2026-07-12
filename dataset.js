/**
 * AdCast AI - Synthetic E-commerce Marketing Dataset Generator
 * Generates realistic daily campaign-level marketing data for Google, Meta, and Microsoft Ads.
 */
(function() {
  const DatasetGenerator = {
    // Campaign definitions with channels, types, and baseline parameters
    campaignDefinitions: [
      { channel: 'Google Ads', type: 'Search', name: 'GG_Search_Brand', baseCost: 150, baseRoas: 4.2 },
      { channel: 'Google Ads', type: 'Search', name: 'GG_Search_Generic', baseCost: 400, baseRoas: 2.1 },
      { channel: 'Google Ads', type: 'PMax', name: 'GG_PMax_Performance', baseCost: 800, baseRoas: 3.5 },
      { channel: 'Google Ads', type: 'Shopping', name: 'GG_Shopping_Top_Products', baseCost: 500, baseRoas: 3.8 },
      { channel: 'Meta Ads', type: 'Prospecting', name: 'FB_Prospecting_Broad', baseCost: 600, baseRoas: 2.8 },
      { channel: 'Meta Ads', type: 'Prospecting', name: 'FB_Prospecting_Lookalikes', baseCost: 400, baseRoas: 3.2 },
      { channel: 'Meta Ads', type: 'Retargeting', name: 'FB_Retargeting_Catalog', baseCost: 200, baseRoas: 5.5 },
      { channel: 'Microsoft Ads', type: 'Search', name: 'MS_Search_Brand', baseCost: 50, baseRoas: 4.8 },
      { channel: 'Microsoft Ads', type: 'Shopping', name: 'MS_Shopping_Feed', baseCost: 100, baseRoas: 2.5 }
    ],

    /**
     * Generates a synthetic dataset for the past N days.
     * @param {number} days - Number of historical days (default 365)
     * @returns {Array<Object>} Daily campaign records
     */
    generateData(days = 365) {
      const data = [];
      const now = new Date();
      
      for (let i = days; i >= 1; i--) {
        const date = new Date(now);
        date.setDate(now.getDate() - i);
        const dateString = date.toISOString().split('T')[0];
        
        const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ...
        const month = date.getMonth(); // 0 = Jan, 11 = Dec
        
        // 1. Seasonality Factors
        // Weekly: Monday/Tuesday are highest, Saturday is lowest
        const weeklyFactor = 1.0 + [0.05, 0.15, 0.10, 0.05, 0.0, -0.10, -0.25][dayOfWeek];
        
        // Monthly: Q4 peak, Summer dip, Spring stable
        // Jan: 0.9, Feb: 0.95, Mar: 1.0, Apr: 1.05, May: 1.0, Jun: 0.85, Jul: 0.80, Aug: 0.85, Sep: 0.95, Oct: 1.05, Nov: 1.40, Dec: 1.60
        const monthlyFactor = [0.90, 0.95, 1.00, 1.05, 1.00, 0.85, 0.80, 0.85, 0.95, 1.05, 1.40, 1.60][month];
        
        // Special Holiday spikes (Black Friday, Cyber Monday in November)
        // Let's check if the date falls around Thanksgiving week (Nov 20-30)
        let holidayFactor = 1.0;
        const dayOfMonth = date.getDate();
        if (month === 10) { // November
          if (dayOfMonth >= 23 && dayOfMonth <= 29) {
            // Black Friday / Thanksgiving peak
            holidayFactor = 3.0 + Math.random() * 0.5;
          }
        } else if (month === 11) { // December
          if (dayOfMonth >= 10 && dayOfMonth <= 20) {
            // Last shipping dates peak
            holidayFactor = 1.8 + Math.random() * 0.3;
          } else if (dayOfMonth >= 24 && dayOfMonth <= 26) {
            // Christmas dip (low traffic/conversion)
            holidayFactor = 0.5;
          }
        }

        const combinedMultiplier = weeklyFactor * monthlyFactor * holidayFactor;

        this.campaignDefinitions.forEach(camp => {
          // Add random daily noise (+-15%)
          const noise = 0.85 + Math.random() * 0.30;
          
          // Cost increases in peak seasons, but slightly less than conversions/revenue (representing high seasonal demand efficiency)
          const seasonalCostFactor = 1.0 + (combinedMultiplier - 1.0) * 0.6;
          let cost = camp.baseCost * seasonalCostFactor * noise;
          
          // Impressions and Clicks are correlated with Cost
          const cpc = (camp.channel === 'Google Ads') ? 1.2 : (camp.channel === 'Meta Ads') ? 0.8 : 0.6;
          const ctr = (camp.type === 'Search') ? 0.04 : (camp.type === 'PMax') ? 0.02 : 0.015;
          
          let clicks = Math.round(cost / cpc);
          let impressions = Math.round(clicks / ctr);
          
          // Conversions and Revenue modeling with saturation (diminishing returns)
          // ROAS decays slightly as cost rises
          const saturationFactor = Math.log(1 + (cost / camp.baseCost)) / 0.693; // 1.0 when cost = baseCost
          let expectedRoas = camp.baseRoas * (1 - (saturationFactor - 1) * 0.12);
          
          // Apply combined seasonality to ROAS (in peak periods, ROAS actually increases)
          expectedRoas = expectedRoas * (1.0 + (combinedMultiplier - 1.0) * 0.4);
          
          let revenue = cost * expectedRoas * noise;
          
          // Conversions derived from revenue / AOV (Average Order Value of $80)
          const aov = 80;
          let conversions = Math.round(revenue / aov);
          
          // Ensure zero spend yields zero results
          if (cost < 1) {
            cost = 0;
            clicks = 0;
            impressions = 0;
            conversions = 0;
            revenue = 0;
          }

          // 2. Anomaly Injection
          // Anomaly A: Meta tracking pixel failure (Meta Ads has cost, but 0 conversions/revenue)
          // Occurs for 3 days: 90 to 88 days ago
          const daysAgo = i;
          if (camp.channel === 'Meta Ads' && daysAgo >= 88 && daysAgo <= 90) {
            conversions = 0;
            revenue = 0;
          }
          
          // Anomaly B: Billing error for Microsoft Ads (cost = 0, impressions = 0, revenue = 0)
          // Occurs for 5 days: 180 to 176 days ago
          if (camp.channel === 'Microsoft Ads' && daysAgo >= 176 && daysAgo <= 180) {
            cost = 0;
            impressions = 0;
            clicks = 0;
            conversions = 0;
            revenue = 0;
          }

          // Anomaly C: Bid engine glitch for Google Search Generic (Cost spikes 3x, ROAS collapses to 0.4x)
          // Occurs for 2 days: 45 and 44 days ago
          if (camp.name === 'GG_Search_Generic' && (daysAgo === 44 || daysAgo === 45)) {
            cost = camp.baseCost * 3.5;
            clicks = Math.round(cost / cpc);
            impressions = Math.round(clicks / ctr);
            revenue = cost * 0.4 * (0.9 + Math.random() * 0.2);
            conversions = Math.round(revenue / aov);
          }

          // Ensure integer values
          conversions = Math.max(0, conversions);
          revenue = Math.round(revenue * 100) / 100;
          cost = Math.round(cost * 100) / 100;
          
          data.push({
            Date: dateString,
            Channel: camp.channel,
            CampaignType: camp.type,
            CampaignName: camp.name,
            Cost: cost,
            Impressions: impressions,
            Clicks: clicks,
            Conversions: conversions,
            Revenue: revenue
          });
        });
      }
      return data;
    },

    /**
     * Formats array of records as CSV string
     * @param {Array<Object>} data 
     * @returns {string} CSV format data
     */
    convertToCSV(data) {
      if (!data || !data.length) return '';
      const headers = Object.keys(data[0]);
      const csvRows = [headers.join(',')];
      
      for (const row of data) {
        const values = headers.map(header => {
          const val = row[header];
          // Escape strings with commas
          if (typeof val === 'string' && val.includes(',')) {
            return `"${val}"`;
          }
          return val;
        });
        csvRows.push(values.join(','));
      }
      return csvRows.join('\n');
    }
  };

  // Export to window object for web app use
  window.DatasetGenerator = DatasetGenerator;
})();
