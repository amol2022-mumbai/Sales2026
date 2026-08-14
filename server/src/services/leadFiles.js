import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Lead import/export file handling (CSV + Excel). Pure helpers, no HTTP.
// ---------------------------------------------------------------------------

// Canonical statuses and priorities (kept in sync with the lead schema).
export const LEAD_STATUSES = [
  'New',
  'Contacted',
  'Interested',
  'Qualified',
  'Proposal Sent',
  'Negotiation',
  'Won',
  'Lost',
  'Not Interested',
  'Future Follow-up',
];

export const LEAD_PRIORITIES = ['Low', 'Medium', 'High'];

export const LEAD_SOURCES = [
  'Referral',
  'Website',
  'Cold Call',
  'Email Campaign',
  'Social Media',
  'Advertisement',
  'Event / Exhibition',
  'Walk-in',
  'Existing Customer',
  'Other',
];

// Header aliases -> canonical field. Matching is case-insensitive on trimmed
// header text.
const HEADER_ALIASES = {
  companyName: ['company', 'company name', 'company_name', 'organization', 'organisation', 'business name'],
  contactPerson: ['contact person', 'contact_person', 'contact', 'contact name', 'name', 'person', 'client name'],
  mobile: ['mobile', 'phone', 'mobile number', 'contact number', 'telephone', 'phone number', 'mobile no'],
  whatsapp: ['whatsapp', 'whats app', 'whatsapp number', 'whatsapp no'],
  email: ['email', 'email address', 'e-mail', 'mail'],
  address: ['address', 'full address'],
  city: ['city', 'town'],
  state: ['state', 'province', 'region'],
  source: ['source', 'lead source', 'lead_source', 'lead from'],
  productService: ['product', 'service', 'product/service', 'product_service', 'product service', 'product or service'],
  leadValue: ['lead value', 'lead_value', 'value', 'amount', 'deal value', 'estimated value'],
  priority: ['priority'],
  status: ['status', 'lead status', 'lead_status', 'stage'],
  nextFollowUp: ['next follow up', 'next_follow_up', 'follow up', 'follow-up', 'follow up date', 'next follow-up', 'next followup'],
  notes: ['notes', 'note', 'description'],
  remarks: ['remarks', 'remark', 'comments'],
  assignedTo: ['assigned to', 'assigned_to', 'assigned', 'salesperson', 'sales person', 'owner', 'assigned user', 'sales executive'],
};

const FIELD_LABELS = {
  companyName: 'Company',
  contactPerson: 'Contact Person',
  mobile: 'Mobile',
  whatsapp: 'WhatsApp',
  email: 'Email',
  address: 'Address',
  city: 'City',
  state: 'State',
  source: 'Source',
  productService: 'Product/Service',
  leadValue: 'Lead Value',
  priority: 'Priority',
  status: 'Status',
  nextFollowUp: 'Next Follow-up',
  notes: 'Notes',
  remarks: 'Remarks',
  assignedTo: 'Assigned To',
};

function canonicalKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Build a header-index map from a row of header cells.
 * Returns { map: { canonicalField: columnIndex }, unmatched: [headers] }.
 */
export function buildHeaderMap(headerRow) {
  const map = {};
  const unmatched = [];
  headerRow.forEach((raw, index) => {
    const key = canonicalKey(raw);
    if (!key) return;
    const field = Object.keys(HEADER_ALIASES).find((f) => HEADER_ALIASES[f].includes(key));
    if (field) map[field] = index;
    else unmatched.push(String(raw));
  });
  return { map, unmatched };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeDate(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    // Excel serial date (days since 1899-12-30).
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, a, b, y] = m;
    // Prefer DD/MM/YYYY (common locale); fall back to MM/DD if day > 12.
    let day = Number(a);
    let month = Number(b);
    if (day > 12 && Number(b) <= 12) [day, month] = [month, day];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime()) && /\d{4}/.test(s)) return parsed.toISOString().slice(0, 10);
  return null;
}

function toNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const s = String(value).trim().replace(/[,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

/**
 * Convert a parsed data row (values) into a canonical lead object using the
 * header map. Returns { row, errors }.
 */
export function normalizeRow(map, values) {
  const row = {};
  const errors = [];
  const pick = (field, { parse }) => {
    const idx = map[field];
    if (idx === undefined || idx >= values.length) return;
    const raw = values[idx];
    if (parse === 'date') row[field] = normalizeDate(raw);
    else if (parse === 'number') row[field] = toNumber(raw);
    else row[field] = raw == null ? null : String(raw).trim();
  };

  for (const field of Object.keys(FIELD_LABELS)) {
    const parse = field === 'leadValue' ? 'number' : field === 'nextFollowUp' ? 'date' : 'string';
    pick(field, { parse });
  }

  if (!row.companyName) errors.push('Company name is required');

  if (row.email && !EMAIL_RE.test(row.email)) errors.push(`Invalid email: ${row.email}`);
  if (row.leadValue != null && Number.isNaN(Number(row.leadValue))) errors.push('Lead value must be a number');

  if (row.priority) {
    const p = LEAD_PRIORITIES.find((x) => x.toLowerCase() === String(row.priority).toLowerCase());
    if (!p) errors.push(`Invalid priority: ${row.priority}`);
    else row.priority = p;
  } else {
    row.priority = 'Medium';
  }

  if (row.status) {
    const s = LEAD_STATUSES.find((x) => x.toLowerCase() === String(row.status).toLowerCase());
    if (!s) errors.push(`Invalid status: ${row.status}`);
    else row.status = s;
  } else {
    row.status = 'New';
  }

  if (row.leadValue === '') row.leadValue = null;

  return { row, errors };
}

/**
 * Duplicate keys for a row (used to detect duplicates against the DB and
 * within the import batch). Returns e.g. ['email:Acme|john@x.com'].
 */
export function leadDuplicateKeys(row) {
  const company = canonicalKey(row.companyName);
  const keys = [];
  if (row.email) keys.push(`email:${company}|${canonicalKey(row.email)}`);
  if (row.mobile) keys.push(`mobile:${company}|${canonicalKey(row.mobile)}`);
  return keys;
}

// -- CSV parsing ------------------------------------------------------------

/**
 * Parse CSV text into an array of row arrays. Handles quoted fields, escaped
 * quotes, commas and newlines inside quotes, and CRLF/LF line endings.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const input = String(text ?? '').replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      // Skip trailing fully-empty row at EOF.
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

// -- Excel parsing ----------------------------------------------------------

export function bufferToRows(buffer, { format }) {
  if (format === 'xlsx') {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  }
  // CSV text.
  return parseCsv(buffer.toString('utf8'));
}

export function base64ToBuffer(base64) {
  return Buffer.from(base64, 'base64');
}

// -- Export ----------------------------------------------------------------

export const EXPORT_COLUMNS = [
  ['leadNo', 'Lead ID'],
  ['companyName', 'Company'],
  ['contactPerson', 'Contact Person'],
  ['mobile', 'Mobile'],
  ['whatsapp', 'WhatsApp'],
  ['email', 'Email'],
  ['address', 'Address'],
  ['city', 'City'],
  ['state', 'State'],
  ['source', 'Source'],
  ['productService', 'Product/Service'],
  ['leadValue', 'Lead Value'],
  ['priority', 'Priority'],
  ['status', 'Status'],
  ['assignedTo', 'Assigned To'],
  ['teamName', 'Team'],
  ['nextFollowUp', 'Next Follow-up'],
  ['notes', 'Notes'],
  ['remarks', 'Remarks'],
  ['createdAt', 'Created Date'],
];

export function leadsToCsv(leads) {
  const header = EXPORT_COLUMNS.map(([, label]) => label);
  const lines = [header];
  for (const l of leads) {
    lines.push(EXPORT_COLUMNS.map(([key]) => {
      const v = l[key];
      return v == null ? '' : String(v);
    }));
  }
  return '\uFEFF' + lines.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

function csvEscape(value) {
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function leadsToXlsx(leads) {
  const aoa = [
    EXPORT_COLUMNS.map(([, label]) => label),
    ...leads.map((l) => EXPORT_COLUMNS.map(([key]) => (l[key] == null ? '' : l[key]))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
