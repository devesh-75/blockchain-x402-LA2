/**
 * AgentMesh // x402 - Interactive Frontend Application
 * Handles Real-Time SSE Streams, Web3 EIP-712 Signatures, and Handshake Animations.
 */

// Global State
const state = {
  activeTab: 'tab-playground',
  selectedService: {
    endpoint: '/api/agent/alpha-signals',
    method: 'GET',
    cost: '0.05',
    units: '50000',
    name: 'DeFi Alpha & Arbitrage Signals'
  },
  signingMode: 'bot', // 'bot' or 'wallet'
  userAddress: null,
  provider: null,
  signer: null,
  swarmLoopInterval: null,
  latestHeaders: {
    'PAYMENT-REQUIRED': '',
    'PAYMENT-SIGNATURE': '',
    'PAYMENT-RESPONSE': ''
  }
};

// UI Notification Helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : '⚡';
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Format Crypto Addresses
function formatAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/* ==========================================================================
   1. Real-Time Server-Sent Events (SSE) Stream
   ========================================================================== */
function initRealtimeStream() {
  const streamStatus = document.getElementById('live-stream-status');
  const eventSource = new EventSource('/api/stream');

  eventSource.onopen = () => {
    if (streamStatus) {
      streamStatus.textContent = 'CONNECTED';
      streamStatus.style.borderColor = 'rgba(0, 229, 153, 0.4)';
    }
  };

  eventSource.addEventListener('init', (e) => {
    const data = JSON.parse(e.data);
    updateMetrics(data);
    refreshMerchantDashboard();
  });

  eventSource.addEventListener('settlement', (e) => {
    const receipt = JSON.parse(e.data);
    state.latestHeaders['PAYMENT-RESPONSE'] = btoa(JSON.stringify(receipt));

    // Append to live feed
    appendFeedLog(`[SETTLEMENT] Payer ${formatAddress(receipt.from)} -> Paid $${(parseFloat(receipt.amount)/1e6).toFixed(4)} USDC on Base L2 (Tx: ${formatAddress(receipt.txHash)})`);

    // Add row to table
    prependSettlementRow(receipt);

    // Refresh telemetry & bots
    fetchTelemetry();
    fetchBots();
  });

  eventSource.addEventListener('agent_action', (e) => {
    const action = JSON.parse(e.data);
    appendFeedLog(`🤖 [AGENT ACTION] ${action.botName} resolved HTTP 402 challenge for ${action.endpoint} (Settled: $${action.cost.toFixed(4)} USDC)`);
  });

  eventSource.onerror = () => {
    if (streamStatus) {
      streamStatus.textContent = 'RECONNECTING';
      streamStatus.style.borderColor = 'rgba(255, 183, 3, 0.4)';
    }
  };
}

function appendFeedLog(text) {
  const box = document.getElementById('swarm-feed-box');
  if (!box) return;

  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.style.marginBottom = '6px';
  entry.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
  entry.style.paddingBottom = '4px';
  entry.innerHTML = `<span style="color: var(--text-dim);">[${time}]</span> <span style="color: var(--accent-emerald);">${text}</span>`;
  
  box.prepend(entry);
  if (box.children.length > 50) {
    box.lastElementChild.remove();
  }
}

function updateMetrics(telemetry) {
  if (!telemetry) return;
  const sEl = document.getElementById('metric-settlements');
  const vEl = document.getElementById('metric-volume');
  const lEl = document.getElementById('metric-latency');
  const gEl = document.getElementById('metric-gas-saved');

  if (sEl) sEl.textContent = telemetry.totalSettlements || 0;
  if (vEl) vEl.textContent = telemetry.totalVolumeUsdc || '$0.0000';
  if (lEl) lEl.textContent = `${telemetry.avgLatencyMs || 38}ms`;
  if (gEl) gEl.textContent = telemetry.totalGasSavedUsd || '$0.00';
}

async function fetchTelemetry() {
  try {
    const res = await fetch('/api/facilitator/telemetry');
    const data = await res.json();
    updateMetrics(data);
  } catch (e) {
    console.error('Failed to fetch telemetry:', e);
  }
}

/* ==========================================================================
   2. Interactive Tab Switching
   ========================================================================== */
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      state.activeTab = targetId;

      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
      });
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');

      if (targetId === 'tab-swarm') fetchBots();
      if (targetId === 'tab-treasury') refreshMerchantDashboard();
      if (targetId === 'tab-inspector') updateInspectorCurlPreview();
    });
  });
}

