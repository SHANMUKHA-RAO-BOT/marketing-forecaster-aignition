/**
 * RevenuePilot - Main Application Controller
 * Coordinates state, event handling, chart rendering, and API integrations.
 */
document.addEventListener('DOMContentLoaded', () => {
  
  // 1. Application State
  const state = {
    historicalData: null,
    forecastResults: null,
    diagnostics: null,
    activeTab: 'overviewTab',
    activeBreakdownLevel: 'channel',
    chartView: 'aggregate', // Default to aggregate planning view
    chartInstances: {},
    planningPeriod: 30, // Selected planning horizon (30, 60, or 90 days)
    // Campaigns table/cards controls
    tablePage: 1,
    tableLimit: 6, // Smaller limit for premium cards layout
    tableSearch: '',
    tableSortColumn: 'budget', // Sort by budget desc by default
    tableSortOrder: 'desc'
  };

  // 2. DOM Elements
  const els = {
    csvFileInput: document.getElementById('csvFileInput'),
    fileNameLabel: document.getElementById('fileNameLabel'),
    loadDemoBtn: document.getElementById('loadDemoBtn'),
    emptyLoadDemoBtn: document.getElementById('emptyLoadDemoBtn'),
    planningPeriodSelect: document.getElementById('planningPeriodSelect'),
    googleBudgetVal: document.getElementById('googleBudgetVal'),
    metaBudgetVal: document.getElementById('metaBudgetVal'),
    msBudgetVal: document.getElementById('msBudgetVal'),
    seasonalitySlider: document.getElementById('seasonalitySlider'),
    seasonalityTextVal: document.getElementById('seasonalityTextVal'),
    confidenceSelect: document.getElementById('confidenceSelect'),
    geminiApiKeyVal: document.getElementById('geminiApiKeyVal'),
    runForecastBtn: document.getElementById('runForecastBtn'),
    
    // View containers
    emptyStateContainer: document.getElementById('emptyStateContainer'),
    dashboardViews: document.getElementById('dashboardViews'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingText: document.getElementById('loadingText'),
    datasetStatus: document.getElementById('datasetStatus'),
    
    // Overview Metrics
    statTotalSpend: document.getElementById('statTotalSpend'),
    statExpectedRevenue: document.getElementById('statExpectedRevenue'),
    statRevenueRange: document.getElementById('statRevenueRange'),
    statExpectedRoas: document.getElementById('statExpectedRoas'),
    statRoasRange: document.getElementById('statRoasRange'),
    statSeasonality: document.getElementById('statSeasonality'),
    
    // Tables & Content elements
    overviewTableBody: document.getElementById('overviewTableBody'),
    breakdownTableBody: document.getElementById('breakdownTableBody'),
    aiReportContent: document.getElementById('aiReportContent'),
    aiKeyWarning: document.getElementById('aiKeyWarning'),
    diagnosticIntegritySummary: document.getElementById('diagnosticIntegritySummary'),
    anomaliesListContainer: document.getElementById('anomaliesListContainer'),
    
    // Level Toggles
    toggleLevelChannel: document.getElementById('toggleLevelChannel'),
    toggleLevelType: document.getElementById('toggleLevelType'),
    toggleLevelCampaign: document.getElementById('toggleLevelCampaign')
  };

  // Reusable Toast System
  function showToast(title, message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `glass-panel pointer-events-auto border rounded-xl p-4 shadow-2xl flex items-start gap-3 transition-all duration-300 transform translate-x-12 opacity-0 border-white/10`;
    
    let icon = 'info';
    let iconClass = 'text-brand-blue';
    if (type === 'success') { icon = 'check-circle'; iconClass = 'text-green-500'; }
    if (type === 'error') { icon = 'alert-octagon'; iconClass = 'text-red-500'; }
    if (type === 'warning') { icon = 'alert-triangle'; iconClass = 'text-amber-500'; }
    
    toast.innerHTML = `
      <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 flex-shrink-0 ${iconClass}">
        <i data-lucide="${icon}" class="w-4 h-4"></i>
      </div>
      <div class="flex flex-col gap-0.5 flex-1 pr-4">
        <span class="text-xs font-bold text-slate-200">${title}</span>
        <span class="text-[10px] text-slate-400 leading-normal">${message}</span>
      </div>
      <button class="text-slate-500 hover:text-slate-300 text-xs self-start" onclick="this.parentElement.remove()">
        &times;
      </button>
    `;
    
    container.appendChild(toast);
    if (window.lucide) {
      lucide.createIcons();
    }
    
    setTimeout(() => {
      toast.classList.remove('translate-x-12', 'opacity-0');
    }, 50);
    
    setTimeout(() => {
      toast.classList.add('translate-x-12', 'opacity-0');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Reusable Promise-based Confirm Modal
  function showConfirm(title, message) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirmModal');
      const titleEl = document.getElementById('confirmTitle');
      const messageEl = document.getElementById('confirmMessage');
      const cancelBtn = document.getElementById('confirmCancelBtn');
      const okBtn = document.getElementById('confirmOkBtn');
      
      if (!modal || !okBtn || !cancelBtn) {
        resolve(window.confirm(message));
        return;
      }
      
      titleEl.textContent = title;
      messageEl.textContent = message;
      
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      
      const cleanUp = (result) => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        resolve(result);
      };
      
      const onOk = () => cleanUp(true);
      const onCancel = () => cleanUp(false);
      
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
    });
  }

  // Notifications logic
  function addNotification(title, message, type = 'info') {
    const notifications = JSON.parse(localStorage.getItem('rp_notifications') || '[]');
    notifications.unshift({
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      title,
      message,
      type,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      read: false
    });
    localStorage.setItem('rp_notifications', JSON.stringify(notifications));
    updateNotificationsUI();
    showToast(title, message, type);
  }

  function updateNotificationsUI() {
    const container = document.getElementById('notificationsContainer');
    const badge = document.getElementById('notificationBadge');
    if (!container) return;
    
    const notifications = JSON.parse(localStorage.getItem('rp_notifications') || '[]');
    const unread = notifications.filter(n => !n.read);
    
    if (badge) {
      if (unread.length > 0) {
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
    
    if (notifications.length === 0) {
      container.innerHTML = `<div class="text-center text-slate-500 py-6 text-xs" id="notificationsEmptyState">No new notifications</div>`;
      return;
    }
    
    container.innerHTML = notifications.map(n => {
      let icon = 'info';
      let iconClass = 'text-brand-blue';
      if (n.type === 'success') { icon = 'check-circle'; iconClass = 'text-green-500'; }
      if (n.type === 'error') { icon = 'alert-octagon'; iconClass = 'text-red-500'; }
      if (n.type === 'warning') { icon = 'alert-triangle'; iconClass = 'text-amber-500'; }
      
      return `
        <div class="flex items-start gap-3 p-2.5 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 transition-all ${n.read ? 'opacity-70' : ''}" data-id="${n.id}">
          <div class="w-6 h-6 rounded flex items-center justify-center bg-white/5 flex-shrink-0 ${iconClass}">
            <i data-lucide="${icon}" class="w-3.5 h-3.5"></i>
          </div>
          <div class="flex flex-col gap-0.5 flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-bold text-slate-200 truncate">${n.title}</span>
              <span class="text-[9px] text-slate-500 flex-shrink-0">${n.time}</span>
            </div>
            <p class="text-[10px] text-slate-400 leading-normal break-words">${n.message}</p>
          </div>
        </div>
      `;
    }).join('');
    
    if (window.lucide) {
      lucide.createIcons();
    }
    
    // Mark as read when clicked
    document.querySelectorAll('#notificationsContainer > div').forEach(el => {
      el.addEventListener('click', (e) => {
        const id = el.getAttribute('data-id');
        const list = JSON.parse(localStorage.getItem('rp_notifications') || '[]');
        const updated = list.map(n => n.id === id ? { ...n, read: true } : n);
        localStorage.setItem('rp_notifications', JSON.stringify(updated));
        updateNotificationsUI();
      });
    });
  }

  // Currency formatting
  function formatCurrency(amount) {
    const symbol = getCurrencySymbol();
    return symbol + Math.round(amount).toLocaleString();
  }

  function getCurrencySymbol() {
    const currency = localStorage.getItem('rp_currency') || 'INR';
    if (currency === 'INR') return '₹';
    if (currency === 'USD') return '$';
    if (currency === 'EUR') return '€';
    if (currency === 'GBP') return '£';
    return '₹';
  }

  // Set up forecast cache
  state.forecastCache = {};

  // 3. Initialize App Settings & Load Saved States
  const savedApiKey = localStorage.getItem('gemini_api_key');
  if (savedApiKey && els.geminiApiKeyVal) {
    els.geminiApiKeyVal.value = savedApiKey;
  }

  // Global Search Index builder
  function buildSearchIndex() {
    state.searchIndex = [];
    
    // 1. Add tabs/pages
    state.searchIndex.push({ name: "Dashboard Overview", type: "page", tab: "overviewTab", desc: "Overview cards, breakdown and aggregate charts" });
    state.searchIndex.push({ name: "Forecast Drill-down", type: "page", tab: "forecastTab", desc: "Daily timeline and channel predictions plot" });
    state.searchIndex.push({ name: "Monte Carlo Simulations", type: "page", tab: "scenarioTab", desc: "Scenario planning, slider settings, and Monte Carlo curves" });
    state.searchIndex.push({ name: "Reports & Insights", type: "page", tab: "reportsTab", desc: "AI advisory causal reports and downloads" });
    state.searchIndex.push({ name: "Data Sources & Diagnostics", type: "page", tab: "diagnosticsTab", desc: "Ingestion logs, file health, and anomalies" });
    
    // 2. Add campaigns from historical data
    if (state.historicalData) {
      const uniqueCamps = [...new Set(state.historicalData.map(r => r.CampaignName))];
      uniqueCamps.forEach(camp => {
        state.searchIndex.push({ name: camp, type: "campaign", tab: "forecastTab", desc: `Campaign in historical dataset` });
      });
    }
    
    // 3. Add channels
    state.searchIndex.push({ name: "Google Ads Channel", type: "channel", tab: "overviewTab", desc: "Google Ads campaign statistics and forecasts" });
    state.searchIndex.push({ name: "Meta Ads Channel", type: "channel", tab: "overviewTab", desc: "Meta Ads campaign statistics and forecasts" });
    state.searchIndex.push({ name: "Microsoft Ads Channel", type: "channel", tab: "overviewTab", desc: "Microsoft Ads campaign statistics and forecasts" });
    
    // 4. Add reports contents if available
    if (state.forecastResults && els.aiReportContent) {
      state.searchIndex.push({ name: "AI Consultation Insights", type: "report", tab: "reportsTab", desc: "AI Growth Analyst advisory causal report text" });
    }
    
    // 5. Add recent uploads
    const savedUploads = JSON.parse(localStorage.getItem('rp_uploads') || '[]');
    savedUploads.forEach(up => {
      state.searchIndex.push({ name: up.filename, type: "upload", tab: "diagnosticsTab", desc: `Uploaded file size ${up.size} - health ${up.health}%` });
    });
  }

  // Load and apply settings
  const applySettingsOnLoad = () => {
    // Theme
    const savedTheme = localStorage.getItem('theme-preference') || 'dark';
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    if (savedTheme === 'dark') {
      document.body.classList.remove('light-mode');
      document.body.classList.add('dark-mode');
      if (themeToggleBtn) themeToggleBtn.innerHTML = '<i data-lucide="moon"></i>';
    } else {
      document.body.classList.add('light-mode');
      document.body.classList.remove('dark-mode');
      if (themeToggleBtn) themeToggleBtn.innerHTML = '<i data-lucide="sun"></i>';
    }

    // Default Horizon
    const savedHorizon = localStorage.getItem('rp_default_horizon');
    if (savedHorizon && els.planningPeriodSelect) {
      els.planningPeriodSelect.value = savedHorizon;
      state.planningPeriod = parseInt(savedHorizon, 10);
    }

    // Confidence Interval
    const savedConfidence = localStorage.getItem('rp_confidence');
    if (savedConfidence && els.confidenceSelect) {
      els.confidenceSelect.value = savedConfidence;
    }

    // Settings Modal Form sync
    const settingsTheme = document.getElementById('settingsTheme');
    const settingsAnimations = document.getElementById('settingsAnimations');
    const settingsDefaultHorizon = document.getElementById('settingsDefaultHorizon');
    const settingsConfidence = document.getElementById('settingsConfidence');
    const settingsCurrency = document.getElementById('settingsCurrency');
    const settingsLanguage = document.getElementById('settingsLanguage');
    const settingsExportFormat = document.getElementById('settingsExportFormat');
    const settingsApiKey = document.getElementById('settingsApiKey');

    if (settingsTheme) settingsTheme.value = savedTheme;
    if (settingsAnimations) settingsAnimations.checked = localStorage.getItem('rp_animations') !== 'false';
    if (settingsDefaultHorizon) settingsDefaultHorizon.value = savedHorizon || '30';
    if (settingsConfidence) settingsConfidence.value = savedConfidence || '80';
    if (settingsCurrency) settingsCurrency.value = localStorage.getItem('rp_currency') || 'INR';
    if (settingsLanguage) settingsLanguage.value = localStorage.getItem('rp_language') || 'EN';
    if (settingsExportFormat) settingsExportFormat.value = localStorage.getItem('rp_export_format') || 'CSV';
    if (settingsApiKey) settingsApiKey.value = savedApiKey || '';

    updateNotificationsUI();
    if (typeof buildSearchIndex === "function") {
      buildSearchIndex();
    }
  };

  applySettingsOnLoad();

  // Lucide icons initialization
  if (window.lucide) {
    lucide.createIcons();
  }
  updateHealthScore(null); // Initial state

  // 4. Event Listeners
  // Tab Switching
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetTab = e.currentTarget.getAttribute('data-tab');
      switchTab(targetTab);
      const sidebarContainer = document.getElementById('sidebarContainer');
      if (sidebarContainer) {
        sidebarContainer.classList.remove('sidebar-active');
      }
    });
  });

  // Slider feedback
  if (els.seasonalitySlider) {
    els.seasonalitySlider.addEventListener('input', (e) => {
      els.seasonalityTextVal.textContent = parseFloat(e.target.value).toFixed(1) + 'x';
    });
  }

  // Load Demo Data
  if (els.loadDemoBtn) els.loadDemoBtn.addEventListener('click', loadDemoDataset);
  if (els.emptyLoadDemoBtn) els.emptyLoadDemoBtn.addEventListener('click', loadDemoDataset);

  // File Ingestion
  if (els.csvFileInput) {
    els.csvFileInput.addEventListener('change', handleFileUpload);
  }

  // Header Actions
  const headerRefreshBtn = document.getElementById('headerRefreshBtn');
  if (headerRefreshBtn) {
    headerRefreshBtn.addEventListener('click', () => {
      if (state.historicalData) {
        executeForecastFlow();
      } else {
        showToast("No Dataset", "Please load a dataset first.", "warning");
      }
    });
  }

  // Theme Toggle listener
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
      document.body.classList.toggle('light-mode');
      const isDark = document.body.classList.contains('dark-mode');
      localStorage.setItem('theme-preference', isDark ? 'dark' : 'light');
      themeToggleBtn.innerHTML = isDark ? '<i data-lucide="moon"></i>' : '<i data-lucide="sun"></i>';
      
      // Update Settings theme selector too
      const settingsTheme = document.getElementById('settingsTheme');
      if (settingsTheme) settingsTheme.value = isDark ? 'dark' : 'light';

      if (window.lucide) {
        lucide.createIcons();
      }
      
      // Re-render active charts to apply dynamic theme grid/text colors instantly
      if (state.forecastResults) {
        renderForecastChart();
        renderForecastDailyChart();
        renderContributionChart();
        renderRoasChart();
      }
      showToast("Theme Updated", `Switched to ${isDark ? 'Dark' : 'Light'} appearance mode.`, "info");
    });
  }

  // Settings Modal controls
  const settingsModal = document.getElementById('settingsModal');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const resetSettingsBtn = document.getElementById('resetSettingsBtn');

  if (openSettingsBtn && settingsModal) {
    openSettingsBtn.addEventListener('click', () => {
      // Refresh form values from localStorage in case they changed
      applySettingsOnLoad();
      settingsModal.classList.remove('hidden');
      settingsModal.classList.add('flex');
    });
  }

  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => {
      settingsModal.classList.add('hidden');
      settingsModal.classList.remove('flex');
    });
  }

  if (saveSettingsBtn && settingsModal) {
    saveSettingsBtn.addEventListener('click', () => {
      const themeVal = document.getElementById('settingsTheme').value;
      const animationsVal = document.getElementById('settingsAnimations').checked;
      const horizonVal = document.getElementById('settingsDefaultHorizon').value;
      const confidenceVal = document.getElementById('settingsConfidence').value;
      const currencyVal = document.getElementById('settingsCurrency').value;
      const languageVal = document.getElementById('settingsLanguage').value;
      const exportVal = document.getElementById('settingsExportFormat').value;
      const apiKeyVal = document.getElementById('settingsApiKey').value;

      localStorage.setItem('theme-preference', themeVal);
      localStorage.setItem('rp_animations', animationsVal ? 'true' : 'false');
      localStorage.setItem('rp_default_horizon', horizonVal);
      localStorage.setItem('rp_confidence', confidenceVal);
      localStorage.setItem('rp_currency', currencyVal);
      localStorage.setItem('rp_language', languageVal);
      localStorage.setItem('rp_export_format', exportVal);
      
      if (apiKeyVal) {
        localStorage.setItem('gemini_api_key', apiKeyVal);
        if (els.geminiApiKeyVal) els.geminiApiKeyVal.value = apiKeyVal;
      } else {
        localStorage.removeItem('gemini_api_key');
        if (els.geminiApiKeyVal) els.geminiApiKeyVal.value = '';
      }

      // Hide modal
      settingsModal.classList.add('hidden');
      settingsModal.classList.remove('flex');

      // Apply theme & options instantly
      applySettingsOnLoad();
      if (els.planningPeriodSelect) {
        els.planningPeriodSelect.value = horizonVal;
        els.planningPeriodSelect.dispatchEvent(new Event('change'));
      }
      if (els.confidenceSelect) {
        els.confidenceSelect.value = confidenceVal;
      }

      if (state.forecastResults) {
        updateOverviewStats();
        populateOverviewTable();
        populateBreakdownTable();
        renderForecastChart();
        renderForecastDailyChart();
        renderContributionChart();
        renderRoasChart();
      }

      showToast("Settings Saved", "Preferences updated and applied successfully.", "success");
      addNotification("Settings Updated", "System configuration details saved.", "success");
    });
  }

  if (resetSettingsBtn) {
    resetSettingsBtn.addEventListener('click', async () => {
      const confirmed = await showConfirm("Reset System Settings", "Are you sure you want to clear all configurations and preferences? This will reload the page.");
      if (confirmed) {
        localStorage.removeItem('theme-preference');
        localStorage.removeItem('rp_animations');
        localStorage.removeItem('rp_default_horizon');
        localStorage.removeItem('rp_confidence');
        localStorage.removeItem('rp_currency');
        localStorage.removeItem('rp_language');
        localStorage.removeItem('rp_export_format');
        localStorage.removeItem('gemini_api_key');
        localStorage.removeItem('rp_notifications');
        location.reload();
      }
    });
  }

  // Notifications toggle controls
  const notificationBellBtn = document.getElementById('notificationBellBtn');
  const notificationsPanel = document.getElementById('notificationsPanel');
  const clearNotificationsBtn = document.getElementById('clearNotificationsBtn');

  if (notificationBellBtn && notificationsPanel) {
    notificationBellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notificationsPanel.classList.toggle('hidden');
      notificationsPanel.classList.toggle('flex');
      
      // Mark all read when opening panel
      if (notificationsPanel.classList.contains('flex')) {
        const list = JSON.parse(localStorage.getItem('rp_notifications') || '[]');
        const updated = list.map(n => ({ ...n, read: true }));
        localStorage.setItem('rp_notifications', JSON.stringify(updated));
        updateNotificationsUI();
      }
    });
  }

  if (clearNotificationsBtn) {
    clearNotificationsBtn.addEventListener('click', () => {
      localStorage.removeItem('rp_notifications');
      updateNotificationsUI();
      showToast("Cleared Notifications", "All inbox alerts cleared.", "info");
    });
  }

  // Global document click listener to close floating panels
  document.addEventListener('click', (e) => {
    if (notificationsPanel && !notificationsPanel.classList.contains('hidden')) {
      if (!notificationsPanel.contains(e.target) && e.target !== notificationBellBtn && !notificationBellBtn.contains(e.target)) {
        notificationsPanel.classList.add('hidden');
        notificationsPanel.classList.remove('flex');
      }
    }
    const searchResults = document.getElementById('globalSearchResults');
    if (searchResults && !searchResults.classList.contains('hidden')) {
      const searchInput = document.getElementById('visibleSearchInput');
      if (!searchResults.contains(e.target) && e.target !== searchInput) {
        searchResults.classList.add('hidden');
        searchResults.classList.remove('flex');
      }
    }
  });

  // Drag and Drop Upload Zone listeners
  const dropZone = document.getElementById('dropZone');
  if (dropZone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('border-brand-blue', 'bg-white/5');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('border-brand-blue', 'bg-white/5');
      }, false);
    });

    dropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const file = dt.files[0];
      if (file && file.name.endsWith('.csv')) {
        handleDroppedFile(file);
      } else {
        showToast("Invalid File Type", "Please drag and drop a valid CSV file.", "error");
      }
    });
  }

  const retryUploadBtn = document.getElementById('retryUploadBtn');
  if (retryUploadBtn) {
    retryUploadBtn.addEventListener('click', () => {
      resetUploadZone();
    });
  }

  function resetUploadZone() {
    const defaultState = document.getElementById('dropZoneDefault');
    const progressState = document.getElementById('dropZoneProgress');
    const successState = document.getElementById('dropZoneSuccess');
    const errorState = document.getElementById('dropZoneError');

    if (defaultState) defaultState.classList.remove('hidden');
    if (progressState) progressState.classList.add('hidden');
    if (successState) successState.classList.add('hidden');
    if (errorState) errorState.classList.add('hidden');
  }

  function handleDroppedFile(file) {
    const defaultState = document.getElementById('dropZoneDefault');
    const progressState = document.getElementById('dropZoneProgress');
    const successState = document.getElementById('dropZoneSuccess');
    const errorState = document.getElementById('dropZoneError');
    const progressText = document.getElementById('uploadProgressText');
    const progressBar = document.getElementById('uploadProgressBar');

    if (defaultState) defaultState.classList.add('hidden');
    if (progressState) progressState.classList.remove('hidden');
    if (progressText) progressText.textContent = "Parsing File...";
    if (progressBar) progressBar.style.width = '30%';

    const reader = new FileReader();
    reader.onload = async function(event) {
      try {
        if (progressBar) progressBar.style.width = '60%';
        const text = event.target.result;
        const records = DataValidator.parseCSV(text);
        
        if (progressBar) progressBar.style.width = '85%';
        await uploadFileToServer(file, records, 'Drag Dataset Loaded');
        
        if (progressBar) progressBar.style.width = '100%';
        if (progressState) progressState.classList.add('hidden');
        if (successState) {
          successState.classList.remove('hidden');
          document.getElementById('successDetails').textContent = `Loaded ${records.length} records successfully.`;
        }
        showToast("Ingestion Complete", "File validation passed successfully.", "success");
        addNotification("CSV Uploaded", `File ${file.name} validated & ingested successfully.`, "success");
        
        setTimeout(() => {
          resetUploadZone();
        }, 2000);

      } catch (err) {
        if (progressState) progressState.classList.add('hidden');
        if (errorState) {
          errorState.classList.remove('hidden');
          document.getElementById('errorDetails').textContent = err.message.substring(0, 100);
        }
        showToast("Ingestion Failed", err.message, "error");
        addNotification("Upload Ingestion Failed", err.message, "error");
      }
    };
    reader.readAsText(file);
  }

  // Global Search Box Listener
  const visibleSearchInput = document.getElementById('visibleSearchInput');
  const globalSearchResults = document.getElementById('globalSearchResults');

  if (visibleSearchInput && globalSearchResults) {
    let searchDebounceTimeout;
    visibleSearchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounceTimeout);
      const query = e.target.value.trim().toLowerCase();
      
      if (!query) {
        globalSearchResults.classList.add('hidden');
        globalSearchResults.classList.remove('flex');
        return;
      }

      searchDebounceTimeout = setTimeout(() => {
        const matches = state.searchIndex.filter(item => {
          return item.name.toLowerCase().includes(query) || item.desc.toLowerCase().includes(query);
        });

        if (matches.length === 0) {
          globalSearchResults.innerHTML = `<div class="text-[11px] text-slate-500 text-center py-4">No matching results found</div>`;
        } else {
          globalSearchResults.innerHTML = matches.slice(0, 8).map(m => {
            let icon = 'search';
            if (m.type === 'page') icon = 'layout';
            if (m.type === 'campaign') icon = 'megaphone';
            if (m.type === 'channel') icon = 'target';
            if (m.type === 'upload') icon = 'file-text';
            if (m.type === 'report') icon = 'sparkles';
            
            return `
              <div class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 cursor-pointer transition-all border border-transparent hover:border-white/5" data-tab="${m.tab}" data-name="${m.name}" data-type="${m.type}">
                <div class="w-6 h-6 rounded flex items-center justify-center bg-white/5 text-slate-400">
                  <i data-lucide="${icon}" class="w-3.5 h-3.5"></i>
                </div>
                <div class="flex flex-col gap-0.5 min-w-0">
                  <span class="text-xs font-bold text-slate-200 truncate">${m.name}</span>
                  <span class="text-[9px] text-slate-500 truncate">${m.desc}</span>
                </div>
              </div>
            `;
          }).join('');

          if (window.lucide) {
            lucide.createIcons();
          }

          document.querySelectorAll('#globalSearchResults > div').forEach(el => {
            el.addEventListener('click', () => {
              const tab = el.getAttribute('data-tab');
              const name = el.getAttribute('data-name');
              const type = el.getAttribute('data-type');
              
              switchTab(tab);
              globalSearchResults.classList.add('hidden');
              globalSearchResults.classList.remove('flex');
              visibleSearchInput.value = '';

              if (type === 'campaign') {
                const searchField = document.getElementById('tableSearchInput');
                if (searchField) {
                  searchField.value = name;
                  searchField.dispatchEvent(new Event('input'));
                }
              }
              showToast("Search Navigated", `Opened ${name} in ${tab.replace('Tab', '')}.`, "info");
            });
          });
        }
        globalSearchResults.classList.remove('hidden');
        globalSearchResults.classList.add('flex');
      }, 250);
    });
  }

  // Mobile Sidebar Event Listeners
  const mobileToggleBtn = document.getElementById('sidebarToggleBtn');
  const sidebarContainer = document.getElementById('sidebarContainer');
  if (mobileToggleBtn && sidebarContainer) {
    mobileToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebarContainer.classList.toggle('sidebar-active');
    });
  }

  // Dismiss mobile sidebar when clicking outside
  document.addEventListener('click', (e) => {
    if (sidebarContainer && sidebarContainer.classList.contains('sidebar-active')) {
      if (!sidebarContainer.contains(e.target) && e.target !== mobileToggleBtn) {
        sidebarContainer.classList.remove('sidebar-active');
      }
    }
  });

  // Run Forecast Button
  if (els.runForecastBtn) {
    els.runForecastBtn.addEventListener('click', executeForecastFlow);
  }

  // Horizon/Planning Period Select changes
  if (els.planningPeriodSelect) {
    els.planningPeriodSelect.addEventListener('change', (e) => {
      const newPeriod = parseInt(e.target.value, 10);
      const oldPeriod = state.planningPeriod || 30;
      if (newPeriod === oldPeriod) return;

      // Scale budget inputs proportionally so the daily spend rate is conserved
      const scale = newPeriod / oldPeriod;
      
      const googleVal = parseFloat(els.googleBudgetVal.value) || 0;
      const metaVal = parseFloat(els.metaBudgetVal.value) || 0;
      const msVal = parseFloat(els.msBudgetVal.value) || 0;
      
      els.googleBudgetVal.value = Math.round(googleVal * scale);
      els.metaBudgetVal.value = Math.round(metaVal * scale);
      els.msBudgetVal.value = Math.round(msVal * scale);
      
      state.planningPeriod = newPeriod;
      
      // Sync toggle buttons visually
      const horizonBtns = document.querySelectorAll('#planningPeriodToggle .horizon-btn');
      horizonBtns.forEach(b => {
        if (parseInt(b.getAttribute('data-value'), 10) === newPeriod) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });
      
      // Automatically trigger forecast flow if data is already loaded
      if (state.historicalData) {
        executeForecastFlow();
      }
    });
  }

  // Horizon/Planning Period Segment Toggle
  const horizonBtns = document.querySelectorAll('#planningPeriodToggle .horizon-btn');
  horizonBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const val = e.currentTarget.getAttribute('data-value');
      
      // Update toggle visual state
      horizonBtns.forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      
      // Update hidden select and trigger change
      if (els.planningPeriodSelect) {
        els.planningPeriodSelect.value = val;
        els.planningPeriodSelect.dispatchEvent(new Event('change'));
      }
    });
  });

  // Campaigns Cards Sorting Selector listener
  const campaignSortSelect = document.getElementById('campaignSortSelect');
  if (campaignSortSelect) {
    campaignSortSelect.addEventListener('change', (e) => {
      const parts = e.target.value.split('-');
      state.tableSortColumn = parts[0];
      state.tableSortOrder = parts[1];
      state.tablePage = 1;
      populateBreakdownTable();
    });
  }

  // Breakdown Table Level Toggles
  if (els.toggleLevelChannel) {
    els.toggleLevelChannel.addEventListener('click', () => { setBreakdownLevel('channel'); state.tablePage = 1; });
  }
  if (els.toggleLevelType) {
    els.toggleLevelType.addEventListener('click', () => { setBreakdownLevel('type'); state.tablePage = 1; });
  }
  if (els.toggleLevelCampaign) {
    els.toggleLevelCampaign.addEventListener('click', () => { setBreakdownLevel('campaign'); state.tablePage = 1; });
  }

  // Search input events (Top Bar & Table-specific search inputs)
  const tableSearchInput = document.getElementById('tableSearchInput');
  if (tableSearchInput) {
    tableSearchInput.addEventListener('input', (e) => {
      state.tableSearch = e.target.value;
      state.tablePage = 1;
      populateBreakdownTable();
    });
  }

  const globalSearchInput = document.getElementById('globalSearchInput');
  if (globalSearchInput) {
    globalSearchInput.addEventListener('input', (e) => {
      state.tableSearch = e.target.value;
      state.tablePage = 1;
      if (tableSearchInput) tableSearchInput.value = e.target.value;
      populateBreakdownTable();
    });
  }

  // Pagination Controls click listeners
  const btnPrevPage = document.getElementById('btnPrevPage');
  const btnNextPage = document.getElementById('btnNextPage');
  if (btnPrevPage) {
    btnPrevPage.addEventListener('click', () => {
      if (state.tablePage > 1) {
        state.tablePage--;
        populateBreakdownTable();
      }
    });
  }
  if (btnNextPage) {
    btnNextPage.addEventListener('click', () => {
      const total = getFilteredRowsTotalCount();
      if (state.tablePage * state.tableLimit < total) {
        state.tablePage++;
        populateBreakdownTable();
      }
    });
  }

  // Reports CSV Export
  const exportReportCsvBtn = document.getElementById('exportReportCsvBtn');
  if (exportReportCsvBtn) {
    exportReportCsvBtn.addEventListener('click', () => {
      if (!state.forecastResults) {
        alert("Please run a forecast first.");
        return;
      }
      const rows = getFilteredCampaignTableRows();
      const csvText = convertToCSV(rows);
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `forecast_report_${state.planningPeriod}_days.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }

  // Model Retrain trigger
  const triggerTrainBtn = document.getElementById('triggerTrainBtn');
  if (triggerTrainBtn) {
    triggerTrainBtn.addEventListener('click', async () => {
      const confirmed = await showConfirm("Retrain Model", "Are you sure you want to trigger manual model retraining on the server? This will overwrite the baseline model.pkl file.");
      if (!confirmed) {
        return;
      }
      
      showLoading("Retraining XGBoost models on the server...");
      try {
        const response = await fetch('/api/train', {
          method: 'POST'
        });
        
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(errText || response.statusText);
        }
        
        const resJson = await response.json();
        showToast("Training Successful", resJson.message, "success");
        addNotification("Model Retrained", "XGBoost regression models rebuilt successfully.", "success");
      } catch (err) {
        showToast("Training Failed", err.message, "error");
        addNotification("Retraining Failed", err.message, "error");
      } finally {
        hideLoading();
      }
    });
  }

  // 5. Controller Core Functions
  
  function switchTab(tabId) {
    // Only alert on tabs that require data context
    if (!state.historicalData && (tabId === 'breakdownTab' || tabId === 'aiInsightsTab' || tabId === 'reportsTab')) {
      showToast("Data Required", "Please load a dataset first.", "warning");
      return;
    }

    state.activeTab = tabId;
    localStorage.setItem('rp_active_tab', tabId);
    
    // Update active button classes
    document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
      const btnTab = btn.getAttribute('data-tab');
      let isBtnActive = btnTab === tabId;
      
      // Top nav custom groups mapping
      if (btn.classList.contains('top-nav-tab')) {
        if (btnTab === 'overviewTab' && tabId === 'overviewTab') isBtnActive = true;
        else if (btnTab === 'forecastTab' && (tabId === 'forecastTab' || tabId === 'breakdownTab')) isBtnActive = true;
        else if (btnTab === 'scenarioTab' && tabId === 'scenarioTab') isBtnActive = true;
        else if (btnTab === 'reportsTab' && (tabId === 'reportsTab' || tabId === 'aiInsightsTab')) isBtnActive = true;
        else if (btnTab === 'diagnosticsTab' && (tabId === 'diagnosticsTab' || tabId === 'settingsTab')) isBtnActive = true;
        else isBtnActive = false;
      }
      
      if (isBtnActive) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Animate the navigation indicator pill
    const activeBtn = document.querySelector(`.top-nav-tab[data-tab="${tabId}"]`) || document.querySelector(`.top-nav-tab[data-tab="overviewTab"]`);
    const indicator = document.getElementById('navIndicator');
    if (indicator && activeBtn && activeBtn.offsetParent) {
      indicator.style.left = activeBtn.offsetLeft + 'px';
      indicator.style.top = activeBtn.offsetTop + 'px';
      indicator.style.width = activeBtn.offsetWidth + 'px';
      indicator.style.height = activeBtn.offsetHeight + 'px';
      indicator.style.display = 'block';
    } else if (indicator) {
      indicator.style.display = 'none';
    }

    // Update active pane
    document.querySelectorAll('.tab-pane').forEach(pane => {
      if (pane.id === tabId) {
        pane.classList.add('active');
      } else {
        pane.classList.remove('active');
      }
    });

    // Handle Chart.js resizing/reflow triggers if switching tabs
    if (tabId === 'overviewTab') {
      if (state.chartInstances.forecast) state.chartInstances.forecast.resize();
      if (state.chartInstances.contribution) state.chartInstances.contribution.resize();
      if (state.chartInstances.roas) state.chartInstances.roas.resize();
    }
    if (tabId === 'forecastTab' && state.chartInstances.forecastDaily) {
      state.chartInstances.forecastDaily.resize();
    }
  }
  window.switchTab = switchTab;

  // Window resize to sync indicator position
  window.addEventListener('resize', () => {
    if (state.activeTab) {
      const activeBtn = document.querySelector(`.top-nav-tab[data-tab="${state.activeTab}"]`) || document.querySelector(`.top-nav-tab[data-tab="overviewTab"]`);
      const indicator = document.getElementById('navIndicator');
      if (indicator && activeBtn && activeBtn.offsetParent) {
        indicator.style.left = activeBtn.offsetLeft + 'px';
        indicator.style.top = activeBtn.offsetTop + 'px';
        indicator.style.width = activeBtn.offsetWidth + 'px';
        indicator.style.height = activeBtn.offsetHeight + 'px';
      }
    }
  });

  function setBreakdownLevel(level) {
    state.activeBreakdownLevel = level;
    
    // Toggle active classes on togglers
    [els.toggleLevelChannel, els.toggleLevelType, els.toggleLevelCampaign].forEach(btn => btn.classList.remove('active'));
    if (level === 'channel') els.toggleLevelChannel.classList.add('active');
    if (level === 'type') els.toggleLevelType.classList.add('active');
    if (level === 'campaign') els.toggleLevelCampaign.classList.add('active');

    // Populate the breakdown table based on level
    populateBreakdownTable();
  }

  /**
   * Helper function to convert raw javascript object array back to CSV text.
   */
  function convertToCSV(objArray) {
    if (objArray.length === 0) return '';
    const headers = Object.keys(objArray[0]);
    const csvRows = [headers.join(',')];
    
    for (const obj of objArray) {
      const values = headers.map(header => {
        const val = obj[header];
        if (typeof val === 'string' && val.includes(',')) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      });
      csvRows.push(values.join(','));
    }
    return csvRows.join('\n');
  }

  /**
   * Helper function to upload file to FastAPI server and sync UI state.
   */
  async function uploadFileToServer(file, parsedRows, sourceName) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${errorText || response.statusText}`);
    }

    const diagReport = await response.json();
    
    if (!diagReport.isValid) {
      throw new Error("Dataset is INVALID according to server: \n" + diagReport.errors.join('\n'));
    }

    state.diagnostics = diagReport;
    state.historicalData = parsedRows;

    // Update Top-Nav Status Badge
    els.datasetStatus.className = `dataset-status-badge ${sourceName.toLowerCase().includes('demo') ? 'demo' : 'judge'}`;
    document.getElementById('statusText').textContent = sourceName;
    document.getElementById('statusIconContainer').innerHTML = '<i data-lucide="check-circle"></i>';
    lucide.createIcons();

    // Update health widget in sidebar
    updateHealthScore(diagReport);

    // Fill diagnostic UI panels
    populateDiagnosticsUI();

    // Remove empty placeholders style classes
    document.querySelectorAll('.chart-container').forEach(c => c.classList.remove('is-empty'));

    // Reveal UI (Hide Quick start banner)
    els.emptyStateContainer.style.display = 'none';

    // Autofill media budgets with historical averages for immediate forecasting comfort
    const planningPeriod = parseInt(els.planningPeriodSelect.value, 10);
    state.planningPeriod = planningPeriod;
    const histDays = diagReport.stats.dateRange.days || 365;
    
    // Calculate historical averages by channel scaled to planningPeriod
    const averages = {};
    parsedRows.forEach(row => {
      if (!averages[row.Channel]) averages[row.Channel] = 0;
      averages[row.Channel] += row.Cost;
    });

    Object.keys(averages).forEach(chan => {
      averages[chan] = (averages[chan] / histDays) * planningPeriod;
    });

    // Populate Slider / Number fields
    els.googleBudgetVal.value = Math.round(averages['Google Ads'] || 15000);
    els.metaBudgetVal.value = Math.round(averages['Meta Ads'] || 12000);
    els.msBudgetVal.value = Math.round(averages['Microsoft Ads'] || 2000);

    // Instantly execute forecast
    await executeForecastFlow();
  }

  /**
   * Action trigger that generates mock dataset and uploads it
   */
  /**
   * Action trigger that generates mock dataset and uploads it
   */
  async function loadDemoDataset() {
    showLoading("Generating synthetic marketing metrics...");
    try {
      const records = DatasetGenerator.generateData(365);
      const csvContent = DatasetGenerator.convertToCSV(records);
      
      // Convert to file object
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const file = new File([blob], 'demo_dataset.csv', { type: 'text/csv' });
      
      // Store in uploads list
      const list = JSON.parse(localStorage.getItem('rp_uploads') || '[]');
      list.unshift({ filename: 'demo_dataset.csv', size: '45KB', health: 100 });
      localStorage.setItem('rp_uploads', JSON.stringify(list.slice(0, 10)));

      await uploadFileToServer(file, records, 'Demo Dataset Loaded');
      showToast("Demo Loaded", "Demo dataset parsed and ingested.", "success");
      addNotification("CSV Uploaded", "E-commerce demo dataset loaded.", "success");
    } catch (err) {
      showToast("Demo Failed", err.message, "error");
    } finally {
      hideLoading();
    }
  }

  /**
   * File input event handler parsing input files
   */
  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    showLoading("Ingesting historical marketing files...");
    const reader = new FileReader();
    reader.onload = async function(event) {
      try {
        const text = event.target.result;
        const records = DataValidator.parseCSV(text);
        
        // Store in uploads list
        const list = JSON.parse(localStorage.getItem('rp_uploads') || '[]');
        list.unshift({ filename: file.name, size: (file.size / 1024).toFixed(1) + 'KB', health: 100 });
        localStorage.setItem('rp_uploads', JSON.stringify(list.slice(0, 10)));

        await uploadFileToServer(file, records, 'Judge Dataset Loaded');
        showToast("Upload Successful", "Dataset verified and loaded.", "success");
        addNotification("CSV Uploaded", `File ${file.name} successfully parsed.`, "success");
      } catch (err) {
        showToast("Integrity Error", err.message, "error");
        addNotification("CSV Parsing Failed", err.message, "error");
      } finally {
        hideLoading();
        els.csvFileInput.value = ''; // Reset input
      }
    };
    reader.readAsText(file);
  }

  /**
   * Orchestrates the run forecast process
   */
  async function executeForecastFlow() {
    if (!state.historicalData) {
      showToast("Forecast Blocked", "Please load historical data before running forecast.", "warning");
      return;
    }
    
    // Check cache first
    const googleVal = parseFloat(els.googleBudgetVal.value) || 0;
    const metaVal = parseFloat(els.metaBudgetVal.value) || 0;
    const msVal = parseFloat(els.msBudgetVal.value) || 0;
    const cacheKey = `${state.planningPeriod}_${googleVal}_${metaVal}_${msVal}_${els.seasonalitySlider.value}_${els.confidenceSelect.value}`;
    
    if (state.forecastCache[cacheKey]) {
      console.log("Serving from cache...");
      state.forecastResults = state.forecastCache[cacheKey];
      
      showLoading("Restoring cached Monte Carlo projections...");
      const finishProgress = animateLoadingProgress(250);
      setTimeout(() => {
        finishProgress();
        hideLoading();
        renderForecastResults();
        showToast("Forecast Cached", "Cached simulation results restored instantly.", "success");
        addNotification("Forecast Complete", "Cached forecast results applied.", "success");
      }, 300);
      return;
    }

    if (googleVal === 0 || metaVal === 0 || msVal === 0) {
      addNotification("Budget Warning", "Some campaign budgets are set to zero.", "warning");
    }

    showLoading("Running Monte Carlo simulations...");
    addNotification("Simulation Started", `Executing predictive run for ${state.planningPeriod} days.`, "info");
    
    // Disable generate button
    if (els.runForecastBtn) {
      els.runForecastBtn.disabled = true;
      els.runForecastBtn.classList.add('opacity-50');
    }

    // Toggle skeleton view
    const kpiSkeletonGrid = document.getElementById('kpiSkeletonGrid');
    const kpiRealGrid = document.getElementById('kpiRealGrid');
    if (kpiSkeletonGrid && kpiRealGrid) {
      kpiSkeletonGrid.classList.remove('hidden');
      kpiRealGrid.classList.add('hidden');
    }

    const finishProgress = animateLoadingProgress(700);

    setTimeout(async () => {
      try {
        await runForecastModel(cacheKey);
        finishProgress();
      } catch (err) {
        finishProgress();
        showToast("Forecast Failed", err.message, "error");
      } finally {
        hideLoading();
        if (els.runForecastBtn) {
          els.runForecastBtn.disabled = false;
          els.runForecastBtn.classList.remove('opacity-50');
        }
        if (kpiSkeletonGrid && kpiRealGrid) {
          kpiSkeletonGrid.classList.add('hidden');
          kpiRealGrid.classList.remove('hidden');
        }
      }
    }, 200);
  }

  // Animation helper for progress bar inside loader overlay
  function animateLoadingProgress(durationMs = 600) {
    const progressBar = document.getElementById('loadingProgressBar');
    if (!progressBar) return () => {};
    progressBar.style.width = '0%';
    
    let currentProgress = 0;
    const intervalTime = 30;
    const steps = durationMs / intervalTime;
    const increment = 100 / steps;
    
    const interval = setInterval(() => {
      currentProgress += increment;
      if (currentProgress >= 90) {
        progressBar.style.width = '90%';
        clearInterval(interval);
      } else {
        progressBar.style.width = currentProgress + '%';
      }
    }, intervalTime);
    
    return () => {
      clearInterval(interval);
      progressBar.style.width = '100%';
    };
  }

  // Web Worker runner fallback
  function runOfflineSimulationFallback() {
    return new Promise((resolve, reject) => {
      const planningPeriod = parseInt(els.planningPeriodSelect.value, 10);
      const budgets = {
        'Google Ads': parseFloat(els.googleBudgetVal.value) || 0,
        'Meta Ads': parseFloat(els.metaBudgetVal.value) || 0,
        'Microsoft Ads': parseFloat(els.msBudgetVal.value) || 0
      };
      
      const seasonalityWeight = parseFloat(els.seasonalitySlider.value);
      const confidenceLevel = parseInt(els.confidenceSelect.value, 10);
      
      const workerBlobCode = `
        self.onmessage = function(e) {
          const { historicalData, options } = e.data;
          try {
            importScripts(options.origin + '/forecaster.js');
            const results = self.Forecaster.run(historicalData, options);
            self.postMessage({ success: true, results: results });
          } catch (err) {
            self.postMessage({ success: false, error: err.message });
          }
        };
      `;
      
      const blob = new Blob([workerBlobCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);
      
      worker.postMessage({
        historicalData: state.historicalData,
        options: {
          origin: window.location.origin,
          planningPeriod,
          budgets,
          seasonalityWeight,
          simulationsCount: 1000,
          confidenceLevel
        }
      });
      
      worker.onmessage = function(e) {
        worker.terminate();
        URL.revokeObjectURL(url);
        if (e.data.success) {
          resolve(e.data.results);
        } else {
          reject(new Error(e.data.error));
        }
      };
      
      worker.onerror = function(err) {
        worker.terminate();
        URL.revokeObjectURL(url);
        reject(err);
      };
    });
  }

  /**
   * Executes calculations, chart renderings, and AI layer fetches
   */
  async function runForecastModel(cacheKey) {
    const planningPeriod = parseInt(els.planningPeriodSelect.value, 10);
    const budgets = {
      'Google Ads': parseFloat(els.googleBudgetVal.value) || 0,
      'Meta Ads': parseFloat(els.metaBudgetVal.value) || 0,
      'Microsoft Ads': parseFloat(els.msBudgetVal.value) || 0
    };
    
    const seasonalityWeight = parseFloat(els.seasonalitySlider.value);
    const confidenceLevel = parseInt(els.confidenceSelect.value, 10);
    const apiKey = els.geminiApiKeyVal.value;

    if (apiKey) {
      localStorage.setItem('gemini_api_key', apiKey);
    } else {
      localStorage.removeItem('gemini_api_key');
    }

    const payload = {
      planningPeriod,
      budgets,
      seasonalityWeight,
      confidenceLevel
    };

    try {
      const response = await fetch('/api/forecast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error("FastAPI server simulation error. Falling back to client-side Web Worker.");
      }

      state.forecastResults = await response.json();
    } catch (err) {
      console.warn(err.message);
      showToast("Worker Fallback", "Server offline or failed. Running simulation in Web Worker...", "warning");
      // Fallback to local client-side forecaster inside a Web Worker
      state.forecastResults = await runOfflineSimulationFallback();
    }

    state.forecastCache[cacheKey] = state.forecastResults;
    renderForecastResults();
  }

  function renderForecastResults() {
    const apiKey = els.geminiApiKeyVal.value;
    state.chartView = 'aggregate';
    
    const toggleBtn = document.getElementById('toggleChartViewBtn');
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i data-lucide="line-chart"></i> View Timeline Drill-down';
    }
    const cardTitle = document.getElementById('chartCardTitle');
    if (cardTitle) {
      cardTitle.innerHTML = '<i data-lucide="activity"></i> Aggregate Planning Forecast (Grouped Confidence Bands)';
    }
    if (window.lucide) {
      lucide.createIcons();
    }

    // Populate Overview and Breakdown Tabs
    updateOverviewStats();
    populateOverviewTable();
    populateBreakdownTable();

    // Render beautiful ChartJS visualizations
    renderForecastChart();
    renderForecastDailyChart(); 
    renderContributionChart();
    renderRoasChart();

    // AI Consultation Layer
    updateAIInsights(apiKey);
    
    // Populate Reports Tab
    populateReportsTab();

    // Rebuild Search Index with new forecast results
    if (typeof buildSearchIndex === "function") {
      buildSearchIndex();
    }

    addNotification("Simulation Finished", `Calculated probability limits. Blended ROAS P50: ${state.forecastResults.blended.roas.pMedian.toFixed(2)}x.`, "success");

    // Force transition to overview on initial loads
    if (state.activeTab === 'diagnosticsTab' && state.diagnostics.anomalies.length > 0) {
      // stay here
    } else {
      switchTab('overviewTab');
    }
  }

  function showLoading(text) {
    els.loadingText.textContent = text;
    els.loadingOverlay.style.display = 'flex';
  }

  function hideLoading() {
    els.loadingOverlay.style.display = 'none';
  }

  function updateOverviewStats() {
    const f = state.forecastResults;
    els.statTotalSpend.textContent = formatCurrency(f.totalFutureBudget);
    els.statExpectedRevenue.textContent = formatCurrency(f.blended.revenue.pMedian);
    els.statRevenueRange.textContent = `${formatCurrency(f.blended.revenue.pLow)} - ${formatCurrency(f.blended.revenue.pHigh)}`;
    els.statExpectedRoas.textContent = f.blended.roas.pMedian.toFixed(2) + 'x';
    els.statRoasRange.textContent = `${f.blended.roas.pLow.toFixed(2)}x - ${f.blended.roas.pHigh.toFixed(2)}x`;
    els.statSeasonality.textContent = f.seasonalityFactor.toFixed(2) + 'x';

    // High ROAS warning alert
    const roasVal = f.blended.roas.pMedian;
    if (roasVal > 3.5) {
      // Prevent spamming notification if already present
      const notifications = JSON.parse(localStorage.getItem('rp_notifications') || '[]');
      const hasRecent = notifications.slice(0, 3).some(n => n.title === "High ROAS Detected");
      if (!hasRecent) {
        addNotification("High ROAS Detected", `Expected blended ROAS is high (${roasVal.toFixed(2)}x). Review scaling opportunities in Reports.`, "success");
      }
    }

    // Calculate percentage change vs last N days dynamically
    const revTrendEl = document.getElementById('statRevenueTrend');
    const roasTrendEl = document.getElementById('statRoasTrend');
    const horizon = parseInt(els.planningPeriodSelect.value, 10) || 30;

    let revTrendHtml = '';
    let roasTrendHtml = '';

    if (state.historicalData && state.historicalData.length > 0) {
      const dates = [...new Set(state.historicalData.map(r => r.Date))].sort();
      const lastNDates = dates.slice(-horizon);
      
      let histRev = 0;
      let histSpend = 0;
      state.historicalData.forEach(row => {
        if (lastNDates.includes(row.Date)) {
          histRev += row.Revenue;
          histSpend += row.Cost;
        }
      });
      const histRoas = histSpend > 0 ? histRev / histSpend : 0;
      const expectedRev = f.blended.revenue.pMedian;
      const expectedRoas = f.blended.roas.pMedian;
      
      if (histRev > 0) {
        const revDiff = ((expectedRev - histRev) / histRev) * 100;
        const isPositive = revDiff >= 0;
        revTrendHtml = `<span class="trend-badge ${isPositive ? 'positive' : 'negative'}">
          <i data-lucide="${isPositive ? 'trending-up' : 'trending-down'}"></i>
          ${isPositive ? '↑' : '↓'} ${Math.abs(revDiff).toFixed(1)}% vs last ${horizon} days
        </span>`;
      }
      
      if (histRoas > 0) {
        const roasDiff = ((expectedRoas - histRoas) / histRoas) * 100;
        const isPositive = roasDiff >= 0;
        roasTrendHtml = `<span class="trend-badge ${isPositive ? 'positive' : 'negative'}">
          <i data-lucide="${isPositive ? 'trending-up' : 'trending-down'}"></i>
          ${isPositive ? '↑' : '↓'} ${Math.abs(roasDiff).toFixed(1)}% vs last ${horizon} days
        </span>`;
      }
    }

    if (revTrendEl) revTrendEl.innerHTML = revTrendHtml;
    if (roasTrendEl) roasTrendEl.innerHTML = roasTrendHtml;

    // Update seasonality description and badge dynamically
    const factor = f.seasonalityFactor;
    let impactText = 'Neutral impact';
    let badgeText = 'Normal Season';
    let badgeClass = 'normal';
    
    if (factor > 1.05) {
      impactText = 'Positive seasonality';
      badgeText = 'High Season';
      badgeClass = 'high';
    } else if (factor < 0.95) {
      impactText = 'Negative seasonality';
      badgeText = 'Low Season';
      badgeClass = 'low';
    }
    
    const textEl = document.getElementById('statSeasonalityText');
    const badgeEl = document.getElementById('statSeasonalityBadge');
    if (textEl) textEl.textContent = impactText;
    if (badgeEl) {
      badgeEl.textContent = badgeText;
      badgeEl.className = `stat-badge ${badgeClass}`;
    }

    lucide.createIcons();
  }

  function populateOverviewTable() {
    const f = state.forecastResults;
    let html = '';
    const symbol = getCurrencySymbol();

    // Blended row
    html += `<tr style="font-weight: 700; background-color: var(--bg-base);">
      <td>Blended (Aggregate)</td>
      <td>${symbol}${Math.round(f.totalFutureBudget).toLocaleString()}</td>
      <td>${f.blended.roas.pMedian.toFixed(2)}x</td>
      <td>${symbol}${Math.round(f.blended.revenue.pMedian).toLocaleString()}</td>
      <td>${symbol}${Math.round(f.blended.revenue.pLow).toLocaleString()}</td>
      <td>${symbol}${Math.round(f.blended.revenue.pHigh).toLocaleString()}</td>
    </tr>`;

    // Channel level breakdown rows
    Object.keys(f.channels).forEach(chan => {
      const c = f.channels[chan];
      const tagClass = chan.toLowerCase().includes('google') ? 'google' : chan.toLowerCase().includes('meta') ? 'meta' : 'microsoft';
      html += `<tr>
        <td><span class="channel-tag ${tagClass}">${chan}</span></td>
        <td>${symbol}${Math.round(c.budget).toLocaleString()}</td>
        <td>${c.roas.pMedian.toFixed(2)}x</td>
        <td>${symbol}${Math.round(c.revenue.pMedian).toLocaleString()}</td>
        <td>${symbol}${Math.round(c.revenue.pLow).toLocaleString()}</td>
        <td>${symbol}${Math.round(c.revenue.pHigh).toLocaleString()}</td>
      </tr>`;
    });

    els.overviewTableBody.innerHTML = html;
  }

  /**
   * Structuring Campaign row items array to search, sort, and paginate
   */
  function getFilteredCampaignTableRows() {
    const f = state.forecastResults;
    if (!f) return [];

    const level = state.activeBreakdownLevel;
    let items = [];

    if (level === 'channel') {
      items = Object.keys(f.channels).map(chan => {
        const c = f.channels[chan];
        return {
          id: chan,
          segment: chan,
          channel: chan,
          type: '',
          budget: c.budget,
          revenue: c.revenue.pMedian,
          pessimistic: c.revenue.pLow,
          optimistic: c.revenue.pHigh,
          roas: c.roas.pMedian,
          roasRange: `${c.roas.pLow.toFixed(2)}x - ${c.roas.pHigh.toFixed(2)}x`,
          tagClass: chan.toLowerCase().includes('google') ? 'google' : chan.toLowerCase().includes('meta') ? 'meta' : 'microsoft'
        };
      });
    } else if (level === 'type') {
      items = Object.keys(f.campaignTypes).map(type => {
        const c = f.campaignTypes[type];
        return {
          id: type,
          segment: type,
          channel: c.channel,
          type: '',
          budget: c.budget,
          revenue: c.revenue.pMedian,
          pessimistic: c.revenue.pLow,
          optimistic: c.revenue.pHigh,
          roas: c.roas.pMedian,
          roasRange: `${c.roas.pLow.toFixed(2)}x - ${c.roas.pHigh.toFixed(2)}x`,
          tagClass: c.channel.toLowerCase().includes('google') ? 'google' : c.channel.toLowerCase().includes('meta') ? 'meta' : 'microsoft'
        };
      });
    } else if (level === 'campaign') {
      items = Object.keys(f.campaigns).map(camp => {
        const c = f.campaigns[camp];
        return {
          id: camp,
          segment: camp,
          channel: c.channel,
          type: c.type,
          budget: c.budget,
          revenue: c.revenue.pMedian,
          pessimistic: c.revenue.pLow,
          optimistic: c.revenue.pHigh,
          roas: c.roas.pMedian,
          roasRange: `${c.roas.pLow.toFixed(2)}x - ${c.roas.pHigh.toFixed(2)}x`,
          tagClass: c.channel.toLowerCase().includes('google') ? 'google' : c.channel.toLowerCase().includes('meta') ? 'meta' : 'microsoft'
        };
      });
    }

    // 1. Search Query Filter
    const query = state.tableSearch.trim().toLowerCase();
    let filtered = items;
    if (query !== '') {
      filtered = items.filter(r => {
        return r.segment.toLowerCase().includes(query) || 
               r.channel.toLowerCase().includes(query) ||
               r.type.toLowerCase().includes(query);
      });
    }

    // 2. Column Sorting
    const col = state.tableSortColumn;
    const isAsc = state.tableSortOrder === 'asc';
    filtered.sort((a, b) => {
      let valA = a[col];
      let valB = b[col];
      
      if (typeof valA === 'string') {
        return isAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      } else {
        return isAsc ? valA - valB : valB - valA;
      }
    });

    return filtered;
  }

  function getFilteredRowsTotalCount() {
    return getFilteredCampaignTableRows().length;
  }

  /**
   * Redesigned breakdown card populator (replaces the table body)
   */
  function populateBreakdownTable() {
    const f = state.forecastResults;
    if (!f) return;

    // Get processed rows
    const allFilteredRows = getFilteredCampaignTableRows();
    const total = allFilteredRows.length;

    // Apply Pagination boundaries
    const start = (state.tablePage - 1) * state.tableLimit;
    const end = Math.min(start + state.tableLimit, total);
    const pageRows = allFilteredRows.slice(start, end);

    let html = '';
    const totalSpend = f.totalFutureBudget || 1;

    pageRows.forEach(r => {
      const sharePercent = ((r.budget / totalSpend) * 100).toFixed(0);
      
      let roasStatus = 'Average';
      let roasStatusClass = 'neutral';
      if (r.roas >= 4.0) {
        roasStatus = 'Excellent';
        roasStatusClass = 'success';
      } else if (r.roas >= 2.5) {
        roasStatus = 'Healthy';
        roasStatusClass = 'success';
      } else if (r.roas < 1.5) {
        roasStatus = 'At Risk';
        roasStatusClass = 'danger';
      }

      html += `
      <div class="campaign-kpi-card">
        <div class="campaign-card-header">
          <h4 class="campaign-card-title">${r.segment}</h4>
          <span class="channel-tag ${r.tagClass}">${r.channel}</span>
        </div>
        
        <div class="campaign-card-metrics">
          <div class="campaign-metric-item">
            <span class="campaign-metric-label">Allocated Spend</span>
            <span class="campaign-metric-value">${formatCurrency(r.budget)}</span>
          </div>
          <div class="spend-share-bar" title="Spend share: ${sharePercent}%">
            <div class="spend-share-fill" style="width: ${sharePercent}%;"></div>
          </div>
          
          <div class="campaign-metric-item" style="margin-top: 10px;">
            <span class="campaign-metric-label">Expected Revenue</span>
            <span class="campaign-metric-value">${formatCurrency(r.revenue)}</span>
          </div>
          
          <div class="campaign-metric-item">
            <span class="campaign-metric-label">Expected ROAS</span>
            <span class="campaign-metric-value highlight">${r.roas.toFixed(2)}x</span>
          </div>
          
          <div class="campaign-metric-item">
            <span class="campaign-metric-label">Confidence Range</span>
            <span class="campaign-metric-value" style="font-size: 11.5px; color: var(--text-muted);">${formatCurrency(r.pessimistic)} - ${formatCurrency(r.optimistic)}</span>
          </div>

          <div class="campaign-metric-item" style="border-top: 1px dashed var(--border-color); padding-top: 8px; margin-top: 8px;">
            <span class="campaign-metric-label">Performance Check</span>
            <span class="ai-insight-tag ${roasStatusClass}">${roasStatus}</span>
          </div>
        </div>
      </div>`;
    });

    if (pageRows.length === 0) {
      html = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 48px;">No matching records found.</div>`;
    }

    els.breakdownTableBody.innerHTML = html;

    // Update Pagination Text and buttons state
    const tablePaginationInfo = document.getElementById('tablePaginationInfo');
    const btnPrevPage = document.getElementById('btnPrevPage');
    const btnNextPage = document.getElementById('btnNextPage');
    
    if (tablePaginationInfo) {
      if (total === 0) {
        tablePaginationInfo.textContent = 'Showing 0-0 of 0 entries';
      } else {
        tablePaginationInfo.textContent = `Showing ${start + 1}-${end} of ${total} entries`;
      }
    }
    if (btnPrevPage) btnPrevPage.disabled = state.tablePage === 1;
    if (btnNextPage) btnNextPage.disabled = end >= total;
  }

  function populateDiagnosticsUI() {
    const diag = state.diagnostics;
    
    // Integrity panel list details
    let summaryHtml = `
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div class="footer-row" style="border-bottom:1px solid var(--border-color); padding-bottom:8px;"><span>Total Record Rows</span><strong>${diag.stats.totalRows}</strong></div>
        <div class="footer-row" style="border-bottom:1px solid var(--border-color); padding-bottom:8px;"><span>Paid Channels</span><strong>${Array.from(diag.stats.channels).join(', ')}</strong></div>
        <div class="footer-row" style="border-bottom:1px solid var(--border-color); padding-bottom:8px;"><span>Campaigns</span><strong>${diag.stats.campaigns.size} campaigns</strong></div>
        <div class="footer-row" style="border-bottom:1px solid var(--border-color); padding-bottom:8px;"><span>Time Range</span><strong>${diag.stats.dateRange.min} to ${diag.stats.dateRange.max} (${diag.stats.dateRange.days} days)</strong></div>
        <div class="footer-row" style="border-bottom:1px solid var(--border-color); padding-bottom:8px;"><span>Aggregate Cost</span><strong>${formatCurrency(diag.stats.totalSpend)}</strong></div>
        <div class="footer-row" style="border-bottom:1px solid var(--border-color); padding-bottom:8px;"><span>Aggregate Revenue</span><strong>${formatCurrency(diag.stats.totalRevenue)}</strong></div>
        <div class="footer-row"><span>Historical ROAS</span><strong>${(diag.stats.totalRevenue / diag.stats.totalSpend).toFixed(2)}x</strong></div>
      </div>
    `;

    if (diag.warnings.length > 0) {
      summaryHtml += `<div style="margin-top: 20px;"><h4 style="font-size:11px; text-transform:uppercase; letter-spacing:0.5px; color:var(--color-warning); margin-bottom:8px;">Hygiene Alerts</h4>`;
      diag.warnings.forEach(w => {
        summaryHtml += `<div class="warning-box" style="margin-bottom:8px;"><i data-lucide="alert-circle" style="width:14px; height:14px;"></i> ${w}</div>`;
      });
      summaryHtml += `</div>`;
    }

    els.diagnosticIntegritySummary.innerHTML = summaryHtml;

    // Build anomalies list
    if (diag.anomalies.length === 0) {
      els.anomaliesListContainer.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 48px; text-align:center; gap:8px;">
          <i data-lucide="check-circle" style="width:36px; height:36px; color:var(--color-success)"></i>
          <p style="font-size:14px; font-weight:600;">Clean Ingestion Status</p>
          <p style="font-size:12px; color:var(--text-secondary)">No anomalous bid patterns or delivery tracking outages detected.</p>
        </div>
      `;
    } else {
      let anomaliesHtml = '';
      diag.anomalies.forEach(a => {
        const severityClass = a.severity.toLowerCase();
        anomaliesHtml += `
          <div class="anomaly-item ${severityClass}">
            <i data-lucide="alert-triangle"></i>
            <div class="anomaly-details" style="flex-grow:1;">
              <div class="anomaly-title">${a.type}</div>
              <p class="anomaly-desc">${a.description}</p>
              <span style="font-size:11px; color:var(--text-muted); display:block; margin-top:6px;">Date: ${a.date} | ${a.campaign} (${a.channel})</span>
            </div>
          </div>
        `;
      });
      els.anomaliesListContainer.innerHTML = anomaliesHtml;
    }

    lucide.createIcons();
  }

  function updateHealthScore(diag) {
    const circle = document.getElementById('healthProgressCircle');
    const valueEl = document.getElementById('healthScoreValue');
    const statusEl = document.getElementById('healthStatusText');
    const pillText = document.getElementById('sidebarStatusText');
    const pill = document.getElementById('sidebarStatusPill');

    if (!diag) {
      if (circle) circle.style.strokeDashoffset = 126;
      if (valueEl) valueEl.textContent = '0%';
      if (statusEl) statusEl.textContent = 'No data uploaded';
      if (pillText) pillText.textContent = 'Unloaded';
      if (pill) pill.className = 'sidebar-status-pill';
      return;
    }

    let score = 100;
    const anomalyDeduction = Math.min(30, diag.anomalies.length * 10);
    score -= anomalyDeduction;

    const warningDeduction = Math.min(20, diag.warnings.length * 5);
    score -= warningDeduction;

    if (!diag.isValid) {
      score -= 25;
    }

    score = Math.max(0, score);

    if (circle) {
      const offset = 126 - (126 * score) / 100;
      circle.style.strokeDashoffset = offset;
    }
    if (valueEl) valueEl.textContent = score + '%';

    let healthDesc = 'Excellent health';
    if (score < 50) {
      healthDesc = 'Critical errors';
    } else if (score < 70) {
      healthDesc = 'Warning issues';
    } else if (score < 90) {
      healthDesc = 'Good health';
    }
    if (statusEl) statusEl.textContent = healthDesc;

    // Update validation page score if exists
    const pageValFill = document.getElementById('validationProgressFill');
    const pageValScore = document.getElementById('validationScoreValue');
    if (pageValFill) pageValFill.style.width = score + '%';
    if (pageValScore) pageValScore.textContent = score + '%';

    // Update dataset pill
    if (pillText) {
      const sourceName = document.getElementById('statusText').textContent || 'Loaded';
      pillText.textContent = sourceName.includes('Demo') ? 'Demo Data' : sourceName.includes('Judge') ? 'Judge Data' : 'CSV Loaded';
    }
    if (pill) {
      pill.className = 'sidebar-status-pill loaded';
    }
  }

  async function updateAIInsights(apiKey) {
    if (!apiKey || !apiKey.trim()) {
      els.aiKeyWarning.style.display = 'block';
    } else {
      els.aiKeyWarning.style.display = 'none';
    }

    const loaderHtml = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 40px; gap: 12px;">
        <div class="spinner" style="width:30px; height:30px; border-width:3px;"></div>
        <p style="font-size: 13px; color: var(--text-secondary);">Growth Analyst composing causal explanations...</p>
      </div>
    `;

    els.aiReportContent.innerHTML = loaderHtml;
    const aiDetailedReportContent = document.getElementById('aiDetailedReportContent');
    if (aiDetailedReportContent) aiDetailedReportContent.innerHTML = loaderHtml;

    // Prepare package payload for AI
    const dataPackage = {
      historical: {
        days: state.diagnostics.stats.dateRange.days,
        totalSpend: state.diagnostics.stats.totalSpend,
        totalRevenue: state.diagnostics.stats.totalRevenue,
        channels: {}
      },
      forecast: state.forecastResults,
      validation: {
        anomalies: state.diagnostics.anomalies
      }
    };

    // Calculate historical channel totals
    state.historicalData.forEach(row => {
      if (!dataPackage.historical.channels[row.Channel]) {
        dataPackage.historical.channels[row.Channel] = { spend: 0, revenue: 0 };
      }
      dataPackage.historical.channels[row.Channel].spend += row.Cost;
      dataPackage.historical.channels[row.Channel].revenue += row.Revenue;
    });

    try {
      const markdownReport = await AICausalLayer.generateInsights(dataPackage, apiKey);
      // Parse Markdown safely to HTML and set container
      const htmlReport = marked.parse(markdownReport);
      els.aiReportContent.innerHTML = htmlReport;
      
      // Parse markdown into expandable accordion elements in the detailed AI insights tab
      parseAndRenderAIInsights(markdownReport);
    } catch (err) {
      const errorHtml = `
        <div class="warning-box" style="margin: 0; background:var(--color-danger-light); border-color: rgba(220,38,38,0.2); color:var(--color-danger);">
          <i data-lucide="alert-circle"></i>
          <strong>AI Consultation Incomplete:</strong> ${err.message}. Showing local advisory reports instead.
        </div>
      `;
      els.aiReportContent.innerHTML = errorHtml;
      if (aiDetailedReportContent) aiDetailedReportContent.innerHTML = errorHtml;
    }
  }

  function parseAndRenderAIInsights(markdown) {
    const container = document.getElementById('aiInsightsAccordionContainer');
    if (!container) return;
    
    const sections = [
      { id: 'summary', title: 'Executive Summary', icon: 'sparkles', content: '' },
      { id: 'causal', title: 'Causal Performance & Seasonality', icon: 'activity', content: '' },
      { id: 'anomalies', title: 'Data Integrity & Anomalies', icon: 'shield-alert', content: '' },
      { id: 'budget', title: 'Strategic Budget Recommendations', icon: 'git-branch', content: '' },
      { id: 'risks', title: 'Operational Risks & Mitigations', icon: 'alert-triangle', content: '' }
    ];
    
    // Split markdown by main second level headers
    const lines = markdown.split('\n');
    let currentSectionIdx = 0;
    let sectionText = '';
    
    lines.forEach(line => {
      if (line.startsWith('## ') || line.startsWith('# ')) {
        const title = line.replace(/^[#\s]+/, '').trim().toLowerCase();
        if (title.includes('summary') || title.includes('executive')) {
          if (sectionText && currentSectionIdx >= 0) sections[currentSectionIdx].content += sectionText;
          currentSectionIdx = 0;
          sectionText = '';
        } else if (title.includes('causal') || title.includes('performance') || title.includes('season')) {
          if (sectionText && currentSectionIdx >= 0) sections[currentSectionIdx].content += sectionText;
          currentSectionIdx = 1;
          sectionText = '';
        } else if (title.includes('anomalies') || title.includes('integrity') || title.includes('diagnostics')) {
          if (sectionText && currentSectionIdx >= 0) sections[currentSectionIdx].content += sectionText;
          currentSectionIdx = 2;
          sectionText = '';
        } else if (title.includes('budget') || title.includes('recommend')) {
          if (sectionText && currentSectionIdx >= 0) sections[currentSectionIdx].content += sectionText;
          currentSectionIdx = 3;
          sectionText = '';
        } else if (title.includes('risk') || title.includes('mitigation') || title.includes('operational')) {
          if (sectionText && currentSectionIdx >= 0) sections[currentSectionIdx].content += sectionText;
          currentSectionIdx = 4;
          sectionText = '';
        } else {
          sectionText += line + '\n';
        }
      } else {
        sectionText += line + '\n';
      }
    });
    if (sectionText && currentSectionIdx >= 0) {
      sections[currentSectionIdx].content += sectionText;
    }
    
    // Populate layout
    let html = '';
    sections.forEach((s, idx) => {
      if (!s.content.trim()) {
        s.content = '_No detailed advisory notes generated for this section._';
      }
      const parsedHtml = marked.parse(s.content);
      const isExpanded = idx === 0 ? 'expanded' : ''; 
      html += `
      <div class="expandable-insight-card ${isExpanded}">
        <button class="expandable-card-trigger" onclick="this.parentElement.classList.toggle('expanded')">
          <div class="expandable-card-trigger-title">
            <i data-lucide="${s.icon}"></i>
            <span>${s.title}</span>
          </div>
          <i data-lucide="chevron-down" class="chevron"></i>
        </button>
        <div class="expandable-card-content">
          <div class="ai-report-box">
            ${parsedHtml}
          </div>
        </div>
      </div>
      `;
    });
    
    container.innerHTML = html;
    lucide.createIcons();
    
    // Show and fill overview page AI summary cards
    document.getElementById('aiSummaryHighlightGrid').style.display = 'grid';
    
    const f = state.forecastResults;
    const proposedRoas = f.blended.roas.pMedian;
    const overallHistRoas = state.diagnostics.stats.totalSpend > 0 ? (state.diagnostics.stats.totalRevenue / state.diagnostics.stats.totalSpend) : 0;
    const roasDiff = proposedRoas - overallHistRoas;
    
    const revBadge = document.getElementById('insightRevBadge');
    const revVal = document.getElementById('insightRevValue');
    
    if (roasDiff > 0.15) {
      if (revBadge) { revBadge.className = 'ai-insight-tag success'; revBadge.textContent = 'High Growth'; }
      if (revVal) revVal.textContent = 'Efficiency Expansion';
    } else if (roasDiff < -0.15) {
      if (revBadge) { revBadge.className = 'ai-insight-tag danger'; revBadge.textContent = 'Saturation'; }
      if (revVal) revVal.textContent = 'Diminishing Returns';
    } else {
      if (revBadge) { revBadge.className = 'ai-insight-tag neutral'; revBadge.textContent = 'Stable'; }
      if (revVal) revVal.textContent = 'Steady Performance';
    }
    
    const channelEntries = Object.keys(f.channels).map(c => ({ name: c, roas: f.channels[c].roas.pMedian }));
    const highestRoasChan = channelEntries.sort((a,b) => b.roas - a.roas)[0];
    const bestChanEl = document.getElementById('insightBestChan');
    if (bestChanEl) bestChanEl.textContent = highestRoasChan ? `${highestRoasChan.name.split(' ')[0]} (${highestRoasChan.roas.toFixed(1)}x)` : 'Stable';
    
    const campEntries = Object.keys(f.campaigns).map(c => ({ name: c, roas: f.campaigns[c].roas.pMedian }));
    const lowestRoasCamp = campEntries.sort((a,b) => a.roas - b.roas)[0];
    const weakCampEl = document.getElementById('insightWeakCamp');
    if (weakCampEl) weakCampEl.textContent = lowestRoasCamp ? lowestRoasCamp.name.replace('GG_','').replace('FB_','').replace('MS_','') : 'Stable';
    
    const riskBadge = document.getElementById('insightRiskBadge');
    const riskVal = document.getElementById('insightRiskValue');
    const anomaliesCount = state.diagnostics.anomalies.length;
    
    if (riskBadge && riskVal) {
      if (anomaliesCount > 2) {
        riskBadge.className = 'ai-insight-tag danger';
        riskBadge.textContent = 'High Risk';
        riskVal.textContent = `${anomaliesCount} Data Outliers`;
      } else if (anomaliesCount > 0) {
        riskBadge.className = 'ai-insight-tag warning';
        riskBadge.textContent = 'Medium Risk';
        riskVal.textContent = 'Data Outliers';
      } else {
        riskBadge.className = 'ai-insight-tag success';
        riskBadge.textContent = 'Healthy';
        riskVal.textContent = 'Clean Baselines';
      }
    }
  }

  function populateReportsTab() {
    const f = state.forecastResults;
    if (!f) return;
    
    const dateText = document.getElementById('reportDateText');
    if (dateText) {
      dateText.textContent = `Generated on: ${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`;
    }
    
    const tableBody = document.getElementById('reportMetricsTableBody');
    if (tableBody) {
      let html = '';
      const symbol = getCurrencySymbol();
      html += `<tr style="font-weight: 700; background-color: var(--bg-base);">
        <td>Blended (Aggregate)</td>
        <td>${symbol}${Math.round(f.totalFutureBudget).toLocaleString()}</td>
        <td>${f.blended.roas.pMedian.toFixed(2)}x</td>
        <td>${symbol}${Math.round(f.blended.revenue.pMedian).toLocaleString()}</td>
        <td>${symbol}${Math.round(f.blended.revenue.pLow).toLocaleString()}</td>
        <td>${symbol}${Math.round(f.blended.revenue.pHigh).toLocaleString()}</td>
      </tr>`;
      
      Object.keys(f.channels).forEach(chan => {
        const c = f.channels[chan];
        html += `<tr>
          <td><strong>${chan}</strong></td>
          <td>${symbol}${Math.round(c.budget).toLocaleString()}</td>
          <td>${c.roas.pMedian.toFixed(2)}x</td>
          <td>${symbol}${Math.round(c.revenue.pMedian).toLocaleString()}</td>
          <td>${symbol}${Math.round(c.revenue.pLow).toLocaleString()}</td>
          <td>${symbol}${Math.round(c.revenue.pHigh).toLocaleString()}</td>
        </tr>`;
      });
      tableBody.innerHTML = html;
    }
    
    const summaryContainer = document.getElementById('reportExecutiveSummaryText');
    const recsContainer = document.getElementById('reportRecommendationsText');
    
    const detailedReport = els.aiReportContent.innerHTML;
    if (detailedReport && detailedReport.trim()) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(detailedReport, 'text/html');
      
      let summaryHtml = '';
      let recsHtml = '';
      let section = '';
      
      Array.from(doc.body.children).forEach(el => {
        const text = el.textContent.toLowerCase();
        if (el.tagName.startsWith('H')) {
          if (text.includes('executive') || text.includes('summary')) {
            section = 'summary';
          } else if (text.includes('recommend') || text.includes('budget')) {
            section = 'recs';
          } else {
            section = '';
          }
        } else {
          if (section === 'summary') {
            summaryHtml += el.outerHTML;
          } else if (section === 'recs') {
            recsHtml += el.outerHTML;
          }
        }
      });
      
      if (summaryContainer) {
        summaryContainer.innerHTML = summaryHtml || `<p>${doc.body.innerHTML}</p>`;
      }
      if (recsContainer) {
        recsContainer.innerHTML = recsHtml || '<p>Strategic recommendations are available in the full AI Insights tab.</p>';
      }
    }
  }

  // 6. CHART RENDER UTILITIES

  function renderForecastChart() {
    const canvas = document.getElementById('forecastChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Destroy previous instance
    if (window.forecastChart && window.forecastChart.destroy) {
      window.forecastChart.destroy();
    }
    if (state.chartInstances.forecast && state.chartInstances.forecast.destroy) {
      state.chartInstances.forecast.destroy();
    }

    const f = state.forecastResults;
    const isLight = document.body.classList.contains('light-mode');
    const tickColor = isLight ? '#475569' : '#94A3B8';
    const gridColor = isLight ? '#ECEFF3' : '#1E2538';

    if (state.chartView === 'aggregate') {
      // Grouped Bar Chart of Aggregate Planning Period Forecasts
      const channels = ['Blended'].concat(Object.keys(f.channels));
      const p10Data = [];
      const p50Data = [];
      const p90Data = [];
      
      channels.forEach(chan => {
        if (chan === 'Blended') {
          p10Data.push(f.blended.revenue.pLow);
          p50Data.push(f.blended.revenue.pMedian);
          p90Data.push(f.blended.revenue.pHigh);
        } else {
          const c = f.channels[chan];
          p10Data.push(c.revenue.pLow);
          p50Data.push(c.revenue.pMedian);
          p90Data.push(c.revenue.pHigh);
        }
      });

      // Neon Cyberpunk colors
      const cP10 = '#F25C5C'; // Neon Red
      const cP50 = '#7971FF'; // Neon Indigo
      const cP90 = '#3ECF8E'; // Neon Green

      window.forecastChart = state.chartInstances.forecast = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: channels,
          datasets: [
            {
              label: 'Pessimistic Revenue (P10)',
              data: p10Data,
              backgroundColor: cP10,
              borderColor: cP10,
              borderWidth: 1,
              borderRadius: 4
            },
            {
              label: 'Expected Revenue (P50)',
              data: p50Data,
              backgroundColor: cP50,
              borderColor: cP50,
              borderWidth: 1,
              borderRadius: 4
            },
            {
              label: 'Optimistic Revenue (P90)',
              data: p90Data,
              backgroundColor: cP90,
              borderColor: cP90,
              borderWidth: 1,
              borderRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: {
                color: tickColor,
                font: { family: 'Plus Jakarta Sans', size: 12, weight: '500' }
              }
            },
            tooltip: {
              backgroundColor: isLight ? '#0F172A' : '#141826',
              borderColor: gridColor,
              borderWidth: 1,
              titleFont: { family: 'Plus Jakarta Sans', weight: 'bold' },
              bodyFont: { family: 'Plus Jakarta Sans' },
              callbacks: {
                label: function(context) {
                  let label = context.dataset.label || '';
                  if (label) label += ': ';
                  if (context.parsed.y !== null) {
                     label += '₹' + Math.round(context.parsed.y).toLocaleString();
                  }
                  return label;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                color: tickColor,
                font: { family: 'Plus Jakarta Sans', size: 12, weight: '600' }
              }
            },
            y: {
              grid: { color: gridColor },
              ticks: {
                color: tickColor,
                font: { family: 'Plus Jakarta Sans', size: 11 },
                callback: (value) => '₹' + value.toLocaleString()
              }
            }
          }
        }
      });

    } else {
      // Daily Timeline Line Chart
      const dailyMap = {};
      state.historicalData.forEach(row => {
        if (!dailyMap[row.Date]) dailyMap[row.Date] = 0;
        dailyMap[row.Date] += row.Revenue;
      });

      const sortedDates = Object.keys(dailyMap).sort();
      const chartHistoryRange = sortedDates.slice(-60);
      const histRevenues = chartHistoryRange.map(d => dailyMap[d]);

      const histRevenues7DayAvg = [];
      for (let i = 0; i < chartHistoryRange.length; i++) {
        let sum = 0;
        let count = 0;
        for (let j = Math.max(0, i - 6); j <= i; j++) {
          const dateKey = chartHistoryRange[j];
          sum += dailyMap[dateKey];
          count++;
        }
        histRevenues7DayAvg.push(sum / count);
      }

      const forecastDatesMap = {};
      if (f.dailyForecasts && f.dailyForecasts.length > 0) {
        f.dailyForecasts.forEach(row => {
          const d = row.date;
          if (!forecastDatesMap[d]) {
            forecastDatesMap[d] = { p10: 0, p50: 0, p90: 0 };
          }
          forecastDatesMap[d].p10 += row.predicted_revenue_p10;
          forecastDatesMap[d].p50 += row.predicted_revenue_p50;
          forecastDatesMap[d].p90 += row.predicted_revenue_p90;
        });
      } else {
        const planningPeriod = f.planningPeriod;
        const dailyMedian = f.blended.revenue.pMedian / planningPeriod;
        const dailyLow = f.blended.revenue.pLow / planningPeriod;
        const dailyHigh = f.blended.revenue.pHigh / planningPeriod;
        
        const maxHistDate = new Date(sortedDates[sortedDates.length - 1]);
        for (let day = 1; day <= planningPeriod; day++) {
          const nextD = new Date(maxHistDate);
          nextD.setDate(maxHistDate.getDate() + day);
          const dateStr = nextD.toISOString().split('T')[0];
          forecastDatesMap[dateStr] = { p10: dailyLow, p50: dailyMedian, p90: dailyHigh };
        }
      }
      
      const forecastDates = Object.keys(forecastDatesMap).sort();
      const labels = chartHistoryRange.concat(forecastDates);
      
      const emptyForecastPadding = Array(forecastDates.length).fill(null);
      const histDataPoints = histRevenues.concat(emptyForecastPadding);
      const hist7DayDataPoints = histRevenues7DayAvg.concat(emptyForecastPadding);

      const emptyHistPadding = Array(chartHistoryRange.length).fill(null);
      const startPoint = histRevenues7DayAvg[histRevenues7DayAvg.length - 1];
      
      const forecastMedianPoints = emptyHistPadding.concat([startPoint]).concat(forecastDates.map(d => forecastDatesMap[d].p50));
      const forecastLowPoints = emptyHistPadding.concat([startPoint]).concat(forecastDates.map(d => forecastDatesMap[d].p10));
      const forecastHighPoints = emptyHistPadding.concat([startPoint]).concat(forecastDates.map(d => forecastDatesMap[d].p90));

      const flatFillColor = isLight ? 'rgba(99, 91, 255, 0.04)' : 'rgba(0, 212, 255, 0.04)';

      window.forecastChart = state.chartInstances.forecast = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Historical Revenue',
              data: histDataPoints,
              borderColor: 'rgba(148, 163, 184, 0.25)',
              borderWidth: 1,
              pointRadius: 0,
              tension: 0.4,
              fill: false
            },
            {
              label: 'Historical (7d Rolling Mean)',
              data: hist7DayDataPoints,
              borderColor: '#94A3B8',
              borderWidth: 1.5,
              borderDash: [4, 4],
              pointRadius: 0,
              tension: 0.4,
              fill: false
            },
            {
              label: 'Forecast Expected',
              data: forecastMedianPoints,
              borderColor: '#3B82F6',
              borderWidth: 2.5,
              pointRadius: 0,
              tension: 0.4,
              fill: true,
              backgroundColor: (() => {
                const grad = ctx.createLinearGradient(0, 0, 0, 300);
                grad.addColorStop(0, 'rgba(59, 130, 246, 0.12)');
                grad.addColorStop(1, 'rgba(59, 130, 246, 0)');
                return grad;
              })()
            },
            {
              label: 'Forecast Optimistic (P90)',
              data: forecastHighPoints,
              borderColor: '#6366F1',
              borderWidth: 1,
              borderDash: [3, 3],
              pointRadius: 0,
              tension: 0.4,
              fill: false
            },
            {
              label: 'Forecast Confidence Band',
              data: forecastLowPoints,
              borderColor: 'rgba(99, 102, 241, 0.25)',
              borderWidth: 1,
              borderDash: [3, 3],
              pointRadius: 0,
              tension: 0.4,
              backgroundColor: 'rgba(99, 102, 241, 0.02)',
              fill: '-1'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: {
                color: tickColor,
                font: { family: 'Plus Jakarta Sans', size: 11 }
              }
            },
            tooltip: {
              mode: 'index',
              intersect: false,
              backgroundColor: isLight ? '#0F172A' : '#141826',
              borderColor: gridColor,
              borderWidth: 1,
              titleFont: { family: 'Plus Jakarta Sans', weight: 'bold' },
              bodyFont: { family: 'Plus Jakarta Sans' }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                color: tickColor,
                font: { family: 'Plus Jakarta Sans', size: 10 },
                maxTicksLimit: 12
              }
            },
            y: {
              grid: { color: gridColor },
              ticks: {
                color: tickColor,
                font: { family: 'Plus Jakarta Sans', size: 10 },
                callback: (value) => '₹' + value.toLocaleString()
              }
            }
          }
        }
      });
    }
  }

  /**
   * Renders the timeline chart inside the dedicated Forecast Drill-down tab view
   */
  function renderForecastDailyChart() {
    const canvas = document.getElementById('forecastDailyChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (window.forecastDailyChart && window.forecastDailyChart.destroy) {
      window.forecastDailyChart.destroy();
    }
    if (state.chartInstances.forecastDaily && state.chartInstances.forecastDaily.destroy) {
      state.chartInstances.forecastDaily.destroy();
    }

    const f = state.forecastResults;
    if (!f) return;

    const isLight = document.body.classList.contains('light-mode');
    const tickColor = isLight ? '#475569' : '#94A3B8';
    const gridColor = isLight ? '#ECEFF3' : '#1E2538';

    // Process Historical Data: Aggregate overall daily revenue
    const dailyMap = {};
    state.historicalData.forEach(row => {
      if (!dailyMap[row.Date]) dailyMap[row.Date] = 0;
      dailyMap[row.Date] += row.Revenue;
    });

    const sortedDates = Object.keys(dailyMap).sort();
    const chartHistoryRange = sortedDates.slice(-60);
    const histRevenues = chartHistoryRange.map(d => dailyMap[d]);

    const histRevenues7DayAvg = [];
    for (let i = 0; i < chartHistoryRange.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - 6); j <= i; j++) {
        const dateKey = chartHistoryRange[j];
        sum += dailyMap[dateKey];
        count++;
      }
      histRevenues7DayAvg.push(sum / count);
    }

    const forecastDatesMap = {};
    if (f.dailyForecasts && f.dailyForecasts.length > 0) {
      f.dailyForecasts.forEach(row => {
        const d = row.date;
        if (!forecastDatesMap[d]) {
          forecastDatesMap[d] = { p10: 0, p50: 0, p90: 0 };
        }
        forecastDatesMap[d].p10 += row.predicted_revenue_p10;
        forecastDatesMap[d].p50 += row.predicted_revenue_p50;
        forecastDatesMap[d].p90 += row.predicted_revenue_p90;
      });
    } else {
      const planningPeriod = f.planningPeriod;
      const dailyMedian = f.blended.revenue.pMedian / planningPeriod;
      const dailyLow = f.blended.revenue.pLow / planningPeriod;
      const dailyHigh = f.blended.revenue.pHigh / planningPeriod;
      
      const maxHistDate = new Date(sortedDates[sortedDates.length - 1]);
      for (let day = 1; day <= planningPeriod; day++) {
        const nextD = new Date(maxHistDate);
        nextD.setDate(maxHistDate.getDate() + day);
        const dateStr = nextD.toISOString().split('T')[0];
        forecastDatesMap[dateStr] = { p10: dailyLow, p50: dailyMedian, p90: dailyHigh };
      }
    }
    
    const forecastDates = Object.keys(forecastDatesMap).sort();
    const labels = chartHistoryRange.concat(forecastDates);
    
    const emptyForecastPadding = Array(forecastDates.length).fill(null);
    const histDataPoints = histRevenues.concat(emptyForecastPadding);
    const hist7DayDataPoints = histRevenues7DayAvg.concat(emptyForecastPadding);

    const emptyHistPadding = Array(chartHistoryRange.length).fill(null);
    const startPoint = histRevenues7DayAvg[histRevenues7DayAvg.length - 1];
    
    const forecastMedianPoints = emptyHistPadding.concat([startPoint]).concat(forecastDates.map(d => forecastDatesMap[d].p50));
    const forecastLowPoints = emptyHistPadding.concat([startPoint]).concat(forecastDates.map(d => forecastDatesMap[d].p10));
    const forecastHighPoints = emptyHistPadding.concat([startPoint]).concat(forecastDates.map(d => forecastDatesMap[d].p90));

    const flatFillColor = isLight ? 'rgba(99, 91, 255, 0.04)' : 'rgba(0, 212, 255, 0.04)';

    window.forecastDailyChart = state.chartInstances.forecastDaily = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Historical Revenue',
            data: histDataPoints,
            borderColor: 'rgba(148, 163, 184, 0.25)',
            borderWidth: 1,
            pointRadius: 0,
            tension: 0.4,
            fill: false
          },
          {
            label: 'Historical (7d Rolling Mean)',
            data: hist7DayDataPoints,
            borderColor: '#94A3B8',
            borderWidth: 1.5,
            borderDash: [4, 4],
            pointRadius: 0,
            tension: 0.4,
            fill: false
          },
          {
            label: 'Forecast Expected',
            data: forecastMedianPoints,
            borderColor: '#3B82F6',
            borderWidth: 2.5,
            pointRadius: 0,
            tension: 0.4,
            fill: true,
            backgroundColor: (() => {
              const grad = ctx.createLinearGradient(0, 0, 0, 300);
              grad.addColorStop(0, 'rgba(59, 130, 246, 0.12)');
              grad.addColorStop(1, 'rgba(59, 130, 246, 0)');
              return grad;
            })()
          },
          {
            label: 'Forecast Optimistic (P90)',
            data: forecastHighPoints,
            borderColor: '#6366F1',
            borderWidth: 1,
            borderDash: [3, 3],
            pointRadius: 0,
            tension: 0.4,
            fill: false
          },
          {
            label: 'Forecast Confidence Band',
            data: forecastLowPoints,
            borderColor: 'rgba(99, 102, 241, 0.25)',
            borderWidth: 1,
            borderDash: [3, 3],
            pointRadius: 0,
            tension: 0.4,
            backgroundColor: 'rgba(99, 102, 241, 0.02)',
            fill: '-1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: tickColor,
              font: { family: 'Plus Jakarta Sans', size: 11 }
            }
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: isLight ? '#0F172A' : '#141826',
            borderColor: gridColor,
            borderWidth: 1,
            titleFont: { family: 'Plus Jakarta Sans', weight: 'bold' },
            bodyFont: { family: 'Plus Jakarta Sans' }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: tickColor,
              font: { family: 'Plus Jakarta Sans', size: 10 },
              maxTicksLimit: 15
            }
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: tickColor,
              font: { family: 'Plus Jakarta Sans', size: 10 },
              callback: (value) => getCurrencySymbol() + value.toLocaleString()
            }
          }
        }
      }
    });
  }

  function renderContributionChart() {
    const canvas = document.getElementById('contributionChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (window.contributionChart && window.contributionChart.destroy) {
      window.contributionChart.destroy();
    }
    if (state.chartInstances.contribution && state.chartInstances.contribution.destroy) {
      state.chartInstances.contribution.destroy();
    }

    const f = state.forecastResults;
    const channels = Object.keys(f.channels);
    const shares = channels.map(c => f.channels[c].revenue.pMedian);
    const isLight = document.body.classList.contains('light-mode');
    const tickColor = isLight ? '#475569' : '#94A3B8';
    const gridColor = isLight ? '#ECEFF3' : '#1E2538';

    // Glowing coding colors
    const colors = channels.map(c => {
      if (c.toLowerCase().includes('google')) return '#00D4FF'; // Cyberpunk Cyan
      if (c.toLowerCase().includes('meta')) return '#3ECF8E';   // Neon Green
      return '#FF79B0'; // Neon Pink/Purple for Microsoft
    });

    window.contributionChart = state.chartInstances.contribution = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: channels,
        datasets: [{
          data: shares,
          backgroundColor: colors,
          borderColor: isLight ? '#FFFFFF' : '#141826',
          borderWidth: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: tickColor,
              boxWidth: 14,
              font: { family: 'Plus Jakarta Sans', size: 12, weight: '500' }
            }
          },
          tooltip: {
            backgroundColor: isLight ? '#0F172A' : '#141826',
            borderColor: gridColor,
            borderWidth: 1,
            callbacks: {
              label: (item) => {
                const total = item.dataset.data.reduce((a,b)=>a+b, 0);
                const percent = ((item.raw / total) * 100).toFixed(1);
                 return ` ${item.label}: ${getCurrencySymbol()}${Math.round(item.raw).toLocaleString()} (${percent}%)`;
              }
            }
          }
        }
      }
    });
  }

  function renderRoasChart() {
    const canvas = document.getElementById('roasChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (window.roasChart && window.roasChart.destroy) {
      window.roasChart.destroy();
    }
    if (state.chartInstances.roas && state.chartInstances.roas.destroy) {
      state.chartInstances.roas.destroy();
    }

    const f = state.forecastResults;
    const channels = Object.keys(f.channels);
    const isLight = document.body.classList.contains('light-mode');
    const tickColor = isLight ? '#475569' : '#94A3B8';
    const gridColor = isLight ? '#ECEFF3' : '#1E2538';
    
    const expectedData = channels.map(c => f.channels[c].roas.pMedian);
    const lowData = channels.map(c => f.channels[c].roas.pLow);
    const highData = channels.map(c => f.channels[c].roas.pHigh);

    // Glowing neon confidence parameters
    const cP10 = '#F25C5C'; // Neon Red
    const cP50 = '#7971FF'; // Neon Indigo
    const cP90 = '#3ECF8E'; // Neon Green

    window.roasChart = state.chartInstances.roas = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: channels,
        datasets: [
          {
            label: 'Pessimistic ROAS (P10)',
            data: lowData,
            backgroundColor: cP10,
            borderColor: cP10,
            borderWidth: 1,
            borderRadius: 4
          },
          {
            label: 'Expected ROAS (P50)',
            data: expectedData,
            backgroundColor: cP50,
            borderColor: cP50,
            borderWidth: 1,
            borderRadius: 4
          },
          {
            label: 'Optimistic ROAS (P90)',
            data: highData,
            backgroundColor: cP90,
            borderColor: cP90,
            borderWidth: 1,
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y', // Makes it horizontal
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: tickColor,
              font: { family: 'Plus Jakarta Sans', size: 11 }
            }
          },
          tooltip: {
            backgroundColor: isLight ? '#0F172A' : '#141826',
            borderColor: gridColor,
            borderWidth: 1,
            callbacks: {
              label: (item) => ` ${item.dataset.label}: ${item.raw.toFixed(2)}x`
            }
          }
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: {
              color: tickColor,
              font: { family: 'Plus Jakarta Sans', size: 11 },
              callback: (value) => value + 'x'
            }
          },
          y: {
            grid: { display: false },
            ticks: {
              color: tickColor,
              font: { family: 'Plus Jakarta Sans', size: 11, weight: '600' }
            }
          }
        }
      }
    });
  }

  // Draw empty state mock background grids for canvas components initially
  document.querySelectorAll('.chart-container').forEach(c => c.classList.add('is-empty'));

  // 13. Scroll Reveal Animation setup
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, {
    root: null,
    threshold: 0.15,
    rootMargin: "0px 0px -50px 0px"
  });

  // Re-run observer setup when tabs change or data loads
  window.setupScrollReveals = () => {
    document.querySelectorAll('.reveal:not(.visible)').forEach(el => {
      revealObserver.observe(el);
    });
  };
  
  // Initial setup
  window.setupScrollReveals();

});
