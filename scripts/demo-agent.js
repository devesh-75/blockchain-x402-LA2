/**
 * Autonomous AI Agent CLI Demonstration
 * Demonstrates machine-to-machine HTTP 402 payments using x402 V2 & Base Sepolia USDC.
 */

const { AutonomousAgent } = require('../src/agent/autonomous-agent');

async function runDemo() {
  const PORT = process.env.PORT || 3402;
  const baseUrl = `http://localhost:${PORT}`;

  console.log('\n================================================================');
  console.log('🤖 STARTING AUTONOMOUS AI AGENT M2M x402 WORKFLOW');
  console.log('⚡ Standard: Linux Foundation / Coinbase x402 Protocol V2');
  console.log('================================================================\n');

  const agent = new AutonomousAgent({
    name: 'AlphaSentinel-AI-9000',
    role: 'Autonomous DeFi Arbitrage & Liquidity Scout'
  });

  console.log(`Agent Identifier : ${agent.name}`);
  console.log(`Role             : ${agent.role}`);
  console.log(`Agent Wallet     : ${agent.address}`);
  console.log(`Virtual Balance  : $${agent.usdcBalance.toFixed(2)} USDC\n`);

  const endpoints = [
    { name: 'DeFi Alpha Signals', path: '/api/agent/alpha-signals', method: 'GET' },
    { name: 'LLM Cognitive Reasoning', path: '/api/agent/llm-reasoning', method: 'POST', body: { query: 'Aerodrome vs Uniswap V3 Yield Spread' } },
    { name: 'Smart Contract Threat Radar', path: '/api/agent/security-audit', method: 'GET' }
  ];

  for (const ep of endpoints) {
    console.log(`----------------------------------------------------------------`);
    console.log(`📡 [DISCOVERY] Querying protected resource: ${ep.name}`);
    console.log(`🔗 Target URL: ${baseUrl}${ep.path}`);
    
    try {
      const options = ep.method === 'POST' ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ep.body)
      } : { method: 'GET' };

      const result = await agent.executeX402Request(`${baseUrl}${ep.path}`, options);

      console.log(`\n✅ Handshake Execution Trace:`);
      result.logTrace.forEach(step => {
        console.log(`   Step ${step.step}: ${step.title}`);
        if (typeof step.detail === 'object') {
          console.log(`      ${JSON.stringify(step.detail)}`);
        } else {
          console.log(`      ${step.detail}`);
        }
      });

      console.log(`\n🎉 Settlement Confirmed:`);
      console.log(`   Tx Hash       : ${result.settlementReceipt.txHash}`);
      console.log(`   Block Number  : ${result.settlementReceipt.blockNumber}`);
      console.log(`   Latency       : ${result.settlementReceipt.latencyMs}ms`);
      console.log(`   Cost          : $${result.costUsdc.toFixed(4)} USDC`);
      console.log(`   Agent Balance : $${result.remainingBalance.toFixed(4)} USDC`);
      console.log(`   Data Payload  : Received ${Object.keys(result.data).length} top-level fields`);

    } catch (err) {
      console.error(`❌ Request failed: ${err.message}`);
    }
    console.log('');
  }

  console.log('================================================================');
  console.log('🏁 AUTONOMOUS WORKFLOW COMPLETE - ZERO HUMAN INTERVENTION');
  console.log('================================================================\n');
}

if (require.main === module) {
  runDemo().catch(console.error);
}

module.exports = { runDemo };