/* ==========================================================================
   3. Service Selector & Signer Mode Toggle
   ========================================================================== */
function initPlaygroundControls() {
  const serviceItems = document.querySelectorAll('.service-item');
  serviceItems.forEach(item => {
    item.addEventListener('click', () => {
      serviceItems.forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');

      state.selectedService = {
        endpoint: item.getAttribute('data-endpoint'),
        method: item.getAttribute('data-method'),
        cost: item.getAttribute('data-cost'),
        units: item.getAttribute('data-units'),
        name: item.querySelector('.service-name').textContent
      };

      updateInspectorCurlPreview();
    });
  });

  const botBtn = document.getElementById('mode-bot-btn');
  const walletBtn = document.getElementById('mode-wallet-btn');

  if (botBtn && walletBtn) {
    botBtn.addEventListener('click', () => {
      state.signingMode = 'bot';
      botBtn.classList.add('active');
      walletBtn.classList.remove('active');
    });

    walletBtn.addEventListener('click', async () => {
      state.signingMode = 'wallet';
      walletBtn.classList.add('active');
      botBtn.classList.remove('active');

      if (!state.userAddress) {
        await connectWeb3Wallet();
      }
    });
  }

  const execBtn = document.getElementById('execute-playground-btn');
  if (execBtn) {
    execBtn.addEventListener('click', executePlaygroundHandshake);
  }
}

/* ==========================================================================
   4. Visual x402 Handshake Pipeline Execution
   ========================================================================== */
