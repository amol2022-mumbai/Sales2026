// ============================================================================
// AI Sales Assistant service.
//
// Answers natural-language sales questions from real, tenant-scoped data. The
// intent classifier routes each question to a deterministic query engine that
// reuses the same company/team/self scope rules as the reports and MIS modules,
// so an answer can never leak another tenant's data or exceed the acting
// user's visibility.
//
// When an LLM provider + API key are configured, the computed facts are passed
// to the model to produce a polished answer; otherwise (or on any provider
// failure) the deterministic answer is returned directly. Secrets are read
// server-side only and never leave the server.
// ============================================================================

import { getDb } from '../db/connection.js';
import { env } from '../config/env.js';
import {
  buildLeadScopeWhere,
  buildCustomerScopeWhere,
  buildOpportunityScopeWhere,
  buildFollowUpScopeWhere,
} from './access.js';
import { withAchievement } from './targetService.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const SUGGESTED_QUESTIONS = [
  'What were our sales this month?',
  'Which salespeople are below target?',
  'Show me overdue follow-ups',
  'Which leads should I contact today?',
  'What is our open pipeline value?',
  'How do sales compare month over month?',
  'Who are our top customers?',
  'Give me a summary of today',
];

// ---------------------------------------------------------------------------
// Provider configuration (server-side only; secrets never exposed).
// ---------------------------------------------------------------------------

function defaultBaseUrl(provider) {
  switch ((provider || '').toLowerCase()) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'deepseek':
      return 'https://api.deepseek.com/v1';
    default:
      return '';
  }
}

export function getAiConfig() {
  return {
    provider: env.aiProvider || '',
    model: env.aiModel || '',
    baseUrl: env.aiBaseUrl || defaultBaseUrl(env.aiProvider),
    hasKey: Boolean(env.aiApiKey),
    timeoutMs: env.aiTimeoutMs || 30000,
  };
}

export function aiStatus() {
  const cfg = getAiConfig();
  return {
    configured: Boolean(cfg.provider && cfg.hasKey),
    provider: cfg.provider || null,
    model: cfg.model || null,
    baseUrlConfigured: Boolean(cfg.baseUrl),
    keyConfigured: cfg.hasKey,
  };
}

// ---------------------------------------------------------------------------
// Usage logging (metadata only — never the raw prompt/response).
// ---------------------------------------------------------------------------

