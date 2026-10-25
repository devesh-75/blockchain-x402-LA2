const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { ethers } = require('ethers');
const app = require('../src/server');
const { HEADERS, getEip712Domain, EIP712_TYPES, NETWORKS, ASSETS } = require('../src/x402/types');
const { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } = require('@x402/core/http');

test('x402 Protocol Test Suite', async (t) => {

  await t.test('1. Unpaid request returns HTTP 402 with PAYMENT-REQUIRED header', async () => {
    const res = await request(app)
      .get('/api/agent/alpha-signals')
      .expect(402);

    assert.strictEqual(res.body.statusCode, 402);
    assert.strictEqual(res.body.statusText, 'Payment Required');
    assert.strictEqual(res.body.protocol, 'x402');
    assert.ok(res.headers[HEADERS.PAYMENT_REQUIRED.toLowerCase()], 'Missing PAYMENT-REQUIRED header');

    const rawHeader = res.headers[HEADERS.PAYMENT_REQUIRED.toLowerCase()];
    const decoded = decodePaymentRequiredHeader(rawHeader);
    assert.strictEqual(decoded.x402Version, 2);
    assert.ok(decoded.accepts.length > 0);
    assert.strictEqual(decoded.accepts[0].amount, '50000');
    assert.strictEqual(decoded.accepts[0].scheme, 'exact');
  });

  await t.test('2. Valid EIP-712 signed payment unlocks resource with HTTP 200 and PAYMENT-RESPONSE', async () => {
    // 1. Initial 402 challenge
    const challengeRes = await request(app).get('/api/agent/alpha-signals').expect(402);
    const rawReqHeader = challengeRes.headers[HEADERS.PAYMENT_REQUIRED.toLowerCase()];
    const reqData = decodePaymentRequiredHeader(rawReqHeader);
    const requirement = reqData.accepts[0];

    // 2. Generate random client wallet and sign EIP-712 authorization
    const clientWallet = ethers.Wallet.createRandom();
    const network = requirement.network;
    const asset = requirement.asset;
    const domain = getEip712Domain(network, asset);

    const nowSec = Math.floor(Date.now() / 1000);
    const validBefore = nowSec + 300;
    const nonce = ethers.hexlify(ethers.randomBytes(32));

    const authorization = {
      from: clientWallet.address,
      to: requirement.payTo,
      value: BigInt(requirement.amount),
      validAfter: BigInt(0),
      validBefore: BigInt(validBefore),
      nonce
    };

    const signature = await clientWallet.signTypedData(domain, EIP712_TYPES, authorization);

    const paymentPayload = {
      x402Version: 2,
      resource: reqData.resource,
      accepted: requirement,
      payload: {
        authorization: {
          from: clientWallet.address,
          to: requirement.payTo,
          value: requirement.amount.toString(),
          validAfter: 0,
          validBefore,
          nonce
        },
        signature
      }
    };

    const sigHeader = encodePaymentSignatureHeader(paymentPayload);

    // 3. Retry request with PAYMENT-SIGNATURE
    const paidRes = await request(app)
      .get('/api/agent/alpha-signals')
      .set(HEADERS.PAYMENT_SIGNATURE, sigHeader)
      .expect(200);

    assert.strictEqual(paidRes.body.success, true);
    assert.strictEqual(paidRes.body.statusCode, 200);
    assert.ok(paidRes.body.data.arbitrageOpportunities.length > 0);

    // Verify PAYMENT-RESPONSE header
    const rawRespHeader = paidRes.headers[HEADERS.PAYMENT_RESPONSE.toLowerCase()];
    assert.ok(rawRespHeader, 'Missing PAYMENT-RESPONSE header');
    const respData = decodePaymentResponseHeader(rawRespHeader);
    assert.strictEqual(respData.success, true);
    assert.strictEqual(respData.from.toLowerCase(), clientWallet.address.toLowerCase());
    assert.ok(respData.txHash.startsWith('0x'));
  });

  await t.test('3. Replay attack: Reusing identical nonce & signature returns HTTP 403', async () => {
    // 1. Initial 402 challenge
    const challengeRes = await request(app).get('/api/agent/alpha-signals').expect(402);
    const rawReqHeader = challengeRes.headers[HEADERS.PAYMENT_REQUIRED.toLowerCase()];
    const reqData = decodePaymentRequiredHeader(rawReqHeader);
    const requirement = reqData.accepts[0];

    const clientWallet = ethers.Wallet.createRandom();
    const domain = getEip712Domain(requirement.network, requirement.asset);
    const nonce = ethers.hexlify(ethers.randomBytes(32));

    const authorization = {
      from: clientWallet.address,
      to: requirement.payTo,
      value: BigInt(requirement.amount),
      validAfter: BigInt(0),
      validBefore: BigInt(Math.floor(Date.now() / 1000) + 300),
      nonce
    };

    const signature = await clientWallet.signTypedData(domain, EIP712_TYPES, authorization);
    const paymentPayload = {
      x402Version: 2,
      resource: reqData.resource,
      accepted: requirement,
      payload: {
        authorization: {
          from: clientWallet.address,
          to: requirement.payTo,
          value: requirement.amount.toString(),
          validAfter: 0,
          validBefore: Math.floor(Date.now() / 1000) + 300,
          nonce
        },
        signature
      }
    };

    const sigHeader = encodePaymentSignatureHeader(paymentPayload);

    // First attempt: succeeds
    await request(app)
      .get('/api/agent/alpha-signals')
      .set(HEADERS.PAYMENT_SIGNATURE, sigHeader)
      .expect(200);

    // Second attempt with exact same signature: MUST be rejected with 403
    const replayRes = await request(app)
      .get('/api/agent/alpha-signals')
      .set(HEADERS.PAYMENT_SIGNATURE, sigHeader)
      .expect(403);

    assert.ok(replayRes.body.message.includes('Replay Attack Detected'));
  });

  await t.test('4. Expired authorization is rejected with HTTP 403', async () => {
    const challengeRes = await request(app).get('/api/agent/alpha-signals').expect(402);
    const reqData = decodePaymentRequiredHeader(challengeRes.headers[HEADERS.PAYMENT_REQUIRED.toLowerCase()]);
    const requirement = reqData.accepts[0];

    const clientWallet = ethers.Wallet.createRandom();
    const domain = getEip712Domain(requirement.network, requirement.asset);
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const expiredTimestamp = Math.floor(Date.now() / 1000) - 60; // 1 minute in the past

    const authorization = {
      from: clientWallet.address,
      to: requirement.payTo,
      value: BigInt(requirement.amount),
      validAfter: BigInt(0),
      validBefore: BigInt(expiredTimestamp),
      nonce
    };

    const signature = await clientWallet.signTypedData(domain, EIP712_TYPES, authorization);
    const paymentPayload = {
      x402Version: 2,
      resource: reqData.resource,
      accepted: requirement,
      payload: {
        authorization: {
          from: clientWallet.address,
          to: requirement.payTo,
          value: requirement.amount.toString(),
          validAfter: 0,
          validBefore: expiredTimestamp,
          nonce
        },
        signature
      }
    };

    const sigHeader = encodePaymentSignatureHeader(paymentPayload);

    const expiredRes = await request(app)
      .get('/api/agent/alpha-signals')
      .set(HEADERS.PAYMENT_SIGNATURE, sigHeader)
      .expect(403);

    assert.ok(expiredRes.body.message.includes('expired'));
  });

  await t.test('5. Autonomous Swarm simulation endpoint executes full automated cycle', async () => {
    const simRes = await request(app)
      .post('/api/agent/simulate')
      .send({ botIndex: 0, endpoint: '/api/agent/alpha-signals' })
      .expect(200);

    assert.strictEqual(simRes.body.success, true);
    assert.strictEqual(simRes.body.result.statusCode, 200);
    assert.ok(simRes.body.bot.name.includes('Bot'));
    assert.ok(simRes.body.result.logTrace.length >= 4);
  });

  await t.test('6. Facilitator telemetry tracks settlements and volume', async () => {
    const telRes = await request(app)
      .get('/api/facilitator/telemetry')
      .expect(200);

    assert.ok(telRes.body.totalSettlements > 0);
    assert.ok(telRes.body.operatorAddress.startsWith('0x'));
    assert.ok(telRes.body.recentSettlements.length > 0);
  });

  await t.test('7. Protocol Inspector decodes valid x402 headers', async () => {
    const challengeRes = await request(app).get('/api/agent/alpha-signals').expect(402);
    const rawReqHeader = challengeRes.headers[HEADERS.PAYMENT_REQUIRED.toLowerCase()];

    const inspectRes = await request(app)
      .post('/api/x402/inspect')
      .send({
        headerType: 'PAYMENT-REQUIRED',
        encodedString: rawReqHeader
      })
      .expect(200);

    assert.strictEqual(inspectRes.body.valid, true);
    assert.strictEqual(inspectRes.body.decoded.x402Version, 2);
  });
});
