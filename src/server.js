const express = require('express');
const cors = require('cors');
const path = require('path');
const { x402PaymentGate } = require('./x402/middleware');
const { defaultFacilitator } = require('./x402/facilitator');
const { NETWORKS, ASSETS } = require('./x402/types');
const { intelligenceService } = require('./services/intelligence');
const { AutonomousAgent } = require('./agent/autonomous-agent');
const { decodePaymentRequiredHeader, decodePaymentSignatureHeader, decodePaymentResponseHeader } = require('@x402/core/http');

const { ethers } = require('ethers');

const app = express();
const PORT = process.env.PORT || 3402;

// Merchant recipient wallet address (e.g., AgentMesh Treasury on Base)
const MERCHANT_WALLET = ethers.getAddress(process.env.MERCHANT_WALLET || '0x4020a6713808B9b1D50D57134800EF516E86663e');

app.use(cors({
  exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE', 'payment-required', 'payment-response']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Server-Sent Events (SSE) clients for live real-time dashboard streaming
const sseClients = new Set();

function broadcastEvent(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  });
}

// Hook facilitator events to SSE stream
defaultFacilitator.on('settlement', (receipt) => {
  broadcastEvent('settlement', receipt);
});

// Real-time SSE endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);

  // Send initial welcome & stats
  res.write(`event: init\ndata: ${JSON.stringify(defaultFacilitator.getTelemetry())}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

/* ========================================================================= */
/* PROTECTED x402 MACHINE-TO-MACHINE ENDPOINTS                               */
/* ========================================================================= */

/**
 * 1. DeFi Alpha Signals ($0.05 USDC)
 */
app.get('/api/agent/alpha-signals', 
  x402PaymentGate({
    amount: '50000', // 0.05 USDC (6 decimals)
    payTo: MERCHANT_WALLET,
    network: NETWORKS.BASE_SEPOLIA,
    description: 'Autonomous DeFi Alpha & Yield Inference Engine'
  }),
  (req, res) => {
    const data = intelligenceService.getAlphaSignals(req.x402.payer);
    res.json({
      success: true,
      statusCode: 200,
      payment: req.x402,
      data
    });
  }
);

/**
 * 2. LLM Cognitive Reasoning ($0.02 USDC)
 */
app.post('/api/agent/llm-reasoning',
  x402PaymentGate({
    amount: '20000', // 0.02 USDC
    payTo: MERCHANT_WALLET,
    network: NETWORKS.BASE_SEPOLIA,
    description: 'Cognitive Reasoning & Predictive Market Simulation'
  }),
  (req, res) => {
    const query = req.body.query || 'Base Ecosystem 48h Outlook';
    const data = intelligenceService.getLlmReasoning(req.x402.payer, query);
    res.json({
      success: true,
      statusCode: 200,
      payment: req.x402,
      data
    });
  }
);

/**
 * 3. Smart Contract Threat Radar ($0.01 USDC)
 */
app.get('/api/agent/security-audit',
  x402PaymentGate({
    amount: '10000', // 0.01 USDC
    payTo: MERCHANT_WALLET,
    network: NETWORKS.BASE_SEPOLIA,
    description: 'Autonomous Smart Contract Bytecode Security Threat Radar'
  }),
  (req, res) => {
    const contract = req.query.contract || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    const data = intelligenceService.getSecurityAudit(req.x402.payer, contract);
    res.json({
      success: true,
      statusCode: 200,
      payment: req.x402,
      data
    });
  }
);

/**
 * 4. Cross-Chain Intent & Solver Path ($0.03 USDC)
 */
app.post('/api/agent/cross-chain-route',
  x402PaymentGate({
    amount: '30000', // 0.03 USDC
    payTo: MERCHANT_WALLET,
    network: NETWORKS.BASE_SEPOLIA,
    description: 'Cross-Chain Intent & Solver Path Optimization'
  }),
  (req, res) => {
    const { fromChain, toChain, amountUsdc } = req.body;
    const data = intelligenceService.getCrossChainRoute(req.x402.payer, fromChain, toChain, amountUsdc);
    res.json({
      success: true,
      statusCode: 200,
      payment: req.x402,
      data
    });
  }
);

/* ========================================================================= */
/* FACILITATOR & MERCHANT PORTAL APIs                                        */
/* ========================================================================= */

app.get('/api/facilitator/telemetry', (req, res) => {
  res.json(defaultFacilitator.getTelemetry());
});

app.get('/api/merchant/dashboard', (req, res) => {
  const balance = defaultFacilitator.getMerchantBalance(MERCHANT_WALLET);
  const telemetry = defaultFacilitator.getTelemetry();
  res.json({
    merchantWallet: MERCHANT_WALLET,
    network: NETWORKS.BASE_SEPOLIA,
    accumulatedBalance: balance,
    recentSettlements: telemetry.recentSettlements.filter(s => s.payTo.toLowerCase() === MERCHANT_WALLET.toLowerCase()),
    totalGasSavedUsd: telemetry.totalGasSavedUsd,
    averageSettlementLatencyMs: telemetry.avgLatencyMs
  });
});

app.post('/api/merchant/withdraw', (req, res) => {
  const balance = defaultFacilitator.getMerchantBalance(MERCHANT_WALLET);
  if (BigInt(balance.units) === BigInt(0)) {
    return res.status(400).json({ error: 'No available balance to withdraw' });
  }

  // Reset merchant balance
  defaultFacilitator.merchantBalances.set(MERCHANT_WALLET.toLowerCase(), BigInt(0));

  res.json({
    success: true,
    withdrawnUnits: balance.units,
    withdrawnFormatted: balance.formattedUsdc,
    destinationWallet: MERCHANT_WALLET,
    withdrawalTxHash: '0x' + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join(''),
    timestamp: new Date().toISOString()
  });
});

/* ========================================================================= */
/* AUTONOMOUS AGENT SIMULATOR & SWARM ENGINE                                 */
/* ========================================================================= */

// Active simulated autonomous bots
const simulatedBots = [
  new AutonomousAgent({ name: 'AlphaSeeker-Bot', role: 'High-Frequency Arbitrage Scanner' }),
  new AutonomousAgent({ name: 'RiskSentinel-Bot', role: 'Security Vulnerability Monitor' }),
  new AutonomousAgent({ name: 'SolventRoute-Bot', role: 'Cross-Chain Liquidity Path Solver' })
];

app.get('/api/agent/bots', (req, res) => {
  res.json(simulatedBots.map(b => ({
    name: b.name,
    role: b.role,
    address: b.address,
    balanceUsdc: b.usdcBalance.toFixed(4),
    operationsCount: b.operationsCount,
    recentOperations: b.history.slice(0, 3)
  })));
});

app.post('/api/agent/simulate', async (req, res) => {
  const { botIndex = 0, endpoint = '/api/agent/alpha-signals' } = req.body;
  const bot = simulatedBots[botIndex % simulatedBots.length];
  const host = req.get('host') || `localhost:${PORT}`;
  const targetUrl = `${req.protocol}://${host}${endpoint}`;

  try {
    const isPost = endpoint.includes('llm') || endpoint.includes('cross-chain');
    const fetchOptions = isPost ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Analyze Base DeFi Momentum' })
    } : { method: 'GET' };

    const result = await bot.executeX402Request(targetUrl, fetchOptions);

    broadcastEvent('agent_action', {
      botName: bot.name,
      endpoint,
      cost: result.costUsdc,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      bot: {
        name: bot.name,
        address: bot.address,
        remainingBalance: bot.usdcBalance.toFixed(4)
      },
      result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ========================================================================= */
/* PROTOCOL INSPECTOR & HEADER DECODER                                       */
/* ========================================================================= */

app.post('/api/x402/inspect', (req, res) => {
  const { headerType, encodedString } = req.body;
  if (!encodedString) {
    return res.status(400).json({ error: 'encodedString is required' });
  }

  try {
    let decoded;
    if (headerType === 'PAYMENT-REQUIRED') {
      try {
        decoded = decodePaymentRequiredHeader(encodedString);
      } catch (e) {
        decoded = JSON.parse(Buffer.from(encodedString, 'base64').toString('utf-8'));
      }
    } else if (headerType === 'PAYMENT-SIGNATURE') {
      try {
        decoded = decodePaymentSignatureHeader(encodedString);
      } catch (e) {
        decoded = JSON.parse(Buffer.from(encodedString, 'base64').toString('utf-8'));
      }
    } else if (headerType === 'PAYMENT-RESPONSE') {
      try {
        decoded = decodePaymentResponseHeader(encodedString);
      } catch (e) {
        decoded = JSON.parse(Buffer.from(encodedString, 'base64').toString('utf-8'));
      }
    } else {
      decoded = JSON.parse(Buffer.from(encodedString, 'base64').toString('utf-8'));
    }

    res.json({
      valid: true,
      headerType,
      byteLength: Buffer.byteLength(encodedString, 'utf-8'),
      decoded
    });
  } catch (err) {
    res.status(400).json({
      valid: false,
      error: `Failed to decode header: ${err.message}`
    });
  }
});

/* ========================================================================= */
/* APP INITIALIZATION                                                        */
/* ========================================================================= */

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`⚡ x402-AgentMesh Gateway running at http://localhost:${PORT}`);
    console.log(`📡 Linux Foundation / Coinbase x402 Protocol V2 Active`);
    console.log(`💼 Merchant Treasury: ${MERCHANT_WALLET}`);
    console.log(`🌐 Base Sepolia USDC Settlement Enabled`);
    console.log(`======================================================\n`);
  });
}

module.exports = app;
