const DASHBOARD_API_BASE = (() => {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return `${window.location.protocol}//${host}:3001/api`;
  }
  return '/api';
})();

let unifiedRows = [];
let filteredRows = [];
let dashboardLatestDataEpoch = 0;
let dashboardStatusTimer = null;

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

function stripTenantPrefix(value) {
  return String(value || '').trim().replace(/^\d+\s*-\s*/i, '').trim();
}

function hasTenantPrefix(value) {
  return /^\d+\s*-\s*/i.test(String(value || '').trim());
}

function normalizeTenantDisplay(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d+)\s*-\s*(.+)$/);
  if (!match) return text;
  return `${match[1]}-${match[2].trim()}`;
}

function normalizeStatusValue(value) {
  const normalized = normalizeText(value);
  const map = {
    ativo: 'active',
    active: 'active',
    online: 'active',
    ok: 'active',
    inativo: 'disconnected',
    inactive: 'disconnected',
    desconectado: 'disconnected',
    disconnected: 'disconnected',
    offline: 'disconnected',
    fora: 'disconnected',
    problem: 'disconnected',
    problema: 'disconnected',
    sem_dados: 'pending',
    manutencao: 'pending',
    maintenance: 'pending',
    planejado: 'pending',
    planned: 'pending',
    pendente: 'pending',
    pending: 'pending',
    never_connected: 'never_connected'
  };
  return map[normalized] || normalized;
}

function toEpoch(value) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value) {
  if (!value) return 'Sem evento';
  try {
    return new Date(value).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return String(value);
  }
}

function request(path, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  return fetch(`${DASHBOARD_API_BASE}${path}`, { ...options, signal: controller.signal })
    .finally(() => window.clearTimeout(timer));
}

function updateDashboardStatus(message, state = 'idle') {
  const node = document.getElementById('dashboardStatus');
  if (!node) return;
  node.textContent = message;
  node.classList.remove('state-idle', 'state-ok', 'state-warn', 'state-error');
  node.classList.add(`state-${state}`);
}

function refreshDashboardStatus() {
  if (!dashboardLatestDataEpoch) {
    updateDashboardStatus('Aguardando atualização dos dados', 'idle');
    return;
  }

  const ageMs = Date.now() - dashboardLatestDataEpoch;
  const warnThresholdMs = 20 * 60 * 1000;
  const stamp = formatDate(dashboardLatestDataEpoch);

  if (ageMs > warnThresholdMs) {
    updateDashboardStatus(`Sem atualização desde ${stamp}`, 'warn');
    return;
  }

  updateDashboardStatus(`Dados atualizados em ${stamp}`, 'ok');
}

function ensureDashboardStatusTimer() {
  if (dashboardStatusTimer) return;
  dashboardStatusTimer = window.setInterval(refreshDashboardStatus, 5000);
}

function getKey(device, ip, tenant) {
  const host = normalizeText(device || '');
  const addr = normalizeText(ip || '');
  const ten = normalizeText(tenant || '');
  if (host && addr) return `${host}|${addr}`;
  if (host) return `${host}|${ten}`;
  if (addr) return `${addr}|${ten}`;
  return `unknown|${ten}`;
}

function normalizeAgentRow(row) {
  const tenantName = row.tenant_name || row.customer_name || '-';
  const deviceName = row.hostname_fqdn || row.hostname || row.asset_name || row.name || '-';
  const ip = row.ip_address || row.ip || '';
  return {
    key: getKey(deviceName, ip, tenantName),
    deviceName,
    tenantName,
    source: 'Agents',
    status: normalizeStatusValue(row.operational_status || row.status),
    lastEvent: row.updated_at || row.last_updated || row.created_at || null
  };
}

function normalizeAgentlessRow(row) {
  const tenantName = row.custom_name || row.customer_name || '-';
  const deviceName = row.hostname_lec || row.device_name || row.ip_host || row.ip_lec || '-';
  const ip = row.ip_host || row.ip_lec || '';
  return {
    key: getKey(deviceName, ip, tenantName),
    deviceName,
    tenantName,
    source: 'Agentless',
    status: normalizeStatusValue(row.status_lec || row.status),
    lastEvent: row.last_event || null
  };
}

function mergeRows(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const existing = grouped.get(row.key);
    if (!existing) {
      grouped.set(row.key, {
        ...row,
        sources: new Set([row.source])
      });
      return;
    }

    existing.sources.add(row.source);
    if ((existing.deviceName === '-' || !existing.deviceName) && row.deviceName) {
      existing.deviceName = row.deviceName;
    }
    if ((existing.tenantName === '-' || !existing.tenantName) && row.tenantName) {
      existing.tenantName = row.tenantName;
    }

    if (toEpoch(row.lastEvent) > toEpoch(existing.lastEvent)) {
      existing.lastEvent = row.lastEvent;
    }

    if (existing.status === 'active' && row.status !== 'active') {
      existing.status = row.status;
    }
  });

  return [...grouped.values()].map((row) => ({
    ...row,
    sourceLabel: row.sources.size > 1 ? 'Agents + Agentless' : [...row.sources][0]
  }));
}

