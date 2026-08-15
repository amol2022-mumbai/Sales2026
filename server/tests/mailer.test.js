import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp, loginToken } from './helpers.js';
import { buildInviteUrl, isMailEnabled, sendInviteEmail } from '../src/services/mailer.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

test('buildInviteUrl encodes the token and falls back to a relative path when APP_URL is unset', () => {
  // In the test environment APP_URL is not set, so the URL is relative.
  const url = buildInviteUrl('abc/def?x=1');
  assert.equal(url, '/accept-invite?token=abc%2Fdef%3Fx%3D1');
  assert.ok(url.startsWith('/accept-invite?token='));
});

test('sendInviteEmail is disabled (no transport) when SMTP is not configured', async () => {
  assert.equal(isMailEnabled(), false);
  const result = await sendInviteEmail({ to: 'a@b.test', companyName: 'Acme', adminName: 'A', token: 'tok' });
  assert.equal(result.sent, false);
  assert.equal(result.link, '/accept-invite?token=tok');
});

test('sendInviteEmail sends via an injected transport and returns the invite link', async () => {
  const sent = [];
  const transport = {
    sendMail: async (msg) => {
      sent.push(msg);
      return { messageId: '<msg-123@test>' };
    },
  };

  const result = await sendInviteEmail({
    to: 'admin@acme.test',
    companyName: 'Acme Corp',
    adminName: 'Jane',
    token: 'secret-token',
    transport,
  });

  assert.equal(result.sent, true);
  assert.equal(result.messageId, '<msg-123@test>');
  assert.equal(result.link, '/accept-invite?token=secret-token');

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'admin@acme.test');
  assert.ok(sent[0].subject.includes('Acme Corp'));
  assert.ok(sent[0].text.includes(result.link));
  assert.ok(sent[0].html.includes(result.link));
});

test('invitation responses include an inviteUrl and emailSent flag', async () => {
  const { request } = initTestApp();
  const admin = await loginToken(request, 'admin@test.com', 'AdminPass123!');

  const onboard = await request
    .post('/api/admin/clients/onboard')
    .set(auth(admin))
    .send({ name: 'Email Co', adminName: 'E Admin', adminEmail: 'e-admin@email.test' });
  assert.equal(onboard.status, 201);

  const inv = onboard.body.data.invitation;
  assert.ok(inv.invitationToken);
  assert.equal(inv.email, 'e-admin@email.test');
  assert.equal(inv.inviteUrl, `/accept-invite?token=${encodeURIComponent(inv.invitationToken)}`);
  assert.equal(inv.emailSent, false);

  const companyId = onboard.body.data.company.id;
  const invited = await request
    .post(`/api/admin/clients/${companyId}/invite-admin`)
    .set(auth(admin))
    .send({ name: 'E Admin', email: 'e-admin@email.test' });
  assert.equal(invited.status, 200);
  assert.equal(invited.body.data.inviteUrl, `/accept-invite?token=${encodeURIComponent(invited.body.data.invitationToken)}`);
  assert.equal(invited.body.data.emailSent, false);
});
