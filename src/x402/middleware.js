const { encodePaymentRequiredHeader, decodePaymentSignatureHeader, encodePaymentResponseHeader } = require('@x402/core/http');
const { defaultFacilitator } = require('./facilitator');
const { NETWORKS, ASSETS, HEADERS } = require('./types');

/**
 * Express middleware that protects a route behind the x402 Payment Required protocol.
 * 
 * @param {Object} options Configuration for payment gate
 * @param {string} options.amount Amount in atomic units (e.g. '50000' for 0.05 USDC)
 * @param {string} options.payTo Merchant wallet address
 * @param {string} [options.network] CAIP-2 network identifier (defaults to Base Sepolia)
 * @param {string} [options.asset] Token address (defaults to USDC on network)
 * @param {string} [options.description] Human-readable description of the protected resource
 * @param {number} [options.maxTimeoutSeconds] Maximum validity window for payment signature
 * @param {Object} [options.facilitator] Custom facilitator instance
 */
function x402PaymentGate(options) {
  const {
    amount,
    payTo: rawPayTo,
    network = NETWORKS.BASE_SEPOLIA,
    asset: rawAsset = (ASSETS[network] ? ASSETS[network].address : '0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
    description = 'Protected AI Agent Resource',
    maxTimeoutSeconds = 300,
    facilitator = defaultFacilitator
  } = options;

  if (!amount || !rawPayTo) {
    throw new Error('x402PaymentGate requires amount and payTo configuration');
  }

  const { ethers } = require('ethers');
  const payTo = ethers.getAddress(rawPayTo);
  const asset = ethers.getAddress(rawAsset);

  const tokenMeta = ASSETS[network] || { symbol: 'USDC', decimals: 6, name: 'USD Coin' };
  const humanReadableCost = `$${(parseFloat(amount) / Math.pow(10, tokenMeta.decimals)).toFixed(4)} ${tokenMeta.symbol}`;

  return async (req, res, next) => {
    // Expose x402 headers for CORS web3 clients
    res.setHeader('Access-Control-Expose-Headers', `${HEADERS.PAYMENT_REQUIRED}, ${HEADERS.PAYMENT_RESPONSE}`);

    // Check if client provided PAYMENT-SIGNATURE header
    const rawSigHeader = req.headers[HEADERS.PAYMENT_SIGNATURE.toLowerCase()] || 
                         req.headers[HEADERS.PAYMENT_SIGNATURE] ||
                         req.headers['x-payment-signature'];

    const resourceUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const paymentRequirements = {
      scheme: 'exact',
      network,
      amount: amount.toString(),
      asset,
      payTo,
      maxTimeoutSeconds,
      extra: {
        tokenSymbol: tokenMeta.symbol,
        tokenDecimals: tokenMeta.decimals,
        humanCost: humanReadableCost
      }
    };

    if (!rawSigHeader) {
      // 1. Client has not paid. Respond with HTTP 402 Payment Required
      const paymentRequiredPayload = {
        x402Version: 2,
        error: `Payment Required: Access to ${description} costs ${humanReadableCost}`,
        resource: {
          url: resourceUrl,
          description,
          method: req.method,
          mimeType: 'application/json'
        },
        accepts: [paymentRequirements]
      };

      let encodedHeader;
      try {
        encodedHeader = encodePaymentRequiredHeader(paymentRequiredPayload);
      } catch (err) {
        // Fallback robust standard Base64 encoding
        encodedHeader = Buffer.from(JSON.stringify(paymentRequiredPayload)).toString('base64');
      }

      res.setHeader(HEADERS.PAYMENT_REQUIRED, encodedHeader);
      res.setHeader('Cache-Control', 'private, no-store, no-cache, max-age=0');
      
      return res.status(402).json({
        statusCode: 402,
        statusText: 'Payment Required',
        protocol: 'x402',
        version: 2,
        message: `This machine-to-machine API is protected by x402. Attach a valid ${HEADERS.PAYMENT_SIGNATURE} header with signed authorization to unlock.`,
        price: {
          raw: amount.toString(),
          formatted: humanReadableCost,
          token: tokenMeta.symbol,
          decimals: tokenMeta.decimals
        },
        requirements: paymentRequirements,
        handshakeGuide: {
          step1: 'Received HTTP 402 with PAYMENT-REQUIRED header',
          step2: 'Sign EIP-712 TransferWithAuthorization using autonomous agent key or connected wallet',
          step3: `Re-dispatch request with header "${HEADERS.PAYMENT_SIGNATURE}: <base64 payload>"`,
          step4: 'Receive HTTP 200 OK with resource data and PAYMENT-RESPONSE receipt'
        }
      });
    }

    // 2. Client provided PAYMENT-SIGNATURE. Decode & Verify
    try {
      let paymentPayload;
      try {
        paymentPayload = decodePaymentSignatureHeader(rawSigHeader);
      } catch (decodeErr) {
        // Fallback base64 parse
        const decodedStr = Buffer.from(rawSigHeader, 'base64').toString('utf-8');
        paymentPayload = JSON.parse(decodedStr);
      }

      // Verify and settle payment via facilitator
      const settlementReceipt = await facilitator.verifyAndSettle(paymentPayload, paymentRequirements);

      // Attach settlement receipt to response header
      let encodedResponseHeader;
      try {
        encodedResponseHeader = encodePaymentResponseHeader(settlementReceipt);
      } catch (e) {
        encodedResponseHeader = Buffer.from(JSON.stringify(settlementReceipt)).toString('base64');
      }

      res.setHeader(HEADERS.PAYMENT_RESPONSE, encodedResponseHeader);

      // Attach x402 settlement metadata to request for route handlers
      req.x402 = {
        receipt: settlementReceipt,
        payer: settlementReceipt.from,
        amount: settlementReceipt.amount,
        txHash: settlementReceipt.txHash,
        settledAt: settlementReceipt.settledAt
      };

      next();
    } catch (paymentError) {
      return res.status(403).json({
        statusCode: 403,
        error: 'x402 Payment Settlement Failed',
        message: paymentError.message,
        requirements: paymentRequirements
      });
    }
  };
}

module.exports = {
  x402PaymentGate
};