async function executePlaygroundHandshake() {
  const execBtn = document.getElementById('execute-playground-btn');
  const statusBadge = document.getElementById('handshake-status-badge');
  if (execBtn) execBtn.disabled = true;

  resetHandshakeUI();
  if (statusBadge) {
    statusBadge.textContent = 'Handshake In Progress';
    statusBadge.style.color = 'var(--accent-base)';
  }

  try {
    const { endpoint, method, name } = state.selectedService;

    // STEP 1: Unauthenticated Probe
    setStepUI(1, 'active', 'SENDING', `Dispatching ${method} ${endpoint} with NO authorization header...`);
    await sleep(350);

    const fetchOptions = method === 'POST' ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Base L2 Yield Analytics' })
    } : { method: 'GET' };

    const firstRes = await fetch(endpoint, fetchOptions);

    if (firstRes.status !== 402) {
      setStepUI(1, 'success', `${firstRes.status}`, `Unexpected status: ${firstRes.status}`);
      showToast(`Expected HTTP 402, received ${firstRes.status}`, 'error');
      return;
    }

    setStepUI(1, 'success', '200 PROBED', `Request sent without credentials. HTTP 402 triggered.`);

    // STEP 2: Capture 402 Challenge & Decode PAYMENT-REQUIRED
    setStepUI(2, 'active', 'PARSING', `Reading headers: HTTP 402 Payment Required`);
    const rawReqHeader = firstRes.headers.get('PAYMENT-REQUIRED') || firstRes.headers.get('payment-required');
    let paymentRequirements;
    let paymentRequiredObj;

    if (rawReqHeader) {
      state.latestHeaders['PAYMENT-REQUIRED'] = rawReqHeader;
      try {
        paymentRequiredObj = JSON.parse(atob(rawReqHeader));
        paymentRequirements = paymentRequiredObj.accepts[0];
      } catch (e) {
        const body = await firstRes.json();
        paymentRequirements = body.requirements;
      }
    } else {
      const body = await firstRes.json();
      paymentRequirements = body.requirements;
    }

    await sleep(350);
    const costUsdc = (parseFloat(paymentRequirements.amount) / 1e6).toFixed(4);
    setStepUI(2, 'success', '402 CAPTURED', 
      `STATUS: 402 Payment Required\n` +
      `Asset: ${paymentRequirements.asset}\n` +
      `Network: ${paymentRequirements.network}\n` +
      `Required Amount: $${costUsdc} USDC (${paymentRequirements.amount} units)\n` +
      `Merchant PayTo: ${paymentRequirements.payTo}\n` +
      `Scheme: ${paymentRequirements.scheme} (EIP-712 TransferWithAuthorization)`
    );

    // STEP 3: Cryptographic Signing
    setStepUI(3, 'active', 'SIGNING', `Signing EIP-712 payload via ${state.signingMode === 'wallet' ? 'MetaMask' : 'Autonomous Agent Key'}...`);

    let sigHeader;
    if (state.signingMode === 'wallet') {
      if (!state.userAddress) {
        await connectWeb3Wallet();
      }
      sigHeader = await signWithBrowserWallet(paymentRequirements, paymentRequiredObj?.resource);
    } else {
      sigHeader = await signWithAutonomousAgent(paymentRequirements, paymentRequiredObj?.resource);
    }

    state.latestHeaders['PAYMENT-SIGNATURE'] = sigHeader;
    setStepUI(3, 'success', 'SIGNED', `Cryptographic signature generated & packed into PAYMENT-SIGNATURE header.`);
    await sleep(300);

    // STEP 4: Retry Request with PAYMENT-SIGNATURE & Receive Unlocked Data
    setStepUI(4, 'active', 'VERIFYING', `Re-dispatching request with PAYMENT-SIGNATURE header to facilitator...`);

    const paidRes = await fetch(endpoint, {
      ...fetchOptions,
      headers: {
        'Accept': 'application/json',
        'PAYMENT-SIGNATURE': sigHeader,
        ...(fetchOptions.headers || {})
      }
    });

    if (!paidRes.ok) {
      const errData = await paidRes.json();
      throw new Error(errData.message || 'Settlement failed');
    }

    const rawRespHeader = paidRes.headers.get('PAYMENT-RESPONSE') || paidRes.headers.get('payment-response');
    let receipt = null;
    if (rawRespHeader) {
      state.latestHeaders['PAYMENT-RESPONSE'] = rawRespHeader;
      try {
        receipt = JSON.parse(atob(rawRespHeader));
      } catch (e) {}
    }

    const payload = await paidRes.json();
    setStepUI(4, 'success', '200 UNLOCKED', 
      `HTTP 200 OK — Resource Unlocked!\n` +
      `Settlement Tx: ${receipt ? receipt.txHash : '0xVerifiedOnChain'}\n` +
      `Latency: ${receipt ? receipt.latencyMs : 34}ms\n\n` +
      `[Decrypted Payload Preview]:\n` +
      JSON.stringify(payload.data, null, 2)
    );

    if (statusBadge) {
      statusBadge.textContent = '200 OK Unlocked';
      statusBadge.style.color = 'var(--accent-emerald)';
    }

    showToast(`Payment of $${costUsdc} USDC settled! Intelligence data unlocked.`, 'success');
    fetchTelemetry();
    refreshMerchantDashboard();

  } catch (err) {
    console.error('Playground handshake error:', err);
    showToast(`Handshake failed: ${err.message}`, 'error');
    if (statusBadge) {
      statusBadge.textContent = 'Handshake Failed';
      statusBadge.style.color = 'var(--accent-red)';
    }
  } finally {
    if (execBtn) execBtn.disabled = false;
  }
}

function setStepUI(stepNum, status, badgeText, detailText) {
  const card = document.getElementById(`step-${stepNum}-card`);
  const badge = document.getElementById(`step-${stepNum}-badge`);
  const detail = document.getElementById(`step-${stepNum}-detail`);

  if (card) {
    card.classList.remove('active', 'success');
    if (status === 'active') card.classList.add('active');
    if (status === 'success') card.classList.add('success');
  }
  if (badge) badge.textContent = badgeText;
  if (detail) detail.textContent = detailText;
}

function resetHandshakeUI() {
  for (let i = 1; i <= 4; i++) {
    const card = document.getElementById(`step-${i}-card`);
    const badge = document.getElementById(`step-${i}-badge`);
    const detail = document.getElementById(`step-${i}-detail`);
    if (card) card.classList.remove('active', 'success');
    if (badge) badge.textContent = 'WAITING';
    if (detail) detail.textContent = 'Awaiting step...';
  }
}

/* ==========================================================================
   5. EIP-712 Signing Implementations (Bot vs Web3 Wallet)
   ========================================================================== */
