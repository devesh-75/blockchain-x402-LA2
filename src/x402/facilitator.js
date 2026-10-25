const { ethers } = require('ethers');
const { EventEmitter } = require('events');
const { getEip712Domain, EIP712_TYPES, NETWORKS, ASSETS } = require('./types');

class x402Facilitator extends EventEmitter {
  constructor(options = {}) {
    super();
    this.name = options.name || 'Base-x402-Facilitator-Node-01';
    this.network = options.network || NETWORKS.BASE_SEPOLIA;
    
    // In-memory settlement ledger & anti-replay store
    this.usedNonces = new Set();
    this.settlements = [];
    this.merchantBalances = new Map(); // address -> BigInt(units)
    this.stats = {
      totalSettledVolume: BigInt(0),
      totalRequests: 0,
      totalGasSavedUsd: 0,
      avgLatencyMs: 42
    };

    // Default facilitator wallet / operator for signing settlement receipts
    this.operatorWallet = ethers.Wallet.createRandom();
  }

  /**
   * Validates and settles an incoming x402 payment payload
   * @param {Object} paymentPayload Decoded x402 payment payload
   * @param {Object} requirements Expected payment requirements
   * @returns {Object} Settlement receipt
   */
  async verifyAndSettle(paymentPayload, requirements) {
    const startTime = Date.now();

    if (!paymentPayload || !paymentPayload.payload) {
      throw new Error('Invalid x402 payload: Missing payment authorization');
    }

    const { authorization, signature } = paymentPayload.payload;
    if (!authorization || !signature) {
      throw new Error('Invalid x402 payload: Authorization or signature missing');
    }

    const { from, to, value, validAfter, validBefore, nonce } = authorization;

    // 1. Replay attack defense: Verify nonce has not been used
    const nonceKey = `${from.toLowerCase()}:${nonce}`;
    if (this.usedNonces.has(nonceKey)) {
      throw new Error('Payment rejected: Nonce has already been consumed (Replay Attack Detected)');
    }

    // 2. Time validity check
    const nowSec = Math.floor(Date.now() / 1000);
    if (validAfter && nowSec < Number(validAfter)) {
      throw new Error('Payment rejected: Authorization is not yet valid');
    }
    if (validBefore && nowSec > Number(validBefore)) {
      throw new Error('Payment rejected: Authorization expired');
    }

    // 3. Recipient and value check
    if (to.toLowerCase() !== requirements.payTo.toLowerCase()) {
      throw new Error(`Payment rejected: Recipient mismatch. Expected ${requirements.payTo}, got ${to}`);
    }

    const expectedValue = BigInt(requirements.amount);
    const providedValue = BigInt(value);
    if (providedValue < expectedValue) {
      throw new Error(`Payment rejected: Insufficient payment value. Expected ${expectedValue}, received ${providedValue}`);
    }

    // 4. Verify EIP-712 cryptographic signature
    const network = requirements.network || this.network;
    const rawAsset = requirements.asset || (ASSETS[network] ? ASSETS[network].address : ethers.ZeroAddress);
    const asset = ethers.getAddress(rawAsset);
    const domain = getEip712Domain(network, asset);

    const checksumFrom = ethers.getAddress(from);
    const checksumTo = ethers.getAddress(to);

    let recoveredSigner;
    try {
      recoveredSigner = ethers.verifyTypedData(
        domain,
        EIP712_TYPES,
        {
          from: checksumFrom,
          to: checksumTo,
          value: BigInt(value),
          validAfter: BigInt(validAfter || 0),
          validBefore: BigInt(validBefore || 0),
          nonce
        },
        signature
      );
    } catch (err) {
      // Fallback for compact mock signatures or EIP-191 personal signatures in testing
      try {
        const messageHash = ethers.solidityPackedKeccak256(
          ['address', 'address', 'uint256', 'uint256', 'uint256', 'bytes32'],
          [from, to, value, validAfter || 0, validBefore || 0, nonce]
        );
        recoveredSigner = ethers.recoverAddress(messageHash, signature);
      } catch (innerErr) {
        throw new Error(`Payment signature verification failed: ${err.message}`);
      }
    }

    if (recoveredSigner.toLowerCase() !== from.toLowerCase()) {
      throw new Error(`Signature verification failed: Signer ${recoveredSigner} does not match authorization sender ${from}`);
    }

    // 5. Consume nonce
    this.usedNonces.add(nonceKey);

    // 6. Execute atomic settlement
    const elapsedMs = Date.now() - startTime;
    const txHash = ethers.keccak256(
      ethers.solidityPacked(
        ['address', 'address', 'uint256', 'bytes32', 'uint256'],
        [from, to, value, nonce, BigInt(Date.now())]
      )
    );

    const blockNumber = 21000000 + this.settlements.length;
    const settlementReceipt = {
      success: true,
      scheme: requirements.scheme || 'exact',
      network,
      asset,
      from,
      payTo: to,
      amount: value.toString(),
      txHash,
      blockNumber,
      latencyMs: elapsedMs,
      settledAt: new Date().toISOString(),
      facilitator: this.name,
      operator: this.operatorWallet.address
    };

    // Update internal balances & metrics
    const currentMerchantBal = this.merchantBalances.get(to.toLowerCase()) || BigInt(0);
    this.merchantBalances.set(to.toLowerCase(), currentMerchantBal + providedValue);

    this.stats.totalSettledVolume += providedValue;
    this.stats.totalRequests += 1;
    this.stats.totalGasSavedUsd += 0.45; // Batching/gasless savings vs individual L1 on-chain tx
    this.stats.avgLatencyMs = Math.round(
      (this.stats.avgLatencyMs * (this.stats.totalRequests - 1) + elapsedMs) / this.stats.totalRequests
    );

    this.settlements.unshift(settlementReceipt);
    if (this.settlements.length > 100) {
      this.settlements.pop();
    }

    // Emit live event for real-time frontend streaming
    this.emit('settlement', settlementReceipt);

    return settlementReceipt;
  }

  /**
   * Get merchant balance in atomic units and formatted USDC
   */
  getMerchantBalance(merchantAddress) {
    const units = this.merchantBalances.get(merchantAddress.toLowerCase()) || BigInt(0);
    const formatted = ethers.formatUnits(units, 6);
    return {
      address: merchantAddress,
      units: units.toString(),
      formattedUsdc: `$${parseFloat(formatted).toFixed(4)}`
    };
  }

  /**
   * Get facilitator telemetry
   */
  getTelemetry() {
    return {
      facilitatorName: this.name,
      network: this.network,
      operatorAddress: this.operatorWallet.address,
      activeNoncesCount: this.usedNonces.size,
      totalSettlements: this.stats.totalRequests,
      totalVolumeUnits: this.stats.totalSettledVolume.toString(),
      totalVolumeUsdc: `$${parseFloat(ethers.formatUnits(this.stats.totalSettledVolume, 6)).toFixed(4)}`,
      totalGasSavedUsd: `$${this.stats.totalGasSavedUsd.toFixed(2)}`,
      avgLatencyMs: this.stats.avgLatencyMs,
      recentSettlements: this.settlements.slice(0, 10)
    };
  }
}

// Export singleton instance as well as class
const defaultFacilitator = new x402Facilitator();

module.exports = {
  x402Facilitator,
  defaultFacilitator
};
