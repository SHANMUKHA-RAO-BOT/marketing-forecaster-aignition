/**
 * AdCast AI - CSV Parser, Data Validator, and Anomaly Detector
 * Handles file ingestion diagnostics and campaign structural validation client-side.
 */
(function() {
  const DataValidator = {
    // Required fields in the dataset
    requiredFields: ['Date', 'Channel', 'CampaignType', 'CampaignName', 'Cost', 'Impressions', 'Clicks', 'Conversions', 'Revenue'],

    /**
     * Parse CSV string into an array of objects
     * @param {string} csvText 
     * @returns {Array<Object>} parsed rows
     */
    parseCSV(csvText) {
      if (!csvText || !csvText.trim()) return [];
      
      const lines = csvText.split(/\r?\n/);
      if (lines.length < 2) return [];

      // Parse headers
      const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
      const parsedData = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Simple CSV splitter handling quoted values
        const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || line.split(',');
        const row = {};
        
        headers.forEach((header, index) => {
          let val = matches[index] !== undefined ? matches[index].trim() : '';
          // Strip quotes
          val = val.replace(/^["']|["']$/g, '');
          row[header] = val;
        });

        // Convert numeric columns
        if (row.Cost !== undefined) row.Cost = parseFloat(row.Cost) || 0;
        if (row.Impressions !== undefined) row.Impressions = parseInt(row.Impressions, 10) || 0;
        if (row.Clicks !== undefined) row.Clicks = parseInt(row.Clicks, 10) || 0;
        if (row.Conversions !== undefined) row.Conversions = parseInt(row.Conversions, 10) || 0;
        if (row.Revenue !== undefined) row.Revenue = parseFloat(row.Revenue) || 0;

        parsedData.push(row);
      }

      return parsedData;
    },

    /**
     * Validates dataset integrity and tags structural warnings/anomalies
     * @param {Array<Object>} parsedData 
     * @returns {Object} diagnostic report
     */
    validate(parsedData) {
      const report = {
        isValid: true,
        errors: [],
        warnings: [],
        anomalies: [],
        stats: {
          totalRows: parsedData.length,
          totalSpend: 0,
          totalRevenue: 0,
          channels: new Set(),
          campaignTypes: new Set(),
          campaigns: new Set(),
          dateRange: { min: null, max: null }
        }
      };

      if (!parsedData || parsedData.length === 0) {
        report.isValid = false;
        report.errors.push("No data found or CSV could not be parsed.");
        return report;
      }

      // Check headers on first row
      const firstRowKeys = Object.keys(parsedData[0]);
      const missingFields = this.requiredFields.filter(f => !firstRowKeys.includes(f));
      
      if (missingFields.length > 0) {
        report.isValid = false;
        report.errors.push(`Missing required columns: ${missingFields.join(', ')}`);
        return report;
      }

      // Track dates to find min/max
      let minDate = null;
      let maxDate = null;

      parsedData.forEach((row, idx) => {
        const lineNum = idx + 2; // 1-based, +1 for header
        
        // Date validation
        const dateVal = row.Date;
        if (!dateVal) {
          report.errors.push(`Row ${lineNum}: Missing Date`);
          report.isValid = false;
        } else {
          const d = new Date(dateVal);
          if (isNaN(d.getTime())) {
            report.errors.push(`Row ${lineNum}: Invalid Date format "${dateVal}"`);
            report.isValid = false;
          } else {
            const time = d.getTime();
            if (!minDate || time < minDate.getTime()) minDate = d;
            if (!maxDate || time > maxDate.getTime()) maxDate = d;
          }
        }

        // Channel tracking & validation
        if (!row.Channel) {
          report.errors.push(`Row ${lineNum}: Missing Channel`);
          report.isValid = false;
        } else {
          report.stats.channels.add(row.Channel);
        }

        // Campaign structure tracking
        if (!row.CampaignName) {
          report.warnings.push(`Row ${lineNum}: CampaignName is empty`);
        } else {
          report.stats.campaigns.add(row.CampaignName);
        }

        if (!row.CampaignType) {
          report.warnings.push(`Row ${lineNum}: Campaign "${row.CampaignName}" has empty CampaignType`);
        } else {
          report.stats.campaignTypes.add(row.CampaignType);
        }

        // Value checking & anomalies detection
        if (row.Cost < 0) {
          report.errors.push(`Row ${lineNum}: Cost cannot be negative (${row.Cost})`);
          report.isValid = false;
        }
        if (row.Revenue < 0) {
          report.errors.push(`Row ${lineNum}: Revenue cannot be negative (${row.Revenue})`);
          report.isValid = false;
        }

        // Accumulate statistics
        report.stats.totalSpend += row.Cost;
        report.stats.totalRevenue += row.Revenue;

        // Anomaly Detection
        // 1. Pixel/tracking anomaly: zero conversions/revenue but high ad spend
        if (row.Cost > 300 && row.Conversions === 0 && row.Revenue === 0) {
          report.anomalies.push({
            date: row.Date,
            channel: row.Channel,
            campaign: row.CampaignName,
            type: 'Tracking/Pixel Breakdown',
            description: `Campaign "${row.CampaignName}" spent $${row.Cost.toFixed(2)} on ${row.Date} but reported 0 conversions and $0 revenue. Potential tracking pixel outage.`,
            severity: 'High'
          });
        }

        // 2. High CPC / Efficiency collapse: Cost is high, but revenue is extremely low (ROAS < 0.1x)
        if (row.Cost > 200 && row.Revenue > 0 && (row.Revenue / row.Cost) < 0.15) {
          const roas = row.Revenue / row.Cost;
          report.anomalies.push({
            date: row.Date,
            channel: row.Channel,
            campaign: row.CampaignName,
            type: 'ROAS Collapse / Bid Glitch',
            description: `Campaign "${row.CampaignName}" spent $${row.Cost.toFixed(2)} on ${row.Date} but returned only $${row.Revenue.toFixed(2)} revenue (${roas.toFixed(2)}x ROAS). Potential bid engine anomaly.`,
            severity: 'Medium'
          });
        }

        // 3. CTR anomaly: click-through rate over 40% (could indicate click fraud or double tracking)
        if (row.Impressions > 50 && row.Clicks > 0) {
          const ctr = row.Clicks / row.Impressions;
          if (ctr > 0.45) {
            report.anomalies.push({
              date: row.Date,
              channel: row.Channel,
              campaign: row.CampaignName,
              type: 'Abnormal CTR (Potential Click Fraud)',
              description: `Campaign "${row.CampaignName}" reported ${row.Clicks} clicks out of ${row.Impressions} impressions (${(ctr * 100).toFixed(1)}% CTR) on ${row.Date}.`,
              severity: 'Low'
            });
          }
        }

        // 4. Missing impressions with click spending
        if (row.Cost > 50 && row.Impressions === 0 && row.Clicks > 0) {
          report.anomalies.push({
            date: row.Date,
            channel: row.Channel,
            campaign: row.CampaignName,
            type: 'Incomplete Delivery Metrics',
            description: `Campaign "${row.CampaignName}" recorded ${row.Clicks} clicks and spent $${row.Cost} on ${row.Date} but reported 0 impressions. Check platform sync.`,
            severity: 'Low'
          });
        }
      });

      // Format date range
      if (minDate && maxDate) {
        report.stats.dateRange = {
          min: minDate.toISOString().split('T')[0],
          max: maxDate.toISOString().split('T')[0],
          days: Math.round((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1
        };
      }

      // Check naming consistency warnings
      const channelNames = Array.from(report.stats.channels);
      const variations = ['google', 'meta', 'facebook', 'microsoft', 'bing'];
      variations.forEach(v => {
        const matches = channelNames.filter(c => c.toLowerCase().includes(v));
        if (matches.length > 1) {
          report.warnings.push(`Channel naming inconsistency: found duplicate variations for "${v}" (${matches.join(', ')}). Please consolidate naming.`);
        }
      });

      // Check if dataset represents enough history (should ideally be at least 60-90 days for seasonal trends)
      if (report.stats.dateRange.days && report.stats.dateRange.days < 60) {
        report.warnings.push(`Dataset covers only ${report.stats.dateRange.days} days. Seasonality adjustments and forecasting accuracy may be limited. Recommend at least 90+ days of history.`);
      }

      return report;
    }
  };

  window.DataValidator = DataValidator;
})();