async function signWithAutonomousAgent(requirement, resource) {
  // Use client-side Ethers to sign with an ephemeral agent wallet
  const agentWallet = window.ethers.Wallet.createRandom();
  const domain = {
    name: 'USD Coin',
    version: '2',
    chainId: parseInt(requirement.network.replace('eip155:', ''), 10) || 84532,
    verifyingContract: requirement.asset
  };

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' }
    ]
  };

  const nowSec = Math.floor(Date.now() / 1000);
  const nonce = window.ethers.hexlify(window.ethers.randomBytes(32));

  const authData = {
    from: agentWallet.address,
    to: requirement.payTo,
    value: BigInt(requirement.amount),
    validAfter: BigInt(0),
    validBefore: BigInt(nowSec + 300),
    nonce
  };

  const signature = await agentWallet.signTypedData(domain, types, authData);

  const payload = {
    x402Version: 2,
    resource: resource || { url: '', description: '' },
    accepted: requirement,
    payload: {
      authorization: {
        from: agentWallet.address,
        to: requirement.payTo,
        value: requirement.amount.toString(),
        validAfter: 0,
        validBefore: nowSec + 300,
        nonce
      },
      signature
    }
  };

  return btoa(JSON.stringify(payload));
}

async function signWithBrowserWallet(requirement, resource) {
  if (!state.signer) {
    throw new Error('Web3 wallet is not connected. Please connect MetaMask or Coinbase Wallet.');
  }

  const domain = {
    name: 'USD Coin',
    version: '2',
    chainId: parseInt(requirement.network.replace('eip155:', ''), 10) || 84532,
    verifyingContract: requirement.asset
  };

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' }
    ]
  };

  const nowSec = Math.floor(Date.now() / 1000);
  const nonce = window.ethers.hexlify(window.ethers.randomBytes(32));

  const authData = {
    from: state.userAddress,
    to: requirement.payTo,
    value: BigInt(requirement.amount),
    validAfter: BigInt(0),
    validBefore: BigInt(nowSec + 300),
    nonce
  };

  const signature = await state.signer.signTypedData(domain, types, authData);

  const payload = {
    x402Version: 2,
    resource: resource || { url: '', description: '' },
    accepted: requirement,
    payload: {
      authorization: {
        from: state.userAddress,
        to: requirement.payTo,
        value: requirement.amount.toString(),
        validAfter: 0,
        validBefore: nowSec + 300,
        nonce
      },
      signature
    }
  };

  return btoa(JSON.stringify(payload));
}

async function connectWeb3Wallet() {
  if (typeof window.ethereum === 'undefined') {
    showToast('No Web3 wallet extension found. Using simulated autonomous key.', 'info');
    state.signingMode = 'bot';
    document.getElementById('mode-bot-btn')?.classList.add('active');
    document.getElementById('mode-wallet-btn')?.classList.remove('active');
    return;
  }

  try {
    state.provider = new window.ethers.BrowserProvider(window.ethereum);
    const accounts = await state.provider.send('eth_requestAccounts', []);
    state.signer = await state.provider.getSigner();
    state.userAddress = accounts[0];

    const btnLabel = document.getElementById('wallet-btn-label');
    if (btnLabel) btnLabel.textContent = formatAddress(state.userAddress);

    showToast(`Wallet connected: ${formatAddress(state.userAddress)}`, 'success');
  } catch (err) {
    showToast(`Wallet connection failed: ${err.message}`, 'error');
  }
}

/* ==========================================================================
   6. Autonomous Swarm Simulator Controls
   ========================================================================== */
async function fetchBots() {
  try {
    const res = await fetch('/api/agent/bots');
    const bots = await res.json();
    renderBots(bots);
  } catch (e) {
    console.error('Failed to fetch bots:', e);
  }
}

function renderBots(bots) {
  const container = document.getElementById('bots-container');
  if (!container) return;

  container.innerHTML = bots.map((bot, index) => `
    <div class="glass bot-card">
      <div class="bot-top">
        <div>
          <div class="bot-name">${bot.name}</div>
          <div class="bot-role">${bot.role}</div>
        </div>
        <span class="bot-status-tag">ACTIVE AGENT</span>
      </div>

      <div style="font-size: 11px; font-family: var(--font-mono); color: var(--text-dim); margin-bottom: 8px;">
        Address: ${formatAddress(bot.address)}
      </div>

      <div class="bot-stats-row">
        <div>
          <div class="bot-stat-item">Virtual USDC Balance</div>
          <div class="bot-stat-val">$${bot.balanceUsdc}</div>
        </div>
        <div>
          <div class="bot-stat-item">x402 M2M Handshakes</div>
          <div class="bot-stat-val">${bot.operationsCount}</div>
        </div>
      </div>

      <button class="wallet-btn" style="width: 100%; justify-content: center; font-size: 13px;" onclick="triggerBotAction(${index})">
        <span>⚡</span> Run Immediate Workflow
      </button>
    </div>
  `).join('');
}

