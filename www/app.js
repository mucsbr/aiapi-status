const state = {
  refreshIntervalSeconds: 60,
  refreshTimer: null,
  refreshDeadline: null,
  isRefreshing: false,
};

const elements = {
  title: document.querySelector('#page-title'),
  refreshButton: document.querySelector('#refresh-button'),
  refreshHint: document.querySelector('#refresh-hint'),
  statusPill: document.querySelector('#status-pill'),
  cpaStatusPill: document.querySelector('#cpa-status-pill'),
  summaryGrid: document.querySelector('#summary-grid'),
  cpaGrid: document.querySelector('#cpa-grid'),
  configGrid: document.querySelector('#config-grid'),
  configUpdatedAt: document.querySelector('#config-updated-at'),
  modelMeta: document.querySelector('#model-meta'),
  modelGrid: document.querySelector('#model-grid'),
  rankingTable: document.querySelector('#ranking-table'),
  errorPanel: document.querySelector('#error-panel'),
};

const formatters = {
  number(value) {
    return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
  },
  percent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '-';
    return `${numeric.toFixed(numeric % 1 === 0 ? 0 : 2)}%`;
  },
  dateTime(value) {
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
  },
  unix(value) {
    return new Date(Number(value) * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  },
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusClass(status) {
  if (status === 'green' || status === 'ready' || status === 'connected') return 'green';
  if (status === 'yellow' || status === 'warming') return 'yellow';
  if (status === 'red' || status === 'failed' || status === 'error') return 'red';
  return 'gray';
}

function resolveStatusTone(status, totalRequests) {
  if ((Number(totalRequests) || 0) <= 0) return 'gray';
  return statusClass(status);
}

function resolveStatusText(status, totalRequests) {
  if ((Number(totalRequests) || 0) <= 0) return '无请求';
  return status || 'unknown';
}

function setPill(element, text, tone) {
  element.className = `status-pill status-pill--${tone}`;
  element.textContent = text;
}

function showError(message) {
  elements.errorPanel.textContent = message;
  elements.errorPanel.classList.remove('hidden');
}

function hideError() {
  elements.errorPanel.textContent = '';
  elements.errorPanel.classList.add('hidden');
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} - ${url}`);
  }
  return response.json();
}

function renderSummary(config, warmup, db, batchData, rankings) {
  const totalRequests = batchData.reduce((sum, item) => sum + (Number(item.total_requests) || 0), 0);
  const avgSuccessRate = batchData.length
    ? batchData.reduce((sum, item) => sum + (Number(item.success_rate) || 0), 0) / batchData.length
    : 0;
  const dbStatus = db?.status || '-';
  const warmupStatus = warmup?.status || '-';
  const cards = [
    {
      label: '数据库',
      value: dbStatus,
      subvalue: db?.engine || '-',
    },
    {
      label: '预热状态',
      value: warmupStatus,
      subvalue: warmup?.message || '-',
    },
    {
      label: '预热进度',
      value: `${Number(warmup?.progress) || 0}%`,
      subvalue: '系统热身状态',
    },
    {
      label: '当前时间窗口',
      value: config?.time_window || '-',
      subvalue: `刷新 ${Number(config?.refresh_interval) || 0}s`,
    },
    {
      label: '模型数量',
      value: formatters.number(config?.data?.length || 0),
      subvalue: '已选模型',
    },
    {
      label: '总请求量',
      value: formatters.number(totalRequests),
      subvalue: '当前时间窗口汇总',
    },
    {
      label: '平均成功率',
      value: formatters.percent(avgSuccessRate),
      subvalue: '按模型均值计算',
    },
    {
      label: '排行首位',
      value: rankings?.[0]?.model_name || '-',
      subvalue: rankings?.[0] ? `${formatters.number(rankings[0].request_count_24h)} 次 / 24h` : '-',
    },
  ];

  elements.summaryGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card">
          <div class="label">${escapeHtml(card.label)}</div>
          <div class="value">${escapeHtml(card.value)}</div>
          <div class="subvalue">${escapeHtml(card.subvalue)}</div>
        </article>
      `,
    )
    .join('');

  const overallTone = batchData.some((item) => item.current_status === 'red')
    ? 'red'
    : batchData.some((item) => item.current_status === 'yellow')
      ? 'yellow'
      : batchData.length
        ? 'green'
        : statusClass(dbStatus === 'connected' ? warmupStatus : dbStatus);
  setPill(elements.statusPill, `整体 ${overallTone.toUpperCase()}`, overallTone);
}

