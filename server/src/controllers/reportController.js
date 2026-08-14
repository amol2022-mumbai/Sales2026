import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { getDb } from '../db/connection.js';
import { badRequest, notFound } from '../lib/httpError.js';
import { ok } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getUserDataScope } from '../services/access.js';
import { runReport, REPORT_TYPES } from '../services/reportService.js';

const REPORT_LABELS = {
  sales: 'Sales Report',
  'lead-conversion': 'Lead Conversion Report',
  'follow-ups': 'Follow-ups Report',
  pipeline: 'Pipeline Report',
  'target-achievement': 'Target Achievement Report',
  customers: 'Customers Report',
  products: 'Products Report',
  territories: 'Territories Report',
  collections: 'Collections Report',
  aging: 'Accounts Receivable Ageing Report',
  'won-lost': 'Won / Lost Report',
  productivity: 'Salesperson Productivity Report',
};

/**
 * Resolve the trusted reporting context from the authenticated user. The
 * companyId is always derived server-side (super admins must supply it
 * explicitly); client-supplied companyId/tenantId is never trusted for
 * non-super-admin users.
 */
function resolveContext(req) {
  const scope = getUserDataScope(req.user);
  let companyId;
  if (scope.type === 'all') {
    companyId = req.query.companyId ? Number(req.query.companyId) : null;
    if (!companyId) throw badRequest('A companyId query parameter is required');
  } else {
    companyId = req.user.companyId;
  }

  return {
    companyId,
    scope,
    period: req.query.period,
    from: req.query.from,
    to: req.query.to,
    salespersonId: req.query.salespersonId,
    teamId: req.query.teamId,
    product: req.query.product,
    territory: req.query.territory,
    status: req.query.status,
    search: req.query.search,
    customerId: req.query.customerId,
  };
}

function postProcess(report, { search, sortBy, sortDir }) {
  let rows = report.rows;
  if (search) {
    const q = String(search).toLowerCase();
    rows = rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(q)));
  }
  if (sortBy && sortDir) {
    const dir = sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }
  return { ...report, rows };
}

function computeReport(req) {
  const db = getDb();
  const type = req.params.type;
  if (!REPORT_TYPES.includes(type)) throw notFound('Unknown report type');
  const report = runReport(db, type, resolveContext(req));
  if (!report) throw notFound('Unknown report type');
  return { type, report: postProcess(report, req.query) };
}

export const listReportTypes = asyncHandler(async (_req, res) => {
  return ok(
    res,
    REPORT_TYPES.map((key) => ({ key, label: REPORT_LABELS[key] || key }))
  );
});

export const getReport = asyncHandler(async (req, res) => {
  const { type, report } = computeReport(req);
  return ok(res, { type, label: REPORT_LABELS[type] || type, ...report });
});

// ---------------------------------------------------------------------------
// Export helpers (server-side CSV / XLSX / PDF).
// ---------------------------------------------------------------------------
function cellValue(v, format) {
  if (v == null) return '';
  if (format === 'currency') return Number(v).toFixed(2);
  if (format === 'percent') return `${Number(v).toFixed(1)}%`;
  return String(v);
}

function buildPdf(title, columns, rows) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(15).text(title, { align: 'center' });
    doc.moveDown(0.75);
    doc.fontSize(8.5);

    const pageWidth = doc.page.width - 60;
    const weights = columns.map((c) => Math.max(String(c.label).length, 8));
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / weightSum) * pageWidth);

    const headerY = doc.y;
    columns.forEach((c, i) => {
      doc.font('Helvetica-Bold').text(c.label, 30 + widths.slice(0, i).reduce((a, b) => a + b, 0), headerY, { width: widths[i] - 4, lineBreak: false });
    });
    doc.font('Helvetica');
    doc.moveDown(0.35);
    doc.moveTo(30, doc.y).lineTo(doc.page.width - 30, doc.y).stroke();
    doc.moveDown(0.25);

    for (const row of rows) {
      if (doc.y > doc.page.height - 50) doc.addPage();
      const startY = doc.y;
      columns.forEach((c, i) => {
        doc.text(cellValue(row[c.key], c.format), 30 + widths.slice(0, i).reduce((a, b) => a + b, 0), startY, { width: widths[i] - 4, lineBreak: false, ellipsis: true });
      });
      doc.y = startY + 13;
    }

    doc.end();
  });
}

export const exportReport = asyncHandler(async (req, res) => {
  const { type, report } = computeReport(req);
  const format = req.query.format || 'csv';
  const title = REPORT_LABELS[type] || type;

  req.audit?.('report.export', { entityType: 'report', metadata: { type, format } });

  if (format === 'pdf') {
    const buffer = await buildPdf(title, report.columns, report.rows);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${type}.pdf"`);
    return res.send(buffer);
  }

  if (format === 'xlsx') {
    const aoa = [
      report.columns.map((c) => c.label),
      ...report.rows.map((r) => report.columns.map((c) => cellValue(r[c.key], c.format))),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${type}.xlsx"`);
    return res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }

  const escape = (v) => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    report.columns.map((c) => c.label),
    ...report.rows.map((r) => report.columns.map((c) => cellValue(r[c.key], c.format))),
  ];
  const csv = '\uFEFF' + lines.map((row) => row.map(escape).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${type}.csv"`);
  return res.send(csv);
});