window.triggerBotAction = async function(botIndex) {
  const endpoints = [
    '/api/agent/alpha-signals',
    '/api/agent/llm-reasoning',
    '/api/agent/security-audit',
    '/api/agent/cross-chain-route'
  ];
  const chosenEndpoint = endpoints[botIndex % endpoints.length];

  try {
    const res = await fetch('/api/agent/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botIndex, endpoint: chosenEndpoint })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`${data.bot.name} settled $${data.result.costUsdc.toFixed(4)} USDC via x402`, 'success');
      fetchBots();
    }
  } catch (err) {
    showToast(`Simulation failed: ${err.message}`, 'error');
  }
};

function initSwarmControls() {
  const singleBtn = document.getElementById('trigger-single-sim-btn');
  const loopBtn = document.getElementById('toggle-swarm-loop-btn');
  const loopLabel = document.getElementById('swarm-loop-label');

  if (singleBtn) {
    singleBtn.addEventListener('click', () => {
      window.triggerBotAction(Math.floor(Math.random() * 3));
    });
  }

  if (loopBtn) {
    loopBtn.addEventListener('click', () => {
      if (state.swarmLoopInterval) {
        clearInterval(state.swarmLoopInterval);
        state.swarmLoopInterval = null;
        if (loopLabel) loopLabel.textContent = 'Start Auto-Swarm Loop';
        loopBtn.style.background = 'linear-gradient(135deg, var(--accent-base), #1e40af)';
        showToast('Autonomous swarm loop stopped', 'info');
      } else {
        state.swarmLoopInterval = setInterval(() => {
          window.triggerBotAction(Math.floor(Math.random() * 3));
        }, 4000);
        if (loopLabel) loopLabel.textContent = 'Stop Auto-Swarm Loop';
        loopBtn.style.background = 'linear-gradient(135deg, var(--accent-red), #991b1b)';
        showToast('Autonomous swarm loop active (triggering every 4s)', 'success');
      }
    });
  }
}

/* ==========================================================================
   7. Protocol Inspector & cURL Snippet Controls
   ========================================================================== */
function initInspectorControls() {
  const decodeBtn = document.getElementById('decode-header-btn');
  const sampleBtn = document.getElementById('load-sample-header-btn');
  const typeSelect = document.getElementById('header-type-select');
  const inputEl = document.getElementById('header-input-base64');
  const outputEl = document.getElementById('decoded-json-view');
  const copyCurlBtn = document.getElementById('copy-curl-btn');

  if (sampleBtn) {
    sampleBtn.addEventListener('click', () => {
      const selectedType = typeSelect.value;
      if (state.latestHeaders[selectedType]) {
        inputEl.value = state.latestHeaders[selectedType];
      } else {
        // Fallback default sample
        inputEl.value = btoa(JSON.stringify({
          x402Version: 2,
          error: "Payment required for DeFi Alpha Signals",
          resource: { url: "/api/agent/alpha-signals", description: "Alpha Engine" },
          accepts: [{
            scheme: "exact",
            network: "eip155:84532",
            amount: "50000",
            asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            payTo: "0x4020a6713808B9b1D50D57134800EF516E86663e"
          }]
        }));
      }
    });
  }

  if (decodeBtn) {
    decodeBtn.addEventListener('click', async () => {
      const encodedString = inputEl.value.trim();
      if (!encodedString) {
        showToast('Please enter a base64 encoded string', 'error');
        return;
      }

      try {
        const res = await fetch('/api/x402/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            headerType: typeSelect.value,
            encodedString
          })
        });

        const data = await res.json();
        if (data.valid) {
          outputEl.innerHTML = `<pre>${JSON.stringify(data.decoded, null, 2)}</pre>`;
          showToast('Schema validated successfully', 'success');
        } else {
          outputEl.innerHTML = `<pre style="color: var(--accent-red);">${data.error}</pre>`;
        }
      } catch (err) {
        outputEl.innerHTML = `<pre style="color: var(--accent-red);">${err.message}</pre>`;
      }
    });
  }

  if (copyCurlBtn) {
    copyCurlBtn.addEventListener('click', () => {
      const curlText = document.getElementById('curl-pre-content')?.textContent;
      if (curlText) {
        navigator.clipboard.writeText(curlText);
        showToast('cURL snippet copied to clipboard', 'success');
      }
    });
  }
}

