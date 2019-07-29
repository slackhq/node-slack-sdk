import { assert } from 'chai';
import * as sinon from 'sinon';
import { createRequest, createRawBodyRequest } from './test-helpers';
import { HTTPHandler } from './http-handler';
import { ServerResponse } from 'http';

import proxyquire = require('proxyquire');

const getRawBodyStub = sinon.stub();
const {
  createHTTPHandler,
  verifyRequestSignature,
} = proxyquire('./http-handler', { 'raw-body': getRawBodyStub });

// fixtures
const correctSigningSecret = 'SIGNING_SECRET';
const correctRawBody = JSON.stringify({
  type: 'event_callback',
  event: {
    type: 'reaction_added',
    user: 'U123',
    item: {
      type: 'message',
      channel: 'C123',
    },
  },
});

describe('http-handler', () => {
  let correctDate: number;

  beforeEach(() => {
    correctDate = Math.floor(Date.now() / 1000);
  });

  describe('verifyRequestSignature', () => {
    it('should return true for a valid request', () => {
      const req = createRequest(correctSigningSecret, correctDate, correctRawBody);
      const isVerified = verifyRequestSignature({
        signingSecret: correctSigningSecret,
        requestTimestamp: req.headers['x-slack-request-timestamp'],
        requestSignature: req.headers['x-slack-signature'],
        body: correctRawBody,
      });

      assert.isTrue(isVerified);
    });

    it('should throw for a request signed with a different secret', () => {
      const req = createRequest(correctSigningSecret, correctDate, correctRawBody);
      assert.throws(() => verifyRequestSignature({
        signingSecret: 'INVALID_SECRET',
        requestTimestamp: req.headers['x-slack-request-timestamp'],
        requestSignature: req.headers['x-slack-signature'],
        body: correctRawBody,
      }), 'Slack request signing verification failed');
    });
  });

  describe('createHTTPHandler', () => {
    let emit: sinon.SinonStub;
    let res: sinon.SinonStubbedInstance<any>;
    let requestListener: HTTPHandler;

    beforeEach(() => {
      emit = sinon.stub();
      res = sinon.stub({
        setHeader() { },
        send() { },
        end() {},
      });
      correctDate = Math.floor(Date.now() / 1000);
      requestListener = createHTTPHandler({
        signingSecret: correctSigningSecret,
        emit,
      });
    });

    it('should verify a correct signing secret', (done) => {
      const req = createRequest(correctSigningSecret, correctDate, correctRawBody);
      emit.resolves({ status: 200 });
      getRawBodyStub.resolves(Buffer.from(correctRawBody));
      res.end.callsFake(() => {
        assert.equal(res.statusCode, 200);
        done();
      });
      requestListener(req, (res as unknown as ServerResponse));
    });

    it('should verify a correct signing secret for a request with rawBody attribute', (done) => {
      const req = createRawBodyRequest(correctSigningSecret, correctDate, correctRawBody);
      emit.resolves({ status: 200 });
      getRawBodyStub.resolves(Buffer.from(correctRawBody));
      res.end.callsFake(() => {
        assert.equal((res as unknown as ServerResponse).statusCode, 200);
        done();
      });
      requestListener(req, (res as unknown as ServerResponse));
    });

    it('should fail request signing verification for a request with a body but no rawBody', (done) => {
      const req = createRequest(correctSigningSecret, correctDate, correctRawBody);
      (req as any).body = {};
      getRawBodyStub.resolves(Buffer.from(correctRawBody));
      res.end.callsFake(() => {
        assert.equal((res as unknown as ServerResponse).statusCode, 500);
        done();
      });
      requestListener(req, (res as unknown as ServerResponse));
    });

    it('should fail request signing verification with an incorrect signing secret', (done) => {
      const req = createRequest('INVALID_SECRET', correctDate, correctRawBody);
      getRawBodyStub.resolves(Buffer.from(correctRawBody));
      res.end.callsFake(() => {
        assert.equal((res as unknown as ServerResponse).statusCode, 404);
        done();
      });
      requestListener(req, (res as unknown as ServerResponse));
    });

    it('should fail request signing verification with old timestamp', (done) => {
      const sixMinutesAgo = Math.floor(Date.now() / 1000) - (60 * 6);
      const req = createRequest(correctSigningSecret, sixMinutesAgo, correctRawBody);
      getRawBodyStub.resolves(Buffer.from(correctRawBody));
      res.end.callsFake(() => {
        assert.equal((res as unknown as ServerResponse).statusCode, 404);
        done();
      });
      requestListener(req, (res as unknown as ServerResponse));
    });

    it('should handle unexpected error', (done) => {
      const req = createRequest(correctSigningSecret, correctDate, correctRawBody);
      getRawBodyStub.rejects(new Error('test error'));
      res.end.callsFake((result?: string) => {
        assert.equal((res as unknown as ServerResponse).statusCode, 500);
        assert.isUndefined(result);
        done();
      });
      requestListener(req, (res as unknown as ServerResponse));
    });

    it('should provide message with unexpected errors in development', (done) => {
      const req = createRequest(correctSigningSecret, correctDate, correctRawBody);
      process.env.NODE_ENV = 'development';
      getRawBodyStub.rejects(new Error('test error'));
      res.end.callsFake((result?: string) => {
        assert.equal((res as unknown as ServerResponse).statusCode, 500);
        assert.equal(result, 'test error');
        delete process.env.NODE_ENV;
        done();
      });
      requestListener(req, (res as unknown as ServerResponse));
    });

    it('should set an identification header in its responses', (done) => {
      const req = createRequest(correctSigningSecret, correctDate, correctRawBody);
      emit.resolves({ status: 200 });
      getRawBodyStub.resolves(Buffer.from(correctRawBody));
      res.end.callsFake(() => {
        assert(res.setHeader.calledWith('X-Slack-Powered-By'));
        done();
      });
      requestListener(req, (res as unknown as ServerResponse));
    });

    it('should respond to url verification requests', (done) => {
      const urlVerificationBody = '{"type":"url_verification","challenge": "TEST_CHALLENGE"}';
      const req = createRequest(correctSigningSecret, correctDate, urlVerificationBody);
      getRawBodyStub.resolves(Buffer.from(urlVerificationBody));
      res.end.callsFake(() => {
        assert(emit.notCalled);
        assert.equal((res as unknown as ServerResponse).statusCode, 200);
        done();
      });
      requestListener(req, (res as unknown as ServerResponse));
    });
  });
});
