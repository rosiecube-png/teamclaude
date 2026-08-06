import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsAccountRotation, hasClientCredential } from '../src/server.js';

// Which requests get a rotated ACCOUNT token injected, and which travel on the
// client's own identity.
//
// The proxy used to inject on everything except three explicitly-listed paths.
// For a single-user proxy that is invisible — the rotated account is the user.
// Once more than one person's accounts sit behind one proxy it stops being
// invisible: `/api/oauth/account/settings` answers with somebody else's
// settings, and `/v1/mcp_servers` with somebody else's server list.

test('inference endpoints rotate', () => {
  for (const url of [
    '/v1/messages',
    '/v1/messages?beta=true',
    '/v1/messages/count_tokens',
    '/v1/messages/count_tokens?beta=true',
    '/v1/complete',
    '/v1/complete?x=1',
  ]) {
    assert.equal(needsAccountRotation(url), true, url);
  }
});

test('account-scoped state endpoints do NOT rotate', () => {
  // Every one of these was observed on the wire from Claude Code 2.1.223.
  for (const url of [
    '/api/claude_cli/bootstrap?entrypoint=sdk-cli&model=claude-opus-5',
    '/api/oauth/account/settings',
    '/api/claude_code_grove',
    '/api/claude_code_penguin_mode',
    '/api/eval/sdk-abc123',
    '/api/event_logging/v2/batch',
    '/v1/mcp_servers?limit=1000',
    '/mcp-registry/v0/servers?version=latest',
  ]) {
    assert.equal(needsAccountRotation(url), false, url);
  }
});

test('lookalike paths are not mistaken for inference', () => {
  // Guard the anchoring: a prefix match would wrongly rotate all of these.
  for (const url of [
    '/v1/messages_beta',
    '/v1/messages/batches',
    '/v1/completions',
    '/api/v1/messages',
    '/v1/messagesfoo',
  ]) {
    assert.equal(needsAccountRotation(url), false, url);
  }
});

test('missing or empty url never rotates', () => {
  assert.equal(needsAccountRotation(undefined), false);
  assert.equal(needsAccountRotation(''), false);
});

test('only `authorization` counts as a client credential', () => {
  assert.equal(hasClientCredential({ headers: { authorization: 'Bearer x' } }), true);
  // x-api-key is the PROXY's key, not an Anthropic one — forwarding it upstream
  // would turn a working request into a 401, so it must not qualify.
  assert.equal(hasClientCredential({ headers: { 'x-api-key': 'tc-secret' } }), false);
  assert.equal(hasClientCredential({ headers: {} }), false);
  assert.equal(hasClientCredential({}), false);
  assert.equal(hasClientCredential(undefined), false);
});

test('a credential-less caller keeps the old inject-and-rotate behavior', () => {
  // The combination the listener actually branches on: non-inference path but no
  // client credential → must NOT be relayed, or the caller gets a 401 where it
  // used to get an answer.
  const req = { url: '/api/oauth/account/settings', headers: { 'x-api-key': 'tc-secret' } };
  const relayed = !needsAccountRotation(req.url) && hasClientCredential(req);
  assert.equal(relayed, false);
});

test('Claude Code, which always sends its own bearer, is relayed', () => {
  const req = { url: '/api/oauth/account/settings', headers: { authorization: 'Bearer sk-ant-oat01-…' } };
  const relayed = !needsAccountRotation(req.url) && hasClientCredential(req);
  assert.equal(relayed, true);
});