function statusPill(status) {
  const normalized = normalizeStatusValue(status);
  if (normalized === 'active') return '<span class="pill ativo">Em operação</span>';
  if (normalized === 'pending') return '<span class="pill manutencao">Pendente</span>';
  return '<span class="pill inativo">Em atenção</span>';
}

function toDateInputEpoch(value, endOfDay = false) {
  if (!value) return null;
  const normalized = endOfDay ? `${value}T23:59:59` : `${value}T00:00:00`;
  const parsed = new Date(normalized).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function openConsultaWithTenantSource(source, tenantName) {
  const params = new URLSearchParams();
  params.set('section', 'consulta');
  params.set('source', source === 'agentless' ? 'agentless' : 'agents');
  params.set('status', 'attention');
  if (tenantName) params.set('tenant', tenantName);
  window.location.href = `./index.html?${params.toString()}`;
}

function applyFilters() {
  const startDate = document.getElementById('uniStartDate')?.value || '';
  const endDate = document.getElementById('uniEndDate')?.value || '';
  const startEpoch = toDateInputEpoch(startDate, false);
  const endEpoch = toDateInputEpoch(endDate, true);

  let baseRows = unifiedRows.filter((row) => {
    if (!startEpoch && !endEpoch) return true;
    if (!row.lastEvent) return false;
    const rowEpoch = toEpoch(row.lastEvent);
    if (startEpoch && rowEpoch < startEpoch) return false;
    if (endEpoch && rowEpoch > endEpoch) return false;
    return true;
  });

  renderTenantCards(baseRows);

  filteredRows = [...baseRows];
  renderKpis();
}

function buildTenantKpis(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const tenantName = String(row.tenantName || '').trim() || 'Tenant não informado';
    const key = normalizeText(stripTenantPrefix(tenantName)) || 'tenant-nao-informado';
    const current = grouped.get(key) || {
      key,
      tenantName,
      hasPrefixedTenant: false,
      total: 0,
      active: 0,
      attention: 0,
      attentionAgents: 0,
      attentionAgentless: 0,
      latestEvent: null,
      latestEventEpoch: 0,
      latestDevice: '-',
      latestAttentionEvent: null,
      latestAttentionEventEpoch: 0,
      latestAttentionDevice: '-'
    };

    if (hasTenantPrefix(tenantName) && !hasTenantPrefix(current.tenantName)) {
      current.tenantName = normalizeTenantDisplay(tenantName);
    }
    if (hasTenantPrefix(tenantName)) current.hasPrefixedTenant = true;

    current.total += 1;
    const normalizedStatus = normalizeStatusValue(row.status);
    if (normalizedStatus === 'active') {
      current.active += 1;
    } else {
      current.attention += 1;

      const rowSources = [row.source || row.sourceLabel || ''];
      rowSources.forEach((source) => {
        const sourceKey = normalizeText(source);
        if (sourceKey === 'agents') current.attentionAgents += 1;
        if (sourceKey === 'agentless') current.attentionAgentless += 1;
      });

      const attentionEpoch = toEpoch(row.lastEvent);
      if (attentionEpoch >= current.latestAttentionEventEpoch) {
        current.latestAttentionEventEpoch = attentionEpoch;
        current.latestAttentionEvent = row.lastEvent;
        current.latestAttentionDevice = row.deviceName || '-';
      }
    }

    const eventEpoch = toEpoch(row.lastEvent);
    if (eventEpoch >= current.latestEventEpoch) {
      current.latestEventEpoch = eventEpoch;
      current.latestEvent = row.lastEvent;
      current.latestDevice = row.deviceName || '-';
    }

    grouped.set(key, current);
  });

  return [...grouped.values()]
    .filter((row) => row.hasPrefixedTenant)
    .filter((row) => Number(row.attentionAgents || 0) > 0 || Number(row.attentionAgentless || 0) > 0)
    .sort((a, b) => {
    if (b.attention !== a.attention) return b.attention - a.attention;
    if (b.total !== a.total) return b.total - a.total;
    return b.latestEventEpoch - a.latestEventEpoch;
  });
}

