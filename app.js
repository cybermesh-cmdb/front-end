
// Em desenvolvimento local: aponta diretamente para o backend em :3000
// Em Docker/produção: o Nginx faz proxy de /api → backend:3000, então usa path relativo
const DEFAULT_API_BASE = (() => {
  // Se não estiver em localhost/127.0.0.1, usa path relativo (produção via Nginx)
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return `${window.location.protocol}//${host}:3001/api`;
  }
  return '/api';
})();

    const catalogs = {
      assetTypes: [],
      assetCriticalities: [],
      tenants: [],
      contactTypes: [],
      productVendors: [],
      productNames: []
    };

    let visibleCIs = [];
    let totalCIs = 0;
    let currentPage = 1;
    let pageSize = 10;
    let toastTimer;
    let searchDebounceTimer;
    let currentDetailAssetId = null;
    let dynamicTagsData = [];
    let selectedContactData = null;
    let activeDashboardQuickFilter = null;
    let editingTenantId = null;
    let detailEditMode = false;
    let detailAssetDraft = null;
    let detailTags = [];
    let detailTagsDraft = [];
    let dashboardAttentionRows = [];
    let dashboardAttentionOpen = false;
    let dashboardLastSuccessAt = null;
    let dashboardLastDataAt = null;
    let dashboardStatusState = 'idle';
    let dashboardStatusMonitorTimer = null;
    let ciLoadRequestSeq = 0;
    let confirmDialogState = {
      resolve: null,
      title: '',
      message: '',
      confirmText: 'Excluir',
      variant: 'danger'
    };
    let ciSortState = { key: null, direction: 'asc' };
    const dashboardCharts = {
      status: null,
      criticality: null,
      types: null,
      trend: null
    };
    let contactCurrentPage = 1;
    let contactPageSize = 10;
    let lecLogsList = [];
    let lecLogsFilteredList = [];
    const REQUIRED_ASSET_FIELDS = ['asset-name', 'asset-type', 'asset-criticality', 'asset-tenant'];

    function v(id) {
      return document.getElementById(id)?.value.trim() || '';
    }

    function showConfirmDialog({ title, message, confirmText = 'Excluir', variant = 'danger' }) {
      const modal = document.getElementById('confirmModal');
      const titleElement = document.getElementById('confirm-modal-title');
      const messageElement = document.getElementById('confirm-modal-message');
      const button = document.getElementById('confirmModalActionBtn');

      if (!modal || !titleElement || !messageElement || !button) {
        return Promise.resolve(window.confirm(message || title || 'Confirmar ação?'));
      }

      if (confirmDialogState.resolve) {
        confirmDialogState.resolve(false);
      }

      confirmDialogState = {
        resolve: null,
        title,
        message,
        confirmText,
        variant
      };

      titleElement.textContent = title || 'Confirmar ação';
      messageElement.textContent = message || '';
      button.textContent = confirmText || 'Excluir';
      button.classList.toggle('danger', variant === 'danger');
      button.classList.toggle('primary', variant !== 'danger');

      modal.classList.add('show');
      modal.setAttribute('aria-hidden', 'false');

      return new Promise((resolve) => {
        confirmDialogState.resolve = resolve;
      });
    }

    function closeConfirmDialog(result = false) {
      const modal = document.getElementById('confirmModal');
      if (modal) {
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
      }
      if (confirmDialogState.resolve) {
        const resolve = confirmDialogState.resolve;
        confirmDialogState.resolve = null;
        resolve(result);
      }
    }

    function esc(value) {
      const div = document.createElement('div');
      div.textContent = String(value ?? '');
      return div.innerHTML;
    }

    function normalizeText(value) {
      return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    }

    const ALLOWED_DASHBOARD_TENANTS = new Set([
      '01060007-cimatec',
      '01110006-atvos',
      '01160009-berneck',
      '01190002-lncc',
      '01250000-cybermesh',
      '01250001-indovinya',
      '01250003-blau',
      '01250004-adeste',
      '01250005-gdmsementes',
      '01250010-semantix'
    ]);

    function isAllowedDashboardTenant(tenantName) {
      return ALLOWED_DASHBOARD_TENANTS.has(String(tenantName || '').trim().toLowerCase());
    }

    function normalizeStatusValue(value) {
      const normalized = normalizeText(value);
      const map = {
        ativo: 'active',
        active: 'active',
        inativo: 'disconnected',
        inactive: 'disconnected',
        desconectado: 'disconnected',
        disconnected: 'disconnected',
        manutencao: 'pending',
        maintenance: 'pending',
        planejado: 'pending',
        planned: 'pending',
        pendente: 'pending',
        pending: 'pending',
        desativado: 'never_connected',
        retired: 'never_connected',
        'never connected': 'never_connected',
        'never-connected': 'never_connected',
        never_connected: 'never_connected'
      };
      return map[normalized] || normalized;
    }

    function getBase() {
      return DEFAULT_API_BASE;
    }

    function updateSearchPlaceholder() {
      const field = document.getElementById('searchField')?.value || 'name';
      const searchInput = document.getElementById('searchQ');
      if (!searchInput) return;

      const placeholderByField = {
        name: 'Pesquisar pelo nome do ativo',
        ip: 'Pesquisar pelo IP do ativo',
        hostname: 'Pesquisar pelo hostname do ativo',
        product: 'Pesquisar pelo produto do ativo',
        id_external: 'Pesquisar pelo ID do ativo'
      };

      searchInput.placeholder = placeholderByField[field] || placeholderByField.name;
    }

    function toast(message, type = 'success') {
      const element = document.getElementById('toast');
      clearTimeout(toastTimer);
      element.textContent = message;
      element.className = `toast show ${type}`;
      toastTimer = window.setTimeout(() => {
        element.className = 'toast';
      }, 3200);
    }

    function formatDate(value) {
      if (!value) return '-';
      try {
        return new Date(value).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch {
        return value;
      }
    }

    function tipoPill(tipo) {
      const normalizedType = normalizeText(tipo);
      const map = {
        servidor: '<span class="pill tipo-srv">Servidor</span>',
        server: '<span class="pill tipo-srv">Servidor</span>',
        rede: '<span class="pill tipo-net">Rede</span>',
        network: '<span class="pill tipo-net">Rede</span>',
        banco: '<span class="pill tipo-db">Banco</span>',
        database: '<span class="pill tipo-db">Banco</span>',
        application: '<span class="pill">Aplicacao</span>'
      };
      return map[normalizedType] || `<span class="pill">${esc(tipo || '-')}</span>`;
    }

    function criticalityPill(value) {
      const map = {
        low: '<span class="pill">Baixa</span>',
        medium: '<span class="pill">Media</span>',
        high: '<span class="pill manutencao">Alta</span>',
        critical: '<span class="pill inativo">Critica</span>'
      };
      return map[value] || `<span class="pill">${esc(value || '-')}</span>`;
    }

    function statusPill(status) {
      const normalizedStatus = normalizeStatusValue(status);
      const map = {
        active: '<span class="pill ativo">Active</span>',
        disconnected: '<span class="pill inativo">Disconnected</span>',
        pending: '<span class="pill manutencao">Pending</span>',
        never_connected: '<span class="pill neutro">Never connected</span>'
      };
      return map[normalizedStatus] || `<span class="pill">${esc(status || '-')}</span>`;
    }

    function formatCompactNumber(value) {
      return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
    }

    function extractCriticalityLevel(asset) {
      if (asset.criticalityId) return Number(asset.criticalityId);
      const match = String(asset.criticalityName || '').match(/(\d+)/);
      return match ? Number(match[1]) : null;
    }

    function buildStatusDistribution(assets) {
      const labels = {
        active: 'Active',
        disconnected: 'Disconnected',
        pending: 'Pending',
        never_connected: 'Never connected'
      };
      const colors = {
        active: '#10b981',
        disconnected: '#ef4444',
        pending: '#f59e0b',
        never_connected: '#94a3b8'
      };
      const order = ['active', 'disconnected', 'pending', 'never_connected'];
      const counts = Object.fromEntries(order.map((key) => [key, 0]));

      assets.forEach((asset) => {
        const key = order.includes(asset.status) ? asset.status : 'disconnected';
        counts[key] += 1;
      });

      return order.map((key) => ({
        key,
        label: labels[key],
        color: colors[key],
        value: counts[key]
      }));
    }

    function toEpoch(value) {
      if (!value) return 0;
      const parsed = new Date(value).getTime();
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function buildAttentionByTenant(assets) {
      const grouped = new Map();

      assets
        .filter((asset) => asset.status !== 'active')
        .forEach((asset) => {
          const tenantId = asset.tenantId ? Number(asset.tenantId) : null;
          const tenantName = String(asset.tenantName || '').trim() || 'Tenant não informado';

          // Filtra somente os tenants oficiais do dashboard.
          if (!isAllowedDashboardTenant(tenantName)) {
            return;
          }

          const key = tenantId ? `tenant:${tenantId}` : `name:${tenantName.toLowerCase()}`;
          const timestamp = toEpoch(asset.updatedAt || asset.createdAt);
          const current = grouped.get(key) || {
            tenantId,
            tenantName,
            count: 0,
            latestAt: null,
            latestTimestamp: 0,
            latestAssetName: '-'
          };

          current.count += 1;
          if (timestamp >= current.latestTimestamp) {
            current.latestTimestamp = timestamp;
            current.latestAt = asset.updatedAt || asset.createdAt || null;
            current.latestAssetName = asset.name || '-';
          }

          grouped.set(key, current);
        });

      return [...grouped.values()]
        .sort((left, right) => {
          if (right.count !== left.count) return right.count - left.count;
          return right.latestTimestamp - left.latestTimestamp;
        });
    }

    function renderAttentionByTenant(rows, totalAttention = 0) {
      const list = document.getElementById('dashboardAttentionList');
      const empty = document.getElementById('dashboardAttentionEmpty');
      if (!list || !empty) return;

      if (!rows.length) {
        list.hidden = true;
        list.innerHTML = '';
        empty.hidden = false;
        return;
      }

      empty.hidden = true;
      list.hidden = false;
      list.innerHTML = rows.map((row) => {
        const hasTenantId = Number.isInteger(row.tenantId) && row.tenantId > 0;
        const clickAttrs = hasTenantId
          ? ` class="attention-item clickable" role="button" tabindex="0" data-tenant-id="${row.tenantId}"`
          : ' class="attention-item"';
        return `
          <article${clickAttrs}>
            <div class="attention-tenant">
              <span class="attention-tenant-name" title="${esc(row.tenantName)}">${esc(row.tenantName)}</span>
            </div>
            <div class="attention-count">${formatCompactNumber(row.count)}</div>
            <div class="attention-recent">
              <span class="attention-recent-asset" title="${esc(row.latestAssetName)}">${esc(row.latestAssetName)}</span>
              <span class="attention-recent-time">Mais recente: ${esc(formatDate(row.latestAt))}</span>
            </div>
          </article>
        `;
      }).join('');
    }

    function buildKPIsByTenant(assets) {
      const grouped = new Map();

      assets.forEach((asset) => {
        const tenantId = asset.tenantId ? Number(asset.tenantId) : null;
        const tenantName = String(asset.tenantName || '').trim() || 'Tenant não informado';

        // Filtra somente os tenants oficiais do dashboard.
        if (!isAllowedDashboardTenant(tenantName)) {
          return;
        }

        const key = tenantId ? `tenant:${tenantId}` : `name:${tenantName.toLowerCase()}`;

        const current = grouped.get(key) || {
          tenantId,
          tenantName,
          total: 0,
          active: 0,
          attention: 0,
          lec: 0,
          latestFailedAssetName: '-',
          latestFailedAt: null,
          latestFailedTimestamp: 0
        };

        current.total += 1;
        if (asset.status === 'active') {
          current.active += 1;
        } else {
          current.attention += 1;
        }
        if (Number(asset.lec || 0) === 1) {
          current.lec += 1;
        }

        // Rastreia o último ativo que parou de funcionar (status !== 'active')
        if (asset.status !== 'active') {
          const timestamp = toEpoch(asset.updatedAt || asset.createdAt);
          if (timestamp >= current.latestFailedTimestamp) {
            current.latestFailedTimestamp = timestamp;
            current.latestFailedAt = asset.updatedAt || asset.createdAt || null;
            current.latestFailedAssetName = asset.name || '-';
          }
        }

        grouped.set(key, current);
      });

      return [...grouped.values()]
        .sort((left, right) => {
          if (right.attention !== left.attention) return right.attention - left.attention;
          return right.total - left.total;
        });
    }

    function renderTenantsCards(kpiRows) {
      const section = document.getElementById('dashboardTenantsSection');
      if (!section) return;

      if (!kpiRows || kpiRows.length === 0) {
        section.innerHTML = `
          <article class="card dashboard-card" style="grid-column: 1/-1">
            <div class="card-header">
              <div>
                <div class="card-title">KPIs por Tenant</div>
                <div class="card-subtitle">Nenhum tenant com dados disponíveis.</div>
              </div>
            </div>
          </article>
        `;
        return;
      }

      const tenantsWithAttention = kpiRows.filter(row => row.attention > 0);
      if (tenantsWithAttention.length === 0) {
        section.innerHTML = `
          <article class="card dashboard-card" style="grid-column: 1/-1">
            <div class="card-header">
              <div>
                <div class="card-title">KPIs por Tenant</div>
                <div class="card-subtitle">Nenhum tenant com ativos que exigem atenção.</div>
              </div>
            </div>
          </article>
        `;
        return;
      }

      section.innerHTML = tenantsWithAttention
        .map((row) => {
          const encodedTenantName = encodeURIComponent(String(row.tenantName || ''));
          return `
        <article class="card dashboard-card tenant-kpi-card ${row.attention > 0 ? 'has-attention' : ''}">
       
          <div class="tenant-kpi-header">
            <div class="tenant-kpi-name">${esc(row.tenantName)}</div>
            <div class="tenant-kpi-top-counts">
              <div class="tenant-kpi-top-count">
                <div class="top-count-label">TOTAL</div>
                <div class="top-count-value total">${formatCompactNumber(row.total)}</div>
              </div>
              <div class="tenant-kpi-top-count">
                <span class="metric-label">Atenção</span>
              <span class="metric-value attention">${formatCompactNumber(row.attention)}</span>
              </div>
            </div>
          </div>
                    
          <div class="tenant-kpi-recent">
            <span class="recent-asset">Último que parou: ${esc(row.latestFailedAssetName)}</span>
            <span class="recent-time">${esc(formatDate(row.latestFailedAt))}</span>
          </div>

         
        </article>
      `;
        }).join('');
    }

    
    function buildCriticalityBands(assets) {
      const bands = [
        { key: 'critical', label: 'Crítica', range: 'Níveis 15 e 16', color: '#ef4444', count: 0 },
        { key: 'high', label: 'Alta', range: 'Níveis 12 a 14', color: '#f59e0b', count: 0 },
        { key: 'medium', label: 'Média', range: 'Níveis 7 a 11', color: '#60a5fa', count: 0 },
        { key: 'low', label: 'Baixa', range: 'Níveis 1 a 6', color: '#10b981', count: 0 }
      ];

      assets.forEach((asset) => {
        const level = extractCriticalityLevel(asset);
        if (!level) return;
        if (level >= 15) bands[0].count += 1;
        else if (level >= 12) bands[1].count += 1;
        else if (level >= 7) bands[2].count += 1;
        else bands[3].count += 1;
      });

      return bands;
    }

    function buildTopGroups(assets, getter, limit = 5) {
      const grouped = new Map();
      assets.forEach((asset) => {
        const key = getter(asset) || 'Não informado';
        grouped.set(key, (grouped.get(key) || 0) + 1);
      });
      return [...grouped.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((left, right) => right.value - left.value)
        .slice(0, limit);
    }

    function buildRecentTrend(assets, days = 7) {
      const formatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
      const buckets = [];
      for (let offset = days - 1; offset >= 0; offset -= 1) {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() - offset);
        buckets.push({
          key: date.toISOString().slice(0, 10),
          label: formatter.format(date),
          value: 0
        });
      }

      const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));
      assets.forEach((asset) => {
        const sourceDate = asset.createdAt || asset.updatedAt;
        if (!sourceDate) return;
        const key = new Date(sourceDate).toISOString().slice(0, 10);
        const bucket = bucketMap.get(key);
        if (bucket) bucket.value += 1;
      });
      return buckets;
    }

    function buildQualitySummary(assets) {
      const totalAssets = assets.length || 0;
      const missingCriticality = assets.filter((asset) => !extractCriticalityLevel(asset)).length;
      const missingTenant = assets.filter((asset) => !String(asset.raw?.tenant_id || asset.raw?.fk_tenant || '').trim()).length;
      const missingType = assets.filter((asset) => !asset.typeName || asset.typeName === '-').length;
      const missingConnectivity = assets.filter((asset) => (!asset.ip || asset.ip === '-') && (!asset.hostname || asset.hostname === '-')).length;

      const rules = [
        { label: 'Sem criticidade', value: missingCriticality, severity: 'Alta', filter: 'missing_criticality' },
        { label: 'Sem tenant responsável', value: missingTenant, severity: 'Alta', filter: 'missing_tenant' },
        { label: 'Sem tipo de ativo', value: missingType, severity: 'Média', filter: 'missing_type' },
        { label: 'Sem IP e sem hostname', value: missingConnectivity, severity: 'Alta', filter: 'missing_connectivity' }
      ];

      const rulesWithImpact = rules.map((rule) => ({
        ...rule,
        impact: totalAssets ? Math.round((rule.value / totalAssets) * 100) : 0
      }));

      const weightedMaximum = totalAssets * 100;
      const weightedPenalty = rulesWithImpact.reduce((sum, rule) => {
        const weight = rule.severity === 'Alta' ? 1.3 : 1;
        return sum + (rule.impact * weight);
      }, 0);
      const completionRate = totalAssets
        ? Math.max(0, Math.round(100 - (weightedPenalty / (rulesWithImpact.length * 1.3))))
        : 0;

      let status = 'Sem dados';
      let note = 'Carregue ativos para calcular o índice de confiabilidade.';
      if (totalAssets > 0) {
        if (completionRate >= 90) {
          status = 'Excelente';
          note = 'Base consistente para operação, risco e auditoria.';
        } else if (completionRate >= 75) {
          status = 'Boa';
          note = 'Há poucos pontos de atenção; priorize completar campos críticos.';
        } else if (completionRate >= 55) {
          status = 'Atenção';
          note = 'Pendências já impactam análises e decisão operacional.';
        } else {
          status = 'Crítica';
          note = 'Confiabilidade baixa: saneamento de dados é prioridade imediata.';
        }
      }

      return {
        completionRate,
        status,
        note,
        items: rulesWithImpact
      };
    }

    function buildPrioritySummary(assets) {
      const criticalAssets = assets.filter((asset) => (extractCriticalityLevel(asset) || 0) >= 9);
      const criticalOutage = criticalAssets.filter((asset) => asset.status !== 'active').length;
      const pendingAssets = assets.filter((asset) => asset.status === 'pending').length;
      const disconnectedAssets = assets.filter((asset) => asset.status === 'disconnected' || asset.status === 'never_connected').length;
      const noCriticality = assets.filter((asset) => !extractCriticalityLevel(asset)).length;
      const noConnectivity = assets.filter((asset) => (!asset.ip || asset.ip === '-') && (!asset.hostname || asset.hostname === '-')).length;
      const total = assets.length || 0;

      const withImpact = (value) => ({
        value,
        impact: total ? Math.round((value / total) * 100) : 0
      });

      const criticalOutageData = withImpact(criticalOutage);
      const pendingData = withImpact(pendingAssets);
      const disconnectedData = withImpact(disconnectedAssets);
      const noCriticalityData = withImpact(noCriticality);
      const noConnectivityData = withImpact(noConnectivity);

      return [
        {
          title: 'Críticos fora de operação',
          value: criticalOutageData.value,
          impact: criticalOutageData.impact,
          badge: 'P1',
          filter: 'critical_outage',
          note: 'Ativos de alto impacto indisponíveis agora.'
        },
        {
          title: 'Ativos em pending',
          value: pendingData.value,
          impact: pendingData.impact,
          badge: 'P2',
          filter: 'pending',
          note: 'Pode indicar fila de ativação/configuração.'
        },
        {
          title: 'Disconnected ou never connected',
          value: disconnectedData.value,
          impact: disconnectedData.impact,
          badge: 'P2',
          filter: 'disconnected_or_never_connected',
          note: 'Sinaliza perda de comunicação ou onboarding pendente.'
        },
        {
          title: 'Sem criticidade definida',
          value: noCriticalityData.value,
          impact: noCriticalityData.impact,
          badge: 'Qualidade',
          filter: 'no_criticality',
          note: 'Sem classificação de risco, decisão fica cega.'
        },
        {
          title: 'Sem IP e sem hostname',
          value: noConnectivityData.value,
          impact: noConnectivityData.impact,
          badge: 'Qualidade',
          filter: 'no_connectivity',
          note: 'Baixa rastreabilidade técnica dos ativos.'
        }
      ];
    }

    function destroyDashboardChart(key) {
      if (dashboardCharts[key]) {
        dashboardCharts[key].destroy();
        dashboardCharts[key] = null;
      }
    }

    function hasChartSupport() {
      return typeof Chart !== 'undefined';
    }

    function showChartFallback(canvasId, message) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const shell = canvas.parentElement;
      if (!shell) return;
      shell.innerHTML = `<div class="legend-empty">${esc(message)}</div>`;
    }

    function getChartTheme() {
      return {
        grid: 'rgba(167, 139, 250, 0.12)',
        tick: '#b8add5',
        text: '#f0eaff',
        teal: '#14b8a6',
        blue: '#60a5fa',
        amber: '#f59e0b',
        orange: '#f97316',
        red: '#ef4444',
        purple: '#8b5cf6'
      };
    }

    function renderDashboardStatusChart(distribution) {
      const canvas = document.getElementById('dashboardStatusCanvas');
      const total = distribution.reduce((sum, item) => sum + item.value, 0);
      document.getElementById('dashboardStatusTotal').textContent = formatCompactNumber(total);
      destroyDashboardChart('status');

      if (!hasChartSupport()) {
        document.getElementById('dashboardStatusLegend').innerHTML = '<div class="legend-empty">Biblioteca de gráficos indisponível no momento.</div>';
        return;
      }

      if (!total) {
        document.getElementById('dashboardStatusChart').classList.add('status-donut-empty');
        document.getElementById('dashboardStatusLegend').innerHTML = '<div class="legend-empty">Sem dados suficientes para distribuição.</div>';
        return;
      }

      document.getElementById('dashboardStatusChart').classList.remove('status-donut-empty');
      const theme = getChartTheme();
      dashboardCharts.status = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: distribution.map((item) => item.label),
          datasets: [{
            data: distribution.map((item) => item.value),
            backgroundColor: distribution.map((item) => item.color),
            borderWidth: 0,
            hoverOffset: 6,
            spacing: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '72%',
          onClick(event, elements) {
            if (!elements.length) return;
            const index = elements[0].index;
            const item = distribution[index];
            if (!item?.key) return;
            openConsultaWithDashboardFilter('status', item.key, item.label || 'Status operacional');
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(11, 8, 21, 0.96)',
              borderColor: theme.grid,
              borderWidth: 1,
              titleColor: theme.text,
              bodyColor: theme.text,
              callbacks: {
                label(context) {
                  const value = Number(context.raw || 0);
                  const percentage = total ? Math.round((value / total) * 100) : 0;
                  return `${formatCompactNumber(value)} ativos (${percentage}%)`;
                }
              }
            }
          }
        }
      });

      document.getElementById('dashboardStatusLegend').innerHTML = distribution.map((item) => {
        const percentage = total ? Math.round((item.value / total) * 100) : 0;
        return `
          <div class="legend-row" data-filter-kind="status" data-filter-value="${esc(item.key)}" style="cursor:pointer" title="Clique para filtrar por ${esc(item.label)}">
            <span class="legend-dot" style="background:${item.color}"></span>
            <div class="legend-copy">
              <span class="legend-label">${esc(item.label)}</span>
              <span class="legend-meta">${formatCompactNumber(item.value)} ativos • ${percentage}%</span>
            </div>
          </div>
        `;
      }).join('');

      document.getElementById('dashboardStatusLegend').addEventListener('click', (event) => {
        const row = event.target.closest('[data-filter-kind][data-filter-value]');
        if (!row) return;
        const kind = row.dataset.filterKind;
        const value = row.dataset.filterValue;
        const label = row.querySelector('.legend-label')?.textContent || 'Status';
        openConsultaWithDashboardFilter(kind, value, label);
      });
    }

    function renderCriticalityBands(bands) {
      destroyDashboardChart('criticality');
      const container = document.getElementById('dashboardCriticalityBands');
      if (!container) {
        return;
      }

      if (!bands.length) {
        container.innerHTML = '<div class="legend-empty">Sem dados suficientes para criticidade.</div>';
        return;
      }

      container.innerHTML = bands.map((band) => `
        <article class="criticality-band-card" role="button" tabindex="0" data-filter-kind="criticality_band" data-filter-value="${esc(band.key)}">
          <div class="criticality-band-title">${esc(band.label)}</div>
          <div class="criticality-band-value" style="color:${esc(band.color)}">${formatCompactNumber(band.count)}</div>
          <div class="criticality-band-range">${esc(band.range)}</div>
        </article>
      `).join('');
    }

    function renderTypesChart(items) {
      const canvas = document.getElementById('dashboardTypesCanvas');
      destroyDashboardChart('types');
      if (!hasChartSupport()) {
        showChartFallback('dashboardTypesCanvas', 'Biblioteca de gráficos indisponível no momento.');
        return;
      }
      if (!items.length) {
        return;
      }
      const theme = getChartTheme();
      dashboardCharts.types = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: items.map((item) => item.label),
          datasets: [{
            label: 'Ativos',
            data: items.map((item) => item.value),
            backgroundColor: ['#8b5cf6', '#60a5fa', '#14b8a6', '#f59e0b', '#ef4444'],
            borderRadius: 10,
            borderSkipped: false
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(11, 8, 21, 0.96)',
              borderColor: theme.grid,
              borderWidth: 1,
              titleColor: theme.text,
              bodyColor: theme.text
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              ticks: { color: theme.tick, precision: 0 },
              grid: { color: theme.grid }
            },
            y: {
              ticks: { color: theme.text, font: { size: 12 } },
              grid: { display: false }
            }
          }
        }
      });
    }

    function renderTrendChart(items) {
      const canvas = document.getElementById('dashboardTrendCanvas');
      destroyDashboardChart('trend');
      if (!hasChartSupport()) {
        showChartFallback('dashboardTrendCanvas', 'Biblioteca de gráficos indisponível no momento.');
        return;
      }
      if (!items.length) {
        return;
      }
      const theme = getChartTheme();
      dashboardCharts.trend = new Chart(canvas, {
        type: 'line',
        data: {
          labels: items.map((item) => item.label),
          datasets: [{
            label: 'Cadastros',
            data: items.map((item) => item.value),
            borderColor: theme.blue,
            backgroundColor: 'rgba(96, 165, 250, 0.18)',
            pointBackgroundColor: theme.teal,
            pointBorderColor: '#0f0b1e',
            pointRadius: 4,
            pointHoverRadius: 5,
            borderWidth: 3,
            tension: 0.35,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(11, 8, 21, 0.96)',
              borderColor: theme.grid,
              borderWidth: 1,
              titleColor: theme.text,
              bodyColor: theme.text
            }
          },
          scales: {
            x: {
              ticks: { color: theme.tick },
              grid: { color: theme.grid }
            },
            y: {
              beginAtZero: true,
              ticks: { color: theme.tick, precision: 0 },
              grid: { color: theme.grid }
            }
          }
        }
      });
    }

    function renderQualitySummary(summary) {
      document.getElementById('dashboardQualityScore').textContent = `${summary.completionRate}%`;
      document.getElementById('dashboardQualityBar').style.width = `${summary.completionRate}%`;
      document.getElementById('dashboardQualityStatus').textContent = summary.status || 'Sem dados';
      document.getElementById('dashboardQualityNote').textContent = summary.note || '';
      document.getElementById('dashboardQualityInsights').innerHTML = summary.items.map((item) => `
        <article class="insight-card" role="button" tabindex="0" data-filter-kind="quality_issue" data-filter-value="${esc(item.filter || '')}">
          <div class="insight-label">${esc(item.label)}</div>
          <div class="insight-value">${formatCompactNumber(item.value)}</div>
          <div class="insight-meta">Impacto em ${formatCompactNumber(item.impact)}% dos ativos • Severidade ${esc(item.severity)}</div>
        </article>
      `).join('');
    }

    function renderPrioritySummary(items) {
      document.getElementById('dashboardPriorityList').innerHTML = items.map((item) => `
        <article class="priority-item" role="button" tabindex="0" data-filter-kind="priority_focus" data-filter-value="${esc(item.filter || '')}">
          <div class="priority-head">
            <span class="priority-title">${esc(item.title)} <span class="priority-badge">${esc(item.badge || '')}</span></span>
            <span class="priority-value">${formatCompactNumber(item.value)}</span>
          </div>
          <div class="priority-note">${esc(item.note)} • Impacto ${formatCompactNumber(item.impact || 0)}%</div>
        </article>
      `).join('');
    }

    function openConsultaWithDashboardFilter(kind, value, label) {
      if (!kind || !value) return;
      activeDashboardQuickFilter = { kind, value, label: label || '' };
      showSection('consulta', { skipAutoLoad: true });
      loadCIs({ resetPage: true });
      toast(`Filtro aplicado: ${label || 'Dashboard'}`);
    }

    function openConsultaForTenant(tenantName) {
      const normalizedTenantName = String(tenantName || '').trim();
      if (!normalizedTenantName) return;

      clearDashboardQuickFilter();

      const tenantFilter = document.getElementById('filterTenant');
      const statusFilter = document.getElementById('filterStatus');
      if (tenantFilter) {
        const targetName = normalizedTenantName.toLowerCase();
        const matchedTenant = (catalogs.tenants || []).find((tenant) => {
          const candidate = String(tenant?.name ?? tenant?.label ?? '').trim().toLowerCase();
          return candidate === targetName;
        });

        tenantFilter.value = matchedTenant
          ? String(matchedTenant.id ?? matchedTenant.value ?? matchedTenant.name)
          : '';
      }

      if (statusFilter) {
        statusFilter.value = 'attention';
      }

      showSection('consulta', { skipAutoLoad: true });
      loadCIs({ resetPage: true });
      toast(`Consulta aberta para ${normalizedTenantName}`);
    }

    function clearDashboardQuickFilter() {
      activeDashboardQuickFilter = null;
    }

    function updateDashboardStatus(message, state = 'idle', blink = false) {
      const element = document.getElementById('dashboardStatus');
      if (!element) return;
      element.textContent = message;
      element.classList.remove('state-idle', 'state-ok', 'state-warn', 'state-error', 'is-blink');
      element.classList.add(`state-${state}`);
      if (blink) {
        element.classList.add('is-blink');
      }
    }

    function resolveLatestAssetTimestamp(assets) {
      const timestamps = assets
        .map((asset) => toEpoch(asset.updatedAt || asset.createdAt))
        .filter((value) => Number.isFinite(value) && value > 0);

      if (!timestamps.length) return null;
      return Math.max(...timestamps);
    }

    function refreshDashboardStatusIndicator() {
      const LOG_UPDATE_INTERVAL_MS = 20 * 60 * 1000; // 20 minutos
      const WARN_DELAY_MS = 5 * 60 * 1000; // margem de atraso esperada
      const ERROR_DELAY_MS = 20 * 60 * 1000; // atraso crítico adicional

      if (dashboardStatusState === 'loading') {
        updateDashboardStatus('Atualizando dados do dashboard...', 'idle');
        return;
      }

      if (dashboardStatusState === 'error') {
        updateDashboardStatus('Falha na atualização do dashboard', 'error', true);
        return;
      }

      if (!dashboardLastSuccessAt) {
        updateDashboardStatus('Aguardando primeira atualização', 'idle');
        return;
      }

      const referenceTimestamp = dashboardLastDataAt || dashboardLastSuccessAt;
      const elapsedMs = Date.now() - referenceTimestamp;
      const stamp = formatDate(new Date(referenceTimestamp));
      const messagePrefix = dashboardLastDataAt ? 'Dados atualizados em' : 'Resumo atualizado em';
      const warnThreshold = LOG_UPDATE_INTERVAL_MS + WARN_DELAY_MS;
      const errorThreshold = LOG_UPDATE_INTERVAL_MS + ERROR_DELAY_MS;

      if (elapsedMs <= warnThreshold) {
        updateDashboardStatus(`${messagePrefix} ${stamp}`, 'ok');
        return;
      }
      if (elapsedMs <= errorThreshold) {
        updateDashboardStatus(`Atualização atrasada desde ${stamp}`, 'warn');
        return;
      }
      updateDashboardStatus(`Sem atualização desde ${stamp}`, 'error', true);
    }

    function ensureDashboardStatusMonitor() {
      if (dashboardStatusMonitorTimer) return;
      dashboardStatusMonitorTimer = window.setInterval(refreshDashboardStatusIndicator, 5000);
    }

    function showSection(id, options = {}) {
      const skipAutoLoad = Boolean(options?.skipAutoLoad);
      document.querySelectorAll('.section').forEach((section) => {
        section.classList.toggle('active', section.id === `sec-${id}`);
      });
      document.querySelectorAll('.nav-btn').forEach((button) => {
        button.classList.toggle('active', button.dataset.section === id);
      });
      if (id === 'consulta' && !skipAutoLoad) loadCIs();
      if (id === 'dashboard') loadDashboard();
      if (id === 'contatos') loadTenantContacts();
      if (id === 'tenants') loadTenants();
      if (id === 'lec-logs') loadLecLogs();
    }

    async function request(path, options = {}, timeout = 8000) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeout);
      try {
        return await fetch(`${getBase()}${path}`, { ...options, signal: controller.signal });
      } finally {
        window.clearTimeout(timer);
      }
    }

    function normalizeAsset(row) {
      return {
        id: row.id,
        idExternal: row.id_asset_external || '-',
        name: row.asset_name || row.name || '-',
        tenantId: row.tenant_id ?? row.fk_tenant ?? null,
        tenantName: row.tenant_name || row.customer_name || '-',
        typeId: row.asset_type_id ?? null,
        typeName: row.asset_type_name || row.asset_type || row.type || '-',
        criticalityId: row.asset_criticality_id || null,
        criticalityName: row.asset_criticality_name || row.criticality || row.asset_criticality || '-',
        productNameId: row.product_name_id ?? row.fk_product_name ?? null,
        productVendorId: row.product_vendor_id ?? row.fk_product_vendor ?? null,
        hostname: row.hostname_fqdn || row.hostname || '-',
        ip: row.ip_address || row.ip || '-',
        status: normalizeStatusValue(row.operational_status || row.status || '-'),
        model: row.product_name || row.product_model || row.model || '-',
        vendor: row.product_vendor || row.vendor_name || row.vendor || '-',
        version: row.version_information || '-',
        macAddress: row.mac_address || '-',
        observations: row.observations || '',
        lec: Number(row.lec || 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at || row.last_updated,
        raw: row
      };
    }

    function getCriticalityWeight(ci) {
      if (ci.criticalityId !== null && ci.criticalityId !== undefined && ci.criticalityId !== '') {
        return Number(ci.criticalityId);
      }
      const match = String(ci.criticalityName || '').match(/(\d+)/);
      return match ? Number(match[1]) : -1;
    }

    function getSortValue(ci, key) {
      switch (key) {
        case 'name':
          return normalizeText(ci.name);
        case 'idExternal': {
          const external = String(ci.idExternal || '').trim();
          if (/^\d+$/.test(external)) return Number(external);
          return normalizeText(external);
        }
        case 'type':
          return normalizeText(ci.typeName);
        case 'criticality':
          return getCriticalityWeight(ci);
        case 'ipHost': {
          const ipOrHost = ci.ip && ci.ip !== '-' ? ci.ip : ci.hostname;
          return normalizeText(ipOrHost);
        }
        case 'status':
          return normalizeText(ci.status);
        case 'product': {
          const product = ci.vendor && ci.vendor !== '-' ? `${ci.vendor} ${ci.model}` : ci.model;
          return normalizeText(product);
        }
        default:
          return '';
      }
    }

    function getSortedCIs(list) {
      // A ordenação agora é feita no backend para considerar todos os ativos (não apenas a página atual).
      return [...list];
    }

    function updateCiSortIndicators() {
      document.querySelectorAll('#ci-table-head th[data-sort-key]').forEach((th) => {
        const key = th.dataset.sortKey;
        const indicator = th.querySelector('.ci-sort-indicator');
        if (key === ciSortState.key) {
          const ascending = ciSortState.direction !== 'desc';
          th.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
          if (indicator) indicator.textContent = ascending ? '▲' : '▼';
        } else {
          th.setAttribute('aria-sort', 'none');
          if (indicator) indicator.textContent = '↕';
        }
      });
    }

    function setDetailEditActions(isEditing) {
      const editBtn = document.getElementById('detailEditBtn');
      const saveBtn = document.getElementById('detailSaveBtn');
      const cancelBtn = document.getElementById('detailCancelBtn');
      if (!editBtn || !saveBtn || !cancelBtn) return;
      editBtn.hidden = isEditing;
      saveBtn.hidden = !isEditing;
      cancelBtn.hidden = !isEditing;
    }

    function updateDetailTenantHeader(ci) {
      const tenantWrap = document.getElementById('detail-tenant-header');
      const tenantValue = document.getElementById('detail-tenant-value');
      if (!tenantWrap || !tenantValue) return;

      const tenantName = String(ci?.tenantName || '-').trim();
      const hasTenant = tenantName && tenantName !== '-';
      tenantValue.textContent = hasTenant ? tenantName : '-';
      tenantWrap.hidden = !hasTenant;
    }

    function renderDetailReadOnly(ci) {
      const fields = [
        { label: 'Nome',              value: ci.name },
        { label: 'ID',                value: ci.idExternal },
        { label: 'Tipo',              value: ci.typeName },
        { label: 'Criticidade',       value: ci.criticalityName },
        { label: 'Status',            value: statusPill(ci.status), html: true },
        { label: 'Product Vendor',    value: ci.vendor },
        { label: 'Product Name',      value: ci.model },
        { label: 'Hostname / FQDN',   value: ci.hostname },
        { label: 'IP principal',      value: ci.ip },
        { label: 'Versão do sistema', value: ci.version },
        { label: 'MAC Address',       value: ci.macAddress },
        { label: 'LEC',               value: ci.lec === 1 ? 'Sim' : 'Não' },
        { label: 'Observações',       value: ci.observations || '-' },
        { label: 'Atualizado em',     value: formatDate(ci.updatedAt) },
        { label: 'Cadastrado em',     value: formatDate(ci.createdAt) },
      ];

      updateDetailTenantHeader(ci);

      document.getElementById('detail-content').innerHTML = fields.map(({ label, value, html }) => `
        <div class="detail-field">
          <span class="detail-key">${esc(label)}</span>
          <span class="detail-val">${html ? (value || '-') : esc(value === null || value === undefined || value === '' || value === '-' ? '-' : String(value))}</span>
        </div>`).join('');
    }

    function buildSelectedOptions(items, selectedId, placeholder) {
      const options = [`<option value="">${esc(placeholder)}</option>`];
      items.forEach((item) => {
        const id = Number(item.id);
        const selected = Number(selectedId) === id ? ' selected' : '';
        options.push(`<option value="${id}"${selected}>${esc(item.name)}</option>`);
      });
      return options.join('');
    }

    function renderDetailEditForm(ci) {
      updateDetailTenantHeader(ci);

      const statusOptions = [
        { value: 'active', label: 'Active' },
        { value: 'disconnected', label: 'Disconnected' },
        { value: 'pending', label: 'Pending' },
        { value: 'never_connected', label: 'Never connected' },
      ];
      const statusHtml = statusOptions
        .map((item) => `<option value="${item.value}"${ci.status === item.value ? ' selected' : ''}>${item.label}</option>`)
        .join('');

      document.getElementById('detail-content').innerHTML = `
        <div class="form-grid" style="grid-column: 1 / -1;">
          <div class="form-group"><label class="form-label" for="detail-edit-name">Nome *</label><input id="detail-edit-name" value="${esc(ci.name === '-' ? '' : ci.name)}" /></div>
          <div class="form-group"><label class="form-label" for="detail-edit-external">ID</label><input id="detail-edit-external" maxlength="10" value="${esc(ci.idExternal === '-' ? '' : ci.idExternal)}" /></div>
          <div class="form-group"><label class="form-label" for="detail-edit-tenant">Tenant *</label><select id="detail-edit-tenant">${buildSelectedOptions(catalogs.tenants, ci.tenantId, 'Selecione um tenant')}</select></div>
          <div class="form-group"><label class="form-label" for="detail-edit-type">Tipo *</label><select id="detail-edit-type">${buildSelectedOptions(catalogs.assetTypes, ci.typeId, 'Selecione um tipo')}</select></div>
          <div class="form-group"><label class="form-label" for="detail-edit-criticality">Criticidade *</label><select id="detail-edit-criticality">${buildSelectedOptions(catalogs.assetCriticalities, ci.criticalityId, 'Selecione uma criticidade')}</select></div>
          <div class="form-group"><label class="form-label" for="detail-edit-vendor">Product Vendor</label><select id="detail-edit-vendor">${buildSelectedOptions(catalogs.productVendors, ci.productVendorId, 'Selecione um vendor')}</select></div>
          <div class="form-group"><label class="form-label" for="detail-edit-product-name">Product Name</label><input id="detail-edit-product-name" value="${esc(ci.model === '-' ? '' : ci.model)}" /></div>
          <div class="form-group"><label class="form-label" for="detail-edit-hostname">Hostname / FQDN</label><input id="detail-edit-hostname" value="${esc(ci.hostname === '-' ? '' : ci.hostname)}" /></div>
          <div class="form-group"><label class="form-label" for="detail-edit-ip">IP principal</label><input id="detail-edit-ip" value="${esc(ci.ip === '-' ? '' : ci.ip)}" /></div>
          <div class="form-group"><label class="form-label" for="detail-edit-version">Versão do sistema</label><input id="detail-edit-version" value="${esc(ci.version === '-' ? '' : ci.version)}" /></div>
          <div class="form-group"><label class="form-label" for="detail-edit-mac">MAC Address</label><input id="detail-edit-mac" value="${esc(ci.macAddress === '-' ? '' : ci.macAddress)}" /></div>
            <div class="form-group"><label class="form-label" for="detail-edit-status">Status</label><select id="detail-edit-status">${statusHtml}</select></div>
            <div class="form-group"><label class="form-label" for="detail-edit-lec"><span>LEC</span></label><select id="detail-edit-lec"><option value="0"${Number(ci.lec) === 0 ? ' selected' : ''}>Não</option><option value="1"${Number(ci.lec) === 1 ? ' selected' : ''}>Sim</option></select></div>
            <div class="form-group" style="grid-column: 1 / -1"><label class="form-label" for="detail-edit-observations">Observações</label><textarea id="detail-edit-observations" rows="3">${esc(ci.observations || '')}</textarea></div>
        </div>`;
    }

    function startDetailEdit() {
      if (!detailAssetDraft) return;
      detailEditMode = true;
      detailTagsDraft = detailTags.map((tag) => ({
        id_tag: tag.id_tag,
        tag_name: tag.tag_name,
        tag_type: tag.tag_type
      }));
      renderDetailEditForm(detailAssetDraft);
      setDetailEditActions(true);
      renderTagsList(detailTagsDraft);
    }

    function cancelDetailEdit() {
      if (!detailAssetDraft) return;
      detailEditMode = false;
      renderDetailReadOnly(detailAssetDraft);
      setDetailEditActions(false);
      renderTagsList(detailTags);
    }

    async function syncDetailTags(assetId) {
      const normalized = detailTagsDraft.map((tag) => ({
        id_tag: tag.id_tag || null,
        tag_name: String(tag.tag_name || '').trim(),
        tag_type: String(tag.tag_type || '').trim()
      }));

      const invalid = normalized.find((tag) => (tag.tag_name && !tag.tag_type) || (!tag.tag_name && tag.tag_type));
      if (invalid) {
        throw new Error('Preencha nome e tipo em todas as tags, ou remova as linhas vazias.');
      }

      const finalTags = normalized.filter((tag) => tag.tag_name && tag.tag_type);

      for (const existing of detailTags) {
        const response = await request(`/tags/${existing.id_tag}`, { method: 'DELETE' });
        if (!response.ok && response.status !== 404) {
          throw new Error(`Falha ao remover tag (${response.status})`);
        }
      }

      for (const tag of finalTags) {
        const response = await request(`/assets/${assetId}/tags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag_name: tag.tag_name, tag_type: tag.tag_type })
        });
        if (!response.ok) {
          throw new Error(`Falha ao criar tag (${response.status})`);
        }
      }
    }

    async function saveDetailEdit() {
      if (!detailAssetDraft?.id) return;

      const payload = {
        asset_name: v('detail-edit-name'),
        id_asset_external: v('detail-edit-external') || null,
        tenant_id: parseInt(document.getElementById('detail-edit-tenant').value, 10) || null,
        asset_type_id: parseInt(document.getElementById('detail-edit-type').value, 10) || null,
        asset_criticality_id: parseInt(document.getElementById('detail-edit-criticality').value, 10) || null,
        product_vendor_id: parseInt(document.getElementById('detail-edit-vendor').value, 10) || null,
        product_name: v('detail-edit-product-name') || null,
        hostname_fqdn: v('detail-edit-hostname') || null,
        ip_address: v('detail-edit-ip') || null,
        version_information: v('detail-edit-version') || null,
        mac_address: v('detail-edit-mac') || null,
        operational_status: document.getElementById('detail-edit-status').value || 'active',
        observations: document.getElementById('detail-edit-observations').value || null,
        lec: Number(document.getElementById('detail-edit-lec').value || 0) === 1 ? 1 : 0,
        tags: []
      };

      if (!payload.asset_name || !payload.tenant_id || !payload.asset_type_id || !payload.asset_criticality_id) {
        toast('Preencha os campos obrigatórios: Nome, Tenant, Tipo e Criticidade.', 'error');
        return;
      }

      try {
        const response = await request(`/assets/${detailAssetDraft.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}`;
          try {
            const errorData = await response.json();
            if (errorData?.detail) {
              errorMessage = typeof errorData.detail === 'string'
                ? errorData.detail
                : JSON.stringify(errorData.detail);
            }
          } catch {
            // keep fallback
          }
          throw new Error(errorMessage);
        }

        const updated = normalizeAsset(await response.json());
        await syncDetailTags(updated.id);

        detailAssetDraft = updated;
        detailEditMode = false;
        renderDetailReadOnly(updated);
        setDetailEditActions(false);
        await loadTagsForAsset(updated.id);

        const index = visibleCIs.findIndex((item) => item.id === updated.id);
        if (index >= 0) visibleCIs[index] = updated;

        toast('Ativo atualizado com sucesso.');
        await Promise.all([loadDashboard(), loadCIs()]);
      } catch (error) {
        toast(`Erro ao atualizar: ${error.message}`, 'error');
      }
    }

    function currentTypeOptions() {
      return catalogs.assetTypes.length ? catalogs.assetTypes : [];
    }

    function currentCriticalityOptions() {
      return catalogs.assetCriticalities.length ? catalogs.assetCriticalities : [];
    }

    function buildSelectOptions(items, placeholder, valueMapper) {
      const options = [`<option value="">${esc(placeholder)}</option>`];
      items.forEach((item) => {
        const mapped = valueMapper(item);
        options.push(`<option value="${esc(mapped.value)}">${esc(mapped.label)}</option>`);
      });
      return options.join('');
    }

    function fillSelect(selectId, items, placeholder) {
      const select = document.getElementById(selectId);
      if (!select) return;
      select.innerHTML = buildSelectOptions(items, placeholder, (item) => {
        const value = item.id ?? item.value ?? item.name;
        return {
          value,
          label: item.name ?? item.label ?? String(value)
        };
      });
    }

    function fillCriticalityFilter(items) {
      const select = document.getElementById('filterCriticality');
      if (!select) return;
      select.innerHTML = buildSelectOptions(items, 'Todas as criticidades', (item) => {
        const value = item.id ?? item.value ?? item.name;
        return {
          value,
          label: item.name ?? item.label ?? String(value)
        };
      });
    }

    function fillValueLabelSelect(selectId, items, placeholder) {
      if (!Array.isArray(items)) return;
      const select = document.getElementById(selectId);
      if (!select) return;
      select.innerHTML = buildSelectOptions(items, placeholder, (item) => ({
        value: item.value,
        label: item.label
      }));

      if (selectId === 'filterStatus' && !select.querySelector('option[value="attention"]')) {
        select.insertAdjacentHTML('beforeend', '<option value="attention">Atenção (Disconnected/Pending/Never connected)</option>');
      }
    }

    function fillProductModelDatalist(items) {
      const datalist = document.getElementById('asset-model-list');
      if (!datalist) return;
      const options = Array.isArray(items) ? items : [];
      datalist.innerHTML = options
        .map((item) => `<option value="${esc(item.name ?? item.label ?? '')}"></option>`)
        .join('');
    }

    function fillProductVendorDatalist(items) {
      const datalist = document.getElementById('asset-vendor-list');
      if (!datalist) return;
      const options = Array.isArray(items) ? items : [];
      datalist.innerHTML = options
        .map((item) => `<option value="${esc(item.name ?? item.label ?? '')}"></option>`)
        .join('');
    }

    function resolveVendorIdFromInput() {
      const typed = v('asset-vendor-search');
      if (!typed) return null;

      const normalizedTyped = normalizeText(typed);
      const match = catalogs.productVendors.find((vendor) => normalizeText(vendor.name) === normalizedTyped);
      return match ? parseInt(match.id, 10) : null;
    }

    async function loadTenants() {
      const tbody = document.getElementById('tenants-table');
      tbody.innerHTML = '<tr><td colspan="4" class="empty">Carregando...</td></tr>';
      try {
        const response = await request('/tenants');
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json();
        if (!data.length) {
          tbody.innerHTML = '<tr><td colspan="4" class="empty">Nenhum tenant cadastrado.</td></tr>';
          return;
        }
        tbody.innerHTML = data.map((t) => `
          <tr>
            <td class="cell-primary">${esc(t.name)}</td>
            <td>${esc(t.domain || '-')}</td>
            <td>${esc(formatDate(t.created_at))}</td>
            <td class="cell-actions">
              <div class="table-actions">
                <button class="btn" type="button" data-action="edit-tenant" data-tenant-id="${t.id}" data-tenant-name="${esc(t.name)}" data-tenant-domain="${esc(t.domain || '')}">Editar</button>
                <button class="btn danger" type="button" data-action="delete-tenant" data-tenant-id="${t.id}" data-tenant-name="${esc(t.name)}">Excluir</button>
              </div>
            </td>
          </tr>`).join('');
      } catch {
        tbody.innerHTML = '<tr><td colspan="4" class="empty">Erro ao carregar tenants.</td></tr>';
      }
    }

    function bindTenantActions() {
      document.getElementById('tenants-table').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const tenantId = parseInt(button.dataset.tenantId || '0', 10);
        if (!tenantId) return;
        const tenant = {
          id: tenantId,
          name: button.dataset.tenantName || '',
          domain: button.dataset.tenantDomain || ''
        };

        if (button.dataset.action === 'edit-tenant') {
          openTenantModal(tenant);
          return;
        }
        if (button.dataset.action === 'delete-tenant') {
          deleteTenant(tenant);
        }
      });
    }

    function bindContactActions() {
      document.getElementById('tenant-contacts-table').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const contactId = parseInt(button.dataset.contactId, 10);
        const contact = allTenantContacts.find((item) => item.id_tenant_contact === contactId);
        if (!contact) return;
        const action = button.dataset.action;
        if (action === 'view-contact') showContactDetail(contact);
        if (action === 'edit-contact') editContact(contact);
        if (action === 'delete-contact') deleteContact(contactId);
      });
    }

    function showContactDetail(contact) {
      selectedContactData = contact;
      const content = document.getElementById('contact-detail-content');
      content.innerHTML = `
        <div class="detail-field">
          <span class="detail-key">Nome</span>
          <span class="detail-val">${esc(contact.contact_name || '-')}</span>
        </div>
        <div class="detail-field">
          <span class="detail-key">Email</span>
          <span class="detail-val">${esc(contact.contact_mail || '-')}</span>
        </div>
        <div class="detail-field">
          <span class="detail-key">Telefone</span>
          <span class="detail-val">${esc(contact.contact_phone || '-')}</span>
        </div>
        <div class="detail-field">
          <span class="detail-key">Tipo</span>
          <span class="detail-val">${esc(contact.contact_type_name || '-')}</span>
        </div>
        <div class="detail-field">
          <span class="detail-key">Prioridade</span>
          <span class="detail-val">${esc(contact.contact_priority || '-')}</span>
        </div>
        <div class="detail-field">
          <span class="detail-key">Canal de notificação</span>
          <span class="detail-val">${esc(contact.notification_channel || '-')}</span>
        </div>
      `;
      const modal = document.getElementById('contactDetailModal');
      modal.classList.add('show');
      modal.setAttribute('aria-hidden', 'false');
    }

    function editContact(contact) {
      if (!contact) return;
      const title = document.getElementById('contact-form-title');
      const tenantSelect = document.getElementById('contact-tenant');
      const tenantId = contact?.fk_tenant || parseInt(tenantSelect?.value, 10) || null;
      if (tenantSelect && tenantId) {
        tenantSelect.value = String(tenantId);
      }
      document.getElementById('contact-name').value = contact.contact_name || '';
      document.getElementById('contact-mail').value = contact.contact_mail || '';
      document.getElementById('contact-phone').value = contact.contact_phone || '';
      document.getElementById('contact-priority').value = contact.contact_priority || 1;
      document.getElementById('contact-channel').value = contact.notification_channel || '';
      document.getElementById('contact-type').value = contact.fk_contact_type || '';
      const button = document.getElementById('saveTenantContactBtn');
      button.dataset.editingContactId = contact.id_tenant_contact;
      button.textContent = 'Atualizar contato';
      if (title) title.textContent = 'Atualizar contato';
      document.getElementById('cancelContactEditBtn').hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast('Preencha os campos para atualizar o contato.', 'error');
    }

    async function deleteContact(contactId) {
      const confirmed = await showConfirmDialog({
        title: 'Excluir contato',
        message: 'Tem certeza que deseja deletar este contato? Essa ação não pode ser desfeita.',
        confirmText: 'Excluir'
      });
      if (!confirmed) return;
      try {
        const response = await request(`/tenants/${parseInt(document.getElementById('contact-tenant').value, 10)}/contacts/${contactId}`, {
          method: 'DELETE'
        });
        if (!response.ok) throw new Error(String(response.status));
        toast('Contato deletado com sucesso.', 'success');
        await loadTenantContacts();
      } catch {
        toast('Erro ao deletar contato.', 'error');
      }
    }

    function closeContactDetailModal() {
      const modal = document.getElementById('contactDetailModal');
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
      selectedContactData = null;
    }

    function openContactEditorFromDetail() {
      if (!selectedContactData) return;
      const contact = selectedContactData;
      closeContactDetailModal();
      editContact(contact);
      const formSection = document.getElementById('sec-contatos');
      if (formSection) {
        formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    async function deleteSelectedContactFromDetail() {
      if (!selectedContactData) return;
      const contactId = selectedContactData.id_tenant_contact;
      closeContactDetailModal();
      await deleteContact(contactId);
    }

    function refreshTenantSelects() {
      fillSelect('asset-tenant', catalogs.tenants, 'Selecione um tenant');
      fillSelect('contact-tenant', catalogs.tenants, 'Selecione um tenant');
      fillSelect('filterTenant', catalogs.tenants, 'Todos os tenants');
    }

    async function loadCatalogs() {
      const response = await request('/catalogs');
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      catalogs.assetTypes = data.assetTypes || [];
      catalogs.assetCriticalities = data.assetCriticalities || [];
      catalogs.tenants = data.tenants || [];
      catalogs.contactTypes = data.contactTypes || [];
      catalogs.productVendors = data.productVendors || [];
      catalogs.productNames = data.productNames || [];
      fillSelect('asset-type', currentTypeOptions(), 'Selecione um tipo');
      fillSelect('asset-criticality', currentCriticalityOptions(), 'Selecione uma criticidade');
      fillProductModelDatalist(catalogs.productNames);
      fillProductVendorDatalist(catalogs.productVendors);
      refreshTenantSelects();
      fillSelect('contact-type', catalogs.contactTypes, 'Selecione um tipo');
      fillCriticalityFilter(catalogs.assetCriticalities);
      fillValueLabelSelect('filterStatus', data.statuses, 'Todos os status');
      fillValueLabelSelect('asset-status', data.statuses, 'Selecione um status');
    }

    let allTenantContacts = [];

    function getFilteredTenantContacts() {
      const searchTerm = document.getElementById('searchContact').value.toLowerCase().trim();
      if (!searchTerm) return allTenantContacts;
      return allTenantContacts.filter((contact) => {
        const name = (contact.contact_name || '').toLowerCase();
        const email = (contact.contact_mail || '').toLowerCase();
        return name.includes(searchTerm) || email.includes(searchTerm);
      });
    }

    function updateContactPagination(totalItems) {
      const totalPages = Math.max(1, Math.ceil(totalItems / contactPageSize));
      if (contactCurrentPage > totalPages) contactCurrentPage = totalPages;
      if (totalItems === 0) contactCurrentPage = 1;

      const info = document.getElementById('contactPaginationInfo');
      const pageInfo = document.getElementById('contactPageNumberInfo');
      const prevBtn = document.getElementById('contactPrevPageBtn');
      const nextBtn = document.getElementById('contactNextPageBtn');

      if (info) {
        info.textContent = totalItems
          ? `Exibindo ${Math.min((contactCurrentPage - 1) * contactPageSize + 1, totalItems)} a ${Math.min(contactCurrentPage * contactPageSize, totalItems)} de ${totalItems}`
          : 'Exibindo 0 de 0';
      }
      if (pageInfo) pageInfo.textContent = `Página ${totalItems ? contactCurrentPage : 1} de ${totalPages}`;
      if (prevBtn) prevBtn.disabled = contactCurrentPage <= 1;
      if (nextBtn) nextBtn.disabled = contactCurrentPage >= totalPages || totalItems === 0;
    }

    function filterTenantContacts() {
      contactCurrentPage = 1;
      renderTenantContacts(getFilteredTenantContacts());
    }

    function renderTenantContacts(list) {
      const tbody = document.getElementById('tenant-contacts-table');
      const totalItems = list.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / contactPageSize));
      const startIndex = (contactCurrentPage - 1) * contactPageSize;
      const pagedList = list.slice(startIndex, startIndex + contactPageSize);

      updateContactPagination(totalItems);

      if (!totalItems) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty">Nenhum contato cadastrado para este tenant.</td></tr>';
        return;
      }
      if (!pagedList.length) {
        contactCurrentPage = totalPages;
        return renderTenantContacts(list);
      }
      tbody.innerHTML = pagedList.map((contact) => `
        <tr>
          <td class="cell-primary">${esc(contact.contact_name || '-')}</td>
          <td>${esc(contact.contact_mail || '-')}</td>
          <td>${esc(contact.contact_phone || '-')}</td>
          <td>${esc(contact.contact_type_name || '-')}</td>
          <td>${esc(contact.contact_priority || '-')}</td>
          <td class="cell-actions">
            <div class="table-actions">
              <button class="btn" type="button" data-action="view-contact" data-contact-id="${contact.id_tenant_contact}" title="Ver detalhes">Ver</button>
              <button class="btn" type="button" data-action="edit-contact" data-contact-id="${contact.id_tenant_contact}" title="Editar">Editar</button>
              <button class="btn danger" type="button" data-action="delete-contact" data-contact-id="${contact.id_tenant_contact}" title="Deletar">Deletar</button>
            </div>
          </td>
        </tr>
      `).join('');
      bindContactActions();
    }

    async function loadTenantContacts() {
      const tenantId = parseInt(document.getElementById('contact-tenant').value, 10);
      if (!tenantId) {
        allTenantContacts = [];
        contactCurrentPage = 1;
        closeContactDetailModal();
        clearContactForm();
        renderTenantContacts([]);
        document.getElementById('searchContact').value = '';
        toast('Selecione um tenant para carregar os contatos.', 'error');
        return;
      }

      const tbody = document.getElementById('tenant-contacts-table');
      tbody.innerHTML = '<tr><td colspan="6" class="empty">Carregando contatos...</td></tr>';
      updateContactPagination(0);
      try {
        const response = await request(`/tenants/${tenantId}/contacts`);
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json();
        allTenantContacts = data || [];
        contactCurrentPage = 1;
        document.getElementById('searchContact').value = '';
        renderTenantContacts(allTenantContacts);
      } catch {
        allTenantContacts = [];
        contactCurrentPage = 1;
        updateContactPagination(0);
        tbody.innerHTML = '<tr><td colspan="6" class="empty">Nao foi possivel carregar os contatos do tenant.</td></tr>';
      }
    }

    function openTenantModal(tenant = null) {
      const title = document.getElementById('tenant-modal-title');
      const subtitle = document.getElementById('tenant-modal-subtitle');
      const saveButton = document.getElementById('saveTenantBtn');
      editingTenantId = tenant?.id || null;
      document.getElementById('tenant-name').value = tenant?.name || '';
      document.getElementById('tenant-domain').value = tenant?.domain || '';
      if (editingTenantId) {
        if (title) title.textContent = 'Editar Tenant';
        if (subtitle) subtitle.textContent = 'Atualize o cadastro do tenant selecionado.';
        if (saveButton) saveButton.textContent = 'Atualizar tenant';
      } else {
        if (title) title.textContent = 'Novo Tenant';
        if (subtitle) subtitle.textContent = 'Cadastro mestre para organizacao dos demais registros.';
        if (saveButton) saveButton.textContent = 'Salvar tenant';
      }
      document.getElementById('tenantModal').classList.add('show');
      document.getElementById('tenantModal').setAttribute('aria-hidden', 'false');
      document.getElementById('tenant-name').focus();
    }

    function closeTenantModal() {
      editingTenantId = null;
      const title = document.getElementById('tenant-modal-title');
      const subtitle = document.getElementById('tenant-modal-subtitle');
      const saveButton = document.getElementById('saveTenantBtn');
      if (title) title.textContent = 'Novo Tenant';
      if (subtitle) subtitle.textContent = 'Cadastro mestre para organizacao dos demais registros.';
      if (saveButton) saveButton.textContent = 'Salvar tenant';
      document.getElementById('tenantModal').classList.remove('show');
      document.getElementById('tenantModal').setAttribute('aria-hidden', 'true');
      document.getElementById('tenant-name').value = '';
      document.getElementById('tenant-domain').value = '';
    }

    async function saveTenant() {
      const customerName = v('tenant-name');
      const customerDomain = v('tenant-domain');
      if (!customerName) {
        toast('Informe o nome do tenant.', 'error');
        return;
      }

      try {
        const isEditing = Boolean(editingTenantId);
        const endpoint = isEditing ? `/tenants/${editingTenantId}` : '/tenants';
        const response = await request(endpoint, {
          method: isEditing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customer_name: customerName, customer_domain: customerDomain || null })
        });
        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}`;
          try {
            const errorData = await response.json();
            if (errorData?.detail) errorMessage = String(errorData.detail);
          } catch {
            // Keep HTTP fallback message when response is not JSON
          }
          throw new Error(errorMessage);
        }

        toast(isEditing ? 'Tenant atualizado com sucesso.' : 'Tenant salvo com sucesso.');
        closeTenantModal();
        await Promise.all([loadCatalogs(), loadTenants()]);
      } catch (error) {
        toast(`Erro ao salvar tenant: ${error.message}`, 'error');
      }
    }

    async function deleteTenant(tenant) {
      const tenantName = tenant?.name || 'este tenant';
      const confirmed = await showConfirmDialog({
        title: 'Excluir tenant',
        message: `Tem certeza que deseja excluir ${tenantName}? Essa ação não pode ser desfeita.`,
        confirmText: 'Excluir'
      });
      if (!confirmed) return;
      try {
        const response = await request(`/tenants/${tenant.id}`, { method: 'DELETE' });
        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}`;
          try {
            const errorData = await response.json();
            if (errorData?.detail) errorMessage = String(errorData.detail);
          } catch {
            // Keep fallback message
          }
          throw new Error(errorMessage);
        }
        toast('Tenant excluido com sucesso.');
        await Promise.all([loadCatalogs(), loadTenants()]);
      } catch (error) {
        toast(`Erro ao excluir tenant: ${error.message}`, 'error');
      }
    }

    function clearContactForm() {
      const button = document.getElementById('saveTenantContactBtn');
      const title = document.getElementById('contact-form-title');
      document.getElementById('contact-name').value = '';
      document.getElementById('contact-mail').value = '';
      document.getElementById('contact-phone').value = '';
      document.getElementById('contact-channel').value = '';
      document.getElementById('contact-priority').value = '1';
      document.getElementById('contact-type').value = '';
      button.dataset.editingContactId = '';
      button.textContent = 'Salvar contato';
      if (title) title.textContent = 'Cadastrar contato';
      document.getElementById('cancelContactEditBtn').hidden = true;
    }

    async function saveTenantContact() {
      const tenantId = parseInt(document.getElementById('contact-tenant').value, 10) || null;
      const contactTypeId = parseInt(document.getElementById('contact-type').value, 10) || null;
      const contactName = v('contact-name');
      const contactMail = v('contact-mail');
      const button = document.getElementById('saveTenantContactBtn');
      const editingContactId = parseInt(button.dataset.editingContactId || 0, 10);
      const isEditing = editingContactId > 0;

      if (!tenantId || !contactTypeId || !contactName || !contactMail) {
        toast('Preencha os campos obrigatorios: Tenant, Tipo, Nome e Email.', 'error');
        return;
      }

      const payload = {
        contact_name: contactName,
        contact_phone: v('contact-phone') || null,
        contact_mail: contactMail,
        contact_priority: parseInt(document.getElementById('contact-priority').value, 10) || 1,
        notification_channel: v('contact-channel') || null,
        contact_type_id: contactTypeId
      };

      try {
        const method = editingContactId ? 'PUT' : 'POST';
        const endpoint = editingContactId ? `/tenants/${tenantId}/contacts/${editingContactId}` : `/tenants/${tenantId}/contacts`;
        const response = await request(endpoint, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}`;
          try {
            const errorData = await response.json();
            if (errorData?.detail) errorMessage = String(errorData.detail);
          } catch {
            // Keep HTTP fallback message when response is not JSON
          }
          throw new Error(errorMessage);
        }

        toast(isEditing ? 'Contato atualizado com sucesso.' : 'Contato do tenant salvo com sucesso.');
        clearContactForm();
        await loadTenantContacts();
        if (isEditing) {
          const contactsTable = document.querySelector('#tenant-contacts-table');
          if (contactsTable) {
            contactsTable.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      } catch (error) {
        toast(`Erro ao salvar contato: ${error.message}`, 'error');
      }
    }

    async function loadDashboard() {
      dashboardStatusState = 'loading';
      refreshDashboardStatusIndicator();
      try {
        const response = await request('/assets');
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json();
        const normalized = data.map(normalizeAsset);
        dashboardLastDataAt = resolveLatestAssetTimestamp(normalized);
        const totalAssets = normalized.length;
        const activeAssets = normalized.filter((asset) => asset.status === 'active').length;
        const lecAssets = normalized.filter((asset) => Number(asset.lec || 0) === 1).length;
        dashboardAttentionRows = buildAttentionByTenant(normalized);
        const attentionAssets = dashboardAttentionRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
        const tenantKPIs = buildKPIsByTenant(normalized);
        const criticalityBands = buildCriticalityBands(normalized);
        const qualitySummary = buildQualitySummary(normalized);

        document.getElementById('dash-total-assets').textContent = formatCompactNumber(totalAssets);
        document.getElementById('dash-active-assets').textContent = formatCompactNumber(activeAssets);
        document.getElementById('dash-attention-assets').textContent = formatCompactNumber(attentionAssets);
        document.getElementById('dash-lec-assets').textContent = formatCompactNumber(lecAssets);

        renderTenantsCards(tenantKPIs);
        renderCriticalityBands(criticalityBands);
        renderQualitySummary(qualitySummary);

        // Carregar dados de cobertura de monitoramento
        try {
          const coverageResponse = await request('/coverage/by-tenant');
          if (coverageResponse.ok) {
            const coverageData = await coverageResponse.json();
            if (typeof renderCoverage === 'function') {
              renderCoverage(coverageData);
            }
          }
        } catch (err) {
          console.warn('Falha ao carregar dados de cobertura:', err);
          const coverageSection = document.getElementById('dashboardCoverageSection');
          if (coverageSection) {
            coverageSection.innerHTML = '<p class="text-muted">Não foi possível carregar dados de cobertura.</p>';
          }
        }

          const recentes = [...normalized]
            .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0))
          .slice(0, 8);

        document.getElementById('dash-recent').innerHTML = recentes.length
          ? recentes.map((ci) => `
              <tr>
                  <td class="cell-primary">${esc(ci.name)}</td>
                  <td>${tipoPill(ci.typeName)}</td>
                  <td>${criticalityPill(ci.criticalityName)}</td>
                  <td class="mono">${esc(ci.ip || ci.hostname)}</td>
                  <td>${statusPill(ci.status)}</td>
                  <td>${esc(formatDate(ci.updatedAt || ci.createdAt))}</td>
              </tr>`).join('')
            : '<tr><td colspan="6" class="empty">Nenhum ativo encontrado.</td></tr>';

        dashboardLastSuccessAt = Date.now();
        dashboardStatusState = 'ok';
        refreshDashboardStatusIndicator();
      } catch {
        ['dash-total-assets', 'dash-active-assets', 'dash-attention-assets', 'dash-lec-assets'].forEach((id) => {
          document.getElementById(id).textContent = '-';
        });
        dashboardAttentionRows = [];
        renderTenantsCards([]);
        if (typeof renderCoverage === 'function') {
          renderCoverage([]);
        }
        renderCriticalityBands(buildCriticalityBands([]));
        renderQualitySummary({ completionRate: 0, status: 'Sem dados', note: 'Conecte a API para medir a confiabilidade da CMDB.', items: [
          { label: 'Sem criticidade', value: 0, impact: 0, severity: 'Alta', filter: 'missing_criticality' },
          { label: 'Sem tenant responsável', value: 0, impact: 0, severity: 'Alta', filter: 'missing_tenant' },
          { label: 'Sem tipo de ativo', value: 0, impact: 0, severity: 'Média', filter: 'missing_type' },
          { label: 'Sem IP e sem hostname', value: 0, impact: 0, severity: 'Alta', filter: 'missing_connectivity' }
        ]});
        document.getElementById('dash-recent').innerHTML = '<tr><td colspan="6" class="empty">Conecte a API para ver dados.</td></tr>';
        dashboardStatusState = 'error';
        refreshDashboardStatusIndicator();
      }
    }

    async function loadLecLogs() {
      try {
        const response = await request('/lec-logs');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        lecLogsList = await response.json();
        lecLogsFilteredList = lecLogsList;
        renderLecLogsKpis();
        renderLecLogsTable();
      } catch (error) {
        console.error('Erro ao carregar LEC Logs:', error);
        const container = document.getElementById('lec-logs-container');
        if (container) {
          container.innerHTML = `
            <div class="empty-state">
              <div style="text-align: center; padding: 40px;">
                <div style="font-size: 18px; font-weight: 500; margin-bottom: 8px;">Erro ao carregar dados</div>
                <div style="color: #999;">Verifique a conexão ou tente novamente.</div>
              </div>
            </div>`;
        }
      }
    }

    function renderLecLogsKpis() {
      const totalDevices = lecLogsFilteredList.length;
      const healthyDevices = lecLogsFilteredList.filter((log) => {
        const status = String(log.status_lec || '').toLowerCase();
        return ['active', 'online', 'ativo'].includes(status);
      }).length;
      const attentionDevices = lecLogsFilteredList.filter((log) => {
        const status = String(log.status_lec || '').toLowerCase();
        return ['disconnected', 'offline', 'pending', 'inactive', 'inativo', 'never_connected'].includes(status);
      }).length;
      const unnamedDevices = lecLogsFilteredList.filter((log) => !String(log.device_name || '').trim()).length;

      const totalNode = document.getElementById('lecKpiTotalDevices');
      const healthyNode = document.getElementById('lecKpiHealthyDevices');
      const attentionNode = document.getElementById('lecKpiAttentionDevices');
      const unnamedNode = document.getElementById('lecKpiUnnamedDevices');

      if (totalNode) totalNode.textContent = String(totalDevices);
      if (healthyNode) healthyNode.textContent = String(healthyDevices);
      if (attentionNode) attentionNode.textContent = String(attentionDevices);
      if (unnamedNode) unnamedNode.textContent = String(unnamedDevices);
    }

    function renderLecLogsTable() {
      const container = document.getElementById('lec-logs-container');
      if (!lecLogsFilteredList.length) {
        container.innerHTML = `
          <div class="empty-state">
            <div style="text-align: center; padding: 40px;">
              <div style="font-size: 18px; font-weight: 500; margin-bottom: 8px;">Nenhum LEC Log encontrado</div>
              <div style="color: #999;">Verifique os filtros ou carregue novos dados.</div>
            </div>
          </div>`;
        return;
      }
      
      container.innerHTML = lecLogsFilteredList.map(log => {
        const status = log.status_lec || '-';
        const statusClass = getStatusClass(status);
        const isHealthy = statusClass === 'status-active' || statusClass === 'status-online';
        const lastEvent = log.last_event ? new Date(log.last_event) : null;
        const lastEventFormatted = lastEvent ? formatDate(lastEvent) : 'Sem eventos';
        const hoursAgo = lastEvent ? Math.floor((Date.now() - lastEvent) / (1000 * 60 * 60)) : null;
        const timeAgo = hoursAgo !== null ? `${hoursAgo}h atrás` : '-';
        
        return `
          <article class="lec-log-card ${statusClass}">
            <div class="lec-card-header">
              <div class="lec-card-status-indicator" title="Status: ${esc(status)}"></div>
              <div class="lec-card-title">${esc(log.device_name || 'Device desconhecido')}</div>
              <div class="lec-card-badge">${statusPill(status)}</div>
            </div>
            
            <div class="lec-card-body">
              <div class="lec-info-row">
                <span class="lec-label">Tenant</span>
                <span class="lec-value">${esc(log.customer_name || '-')}</span>
              </div>
              
              <div class="lec-info-row">
                <span class="lec-label">IP do LEC</span>
                <span class="lec-value mono">${esc(log.ip_lec || '-')}</span>
              </div>
              
              <div class="lec-info-row">
                <span class="lec-label">Último Evento</span>
                <div class="lec-time-info">
                  <span class="lec-value">${esc(lastEventFormatted)}</span>
                  <span class="lec-time-ago">${esc(timeAgo)}</span>
                </div>
              </div>
              
              <div class="lec-info-row">
                <span class="lec-label">Threshold</span>
                <span class="lec-value">${esc(log.threshold_minutes ? log.threshold_minutes + ' min' : '-')}</span>
              </div>
            </div>
            
          
          </article>`;
      }).join('');
    }

    function getStatusClass(status) {
      const normalizedStatus = String(status || '').toLowerCase();
      const classMap = {
        'active': 'status-active',
        'online': 'status-active',
        'ativo': 'status-active',
        'disconnected': 'status-disconnected',
        'offline': 'status-disconnected',
        'inativo': 'status-disconnected',
        'pending': 'status-pending',
        'pendente': 'status-pending',
        'never_connected': 'status-never-connected'
      };
      return classMap[normalizedStatus] || 'status-unknown';
    }

    function renderPagination(totalItems, currentItemsCount) {
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const startIndex = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
      const endIndex = totalItems === 0 ? 0 : startIndex + currentItemsCount - 1;

      document.getElementById('paginationInfo').textContent = `Exibindo ${startIndex}-${endIndex} de ${totalItems}`;
      document.getElementById('pageNumberInfo').textContent = `Página ${currentPage} de ${totalPages}`;

      document.getElementById('prevPageBtn').disabled = currentPage <= 1;
      document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;

      const pageButtons = document.getElementById('pageNumberButtons');
      if (!pageButtons) return;
      if (totalPages <= 1) {
        pageButtons.innerHTML = '';
        return;
      }

      const pages = [];
      const maxVisible = 5;
      let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
      let endPage = Math.min(totalPages, startPage + maxVisible - 1);
      startPage = Math.max(1, endPage - maxVisible + 1);

      if (startPage > 1) {
        pages.push(1);
        if (startPage > 2) pages.push('...');
      }
      for (let page = startPage; page <= endPage; page += 1) {
        pages.push(page);
      }
      if (endPage < totalPages) {
        if (endPage < totalPages - 1) pages.push('...');
        pages.push(totalPages);
      }

      pageButtons.innerHTML = pages.map((page) => {
        if (page === '...') {
          return '<span class="ellipsis" aria-hidden="true">...</span>';
        }
        const isActive = page === currentPage;
        return `<button class="btn pagination-page-btn${isActive ? ' is-active' : ''}" type="button" data-page="${page}" aria-label="Ir para página ${page}"${isActive ? ' aria-current="page"' : ''}>${page}</button>`;
      }).join('');
    }

    function renderTable(list) {
      const sortedList = getSortedCIs(list);
      visibleCIs = sortedList;
      updateCiSortIndicators();

      const tbody = document.getElementById('ci-table');
      if (!sortedList.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="8" class="empty">Nenhum item encontrado.</td></tr>';
        renderPagination(totalCIs, 0);
        return;
      }
      tbody.innerHTML = sortedList.map((ci, index) => `
        <tr>
          <td data-label="Nome" title="${esc(ci.name)}" class="cell-primary">${esc(ci.name)}</td>
          <td data-label="ID" class="mono">${esc(ci.idExternal)}</td>
          <td data-label="Tipo">${tipoPill(ci.typeName)}</td>
          <td data-label="Criticidade">${criticalityPill(ci.criticalityName)}</td>
          <td data-label="IP / Host" class="mono">${esc(ci.ip || ci.hostname)}</td>
          <td data-label="Status">${statusPill(ci.status)}</td>
          <td data-label="Produto" title="${esc(ci.vendor && ci.vendor !== '-' ? `${ci.vendor} - ${ci.model}` : ci.model || '')}">${esc(ci.vendor && ci.vendor !== '-' ? `${ci.vendor} - ${ci.model}` : ci.model || '-')}</td>
          <td data-label="Acoes" class="cell-actions">
            <div class="table-actions">
              <button class="btn" type="button" data-action="view" data-index="${index}" aria-label="Ver detalhes do ativo ${esc(ci.name)}">Detalhes</button>
              <button class="btn danger" type="button" data-action="delete" data-index="${index}" aria-label="Excluir ativo ${esc(ci.name)}">Excluir</button>
            </div>
          </td>
        </tr>`).join('');

      renderPagination(totalCIs, sortedList.length);
    }

    function clearFilters() {
      clearDashboardQuickFilter();
      document.getElementById('searchQ').value = '';
      document.getElementById('searchField').value = 'name';
      updateSearchPlaceholder();
      document.getElementById('filterStatus').value = '';
      document.getElementById('filterTenant').value = '';
      document.getElementById('filterCriticality').value = '';
      document.getElementById('filterLec').value = '';
      currentPage = 1;
      loadCIs({ resetPage: true });
    }

    function clearInvalidStyles() {
      REQUIRED_ASSET_FIELDS.forEach((id) => {
        document.getElementById(id).classList.remove('field-invalid');
      });
    }

    function markMissingRequiredFields(payload) {
      const missing = [];
      if (!payload.asset_name) missing.push('asset-name');
      if (!payload.asset_type_id) missing.push('asset-type');
      if (!payload.asset_criticality_id) missing.push('asset-criticality');
      if (!payload.tenant_id) missing.push('asset-tenant');

      missing.forEach((id) => {
        document.getElementById(id).classList.add('field-invalid');
      });
      return missing.length > 0;
    }

    async function loadCIs({ resetPage = false } = {}) {
      if (resetPage) currentPage = 1;
      const requestSeq = ++ciLoadRequestSeq;

      const query = document.getElementById('searchQ').value.trim();
      const searchField = document.getElementById('searchField').value || 'name';
      const rawStatus = document.getElementById('filterStatus').value;
      const status = normalizeStatusValue(rawStatus);
      const attentionOnly = status === 'attention';
      const tenantId = document.getElementById('filterTenant').value;
      const criticalityId = document.getElementById('filterCriticality').value;
      const lec = document.getElementById('filterLec').value;
      const offset = (currentPage - 1) * pageSize;

      const params = new URLSearchParams();
      params.set('limit', String(pageSize));
      params.set('offset', String(offset));
      if (ciSortState.key) {
        params.set('sort_by', ciSortState.key);
        params.set('sort_dir', ciSortState.direction || 'asc');
      }
      if (query) {
        params.set('q', query);
        params.set('q_field', searchField);
      }
      if (attentionOnly) {
        params.set('attention_only', 'true');
      } else if (status) {
        params.set('status', status);
      }
      if (tenantId) params.set('tenant_id', tenantId);
      if (criticalityId) params.set('asset_criticality_id', criticalityId);
      if (lec !== '') params.set('lec', lec);
      if (activeDashboardQuickFilter?.kind && activeDashboardQuickFilter?.value) {
        params.set(activeDashboardQuickFilter.kind, activeDashboardQuickFilter.value);
      }

      const tbody = document.getElementById('ci-table');
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8" class="empty">Carregando...</td></tr>';
      try {
        const response = await request(`/assets?${params.toString()}`);
        if (requestSeq !== ciLoadRequestSeq) return;
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json();
        if (requestSeq !== ciLoadRequestSeq) return;
        const items = Array.isArray(data) ? data : (data.items || []);
        totalCIs = Array.isArray(data) ? items.length : (data.total || 0);

        const totalPages = Math.max(1, Math.ceil(totalCIs / pageSize));
        if (currentPage > totalPages && totalCIs > 0) {
          currentPage = totalPages;
          return loadCIs();
        }

        renderTable(items.map(normalizeAsset));
      } catch {
        if (requestSeq !== ciLoadRequestSeq) return;
        visibleCIs = [];
        totalCIs = 0;
        tbody.innerHTML = '<tr class="empty-row"><td colspan="8" class="empty">Nao foi possivel carregar da API. Verifique a URL e tente novamente.</td></tr>';
        renderPagination(0, 0);
      }
    }

    function showDetail(ci) {
      detailAssetDraft = { ...ci };
      detailEditMode = false;
      detailTags = [];
      detailTagsDraft = [];
      currentDetailAssetId = ci.id;
      document.getElementById('detail-title').textContent = ci.name || 'Detalhes do ativo';
      updateDetailTenantHeader(ci);
      setDetailEditActions(false);
      renderDetailReadOnly(ci);

      document.getElementById('detailModal').classList.add('show');
      document.getElementById('detailModal').setAttribute('aria-hidden', 'false');
      loadTagsForAsset(ci.id);
    }

    async function loadTagsForAsset(assetId) {
      const container = document.getElementById('detail-tags-list');
      container.innerHTML = '<span class="tags-empty">Carregando...</span>';
      try {
        const response = await request(`/assets/${assetId}/tags`);
        if (response.status === 404) {
          detailTags = [];
          detailTagsDraft = [];
          renderTagsList([]);
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const tags = await response.json();
        detailTags = (Array.isArray(tags) ? tags : []).map((tag) => ({
          id_tag: tag.id_tag,
          tag_name: tag.tag_name,
          tag_type: tag.tag_type
        }));
        if (!detailEditMode) {
          detailTagsDraft = detailTags.map((tag) => ({ ...tag }));
        }
        renderTagsList(detailEditMode ? detailTagsDraft : detailTags);
      } catch {
        detailTags = [];
        detailTagsDraft = [];
        renderTagsList([]);
      }
    }

    function renderTagsList(tags) {
      const container = document.getElementById('detail-tags-list');
      if (detailEditMode) {
        const list = Array.isArray(tags) ? tags : [];
        const rows = list.map((tag, index) => `
          <div class="tag-field-row" style="display:flex; gap:8px; margin-bottom:8px; align-items:flex-end;">
            <div class="form-group" style="flex:1; margin:0;">
              <label class="form-label">Nome da tag</label>
              <input type="text" class="detail-tag-name" data-tag-index="${index}" value="${esc(tag.tag_name || '')}" maxlength="150" autocomplete="off" />
            </div>
            <div class="form-group" style="flex:1; margin:0;">
              <label class="form-label">Tipo da tag</label>
              <input type="text" class="detail-tag-type" data-tag-index="${index}" value="${esc(tag.tag_type || '')}" maxlength="150" autocomplete="off" />
            </div>
            <button class="btn danger" type="button" data-action="detail-remove-tag" data-tag-index="${index}" style="height:36px; padding:8px 12px;">Remover</button>
          </div>`).join('');

        container.innerHTML = `${rows}<button class="btn" type="button" data-action="detail-add-tag">+ Adicionar tag</button>`;
        return;
      }

      if (!tags.length) {
        container.innerHTML = '<span class="tags-empty">Nenhuma tag cadastrada.</span>';
        return;
      }
      container.innerHTML = tags.map((tag) => `
        <span class="tag-pill">
          <span class="tag-type">${esc(tag.tag_type)}</span>
          <span class="tag-name">${esc(tag.tag_name)}</span>
          <button class="tag-remove" type="button" data-tag-id="${esc(tag.id_tag)}" aria-label="Remover tag ${esc(tag.tag_name)}">&times;</button>
        </span>`).join('');
    }

    async function deleteTag(tagId) {
      const confirmed = await showConfirmDialog({
        title: 'Remover tag',
        message: 'Tem certeza que deseja remover esta tag? Essa ação não pode ser desfeita.',
        confirmText: 'Remover'
      });
      if (!confirmed) return;
      try {
        const response = await request(`/tags/${tagId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(String(response.status));
        toast('Tag removida.');
        await loadTagsForAsset(currentDetailAssetId);
      } catch {
        toast('Erro ao remover tag.', 'error');
      }
    }

    function closeDetail() {
      detailEditMode = false;
      detailAssetDraft = null;
      detailTags = [];
      detailTagsDraft = [];
      const tenantWrap = document.getElementById('detail-tenant-header');
      const tenantValue = document.getElementById('detail-tenant-value');
      if (tenantWrap) tenantWrap.hidden = true;
      if (tenantValue) tenantValue.textContent = '-';
      document.getElementById('detailModal').classList.remove('show');
      document.getElementById('detailModal').setAttribute('aria-hidden', 'true');
    }

    async function deleteCI(id) {
      if (!id) return;
      const ci = visibleCIs.find((item) => item.id === id) || detailAssetDraft || null;
      const confirmed = await showConfirmDialog({
        title: 'Excluir ativo',
        message: `Tem certeza que deseja excluir ${ci?.name || 'este ativo'}? Essa ação não pode ser desfeita.`,
        confirmText: 'Excluir'
      });
      if (!confirmed) return;
      try {
        const response = await request(`/assets/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(String(response.status));
        toast('Ativo removido com sucesso.');
        await Promise.all([loadCIs(), loadDashboard()]);
      } catch {
        toast('Erro ao remover ativo.', 'error');
      }
    }

    async function saveAsset() {
      clearInvalidStyles();

      const normalizedTags = dynamicTagsData.map((tag) => ({
        name: tag.name.trim(),
        type: tag.type.trim()
      }));

      const invalidTag = normalizedTags.find((tag) => (tag.name && !tag.type) || (!tag.name && tag.type));
      if (invalidTag) {
        toast('Preencha nome e tipo em todas as tags, ou remova as linhas vazias.', 'error');
        return;
      }

      const tags = normalizedTags.filter((tag) => tag.name && tag.type);

      const assetLecElement = document.getElementById('asset-lec');
      const assetLecValue = assetLecElement
        ? (assetLecElement.tagName === 'SELECT'
          ? Number(assetLecElement.value || 0)
          : (assetLecElement.checked ? 1 : 0))
        : 0;

      const payload = {
        asset_name: v('asset-name'),
        asset_type_id: parseInt(document.getElementById('asset-type').value) || null,
        asset_criticality_id: parseInt(document.getElementById('asset-criticality').value) || null,
        tenant_id: document.getElementById('asset-tenant').value ? parseInt(document.getElementById('asset-tenant').value) : null,
        product_vendor_id: resolveVendorIdFromInput(),
        hostname_fqdn: v('asset-hostname') || null,
        ip_address: v('asset-ip') || null,
        version_information: v('asset-version') || null,
        mac_address: v('asset-mac') || null,
        operational_status: document.getElementById('asset-status').value || 'active',
        product_name: v('asset-model') || null,
        id_asset_external: v('asset-external-id') || null,
        observations: document.getElementById('asset-observations').value || null,
        lec: assetLecValue === 1 ? 1 : 0,
        tags: tags.map((tag) => ({ tag_name: tag.name, tag_type: tag.type }))
      };

      if (markMissingRequiredFields(payload)) {
        toast('Preencha os campos obrigatorios: Nome, Tipo, Criticidade e Tenant.', 'error');
        return;
      }

      try {
        const response = await request('/assets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}`;
          try {
            const errorData = await response.json();
            if (errorData?.detail) {
              errorMessage = typeof errorData.detail === 'string'
                ? errorData.detail
                : JSON.stringify(errorData.detail);
            }
          } catch {
            // Keep HTTP fallback message when response is not JSON
          }
          throw new Error(errorMessage);
        }
        await response.json();

        toast('Ativo salvo com sucesso.');
        clearAssetForm();
        await Promise.all([loadDashboard(), loadCIs({ resetPage: true })]);
        showSection('consulta');
      } catch (error) {
        toast(`Erro ao salvar: ${error.message}`, 'error');
      }
    }

    function clearAssetForm() {
      const fields = [
        'asset-name',
        'asset-external-id',
        'asset-type',
        'asset-criticality',
        'asset-tenant',
        'asset-vendor-search',
        'asset-model',
        'asset-hostname',
        'asset-ip',
        'asset-version',
        'asset-mac',
        'asset-status',
        'asset-observations',
        'asset-lec'
      ];
      fields.forEach((id) => {
        const element = document.getElementById(id);
        if (!element) return;
        if (element.tagName === 'SELECT') {
          element.selectedIndex = 0;
        } else if (element.type === 'checkbox') {
          element.checked = false;
        } else {
          element.value = '';
        }
      });
      dynamicTagsData = [];
      renderDynamicTagsFields();
      clearInvalidStyles();
    }

    function renderDynamicTagsFields() {
      const container = document.getElementById('tags-container');
      if (!dynamicTagsData.length) {
        container.innerHTML = '<p style="color: var(--color-text-secondary); font-size: 13px;">Nenhuma tag adicionada ainda.</p>';
        return;
      }
      container.innerHTML = dynamicTagsData.map((tag, index) => `
        <div class="tag-field-row" style="display: flex; gap: 8px; margin-bottom: 12px; align-items: flex-end;">
          <div class="form-group" style="flex: 1; margin: 0;">
            <label class="form-label">Nome da tag</label>
            <input type="text" class="tag-name-input" data-index="${index}" value="${esc(tag.name || '')}" placeholder="Ex: ambiente" maxlength="150" autocomplete="off" />
          </div>
          <div class="form-group" style="flex: 1; margin: 0;">
            <label class="form-label">Tipo da tag</label>
            <input type="text" class="tag-type-input" data-index="${index}" value="${esc(tag.type || '')}" placeholder="Ex: producao" maxlength="150" autocomplete="off" />
          </div>
          <button class="btn danger" type="button" data-remove-index="${index}" style="padding: 8px 12px; height: 36px;">Remover</button>
        </div>`).join('');
      
      // Bind update listeners
      container.querySelectorAll('.tag-name-input').forEach(input => {
        input.addEventListener('input', (e) => {
          dynamicTagsData[Number(e.target.dataset.index)].name = e.target.value;
        });
      });
      container.querySelectorAll('.tag-type-input').forEach(input => {
        input.addEventListener('input', (e) => {
          dynamicTagsData[Number(e.target.dataset.index)].type = e.target.value;
        });
      });
      container.querySelectorAll('button[data-remove-index]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          removeDynamicTagField(Number(e.currentTarget.dataset.removeIndex));
        });
      });
    }

    function addDynamicTagField() {
      dynamicTagsData.push({ name: '', type: '' });
      renderDynamicTagsFields();
    }

    function removeDynamicTagField(index) {
      dynamicTagsData.splice(index, 1);
      renderDynamicTagsFields();
    }

    function bindEvents() {
      document.querySelectorAll('.nav-btn').forEach((button) => {
        button.addEventListener('click', () => showSection(button.dataset.section));
      });

      document.getElementById('clearAssetBtn').addEventListener('click', clearAssetForm);
      document.getElementById('saveAssetBtn').addEventListener('click', saveAsset);
      document.getElementById('addTagFieldBtn').addEventListener('click', addDynamicTagField);
      document.getElementById('openTenantModalBtn').addEventListener('click', openTenantModal);
      document.getElementById('refreshTenantsListBtn').addEventListener('click', loadTenants);
      document.getElementById('saveTenantBtn').addEventListener('click', saveTenant);
      document.getElementById('closeTenantModalBtn').addEventListener('click', closeTenantModal);
      document.getElementById('cancelTenantModalBtn').addEventListener('click', closeTenantModal);
      bindTenantActions();
      document.getElementById('tenantModal').addEventListener('click', (event) => {
        if (event.target.id === 'tenantModal') closeTenantModal();
      });
      document.getElementById('contactDetailModal').addEventListener('click', (event) => {
        if (event.target.id === 'contactDetailModal') closeContactDetailModal();
      });
      document.getElementById('saveTenantContactBtn').addEventListener('click', saveTenantContact);
      document.getElementById('loadContactsBtn').addEventListener('click', loadTenantContacts);
      document.getElementById('contact-tenant').addEventListener('change', () => {
        closeContactDetailModal();
        clearContactForm();
        loadTenantContacts();
      });
      document.getElementById('searchContact').addEventListener('input', filterTenantContacts);
      document.getElementById('clearContactFilterBtn').addEventListener('click', () => {
        document.getElementById('searchContact').value = '';
        filterTenantContacts();
      });
      document.getElementById('contactPageSizeSelect').addEventListener('change', (event) => {
        contactPageSize = Number(event.target.value) || 10;
        contactCurrentPage = 1;
        renderTenantContacts(getFilteredTenantContacts());
      });
      document.getElementById('contactPrevPageBtn').addEventListener('click', () => {
        if (contactCurrentPage <= 1) return;
        contactCurrentPage -= 1;
        renderTenantContacts(getFilteredTenantContacts());
      });
      document.getElementById('contactNextPageBtn').addEventListener('click', () => {
        const filteredContacts = getFilteredTenantContacts();
        const totalPages = Math.max(1, Math.ceil(filteredContacts.length / contactPageSize));
        if (contactCurrentPage >= totalPages) return;
        contactCurrentPage += 1;
        renderTenantContacts(filteredContacts);
      });
      document.getElementById('cancelContactEditBtn').addEventListener('click', () => {
        clearContactForm();
      });
      document.getElementById('closeContactDetailBtn').addEventListener('click', closeContactDetailModal);
      document.getElementById('contactDetailEditBtn').addEventListener('click', openContactEditorFromDetail);
      document.getElementById('contactDetailDeleteBtn').addEventListener('click', deleteSelectedContactFromDetail);

      document.getElementById('searchQ').addEventListener('input', () => {
        clearDashboardQuickFilter();
        window.clearTimeout(searchDebounceTimer);
        searchDebounceTimer = window.setTimeout(() => {
          loadCIs({ resetPage: true });
        }, 300);
      });
      document.getElementById('searchField').addEventListener('change', () => {
        clearDashboardQuickFilter();
        updateSearchPlaceholder();
        loadCIs({ resetPage: true });
      });
      document.getElementById('filterStatus').addEventListener('change', () => {
        clearDashboardQuickFilter();
        loadCIs({ resetPage: true });
      });
      document.getElementById('filterTenant').addEventListener('change', () => {
        clearDashboardQuickFilter();
        loadCIs({ resetPage: true });
      });
      document.getElementById('filterCriticality').addEventListener('change', () => {
        clearDashboardQuickFilter();
        loadCIs({ resetPage: true });
      });
      document.getElementById('filterLec').addEventListener('change', () => {
        clearDashboardQuickFilter();
        loadCIs({ resetPage: true });
      });
      document.getElementById('reloadCisBtn').addEventListener('click', () => loadCIs());
      document.getElementById('clearFiltersBtn').addEventListener('click', clearFilters);

      document.getElementById('dashboardQualityInsights').addEventListener('click', (event) => {
        const card = event.target.closest('[data-filter-kind][data-filter-value]');
        if (!card) return;
        const label = card.querySelector('.insight-label')?.textContent || 'Qualidade da base';
        openConsultaWithDashboardFilter(card.dataset.filterKind, card.dataset.filterValue, label);
      });
      document.getElementById('dashboardQualityInsights').addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const card = event.target.closest('[data-filter-kind][data-filter-value]');
        if (!card) return;
        event.preventDefault();
        const label = card.querySelector('.insight-label')?.textContent || 'Qualidade da base';
        openConsultaWithDashboardFilter(card.dataset.filterKind, card.dataset.filterValue, label);
      });

      document.getElementById('dashboardCriticalityBands').addEventListener('click', (event) => {
        const card = event.target.closest('[data-filter-kind][data-filter-value]');
        if (!card) return;
        const label = card.querySelector('.criticality-band-title')?.textContent || 'Faixa de criticidade';
        openConsultaWithDashboardFilter(card.dataset.filterKind, card.dataset.filterValue, label);
      });
      document.getElementById('dashboardCriticalityBands').addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const card = event.target.closest('[data-filter-kind][data-filter-value]');
        if (!card) return;
        event.preventDefault();
        const label = card.querySelector('.criticality-band-title')?.textContent || 'Faixa de criticidade';
        openConsultaWithDashboardFilter(card.dataset.filterKind, card.dataset.filterValue, label);
      });

      document.getElementById('dashboardTenantsSection').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action="verify-tenant"]');
        if (!button) return;
        const tenantName = decodeURIComponent(button.dataset.tenantName || '');
        openConsultaForTenant(tenantName);
      });

      REQUIRED_ASSET_FIELDS.forEach((id) => {
        const element = document.getElementById(id);
        element.addEventListener('input', () => element.classList.remove('field-invalid'));
        element.addEventListener('change', () => element.classList.remove('field-invalid'));
      });

      document.getElementById('pageSizeSelect').addEventListener('change', (event) => {
        pageSize = Number(event.target.value) || 10;
        currentPage = 1;
        loadCIs({ resetPage: true });
      });
      document.getElementById('prevPageBtn').addEventListener('click', () => {
        if (currentPage <= 1) return;
        currentPage -= 1;
        loadCIs();
      });
      document.getElementById('nextPageBtn').addEventListener('click', () => {
        const totalPages = Math.max(1, Math.ceil(totalCIs / pageSize));
        if (currentPage >= totalPages) return;
        currentPage += 1;
        loadCIs();
      });
      document.getElementById('pageNumberButtons').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-page]');
        if (!button) return;
        const selectedPage = Number(button.dataset.page);
        const totalPages = Math.max(1, Math.ceil(totalCIs / pageSize));
        if (!Number.isInteger(selectedPage) || selectedPage < 1 || selectedPage > totalPages) return;
        if (selectedPage === currentPage) return;
        currentPage = selectedPage;
        loadCIs();
      });

      document.getElementById('ci-table').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const ci = visibleCIs[Number(button.dataset.index)];
        if (!ci) return;

        if (button.dataset.action === 'view') {
          showDetail(ci);
          return;
        }
        if (button.dataset.action === 'delete') {
          deleteCI(ci.id);
        }
      });

      document.getElementById('ci-table-head').addEventListener('click', (event) => {
        const th = event.target.closest('th[data-sort-key]');
        if (!th) return;
        const key = th.dataset.sortKey;
        if (!key) return;

        if (ciSortState.key === key) {
          ciSortState.direction = ciSortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
          ciSortState.key = key;
          ciSortState.direction = 'asc';
        }
        currentPage = 1;
        loadCIs({ resetPage: true });
      });

      document.getElementById('closeDetailBtn').addEventListener('click', closeDetail);
      document.getElementById('detailEditBtn').addEventListener('click', startDetailEdit);
      document.getElementById('detailSaveBtn').addEventListener('click', saveDetailEdit);
      document.getElementById('detailCancelBtn').addEventListener('click', cancelDetailEdit);
      document.getElementById('detailModal').addEventListener('click', (event) => {
        if (event.target.id === 'detailModal') closeDetail();
      });

      document.getElementById('closeConfirmModalBtn').addEventListener('click', () => closeConfirmDialog(false));
      document.getElementById('cancelConfirmModalBtn').addEventListener('click', () => closeConfirmDialog(false));
      document.getElementById('confirmModalActionBtn').addEventListener('click', () => closeConfirmDialog(true));
      document.getElementById('confirmModal').addEventListener('click', (event) => {
        if (event.target.id === 'confirmModal') closeConfirmDialog(false);
      });

      document.getElementById('detail-tags-list').addEventListener('click', (event) => {
        if (detailEditMode) {
          const removeButton = event.target.closest('button[data-action="detail-remove-tag"]');
          if (removeButton) {
            const index = Number(removeButton.dataset.tagIndex);
            if (!Number.isNaN(index)) {
              detailTagsDraft.splice(index, 1);
              renderTagsList(detailTagsDraft);
            }
            return;
          }

          const addButton = event.target.closest('button[data-action="detail-add-tag"]');
          if (addButton) {
            detailTagsDraft.push({ id_tag: null, tag_name: '', tag_type: '' });
            renderTagsList(detailTagsDraft);
            return;
          }
        }

        const button = event.target.closest('button.tag-remove');
        if (!button) return;
        deleteTag(button.dataset.tagId);
      });

      document.getElementById('detail-tags-list').addEventListener('input', (event) => {
        if (!detailEditMode) return;
        const nameInput = event.target.closest('input.detail-tag-name');
        if (nameInput) {
          const index = Number(nameInput.dataset.tagIndex);
          if (!Number.isNaN(index) && detailTagsDraft[index]) {
            detailTagsDraft[index].tag_name = nameInput.value;
          }
          return;
        }

        const typeInput = event.target.closest('input.detail-tag-type');
        if (typeInput) {
          const index = Number(typeInput.dataset.tagIndex);
          if (!Number.isNaN(index) && detailTagsDraft[index]) {
            detailTagsDraft[index].tag_type = typeInput.value;
          }
        }
      });

      document.getElementById('refreshLecLogsBtn').addEventListener('click', loadLecLogs);

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          closeDetail();
          closeTenantModal();
          closeConfirmDialog(false);
        }
      });
    }

    async function init() {
      bindEvents();
      ensureDashboardStatusMonitor();
      refreshDashboardStatusIndicator();
      updateSearchPlaceholder();
      renderDynamicTagsFields();
      try {
        await Promise.all([loadCatalogs(), loadDashboard(), loadCIs()]);
      } catch (error) {
        console.error('Erro ao inicializar aplicação:', error);
        toast('Erro ao carregar dados iniciais. Por favor, recarregue a página.', 'error');
      }
    }

    init();