function renderCpaStatus(cpa) {
  if (!cpa?.configured) {
    setPill(elements.cpaStatusPill, '未配置', 'gray');
    elements.cpaGrid.innerHTML = `
      <article class="summary-card">
        <div class="label">CPA 状态</div>
        <div class="value">未配置</div>
        <div class="subvalue">${escapeHtml(cpa?.error || '请配置 CPA_BASE_URL 和 CPA_TOKEN')}</div>
      </article>
    `;
    return;
  }

  const tone = cpa.error ? 'red' : cpa.healthy ? 'green' : 'yellow';
  const statusText = cpa.error ? '异常' : cpa.healthy ? '健康' : '不足';
  setPill(elements.cpaStatusPill, `CPA ${statusText}`, tone);

  const cards = [
    { label: '目标池类型', value: cpa.target_type || '-', subvalue: '按 type/typo 过滤' },
    { label: '总账号数', value: formatters.number(cpa.total), subvalue: 'auth-files 总量' },
    { label: '目标池个数', value: formatters.number(cpa.candidates), subvalue: '目标类型账号数' },
    { label: '非目标类型', value: formatters.number(cpa.error_count), subvalue: 'total - candidates' },
    { label: '阈值', value: formatters.number(cpa.threshold), subvalue: '最低池容量要求' },
    { label: '完成度', value: formatters.percent(cpa.percent), subvalue: `最近检查 ${cpa.last_checked || '-'}` },
  ];

  elements.cpaGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card">
          <div class="label">${escapeHtml(card.label)}</div>
          <div class="value">${escapeHtml(card.value)}</div>
          <div class="subvalue">${escapeHtml(card.subvalue)}</div>
        </article>
      `,
    )
    .join('');
}

function renderConfig(config, updatedAt) {
  elements.title.textContent = config?.site_title || '模型状态公开看板';
  elements.configUpdatedAt.textContent = `配置更新时间：${formatters.dateTime(updatedAt)}`;

  const cards = [
    { label: '站点标题', value: config?.site_title || '未设置', subvalue: '来自上游只读配置' },
    { label: '主题', value: config?.theme || '-', subvalue: '展示用途' },
    { label: '排序方式', value: config?.sort_mode || '-', subvalue: '只读展示' },
    { label: '时间窗口', value: config?.time_window || '-', subvalue: '状态批量查询窗口' },
    { label: '刷新间隔', value: `${Number(config?.refresh_interval) || 0}s`, subvalue: '自动刷新周期' },
    { label: '已选模型', value: formatters.number(config?.data?.length || 0), subvalue: 'config.selected.data' },
  ];

  elements.configGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="config-card">
          <div class="label">${escapeHtml(card.label)}</div>
          <div class="value">${escapeHtml(card.value)}</div>
          <div class="subvalue">${escapeHtml(card.subvalue)}</div>
        </article>
      `,
    )
    .join('');
}

function renderModels(batchData, updatedAt) {
  elements.modelMeta.textContent = `共 ${batchData.length} 个模型，更新时间 ${formatters.dateTime(updatedAt)}`;

  if (!batchData.length) {
    elements.modelGrid.innerHTML = '<div class="empty-state">暂无模型状态数据。</div>';
    return;
  }

  elements.modelGrid.innerHTML = batchData
    .map((item) => {
      const slots = Array.isArray(item.slot_data) ? item.slot_data : [];
      const tone = resolveStatusTone(item.current_status, item.total_requests);
      const label = resolveStatusText(item.current_status, item.total_requests);
      return `
        <article class="model-card">
          <div class="model-top">
            <div>
              <div class="model-name">${escapeHtml(item.display_name || item.model_name)}</div>
              <div class="section-tip">${escapeHtml(item.model_name || '-')}</div>
            </div>
            <span class="status-chip status-chip--${tone}">${escapeHtml(label)}</span>
          </div>
          <div class="model-stats">
            <div class="stat-box">
              <div class="label">成功率</div>
              <div class="value">${escapeHtml(formatters.percent(item.success_rate))}</div>
            </div>
            <div class="stat-box">
              <div class="label">请求量</div>
              <div class="value">${escapeHtml(formatters.number(item.total_requests))}</div>
            </div>
            <div class="stat-box">
              <div class="label">成功数</div>
              <div class="value">${escapeHtml(formatters.number(item.success_count))}</div>
            </div>
          </div>
          <div class="slot-grid">
            ${slots
              .map(
                (slot) => {
                  const slotTone = resolveStatusTone(slot.status, slot.total_requests);
                  const slotLabel = resolveStatusText(slot.status, slot.total_requests);
                  return `
                  <div
                    class="slot slot--${slotTone}"
                    title="槽位 ${escapeHtml(slot.slot)} | ${escapeHtml(formatters.unix(slot.start_time))}-${escapeHtml(formatters.unix(slot.end_time))} | 状态 ${escapeHtml(slotLabel)} | 成功率 ${escapeHtml(formatters.percent(slot.success_rate))} | 请求 ${escapeHtml(formatters.number(slot.total_requests))}"
                  ></div>
                `;
                },
              )
              .join('')}
          </div>
        </article>
      `;
    })
    .join('');
}

