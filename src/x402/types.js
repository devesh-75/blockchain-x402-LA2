/**
 * x402 Protocol Specification & Constants
 * Compliant with Linux Foundation x402 V2 & Coinbase open standard.
 */

// CAIP-2 Network Identifiers
const NETWORKS = {
  BASE_MAINNET: 'eip155:8453',
  BASE_SEPOLIA: 'eip155:84532',
  ETHEREUM_MAINNET: 'eip155:1',
  ARBITRUM_ONE: 'eip155:42161'
};

// Supported Settlement Tokens
const ASSETS = {
  [NETWORKS.BASE_MAINNET]: {
    symbol: 'USDC',
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: 6,
    name: 'USD Coin'
  },
  [NETWORKS.BASE_SEPOLIA]: {
    symbol: 'USDC',
    address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    decimals: 6,
    name: 'USD Coin'
  }
};

// Standard HTTP 402 Headers defined by the x402 specification
const HEADERS = {
  PAYMENT_REQUIRED: 'PAYMENT-REQUIRED',
  PAYMENT_SIGNATURE: 'PAYMENT-SIGNATURE',
  PAYMENT_RESPONSE: 'PAYMENT-RESPONSE'
};

// EIP-712 Domain and Type definition for x402 Exact EVM Scheme
const EIP712_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' }
  ]
};

function getEip712Domain(network, assetAddress) {
  const chainId = parseInt(network.replace('eip155:', ''), 10) || 84532;
  return {
    name: 'USD Coin',
    version: '2',
    chainId: chainId,
    verifyingContract: assetAddress
  };
}

module.exports = {
  NETWORKS,
  ASSETS,
  HEADERS,
  EIP712_TYPES,
  getEip712Domain
};