export function logAiUsage({
  companyId = null,
  userId = null,
  provider = null,
  model = null,
  action,
  status,
  latencyMs = null,
  promptChars = null,
  responseChars = null,
  errorCode = null,
}) {
  const db = getDb();
  db.prepare(
    `INSERT INTO ai_usage_logs (company_id, user_id, provider, model, action, status, latency_ms, prompt_chars, response_chars, error_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(companyId, userId, provider, model, action, status, latencyMs, promptChars, responseChars, errorCode);
}

// ---------------------------------------------------------------------------
// Scope helpers (mirror the MIS controller so answers obey data visibility).
// ---------------------------------------------------------------------------

function scopedWhere(buildFn, scope, alias, companyId) {
  const { where, params } = buildFn(scope, alias);
  if (scope.type === 'all') {
    return { where: `WHERE ${alias}.company_id = ?`, params: [companyId] };
  }
  return { where, params };
}

function fmtMoney(n) {
  return `$${r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Intent classification (keyword routing over the supported questions).
// ---------------------------------------------------------------------------

function classify(question) {
  const q = ` ${question.toLowerCase()} `;
  const match = (re) => re.test(q);

  if (match(/overdue|past due|missed/)) return 'overdue_followups';
  if (match(/below target|under target|underperform|behind target|not met target|(?:below|under)\s+(?:their )?target/)) return 'below_target';
  if (match(/top customer|best customer|top client|customer.*\btop\b|\btop\b.*customer/)) return 'top_customers';
  if (match(/month.over.month|month-over-month|compare.*last.*month|vs\.?\s*last.*month|versus.*last.*month|comparison/)) return 'sales_mom';
  if (match(/needs? attention|struggl|worst|lowest|falling behind/)) return 'needs_attention';
  if (match(/pipeline/)) return 'pipeline';
  if (match(/contact today|call today|due today|today.*(?:lead|contact|call|follow)|(?:lead|contact|call|follow).*today/)) return 'leads_today';
  if (match(/summary.*today|today.*summary|today'?s.*(?:sales|summary|revenue)|sales today/)) return 'today_summary';
  if (match(/sales|revenue/)) return 'sales_month';
  return 'general';
}

// ---------------------------------------------------------------------------
// Deterministic answer engine. Returns { intent, facts, answer }.
// ---------------------------------------------------------------------------

function buildAnswer(db, ctx, intent) {
  const { companyId, scope } = ctx;
  const today = ctx.today;
  const month = today.slice(0, 7);

  switch (intent) {
    case 'sales_month':
      return salesMonth(db, ctx, month);
    case 'sales_mom':
      return salesMoM(db, ctx, month);
    case 'pipeline':
      return pipeline(db, ctx);
    case 'overdue_followups':
      return overdueFollowUps(db, ctx, today);
    case 'leads_today':
      return leadsToday(db, ctx, today);
    case 'top_customers':
      return topCustomers(db, ctx);
    case 'below_target':
      return belowTarget(db, ctx, today);
    case 'needs_attention':
      return needsAttention(db, ctx, today);
    case 'today_summary':
      return todaySummary(db, ctx, today);
    default:
      return generalSummary(db, ctx, today);
  }
}

function monthRange(month) {
  // month = 'YYYY-MM'
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const end = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  return { start, end };
}

function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function wonSales(db, ctx, { from, to, month }) {
  const oppW = scopedWhere(buildOpportunityScopeWhere, ctx.scope, 'o', ctx.companyId);
  const where = [];
  const params = [...oppW.params];
  where.push(`${oppW.where ? `${oppW.where.replace(/^WHERE /, '')} AND ` : ''}o.stage = 'Won' AND o.deleted_at IS NULL`);
  if (from && to) {
    where.push('o.expected_close_date BETWEEN ? AND ?');
    params.push(from, to);
  } else if (month) {
    where.push("strftime('%Y-%m', o.expected_close_date) = ?");
    params.push(month);
  }
  const row = db
    .prepare(`SELECT COALESCE(SUM(o.deal_value), 0) AS v, COUNT(*) AS c FROM opportunities o WHERE ${where.join(' AND ')}`)
    .get(...params);
  return { value: r2(row.v), count: row.c };
}

function salesMonth(db, ctx, month) {
  const s = wonSales(db, ctx, { month });
  const facts = { month, sales: s.value, deals: s.count };
  const answer = `Sales for ${month}: ${fmtMoney(s.value)} across ${s.count} won deal(s).`;
  return { intent: 'sales_month', facts, answer };
}

function salesMoM(db, ctx, month) {
  const last = prevMonth(month);
  const thisMonth = wonSales(db, ctx, { month });
  const lastMonth = wonSales(db, ctx, { month: last });
  const change = r2(thisMonth.value - lastMonth.value);
  const changePct = lastMonth.value > 0 ? r2((change / lastMonth.value) * 100) : thisMonth.value > 0 ? 100 : 0;
  const facts = {
    month,
    previousMonth: last,
    sales: thisMonth.value,
    previousSales: lastMonth.value,
    change,
    changePct,
  };
  const answer =
    `Sales this month (${month}): ${fmtMoney(thisMonth.value)} vs ${fmtMoney(lastMonth.value)} last month — ` +
    `${change >= 0 ? 'up' : 'down'} ${fmtMoney(Math.abs(change))} (${changePct}%).`;
  return { intent: 'sales_mom', facts, answer };
}

function pipeline(db, ctx) {
  const oppW = scopedWhere(buildOpportunityScopeWhere, ctx.scope, 'o', ctx.companyId);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c,
              COALESCE(SUM(o.deal_value), 0) AS v,
              COALESCE(SUM(o.deal_value * o.probability / 100.0), 0) AS w
       FROM opportunities o
       WHERE ${oppW.where ? `${oppW.where.replace(/^WHERE /, '')} AND ` : ''}o.deleted_at IS NULL AND o.stage NOT IN ('Won','Lost')`
    )
    .get(...oppW.params);
  const facts = { openCount: row.c, openValue: r2(row.v), weightedValue: r2(row.w) };
  const answer =
    `Open pipeline: ${facts.openCount} deal(s) worth ${fmtMoney(facts.openValue)} ` +
    `(weighted value ${fmtMoney(facts.weightedValue)}).`;
  return { intent: 'pipeline', facts, answer };
}

function overdueFollowUps(db, ctx, today) {
  const fW = scopedWhere(buildFollowUpScopeWhere, ctx.scope, 'f', ctx.companyId);
  const rows = db
    .prepare(
      `SELECT f.contact_person AS contact, f.follow_up_date AS date, f.activity_type AS type
       FROM follow_ups f
       WHERE ${fW.where ? `${fW.where.replace(/^WHERE /, '')} AND ` : ''}f.deleted_at IS NULL AND f.status = 'Pending' AND date(f.follow_up_date) < date(?)
       ORDER BY f.follow_up_date ASC LIMIT 20`
    )
    .all(...fW.params, today);
  const facts = { overdue: rows.length, items: rows };
  const answer = rows.length
    ? `There are ${rows.length} overdue follow-up(s). The oldest is with ${rows[0].contact || 'a contact'} (${rows[0].date}).`
    : 'No overdue follow-ups.';
  return { intent: 'overdue_followups', facts, answer };
}

function leadsToday(db, ctx, today) {
  const fW = scopedWhere(buildFollowUpScopeWhere, ctx.scope, 'f', ctx.companyId);
  const followUps = db
    .prepare(
      `SELECT f.contact_person AS contact, f.follow_up_time AS time, f.activity_type AS type
       FROM follow_ups f
       WHERE ${fW.where ? `${fW.where.replace(/^WHERE /, '')} AND ` : ''}f.deleted_at IS NULL AND f.status = 'Pending' AND date(f.follow_up_date) = date(?)
       ORDER BY f.follow_up_time ASC LIMIT 20`
    )
    .all(...fW.params, today);

  const lW = scopedWhere(buildLeadScopeWhere, ctx.scope, 'l', ctx.companyId);
  const leads = db
    .prepare(
      `SELECT l.company_name AS name, l.contact_person AS contact
       FROM leads l
       WHERE ${lW.where ? `${lW.where.replace(/^WHERE /, '')} AND ` : ''}l.deleted_at IS NULL AND date(l.next_follow_up) = date(?)
       ORDER BY l.id ASC LIMIT 20`
    )
    .all(...lW.params, today);

  const facts = { followUps: followUps.length, leads: leads.length, followUpItems: followUps, leadItems: leads };
  const total = followUps.length + leads.length;
  const answer = total
    ? `${followUps.length} follow-up(s) and ${leads.length} lead(s) are due for contact today.`
    : 'Nothing is due for contact today.';
  return { intent: 'leads_today', facts, answer };
}

function topCustomers(db, ctx) {
  const oppW = scopedWhere(buildOpportunityScopeWhere, ctx.scope, 'o', ctx.companyId);
  const rows = db
    .prepare(
      `SELECT COALESCE(c.name, 'Unnamed') AS name, COALESCE(SUM(o.deal_value), 0) AS value
       FROM opportunities o
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE ${oppW.where ? `${oppW.where.replace(/^WHERE /, '')} AND ` : ''}o.stage = 'Won' AND o.deleted_at IS NULL
       GROUP BY COALESCE(c.name, 'Unnamed')
       ORDER BY value DESC LIMIT 5`
    )
    .all(...oppW.params);
  const top = rows.map((r) => ({ name: r.name, value: r2(r.value) }));
  const facts = { topCustomers: top };
  const answer = top.length
    ? `Top customer(s) by won revenue: ${top.map((t) => `${t.name} (${fmtMoney(t.value)})`).join(', ')}.`
    : 'No won deals to rank customers yet.';
  return { intent: 'top_customers', facts, answer };
}

function visibleUsers(db, ctx) {
  const s = ctx.scope;
  if (s.type === 'all') {
    return db.prepare("SELECT id, name FROM users WHERE company_id = ? AND status = 'active'").all(ctx.companyId);
  }
  if (s.type === 'company') {
    return db.prepare("SELECT id, name FROM users WHERE company_id = ? AND status = 'active'").all(ctx.companyId);
  }
  if (s.type === 'self') {
    return db.prepare("SELECT id, name FROM users WHERE id = ? AND status = 'active'").all(s.selfId);
  }
  if (s.type === 'teams' || s.type === 'team') {
    if (!s.teamIds.length) {
      return db.prepare("SELECT id, name FROM users WHERE id = ? AND status = 'active'").all(s.selfId);
    }
    const ph = s.teamIds.map(() => '?').join(', ');
    return db
      .prepare(`SELECT id, name FROM users WHERE company_id = ? AND status = 'active' AND (team_id IN (${ph}) OR id = ?)`)
      .all(ctx.companyId, ...s.teamIds, s.selfId);
  }
  return [];
}

function belowTarget(db, ctx, today) {
  const users = visibleUsers(db, ctx);
  const rows = [];
  for (const u of users) {
    const targets = db
      .prepare(
        `SELECT * FROM targets
         WHERE company_id = ? AND scope = 'user' AND user_id = ? AND target_type = 'sales'
           AND status = 'Active' AND deleted_at IS NULL AND start_date <= ? AND end_date >= ?`
      )
      .all(ctx.companyId, u.id, today, today);
    for (const t of targets) {
      const a = withAchievement(db, t);
      if (a.achievementPct < 100) {
        rows.push({ name: u.name, target: r2(t.target_value), achievement: a.achievement, achievementPct: a.achievementPct });
      }
    }
  }
  rows.sort((a, b) => a.achievementPct - b.achievementPct);
  const facts = { belowTarget: rows };
  const answer = rows.length
    ? `${rows.length} salesperson(s) are below target: ${rows
        .map((r) => `${r.name} at ${r.achievementPct}%`)
        .join(', ')}.`
    : 'No salespeople are currently below their sales target.';
  return { intent: 'below_target', facts, answer };
}

function needsAttention(db, ctx, today) {
  const users = visibleUsers(db, ctx);
  const rows = [];
  for (const u of users) {
    const overdue = db
      .prepare(
        `SELECT COUNT(*) AS c FROM follow_ups f
         WHERE f.assigned_to = ? AND f.deleted_at IS NULL AND f.status = 'Pending' AND date(f.follow_up_date) < date(?)`
      )
      .get(u.id, today).c;
    if (overdue > 0) rows.push({ name: u.name, overdue });
  }
  rows.sort((a, b) => b.overdue - a.overdue);
  const facts = { needsAttention: rows };
  const answer = rows.length
    ? `${rows[0].name} needs attention with ${rows[0].overdue} overdue follow-up(s).`
    : 'No salesperson currently needs attention.';
  return { intent: 'needs_attention', facts, answer };
}

function todaySummary(db, ctx, today) {
  const oppW = scopedWhere(buildOpportunityScopeWhere, ctx.scope, 'o', ctx.companyId);
  const won = db
    .prepare(
      `SELECT COALESCE(SUM(o.deal_value), 0) AS v, COUNT(*) AS c FROM opportunities o
       WHERE ${oppW.where ? `${oppW.where.replace(/^WHERE /, '')} AND ` : ''}o.stage = 'Won' AND o.deleted_at IS NULL AND date(o.expected_close_date) = date(?)`
    )
    .get(...oppW.params, today);

  const lW = scopedWhere(buildLeadScopeWhere, ctx.scope, 'l', ctx.companyId);
  const newLeads = db
    .prepare(
      `SELECT COUNT(*) AS c FROM leads l
       WHERE ${lW.where ? `${lW.where.replace(/^WHERE /, '')} AND ` : ''}l.deleted_at IS NULL AND date(l.created_at) = date(?)`
    )
    .get(...lW.params, today).c;

  const fW = scopedWhere(buildFollowUpScopeWhere, ctx.scope, 'f', ctx.companyId);
  const dueToday = db
    .prepare(
      `SELECT COUNT(*) AS c FROM follow_ups f
       WHERE ${fW.where ? `${fW.where.replace(/^WHERE /, '')} AND ` : ''}f.deleted_at IS NULL AND f.status = 'Pending' AND date(f.follow_up_date) = date(?)`
    )
    .get(...fW.params, today).c;

  const facts = {
    today,
    wonValue: r2(won.v),
    wonCount: won.c,
    newLeads,
    followUpsDue: dueToday,
  };
  const answer =
    `Today's summary: ${won.c} deal(s) won (${fmtMoney(won.v)}), ${newLeads} new lead(s), ` +
    `${dueToday} follow-up(s) due.`;
  return { intent: 'today_summary', facts, answer };
}

function generalSummary(db, ctx, today) {
  const oppW = scopedWhere(buildOpportunityScopeWhere, ctx.scope, 'o', ctx.companyId);
  const won = db
    .prepare(
      `SELECT COALESCE(SUM(o.deal_value), 0) AS v, COUNT(*) AS c FROM opportunities o
       WHERE ${oppW.where ? `${oppW.where.replace(/^WHERE /, '')} AND ` : ''}o.stage = 'Won' AND o.deleted_at IS NULL`
    )
    .get(...oppW.params);

  const pipelineRow = db
    .prepare(
      `SELECT COALESCE(SUM(o.deal_value), 0) AS v FROM opportunities o
       WHERE ${oppW.where ? `${oppW.where.replace(/^WHERE /, '')} AND ` : ''}o.deleted_at IS NULL AND o.stage NOT IN ('Won','Lost')`
    )
    .get(...oppW.params);

  const lW = scopedWhere(buildLeadScopeWhere, ctx.scope, 'l', ctx.companyId);
  const leads = db
    .prepare(`SELECT COUNT(*) AS c FROM leads l WHERE ${lW.where ? `${lW.where.replace(/^WHERE /, '')} AND ` : ''}l.deleted_at IS NULL`)
    .get(...lW.params).c;

  const cW = scopedWhere(buildCustomerScopeWhere, ctx.scope, 'c', ctx.companyId);
  const customers = db
    .prepare(`SELECT COUNT(*) AS c FROM customers c WHERE ${cW.where ? `${cW.where.replace(/^WHERE /, '')} AND ` : ''}c.deleted_at IS NULL`)
    .get(...cW.params).c;

  const fW = scopedWhere(buildFollowUpScopeWhere, ctx.scope, 'f', ctx.companyId);
  const overdue = db
    .prepare(
      `SELECT COUNT(*) AS c FROM follow_ups f
       WHERE ${fW.where ? `${fW.where.replace(/^WHERE /, '')} AND ` : ''}f.deleted_at IS NULL AND f.status = 'Pending' AND date(f.follow_up_date) < date(?)`
    )
    .get(...fW.params, today).c;

  const facts = {
    totalLeads: leads,
    totalCustomers: customers,
    wonValue: r2(won.v),
    wonCount: won.c,
    openPipelineValue: r2(pipelineRow.v),
    overdueFollowUps: overdue,
  };
  const answer =
    `Overview: ${leads} lead(s), ${customers} customer(s), ${won.c} won deal(s) worth ${fmtMoney(won.v)}, ` +
    `open pipeline ${fmtMoney(pipelineRow.v)}, ${overdue} overdue follow-up(s).`;
  return { intent: 'general', facts, answer };
}

// ---------------------------------------------------------------------------
// LLM integration (optional; graceful fallback).
// ---------------------------------------------------------------------------

function systemPrompt() {
  return [
    'You are a concise sales assistant embedded in a CRM.',
    'Answer using ONLY the facts provided to you (a JSON object).',
    'Do not invent numbers. Include the key figures in your answer.',
    'If the facts are empty or zero, say so plainly.',
    'Keep the answer under 4 sentences. Mark any estimate clearly.',
  ].join(' ');
}

async function callLlm(config, messages) {
  if (!config.hasKey || !config.provider) return null;
  if (!config.baseUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs || 30000);
  try {
    const res = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.aiApiKey}`,
      },
      body: JSON.stringify({
        model: config.model || 'gpt-4o-mini',
        messages,
        temperature: 0.3,
        max_tokens: 500,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Answer a question. Never throws for provider issues; always returns a usable
 * answer from real, scoped data.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} ctx { companyId, scope, today }
 * @param {string} question
 */
export async function askAi(db, ctx, question) {
  const intent = classify(question);
  const deterministic = buildAnswer(db, ctx, intent);
  const config = getAiConfig();

  let answer = deterministic.answer;
  let providerUsed = false;
  let error = null;

  if (config.hasKey && config.provider) {
    const llm = await callLlm(config, [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: `Question: ${question}\n\nFacts: ${JSON.stringify(deterministic.facts)}` },
    ]);
    if (llm) {
      answer = llm;
      providerUsed = true;
    } else {
      error = 'LLM provider unavailable; using the computed answer.';
    }
  }

  return { intent, answer, facts: deterministic.facts, providerUsed, error };
}

export { classify };

/**
 * Verify the configured provider responds. Used by the Super Admin AI
 * Management area. Never returns secrets.
 */
export async function testAiConnection() {
  const config = getAiConfig();
  if (!config.hasKey || !config.provider) {
    return { ok: false, reason: 'not_configured' };
  }
  const reply = await callLlm(config, [{ role: 'user', content: 'Reply with the single word: ok' }]);
  if (reply) return { ok: true, reason: 'ok', model: config.model || 'default' };
  return { ok: false, reason: 'connection_failed' };
}