function renderRanking(rankings) {
  if (!rankings.length) {
    elements.rankingTable.innerHTML = '<div class="empty-state">暂无 24h 排行数据。</div>';
    return;
  }

  elements.rankingTable.innerHTML = rankings
    .map(
      (item, index) => `
        <div class="ranking-row">
          <div class="rank">#${index + 1}</div>
          <div class="model">${escapeHtml(item.model_name)}</div>
          <div class="value">${escapeHtml(formatters.number(item.request_count_24h))}</div>
        </div>
      `,
    )
    .join('');
}

function stopRefreshTimer() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

function startRefreshTimer(seconds) {
  stopRefreshTimer();
  state.refreshIntervalSeconds = seconds;
  state.refreshDeadline = Date.now() + seconds * 1000;
  elements.refreshHint.textContent = `${seconds}s 后自动刷新`;

  state.refreshTimer = setInterval(() => {
    const remainingMs = state.refreshDeadline - Date.now();
    if (remainingMs <= 0) {
      loadDashboard();
      return;
    }
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    elements.refreshHint.textContent = `${remainingSeconds}s 后自动刷新`;
  }, 1000);
}

async function loadDashboard() {
  if (state.isRefreshing) return;
  state.isRefreshing = true;
  elements.refreshButton.disabled = true;
  elements.refreshHint.textContent = '正在刷新…';
  hideError();

  try {
    const configResponse = await requestJson('/proxy/model-status/config');
    const config = configResponse?.success === false ? null : configResponse;
    const selectedModels = Array.isArray(config?.data) ? config.data : [];
    const windowValue = config?.time_window || '6h';

    const [statusResponse, rankingsResponse, warmupResponse, dbResponse, cpaResponse] = await Promise.all([
      requestJson(`/proxy/model-status/status?window=${encodeURIComponent(windowValue)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedModels),
      }),
      requestJson('/proxy/model-status/models'),
      requestJson('/proxy/system/warmup'),
      requestJson('/proxy/health/db'),
      requestJson('/proxy/cpa/pool-status'),
    ]);

    const updatedAt = Date.now();
    const batchData = Array.isArray(statusResponse?.data) ? statusResponse.data : [];
    const rankings = Array.isArray(rankingsResponse?.data) ? [...rankingsResponse.data].sort((a, b) => (b.request_count_24h || 0) - (a.request_count_24h || 0)) : [];
    const warmup = warmupResponse?.data || {};
    const db = dbResponse || {};

    renderConfig(config, updatedAt);
    renderSummary(config, warmup, db, batchData, rankings);
    renderCpaStatus(cpaResponse || {});
    renderModels(batchData, updatedAt);
    renderRanking(rankings);
    startRefreshTimer(Math.max(10, Number(config?.refresh_interval) || 60));
  } catch (error) {
    stopRefreshTimer();
    setPill(elements.statusPill, '加载失败', 'red');
    setPill(elements.cpaStatusPill, '加载失败', 'red');
    showError(`页面加载失败：${error.message}`);
    elements.refreshHint.textContent = '请检查代理配置与上游 JWT/CPA 配置';
  } finally {
    state.isRefreshing = false;
    elements.refreshButton.disabled = false;
  }
}

elements.refreshButton.addEventListener('click', () => {
  loadDashboard();
});

loadDashboard();