function updateInspectorCurlPreview() {
  const pre = document.getElementById('curl-pre-content');
  if (!pre) return;

  const endpoint = state.selectedService.endpoint;
  const isPost = state.selectedService.method === 'POST';

  pre.textContent = 
`# 1. Probe the endpoint to receive the HTTP 402 challenge
curl -i -X ${isPost ? 'POST' : 'GET'} http://localhost:3402${endpoint} \\
  -H "Accept: application/json"

# Server responds:
# HTTP/1.1 402 Payment Required
# PAYMENT-REQUIRED: <base64 encoded JSON>

# 2. Re-dispatch the request with the client PAYMENT-SIGNATURE header:
curl -X ${isPost ? 'POST' : 'GET'} http://localhost:3402${endpoint} \\
  -H "PAYMENT-SIGNATURE: eyJ4NDAyVmVyc2lvbiI6MiwicmVzb3VyY2UiOnsidXJsIjoiLi4uIn0...\" \\
  -H "Accept: application/json"`;
}

/* ==========================================================================
   8. Merchant Treasury & Ledger Controls
   ========================================================================== */
async function refreshMerchantDashboard() {
  try {
    const res = await fetch('/api/merchant/dashboard');
    const data = await res.json();

    const balEl = document.getElementById('merchant-available-bal');
    if (balEl && data.accumulatedBalance) {
      balEl.textContent = data.accumulatedBalance.formattedUsdc;
    }

    if (data.recentSettlements && data.recentSettlements.length > 0) {
      renderSettlementRows(data.recentSettlements);
    }
  } catch (e) {
    console.error('Failed to load merchant dashboard:', e);
  }
}

function renderSettlementRows(settlements) {
  const tbody = document.getElementById('settlements-table-body');
  if (!tbody) return;

  tbody.innerHTML = settlements.map(s => createRowHtml(s)).join('');
}

function prependSettlementRow(s) {
  const tbody = document.getElementById('settlements-table-body');
  if (!tbody) return;

  const tr = document.createElement('tr');
  tr.innerHTML = createRowHtml(s);
  tbody.prepend(tr);

  if (tbody.children.length > 20) {
    tbody.lastElementChild.remove();
  }
}

function createRowHtml(s) {
  const cost = (parseFloat(s.amount) / 1e6).toFixed(4);
  const time = new Date(s.settledAt).toLocaleTimeString();
  return `
    <tr>
      <td style="color: var(--accent-base); font-weight: 600;">${formatAddress(s.txHash)}</td>
      <td>${formatAddress(s.from)}</td>
      <td style="color: var(--accent-emerald); font-weight: 700;">$${cost} USDC</td>
      <td><span class="brand-badge">${s.scheme}</span></td>
      <td>#${s.blockNumber}</td>
      <td>${s.latencyMs || 35}ms</td>
      <td style="color: var(--text-dim);">${time}</td>
    </tr>
  `;
}

function initTreasuryControls() {
  const withdrawBtn = document.getElementById('withdraw-btn');
  if (withdrawBtn) {
    withdrawBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/merchant/withdraw', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast(`Successfully withdrawn ${data.withdrawnFormatted} to treasury`, 'success');
          refreshMerchantDashboard();
        } else {
          showToast(data.error || 'Withdrawal failed', 'error');
        }
      } catch (e) {
        showToast(`Withdrawal failed: ${e.message}`, 'error');
      }
    });
  }
}

// Utility Sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ==========================================================================
   Initialization on DOM Load
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initRealtimeStream();
  initTabs();
  initPlaygroundControls();
  initSwarmControls();
  initInspectorControls();
  initTreasuryControls();

  const connectBtn = document.getElementById('connect-wallet-btn');
  if (connectBtn) {
    connectBtn.addEventListener('click', connectWeb3Wallet);
  }

  fetchTelemetry();
  fetchBots();
  refreshMerchantDashboard();
});
