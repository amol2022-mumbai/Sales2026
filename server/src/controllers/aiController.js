import { getDb } from '../db/connection.js';
import { badRequest, notFound } from '../lib/httpError.js';
import { ok } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getUserDataScope } from '../services/access.js';
import { askAi, getAiConfig, logAiUsage, SUGGESTED_QUESTIONS } from '../services/aiService.js';

/**
 * Resolve the trusted company context. The companyId is always derived from the
 * authenticated user server-side; a client-supplied companyId is honoured only
 * for super admins (and is required for them). Any companyId/tenantId injected
 * by a non-super-admin is ignored.
 */
function resolveCompanyId(req, { body = {}, query = {} } = {}) {
  const scope = getUserDataScope(req.user);
  if (scope.type === 'all') {
    const raw = body.companyId ?? query.companyId;
    const companyId = raw ? Number(raw) : null;
    if (!companyId) throw badRequest('A companyId is required for super admin');
    return companyId;
  }
  return req.user.companyId;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toJson(m) {
  return { id: m.id, role: m.role, content: m.content, createdAt: m.created_at };
}

export const ask = asyncHandler(async (req, res) => {
  const db = getDb();
  const { question, conversationId } = req.body;
  const companyId = resolveCompanyId(req, { body: req.body });
  const scope = getUserDataScope(req.user);
  const ctx = { companyId, scope, today: today() };

  let convId = conversationId ? Number(conversationId) : null;
  if (convId) {
    const conv = db
      .prepare('SELECT id FROM ai_conversations WHERE id = ? AND user_id = ? AND company_id = ?')
      .get(convId, req.user.id, companyId);
    if (!conv) throw notFound('Conversation not found');
  } else {
    const title = question.length > 80 ? `${question.slice(0, 80)}…` : question;
    const createdConv = db
      .prepare('INSERT INTO ai_conversations (company_id, user_id, title) VALUES (?, ?, ?)')
      .run(companyId, req.user.id, title);
    convId = Number(createdConv.lastInsertRowid);
  }

  const started = Date.now();
  const result = await askAi(db, ctx, question);
  const latencyMs = Date.now() - started;

  db.prepare('INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, ?, ?)').run(convId, 'user', question);
  const assistantMsg = db
    .prepare('INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, ?, ?)')
    .run(convId, 'assistant', result.answer);
  db.prepare("UPDATE ai_conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(convId);

  const cfg = getAiConfig();
  logAiUsage({
    companyId,
    userId: req.user.id,
    provider: cfg.provider || null,
    model: cfg.model || null,
    action: 'ai.ask',
    status: result.error ? 'degraded' : 'ok',
    latencyMs,
    promptChars: question.length,
    responseChars: result.answer.length,
    errorCode: result.error ? 'LLM_FALLBACK' : null,
  });

  return ok(res, {
    conversationId: convId,
    intent: result.intent,
    facts: result.facts,
    providerUsed: result.providerUsed,
    suggestedQuestions: SUGGESTED_QUESTIONS,
    message: { id: Number(assistantMsg.lastInsertRowid), role: 'assistant', content: result.answer },
  });
});

export const listConversations = asyncHandler(async (req, res) => {
  const db = getDb();
  const rows = req.user.isSuperAdmin
    ? db
        .prepare('SELECT id, title, created_at, updated_at FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50')
        .all(req.user.id)
    : db
        .prepare(
          'SELECT id, title, created_at, updated_at FROM ai_conversations WHERE user_id = ? AND company_id = ? ORDER BY updated_at DESC LIMIT 50'
        )
        .all(req.user.id, req.user.companyId);

  return ok(res, rows.map((c) => ({ id: c.id, title: c.title, createdAt: c.created_at, updatedAt: c.updated_at })));
});

export const getConversation = asyncHandler(async (req, res) => {
  const db = getDb();
  const conv = req.user.isSuperAdmin
    ? db.prepare('SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
    : db
        .prepare('SELECT id FROM ai_conversations WHERE id = ? AND user_id = ? AND company_id = ?')
        .get(req.params.id, req.user.id, req.user.companyId);
  if (!conv) throw notFound('Conversation not found');

  const messages = db
    .prepare('SELECT id, role, content, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY id ASC')
    .all(conv.id);

  return ok(res, { id: conv.id, messages: messages.map(toJson) });
});
