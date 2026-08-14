import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Customer import/export file handling (CSV + Excel). Pure helpers, no HTTP.
// ---------------------------------------------------------------------------

export const CUSTOMER_TYPES = [
  'Individual',
  'Company',
  'Government',
  'Distributor',
  'Retailer',
  'Wholesaler',
  'Other',
];

export const CUSTOMER_STATUSES = ['Active', 'Inactive', 'Blocked'];

// Header aliases -> canonical field. Matching is case-insensitive on trimmed
// header text.
const HEADER_ALIASES = {
  name: ['name', 'company', 'company name', 'company/name', 'company_name', 'customer', 'customer name', 'organization', 'organisation', 'business name'],
  contactPerson: ['contact person', 'contact_person', 'contact', 'contact name', 'person', 'client name'],
  mobile: ['mobile', 'phone', 'mobile number', 'contact number', 'telephone', 'phone number', 'mobile no'],
  whatsapp: ['whatsapp', 'whats app', 'whatsapp number', 'whatsapp no'],
  email: ['email', 'email address', 'e-mail', 'mail'],
  address: ['address', 'full address'],
  city: ['city', 'town'],
  state: ['state', 'province', 'region'],
  gst: ['gst', 'gst number', 'gst no', 'gstin', 'gst in'],
  pan: ['pan', 'pan number', 'pan no', 'tax id', 'tax number'],
  customerType: ['type', 'customer type', 'customer_type', 'category', 'customer category', 'account type'],
  status: ['status', 'customer status', 'customer_status', 'account status'],
  assignedTo: ['assigned to', 'assigned_to', 'assigned', 'salesperson', 'sales person', 'owner', 'assigned user', 'sales executive'],
};

const FIELD_LABELS = {
  name: 'Company/Name',
  contactPerson: 'Contact Person',
  mobile: 'Mobile',
  whatsapp: 'WhatsApp',
  email: 'Email',
  address: 'Address',
  city: 'City',
  state: 'State',
  gst: 'GST',
  pan: 'PAN',
  customerType: 'Customer Type',
  status: 'Status',
  assignedTo: 'Assigned To',
};

function canonicalKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Build a header-index map from a row of header cells.
 * Returns { map: { canonicalField: columnIndex }, unmatched: [headers] }.
 */
export function buildCustomerHeaderMap(headerRow) {
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

/**
 * Convert a parsed data row (values) into a canonical customer object using
 * the header map. Returns { row, errors }.
 */
export function normalizeCustomerRow(map, values) {
  const row = {};
  const errors = [];
  const pick = (field) => {
    const idx = map[field];
    if (idx === undefined || idx >= values.length) return;
    const raw = values[idx];
    row[field] = raw == null ? null : String(raw).trim();
  };

  for (const field of Object.keys(FIELD_LABELS)) pick(field);

  if (!row.name) errors.push('Company/Name is required');

  if (row.email && !EMAIL_RE.test(row.email)) errors.push(`Invalid email: ${row.email}`);

  if (row.customerType) {
    const t = CUSTOMER_TYPES.find((x) => x.toLowerCase() === String(row.customerType).toLowerCase());
    if (!t) errors.push(`Invalid customer type: ${row.customerType}`);
    else row.customerType = t;
  } else {
    row.customerType = 'Company';
  }

  if (row.status) {
    const s = CUSTOMER_STATUSES.find((x) => x.toLowerCase() === String(row.status).toLowerCase());
    if (!s) errors.push(`Invalid status: ${row.status}`);
    else row.status = s;
  } else {
    row.status = 'Active';
  }

  return { row, errors };
}

/**
 * Duplicate keys for a row (used to detect duplicates against the DB and
 * within the import batch). Returns e.g. ['email:Acme|john@x.com'].
 */
export function customerDuplicateKeys(row) {
  const name = canonicalKey(row.name);
  const keys = [];
  if (row.email) keys.push(`email:${name}|${canonicalKey(row.email)}`);
  if (row.mobile) keys.push(`mobile:${name}|${canonicalKey(row.mobile)}`);
  if (row.gst) keys.push(`gst:${name}|${canonicalKey(row.gst)}`);
  return keys;
}

// -- CSV parsing ------------------------------------------------------------

/**
 * Parse CSV text into an array of row arrays. Handles quoted fields, escaped
 * quotes, commas and newlines inside quotes, and CRLF/LF line endings.
 */
export function parseCustomerCsv(text) {
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

export function customerBufferToRows(buffer, { format }) {
  if (format === 'xlsx') {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  }
  return parseCustomerCsv(buffer.toString('utf8'));
}

export function base64ToBuffer(base64) {
  return Buffer.from(base64, 'base64');
}

// -- Export ----------------------------------------------------------------

export const CUSTOMER_EXPORT_COLUMNS = [
  ['customerNo', 'Customer ID'],
  ['name', 'Company/Name'],
  ['contactPerson', 'Contact Person'],
  ['mobile', 'Mobile'],
  ['whatsapp', 'WhatsApp'],
  ['email', 'Email'],
  ['address', 'Address'],
  ['city', 'City'],
  ['state', 'State'],
  ['gst', 'GST'],
  ['pan', 'PAN'],
  ['customerType', 'Customer Type'],
  ['status', 'Status'],
  ['assignedName', 'Assigned To'],
  ['teamName', 'Team'],
  ['leadNo', 'Source Lead'],
  ['createdAt', 'Created Date'],
];

export function customersToCsv(customers) {
  const header = CUSTOMER_EXPORT_COLUMNS.map(([, label]) => label);
  const lines = [header];
  for (const c of customers) {
    lines.push(CUSTOMER_EXPORT_COLUMNS.map(([key]) => {
      const v = c[key];
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

export function customersToXlsx(customers) {
  const aoa = [
    CUSTOMER_EXPORT_COLUMNS.map(([, label]) => label),
    ...customers.map((c) => CUSTOMER_EXPORT_COLUMNS.map(([key]) => (c[key] == null ? '' : c[key]))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Customers');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