function renderTenantCards(rows) {
  const section = document.getElementById('dashboardTenantsSection');
  if (!section) return;

  const tenants = buildTenantKpis(rows);
  if (!tenants.length) {
    section.innerHTML = `
      <article class="card dashboard-card">
        <div class="card-header">
          <div>
            <div class="card-title">KPIs por Tenant</div>
            <div class="card-subtitle">Nenhum tenant com dados para os filtros atuais.</div>
          </div>
        </div>
      </article>
    `;
    return;
  }

  section.innerHTML = tenants.map((row) => {
    const cardClasses = [
      'card',
      'dashboard-card',
      'tenant-kpi-card',
      row.attention > 0 ? 'has-attention' : ''
    ].filter(Boolean).join(' ');

    return `
      <article class="${cardClasses}">
        <div class="tenant-kpi-header">
          <div class="tenant-kpi-name">${esc(row.tenantName)}</div>

<div class="tenant-kpi-main-row">
        <div class="tenant-total-box">
            <span class="top-count-label">Total</span>
            <span class="top-count-value total">${row.total}</span>
          </div>
          </div>
          
          <div class="tenant-attention-box">
            <div class="tenant-attention-label">ATENCAO</div>
            <div class="tenant-attention-values">
              <button class="attention-source is-clickable" type="button" data-consulta-source="agents" data-tenant-name="${esc(row.tenantName)}" title="Abrir consulta de Agentes em atenção">
                <span class="attention-value">${row.attentionAgents}</span>
                <span class="attention-caption">AGENTS</span>
              </button>
              <button class="attention-source is-clickable" type="button" data-consulta-source="agentless" data-tenant-name="${esc(row.tenantName)}" title="Abrir consulta Agentless em atenção">
                <span class="attention-value">${row.attentionAgentless}</span>
                <span class="attention-caption">AGENTLESS</span>
              </button>
            </div>
          </div>
        </div>

   

        <div class="tenant-kpi-recent">
          <span class="recent-label">Ultimo que parou: ${esc(row.latestAttentionDevice || row.latestDevice)}</span>
          <span class="recent-time">${esc(formatDate(row.latestAttentionEvent || row.latestEvent))}</span>
        </div>
      </article>
    `;
  }).join('');
}

function renderKpis() {
  const total = filteredRows.length;
  const active = filteredRows.filter((row) => normalizeStatusValue(row.status) === 'active').length;
  const attention = total - active;
  const activeTenants = new Set(filteredRows.map((row) => normalizeText(row.tenantName)).filter(Boolean)).size;

  document.getElementById('uni-total-assets').textContent = String(total);
  document.getElementById('uni-active-assets').textContent = String(active);
  document.getElementById('uni-attention-assets').textContent = String(attention);
  document.getElementById('uni-active-tenants').textContent = String(activeTenants);
}

async function loadUnifiedDashboard() {
  updateDashboardStatus('Atualizando dados...', 'idle');

  try {
    const [assetsResponse, lecResponse] = await Promise.all([
      request('/assets'),
      request('/lec-logs')
    ]);

    if (!assetsResponse.ok) throw new Error(`Assets HTTP ${assetsResponse.status}`);
    if (!lecResponse.ok) throw new Error(`LEC HTTP ${lecResponse.status}`);

    const assets = await assetsResponse.json();
    const lec = await lecResponse.json();

    const allRows = [
      ...assets.map(normalizeAgentRow),
      ...lec.map(normalizeAgentlessRow)
    ];

    // Contagem bruta: soma Agents + Agentless sem deduplicacao.
    unifiedRows = allRows;
    dashboardLatestDataEpoch = unifiedRows
      .map((row) => toEpoch(row.lastEvent))
      .reduce((max, value) => (value > max ? value : max), 0);
    applyFilters();
    refreshDashboardStatus();
  } catch (error) {
    console.error('Erro ao carregar dashboard geral:', error);
    ['uni-total-assets', 'uni-active-assets', 'uni-attention-assets', 'uni-active-tenants'].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.textContent = '-';
    });
    updateDashboardStatus('Falha ao atualizar os dados da dashboard', 'error');
  }
}

function bindEvents() {
  document.getElementById('refreshUnifiedDashboardBtn')?.addEventListener('click', loadUnifiedDashboard);
  document.getElementById('uniApplyPeriodBtn')?.addEventListener('click', applyFilters);
  document.getElementById('uniResetPeriodBtn')?.addEventListener('click', () => {
    const start = document.getElementById('uniStartDate');
    const end = document.getElementById('uniEndDate');
    if (start) start.value = '';
    if (end) end.value = '';
    applyFilters();
  });

  document.getElementById('dashboardTenantsSection')?.addEventListener('click', (event) => {
    const actionNode = event.target.closest('[data-consulta-source][data-tenant-name]');
    if (!actionNode) return;
    const source = actionNode.getAttribute('data-consulta-source') || 'agents';
    const tenantName = actionNode.getAttribute('data-tenant-name') || '';
    openConsultaWithTenantSource(source, tenantName);
  });
}

bindEvents();
ensureDashboardStatusTimer();
refreshDashboardStatus();
loadUnifiedDashboard();
