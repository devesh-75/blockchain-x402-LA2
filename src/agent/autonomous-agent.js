const { ethers } = require('ethers');
const { decodePaymentRequiredHeader, encodePaymentSignatureHeader, decodePaymentResponseHeader } = require('@x402/core/http');
const { getEip712Domain, EIP712_TYPES, HEADERS, NETWORKS, ASSETS } = require('../x402/types');

class AutonomousAgent {
  /**
   * @param {Object} config
   * @param {string} [config.name] Human readable agent identifier
   * @param {string} [config.privateKey] Hex private key (or generates random)
   * @param {string} [config.role] Agent specialty (e.g. 'Arbitrage Scout', 'Sentiment Sentinel')
   */
  constructor(config = {}) {
    this.name = config.name || 'AgentMesh-AutoBot-01';
    this.role = config.role || 'Autonomous DeFi Intelligence Scout';
    this.wallet = config.privateKey ? new ethers.Wallet(config.privateKey) : ethers.Wallet.createRandom();
    this.address = this.wallet.address;
    
    // Virtual initial balance for demonstration
    this.usdcBalance = 250.00;
    this.operationsCount = 0;
    this.history = [];
  }

  /**
   * Signs an EIP-712 x402 payment authorization payload
   * @param {Object} requirement Payment requirement extracted from 402 challenge
   * @param {Object} resource Resource metadata
   * @returns {Object} Encoded payment signature header string and raw payload
   */
  async signPayment(requirement, resource) {
    const network = requirement.network || NETWORKS.BASE_SEPOLIA;
    const asset = requirement.asset || (ASSETS[network] ? ASSETS[network].address : '0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    const domain = getEip712Domain(network, asset);

    const nowSec = Math.floor(Date.now() / 1000);
    const validAfter = 0;
    const validBefore = nowSec + (requirement.maxTimeoutSeconds || 300);
    const nonce = ethers.hexlify(ethers.randomBytes(32));

    const authorization = {
      from: this.address,
      to: requirement.payTo,
      value: BigInt(requirement.amount),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce
    };

    // Sign the EIP-712 typed data
    const signature = await this.wallet.signTypedData(
      domain,
      EIP712_TYPES,
      authorization
    );

    const paymentPayload = {
      x402Version: 2,
      resource: resource || { url: '', description: '' },
      accepted: requirement,
      payload: {
        authorization: {
          from: this.address,
          to: requirement.payTo,
          value: requirement.amount.toString(),
          validAfter,
          validBefore,
          nonce
        },
        signature
      }
    };

    let encodedHeader;
    try {
      encodedHeader = encodePaymentSignatureHeader(paymentPayload);
    } catch (e) {
      encodedHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
    }

    return {
      encodedHeader,
      paymentPayload
    };
  }

  /**
   * Executes a full x402 machine-to-machine request against an endpoint
   * @param {string} endpointUrl Complete target URL
   * @param {Object} [fetchOptions] Custom fetch parameters
   */
  async executeX402Request(endpointUrl, fetchOptions = {}) {
    const logTrace = [];
    const pushLog = (step, title, detail) => {
      logTrace.push({ step, timestamp: new Date().toISOString(), title, detail });
    };

    pushLog(1, 'Initial HTTP Request', `Dispatching ${fetchOptions.method || 'GET'} to ${endpointUrl}`);

    // Step 1: Initial call without payment
    let response = await fetch(endpointUrl, {
      ...fetchOptions,
      headers: {
        'Accept': 'application/json',
        ...(fetchOptions.headers || {})
      }
    });

    if (response.status === 200) {
      pushLog(4, 'Free Resource', 'Resource accessed without 402 challenge');
      const data = await response.json();
      return { success: true, data, logTrace };
    }

    if (response.status !== 402) {
      throw new Error(`Unexpected HTTP status: ${response.status} ${response.statusText}`);
    }

    // Step 2: Handle HTTP 402 challenge
    const rawReqHeader = response.headers.get(HEADERS.PAYMENT_REQUIRED.toLowerCase()) || 
                         response.headers.get(HEADERS.PAYMENT_REQUIRED);

    let paymentRequired;
    if (rawReqHeader) {
      try {
        paymentRequired = decodePaymentRequiredHeader(rawReqHeader);
      } catch (e) {
        paymentRequired = JSON.parse(Buffer.from(rawReqHeader, 'base64').toString('utf-8'));
      }
    } else {
      const body = await response.json();
      paymentRequired = {
        accepts: [body.requirements],
        resource: { url: endpointUrl, description: body.message }
      };
    }

    const acceptedRequirement = paymentRequired.accepts[0];
    const costUsdc = parseFloat(acceptedRequirement.amount) / 1e6;

    pushLog(2, 'HTTP 402 Received', {
      status: 402,
      error: paymentRequired.error,
      cost: `$${costUsdc.toFixed(4)} USDC`,
      payTo: acceptedRequirement.payTo,
      network: acceptedRequirement.network
    });

    // Step 3: Programmatically sign payment payload
    pushLog(3, 'Signing EIP-712 Authorization', {
      signer: this.address,
      agentName: this.name,
      amountAtomic: acceptedRequirement.amount
    });

    const { encodedHeader, paymentPayload } = await this.signPayment(acceptedRequirement, paymentRequired.resource);

    // Step 4: Re-dispatch with PAYMENT-SIGNATURE
    pushLog(4, 'Dispatching PAYMENT-SIGNATURE', 'Retrying request with signed cryptographic header');

    const paidResponse = await fetch(endpointUrl, {
      ...fetchOptions,
      headers: {
        'Accept': 'application/json',
        [HEADERS.PAYMENT_SIGNATURE]: encodedHeader,
        ...(fetchOptions.headers || {})
      }
    });

    if (!paidResponse.ok) {
      const errBody = await paidResponse.json();
      throw new Error(`x402 Payment failed with status ${paidResponse.status}: ${JSON.stringify(errBody)}`);
    }

    const data = await paidResponse.json();

    // Parse settlement receipt from response header
    const rawRespHeader = paidResponse.headers.get(HEADERS.PAYMENT_RESPONSE.toLowerCase()) ||
                          paidResponse.headers.get(HEADERS.PAYMENT_RESPONSE);
    let settlementReceipt = null;
    if (rawRespHeader) {
      try {
        settlementReceipt = decodePaymentResponseHeader(rawRespHeader);
      } catch (e) {
        settlementReceipt = JSON.parse(Buffer.from(rawRespHeader, 'base64').toString('utf-8'));
      }
    }

    this.usdcBalance = Math.max(0, this.usdcBalance - costUsdc);
    this.operationsCount++;

    const executionRecord = {
      timestamp: new Date().toISOString(),
      agentName: this.name,
      endpointUrl,
      costUsdc,
      settlementReceipt,
      logTrace
    };

    this.history.unshift(executionRecord);

    return {
      success: true,
      statusCode: 200,
      data,
      settlementReceipt,
      costUsdc,
      remainingBalance: this.usdcBalance,
      logTrace
    };
  }
}

module.exports = {
  AutonomousAgent
};
