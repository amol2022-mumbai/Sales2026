import { z } from 'zod';

const email = z.string().trim().toLowerCase().email('A valid email is required');
const password = z.string().min(8, 'Password must be at least 8 characters');
const nullableString = (max = 200) => z.string().trim().max(max).nullable().optional();
const nullableId = z.number().int().positive().nullable().optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').nullable().optional();

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: password,
});

// Forced first-login password replacement (temporary credentials flow): the
// user is already authenticated but must choose a new password.
export const setPasswordSchema = z.object({
  newPassword: password,
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  avatarUrl: z.string().trim().max(500).nullable().optional(),
});

export const companySettingsSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  website: z.string().trim().max(200).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  state: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  timezone: z.string().trim().max(60).optional(),
  logoUrl: z.string().trim().max(500).nullable().optional(),
  faviconUrl: z.string().trim().max(500).nullable().optional(),
  brandColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'brandColor must be a hex color like #4f46e5').nullable().optional(),
});

// ---------------------------------------------------------------------------
// Users (Phase 2: Employee ID, Name, Email, Mobile, Role, Team, Manager,
// Territory, Joining Date, Status)
// ---------------------------------------------------------------------------
export const createUserSchema = z.object({
  employeeId: nullableString(50),
  name: z.string().trim().min(1).max(120),
  email,
  password,
  roleId: z.number().int().positive(),
  teamId: nullableId,
  managerId: nullableId,
  phone: z.string().trim().max(30).nullable().optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  territory: nullableString(120),
  joiningDate: isoDate,
  companyId: z.number().int().positive().nullable().optional(),
});

export const updateUserSchema = z.object({
  employeeId: nullableString(50),
  name: z.string().trim().min(1).max(120).optional(),
  email: email.optional(),
  roleId: z.number().int().positive().optional(),
  teamId: nullableId,
  managerId: nullableId,
  status: z.enum(['active', 'inactive', 'pending']).optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  territory: nullableString(120),
  joiningDate: isoDate,
});

export const resetPasswordSchema = z.object({
  password,
});

export const statusActionSchema = z.object({
  status: z.enum(['active', 'inactive']),
});

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------
export const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: nullableString(300),
  leadId: nullableId,
  managerId: nullableId,
});

export const updateTeamSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: nullableString(300),
  leadId: nullableId,
  managerId: nullableId,
  isActive: z.boolean().optional(),
});

export const addTeamMembersSchema = z.object({
  userIds: z.array(z.number().int().positive()).min(1).max(200),
});

// ---------------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------------
export const updateRolePermissionsSchema = z.object({
  permissionKeys: z.array(z.string().trim().min(1)).max(500),
});

// ---------------------------------------------------------------------------
// Leads (Phase 3)
// ---------------------------------------------------------------------------
export const leadStatuses = [
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

export const leadPriorities = ['Low', 'Medium', 'High'];

const leadEmail = z.string().trim().toLowerCase().email('A valid email is required').nullable().optional();

export const createLeadSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  contactPerson: nullableString(160),
  mobile: nullableString(30),
  whatsapp: nullableString(30),
  email: leadEmail,
  address: nullableString(300),
  city: nullableString(120),
  state: nullableString(120),
  source: nullableString(120),
  productService: nullableString(200),
  leadValue: z.number().nonnegative().nullable().optional(),
  priority: z.enum(leadPriorities).optional(),
  status: z.enum(leadStatuses).optional(),
  assignedTo: nullableId,
  teamId: nullableId,
  nextFollowUp: isoDate,
  notes: nullableString(2000),
  remarks: nullableString(2000),
  companyId: z.number().int().positive().nullable().optional(),
});

export const updateLeadSchema = z.object({
  companyName: z.string().trim().min(1).max(200).optional(),
  contactPerson: nullableString(160),
  mobile: nullableString(30),
  whatsapp: nullableString(30),
  email: leadEmail,
  address: nullableString(300),
  city: nullableString(120),
  state: nullableString(120),
  source: nullableString(120),
  productService: nullableString(200),
  leadValue: z.number().nonnegative().nullable().optional(),
  priority: z.enum(leadPriorities).optional(),
  status: z.enum(leadStatuses).optional(),
  assignedTo: nullableId,
  teamId: nullableId,
  nextFollowUp: isoDate,
  notes: nullableString(2000),
  remarks: nullableString(2000),
});

export const addLeadNoteSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});

export const bulkAssignLeadsSchema = z.object({
  leadIds: z.array(z.number().int().positive()).min(1).max(500),
  assignedTo: nullableId,
});

export const bulkStatusLeadsSchema = z.object({
  leadIds: z.array(z.number().int().positive()).min(1).max(500),
  status: z.enum(leadStatuses),
});

export const importLeadsSchema = z.object({
  format: z.enum(['csv', 'xlsx']),
  data: z.string().min(1).max(15_000_000),
  companyId: z.number().int().positive().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Customers (Phase 4)
// ---------------------------------------------------------------------------
export const customerTypes = [
  'Individual',
  'Company',
  'Government',
  'Distributor',
  'Retailer',
  'Wholesaler',
  'Other',
];

export const customerStatuses = ['Active', 'Inactive', 'Blocked'];

const customerEmail = z.string().trim().toLowerCase().email('A valid email is required').nullable().optional();

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contactPerson: nullableString(160),
  mobile: nullableString(30),
  whatsapp: nullableString(30),
  email: customerEmail,
  address: nullableString(300),
  city: nullableString(120),
  state: nullableString(120),
  gst: nullableString(30),
  pan: nullableString(30),
  customerType: z.enum(customerTypes).optional(),
  status: z.enum(customerStatuses).optional(),
  assignedTo: nullableId,
  teamId: nullableId,
  companyId: z.number().int().positive().nullable().optional(),
});

export const updateCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  contactPerson: nullableString(160),
  mobile: nullableString(30),
  whatsapp: nullableString(30),
  email: customerEmail,
  address: nullableString(300),
  city: nullableString(120),
  state: nullableString(120),
  gst: nullableString(30),
  pan: nullableString(30),
  customerType: z.enum(customerTypes).optional(),
  status: z.enum(customerStatuses).optional(),
  assignedTo: nullableId,
  teamId: nullableId,
});

export const addCustomerNoteSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});

export const addCustomerActivitySchema = z.object({
  type: z.enum(['call', 'meeting', 'follow_up', 'complaint']),
  description: z.string().trim().min(1).max(2000),
  scheduledAt: isoDate,
});

export const bulkAssignCustomersSchema = z.object({
  customerIds: z.array(z.number().int().positive()).min(1).max(500),
  assignedTo: nullableId,
});

export const bulkStatusCustomersSchema = z.object({
  customerIds: z.array(z.number().int().positive()).min(1).max(500),
  status: z.enum(customerStatuses),
});

export const convertLeadToCustomerSchema = z.object({
  leadId: z.number().int().positive(),
  name: z.string().trim().min(1).max(200).optional(),
  contactPerson: nullableString(160),
  mobile: nullableString(30),
  whatsapp: nullableString(30),
  email: customerEmail,
  address: nullableString(300),
  city: nullableString(120),
  state: nullableString(120),
  gst: nullableString(30),
  pan: nullableString(30),
  customerType: z.enum(customerTypes).optional(),
  status: z.enum(customerStatuses).optional(),
  assignedTo: nullableId,
  teamId: nullableId,
});

export const importCustomersSchema = z.object({
  format: z.enum(['csv', 'xlsx']),
  data: z.string().min(1).max(15_000_000),
  companyId: z.number().int().positive().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Follow-ups (Phase 5)
// ---------------------------------------------------------------------------
export const followUpActivityTypes = [
  'call',
  'whatsapp',
  'email',
  'meeting',
  'site_visit',
  'demo',
  'presentation',
  'note',
  'follow_up',
];

export const followUpPriorities = ['Low', 'Medium', 'High'];

export const followUpStatuses = ['Pending', 'Completed', 'Rescheduled', 'Cancelled'];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM (24-hour)').nullable().optional();

export const createFollowUpSchema = z.object({
  targetType: z.enum(['lead', 'customer']),
  targetId: z.number().int().positive(),
  contactPerson: nullableString(160),
  activityType: z.enum(followUpActivityTypes),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  followUpTime: hhmm,
  priority: z.enum(followUpPriorities).optional(),
  assignedTo: nullableId,
  notes: nullableString(2000),
  nextAction: nullableString(500),
  nextFollowUpDate: isoDate,
});

export const updateFollowUpSchema = z.object({
  contactPerson: nullableString(160),
  activityType: z.enum(followUpActivityTypes).optional(),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  followUpTime: hhmm,
  priority: z.enum(followUpPriorities).optional(),
  assignedTo: nullableId,
  notes: nullableString(2000),
  nextAction: nullableString(500),
  nextFollowUpDate: isoDate,
});

export const completeFollowUpSchema = z.object({
  notes: nullableString(2000),
});

export const rescheduleFollowUpSchema = z.object({
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  followUpTime: hhmm,
  assignedTo: nullableId,
  notes: nullableString(2000),
});

export const assignFollowUpSchema = z.object({
  assignedTo: nullableId,
});

export const cancelFollowUpSchema = z.object({
  notes: nullableString(2000),
});

// ---------------------------------------------------------------------------
// Opportunities / Pipeline (Phase 6)
// ---------------------------------------------------------------------------
export const opportunityStages = [
  'New',
  'Contacted',
  'Qualified',
  'Proposal',
  'Negotiation',
  'Won',
  'Lost',
];

export const opportunityPriorities = ['Low', 'Medium', 'High'];

const opportunityTargetType = z.enum(['lead', 'customer']);
const probabilitySchema = z.number().int().min(0).max(100).nullable().optional();
const nonNegativeNumber = z.number().nonnegative().nullable().optional();

export const createOpportunitySchema = z.object({
  targetType: opportunityTargetType,
  targetId: z.number().int().positive(),
  contactPerson: nullableString(160),
  productService: nullableString(200),
  dealValue: nonNegativeNumber,
  probability: probabilitySchema,
  expectedCloseDate: isoDate,
  assignedTo: nullableId,
  teamId: nullableId,
  stage: z.enum(opportunityStages).optional(),
  priority: z.enum(opportunityPriorities).optional(),
  notes: nullableString(2000),
  nextAction: nullableString(500),
});

export const updateOpportunitySchema = z.object({
  contactPerson: nullableString(160),
  productService: nullableString(200),
  dealValue: nonNegativeNumber,
  probability: probabilitySchema,
  expectedCloseDate: isoDate,
  assignedTo: nullableId,
  teamId: nullableId,
  priority: z.enum(opportunityPriorities).optional(),
  notes: nullableString(2000),
  nextAction: nullableString(500),
});

export const moveOpportunityStageSchema = z.object({
  stage: z.enum(opportunityStages),
});

export const addOpportunityNoteSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});

// ---------------------------------------------------------------------------
// Targets (Phase 7)
// ---------------------------------------------------------------------------
export const targetScopes = ['company', 'team', 'user', 'product', 'territory'];

export const targetTypes = ['sales', 'collection', 'new_leads', 'new_customers', 'conversion_rate'];

export const targetPeriods = ['monthly', 'quarterly', 'annual'];

export const targetStatuses = ['Active', 'Paused', 'Completed', 'Cancelled'];

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const positiveAmount = z.number().positive();

export const createTargetSchema = z.object({
  scope: z.enum(targetScopes),
  userId: nullableId,
  teamId: nullableId,
  product: nullableString(200),
  territory: nullableString(160),
  targetType: z.enum(targetTypes),
  periodType: z.enum(targetPeriods),
  targetValue: positiveAmount,
  startDate: dateString,
  endDate: dateString,
  status: z.enum(targetStatuses).optional(),
  companyId: z.number().int().positive().nullable().optional(),
});

export const updateTargetSchema = z.object({
  scope: z.enum(targetScopes).optional(),
  userId: nullableId,
  teamId: nullableId,
  product: nullableString(200),
  territory: nullableString(160),
  targetType: z.enum(targetTypes).optional(),
  periodType: z.enum(targetPeriods).optional(),
  targetValue: positiveAmount.optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  status: z.enum(targetStatuses).optional(),
});

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  role: z.string().trim().max(50).optional(),
  teamId: z.coerce.number().int().positive().optional(),
  status: z.enum(['active', 'inactive', 'pending']).optional(),
  companyId: z.coerce.number().int().positive().optional(),
});

export const listTeamsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

export const listLeadsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(leadStatuses).optional(),
  priority: z.enum(leadPriorities).optional(),
  source: z.string().trim().max(120).optional(),
  assignedTo: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  companyId: z.coerce.number().int().positive().optional(),
  sort: z
    .enum(['leadNo', 'companyName', 'contactPerson', 'leadValue', 'priority', 'status', 'createdAt', 'nextFollowUp'])
    .optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const exportLeadsQuerySchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  search: z.string().trim().max(100).optional(),
  status: z.enum(leadStatuses).optional(),
  priority: z.enum(leadPriorities).optional(),
  source: z.string().trim().max(120).optional(),
  assignedTo: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
});

export const listCustomersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(customerStatuses).optional(),
  customerType: z.enum(customerTypes).optional(),
  assignedTo: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  companyId: z.coerce.number().int().positive().optional(),
  sort: z.enum(['customerNo', 'name', 'contactPerson', 'customerType', 'status', 'createdAt']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const exportCustomersQuerySchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  search: z.string().trim().max(100).optional(),
  status: z.enum(customerStatuses).optional(),
  customerType: z.enum(customerTypes).optional(),
  assignedTo: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
});

export const listFollowUpsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum([...followUpStatuses, 'Overdue']).optional(),
  activityType: z.enum(followUpActivityTypes).optional(),
  priority: z.enum(followUpPriorities).optional(),
  assignedTo: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  targetType: z.enum(['lead', 'customer']).optional(),
  targetId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom must be YYYY-MM-DD').optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo must be YYYY-MM-DD').optional(),
  sort: z.enum(['followUpDate', 'followUpTime', 'createdAt', 'priority', 'status', 'activityType', 'contactPerson']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const calendarQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD').optional(),
  assignedTo: z.coerce.number().int().positive().optional(),
});

export const listOpportunitiesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  stage: z.enum(opportunityStages).optional(),
  priority: z.enum(opportunityPriorities).optional(),
  targetType: z.enum(['lead', 'customer']).optional(),
  targetId: z.coerce.number().int().positive().optional(),
  assignedTo: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  companyId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom must be YYYY-MM-DD').optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo must be YYYY-MM-DD').optional(),
  sort: z
    .enum(['opportunityNo', 'dealValue', 'probability', 'expectedCloseDate', 'priority', 'stage', 'createdAt'])
    .optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const opportunityBoardQuerySchema = z.object({
  priority: z.enum(opportunityPriorities).optional(),
  targetType: z.enum(['lead', 'customer']).optional(),
  assignedTo: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  companyId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(100).optional(),
});

export const listTargetsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  scope: z.enum(targetScopes).optional(),
  targetType: z.enum(targetTypes).optional(),
  periodType: z.enum(targetPeriods).optional(),
  status: z.enum(targetStatuses).optional(),
  userId: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  territory: z.string().trim().max(160).optional(),
  companyId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom must be YYYY-MM-DD').optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo must be YYYY-MM-DD').optional(),
  sort: z
    .enum(['targetNo', 'targetValue', 'startDate', 'endDate', 'status', 'targetType', 'periodType', 'createdAt', 'achievement', 'balance', 'achievementPct'])
    .optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const exportTargetsQuerySchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  search: z.string().trim().max(100).optional(),
  scope: z.enum(targetScopes).optional(),
  targetType: z.enum(targetTypes).optional(),
  periodType: z.enum(targetPeriods).optional(),
  status: z.enum(targetStatuses).optional(),
  userId: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  territory: z.string().trim().max(160).optional(),
});

export const targetsDashboardQuerySchema = z.object({
  targetType: z.enum(targetTypes).optional(),
  scope: z.enum(targetScopes).optional(),
  teamId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  territory: z.string().trim().max(160).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom must be YYYY-MM-DD').optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo must be YYYY-MM-DD').optional(),
});

export const targetScorecardQuerySchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  groupBy: z.enum(['day', 'month', 'quarter', 'year']).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom must be YYYY-MM-DD').optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo must be YYYY-MM-DD').optional(),
});

export const targetCompareQuerySchema = z.object({
  teamId: z.coerce.number().int().positive().optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  scope: z.enum(['all', 'users', 'companies', 'teams', 'leads', 'customers']).default('all'),
});

// ---------------------------------------------------------------------------
// Products (product/service catalogue)
// ---------------------------------------------------------------------------
export const productStatuses = ['Active', 'Inactive'];

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sku: nullableString(100),
  category: nullableString(100),
  description: nullableString(2000),
  unit: nullableString(50),
  unitPrice: z.coerce.number().min(0).default(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
  status: z.enum(productStatuses).default('Active'),
  companyId: z.coerce.number().int().positive().nullable().optional(),
});

export const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  sku: nullableString(100),
  category: nullableString(100),
  description: nullableString(2000),
  unit: nullableString(50),
  unitPrice: z.coerce.number().min(0).optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  status: z.enum(productStatuses).optional(),
});

export const listProductsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  status: z.enum(productStatuses).optional(),
  companyId: z.coerce.number().int().positive().optional(),
  sort: z.enum(['name', 'sku', 'category', 'unitPrice', 'createdAt']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

// ---------------------------------------------------------------------------
// Quotations (product/service catalogue line items against a customer)
// ---------------------------------------------------------------------------
export const quotationStatuses = ['Draft', 'Sent', 'Accepted', 'Rejected', 'Cancelled'];

const quotationItemSchema = z.object({
  productId: z.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  unit: nullableString(50),
  quantity: z.coerce.number().positive().default(1),
  unitPrice: z.coerce.number().min(0).default(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
});

export const createQuotationSchema = z.object({
  customerId: z.number().int().positive(),
  opportunityId: nullableId,
  status: z.enum(quotationStatuses).optional(),
  validUntil: isoDate,
  discount: z.coerce.number().min(0).default(0),
  assignedTo: nullableId,
  teamId: nullableId,
  notes: nullableString(1000),
  items: z.array(quotationItemSchema).min(1, 'At least one line item is required'),
  companyId: z.number().int().positive().nullable().optional(),
});

export const updateQuotationSchema = z.object({
  status: z.enum(quotationStatuses).optional(),
  validUntil: isoDate,
  discount: z.coerce.number().min(0).optional(),
  assignedTo: nullableId,
  teamId: nullableId,
  notes: nullableString(1000),
  items: z.array(quotationItemSchema).min(1).optional(),
});

export const listQuotationsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum([...quotationStatuses, 'Expired']).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  assignedTo: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom must be YYYY-MM-DD').optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo must be YYYY-MM-DD').optional(),
  sort: z.enum(['quotationNo', 'total', 'status', 'customerName', 'createdAt']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

// ---------------------------------------------------------------------------
// Sales Orders (product line items against a customer, optionally originating
// from an accepted quotation)
// ---------------------------------------------------------------------------
export const orderStatuses = ['Draft', 'Confirmed', 'Processing', 'Completed', 'Cancelled'];

const orderItemSchema = z.object({
  productId: z.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  unit: nullableString(50),
  quantity: z.coerce.number().positive().default(1),
  unitPrice: z.coerce.number().min(0).default(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
});

export const createOrderSchema = z.object({
  customerId: z.number().int().positive(),
  quotationId: nullableId,
  status: z.enum(orderStatuses).optional(),
  discount: z.coerce.number().min(0).default(0),
  assignedTo: nullableId,
  teamId: nullableId,
  notes: nullableString(1000),
  items: z.array(orderItemSchema).min(1, 'At least one line item is required'),
  companyId: z.number().int().positive().nullable().optional(),
});

export const convertQuotationSchema = z.object({
  quotationId: z.number().int().positive(),
  assignedTo: nullableId,
  teamId: nullableId,
  notes: nullableString(1000),
});

export const updateOrderSchema = z.object({
  status: z.enum(orderStatuses).optional(),
  discount: z.coerce.number().min(0).optional(),
  assignedTo: nullableId,
  teamId: nullableId,
  notes: nullableString(1000),
  items: z.array(orderItemSchema).min(1).optional(),
});

export const listOrdersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(orderStatuses).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  quotationId: z.coerce.number().int().positive().optional(),
  assignedTo: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom must be YYYY-MM-DD').optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo must be YYYY-MM-DD').optional(),
  sort: z.enum(['orderNo', 'total', 'status', 'customerName', 'createdAt']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const companyIdParamSchema = z.object({
  companyId: z.coerce.number().int().positive(),
});

export const teamMemberParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Multi-client white-label / Super Admin (clients, plans, licenses)
// ---------------------------------------------------------------------------
export const createClientSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  website: z.string().trim().max(200).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  state: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  industry: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  timezone: z.string().trim().max(60).optional(),
  logoUrl: z.string().trim().max(500).nullable().optional(),
  faviconUrl: z.string().trim().max(500).nullable().optional(),
  brandColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  domain: z.string().trim().max(200).nullable().optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
});

export const updateClientSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  email: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  website: z.string().trim().max(200).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  state: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  industry: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  timezone: z.string().trim().max(60).optional(),
  logoUrl: z.string().trim().max(500).nullable().optional(),
  faviconUrl: z.string().trim().max(500).nullable().optional(),
  brandColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  domain: z.string().trim().max(200).nullable().optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
});

const featureLimitsObjectSchema = z.record(z.string().trim().min(1), z.number().int().min(-1));

export const createPlanSchema = z.object({
  key: z.string().trim().min(1).max(60).regex(/^[a-z0-9_]+$/, 'key must be lowercase letters, numbers, underscores'),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  userLimit: z.number().int().min(-1).default(-1),
  modules: z.array(z.string().trim().min(1)).nullable().optional(),
  priceMonthly: z.number().nonnegative().default(0),
  priceAnnual: z.number().nonnegative().default(0),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  storageLimitMb: z.number().int().min(-1).default(-1),
  exportEnabled: z.boolean().default(true),
  apiEnabled: z.boolean().default(false),
  licenseDurationDays: z.number().int().min(0).default(0),
  trialDays: z.number().int().min(0).default(0),
  limits: featureLimitsObjectSchema.optional(),
});

export const updatePlanSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  userLimit: z.number().int().min(-1).optional(),
  modules: z.array(z.string().trim().min(1)).nullable().optional(),
  priceMonthly: z.number().nonnegative().optional(),
  priceAnnual: z.number().nonnegative().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  storageLimitMb: z.number().int().min(-1).optional(),
  exportEnabled: z.boolean().optional(),
  apiEnabled: z.boolean().optional(),
  licenseDurationDays: z.number().int().min(0).optional(),
  trialDays: z.number().int().min(0).optional(),
  limits: featureLimitsObjectSchema.optional(),
});

export const licenseStatuses = ['active', 'trial', 'past_due', 'expired', 'suspended', 'cancelled'];

export const upsertLicenseSchema = z.object({
  planId: z.number().int().positive().nullable().optional(),
  status: z.enum(licenseStatuses),
  startsAt: isoDate,
  expiresAt: isoDate,
  userLimit: z.number().int().min(-1).nullable().optional(),
  modules: z.array(z.string().trim().min(1)).nullable().optional(),
  storageLimitMb: z.number().int().min(-1).nullable().optional(),
  exportEnabled: z.boolean().nullable().optional(),
  apiEnabled: z.boolean().nullable().optional(),
  billingCycle: z.enum(['monthly', 'annual']).nullable().optional(),
  autoRenew: z.boolean().nullable().optional(),
  limits: featureLimitsObjectSchema.optional(),
});

export const listClientsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  lifecycle: z
    .enum(['pending', 'trial', 'active', 'expiring', 'past_due', 'expired', 'suspended', 'cancelled', 'deactivated', 'deleted'])
    .optional(),
  licenseStatus: z.enum(licenseStatuses).optional(),
  planId: z.coerce.number().int().positive().optional(),
  includeDeleted: z.coerce.boolean().optional(),
  sort: z.enum(['name', 'createdAt', 'userCount', 'licenseExpiresAt', 'status']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

// ---------------------------------------------------------------------------
// SaaS Operations (Phase 16): Super Admin operations overview, tenant detail
// and derived alerts.
// ---------------------------------------------------------------------------
export const operationsOverviewQuerySchema = z.object({}).passthrough();

export const operationsAlertsQuerySchema = paginationQuerySchema.extend({
  type: z
    .enum([
      'license_expiring',
      'license_expired',
      'subscription_expired',
      'payment_failed',
      'payment_overdue',
      'user_near_limit',
      'tenant_suspended',
      'security',
    ])
    .optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
});

// ---------------------------------------------------------------------------
// Tenant onboarding & invitation (Phase 12)
// ---------------------------------------------------------------------------
export const inviteAdminSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email,
  roleId: z.number().int().positive().optional(),
});

export const acceptInviteSchema = z.object({
  token: z.string().trim().min(16).max(200),
  password,
});

// Super Admin "Generate Temporary Credentials": name + email of the Company
// Admin to issue temporary credentials for. The password itself is generated
// server-side and never supplied by the caller.
export const generateAdminCredentialsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email,
});

// ---------------------------------------------------------------------------
// Tenant onboarding (Phase 15): Super Admin composite provisioning + Company
// Admin first-login setup.
// ---------------------------------------------------------------------------
export const onboardTenantSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  website: z.string().trim().max(200).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  state: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  industry: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  timezone: z.string().trim().max(60).optional(),
  logoUrl: z.string().trim().max(500).nullable().optional(),
  faviconUrl: z.string().trim().max(500).nullable().optional(),
  brandColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  domain: z.string().trim().max(200).nullable().optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  planId: z.number().int().positive().nullable().optional(),
  licenseStatus: z.enum(licenseStatuses).optional(),
  startsAt: isoDate,
  expiresAt: isoDate,
  userLimit: z.number().int().min(-1).nullable().optional(),
  modules: z.array(z.string().trim().min(1)).nullable().optional(),
  storageLimitMb: z.number().int().min(-1).nullable().optional(),
  exportEnabled: z.boolean().nullable().optional(),
  apiEnabled: z.boolean().nullable().optional(),
  billingCycle: z.enum(['monthly', 'annual']).nullable().optional(),
  autoRenew: z.boolean().nullable().optional(),
  adminName: z.string().trim().min(1).max(120).optional(),
  adminEmail: email.optional(),
});

export const completeCompanySetupSchema = companySettingsSchema;


// ---------------------------------------------------------------------------
// Collections (invoices & payments) — Phase 10
// ---------------------------------------------------------------------------
export const invoiceStatuses = ['Unpaid', 'Partial', 'Paid'];
export const paymentMethods = ['Cash', 'Bank Transfer', 'Cheque', 'UPI', 'Card', 'Other'];

export const createInvoiceSchema = z.object({
  customerId: z.number().int().positive(),
  amount: z.number().nonnegative(),
  dueDate: isoDate,
  assignedTo: nullableId,
  teamId: nullableId,
  notes: nullableString(1000),
  status: z.enum(invoiceStatuses).optional(),
});

export const updateInvoiceSchema = z.object({
  amount: z.number().nonnegative().optional(),
  dueDate: isoDate,
  assignedTo: nullableId,
  teamId: nullableId,
  notes: nullableString(1000),
  status: z.enum(invoiceStatuses).optional(),
});

export const recordPaymentSchema = z.object({
  invoiceId: z.number().int().positive(),
  amount: positiveAmount,
  paymentDate: dateString,
  method: z.enum(paymentMethods).optional(),
  reference: nullableString(120),
  notes: nullableString(500),
});

export const listInvoicesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum([...invoiceStatuses, 'Overdue']).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  assignedTo: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom must be YYYY-MM-DD').optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo must be YYYY-MM-DD').optional(),
  sort: z.enum(['invoiceNo', 'amount', 'dueDate', 'status', 'customerName', 'createdAt']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const listPaymentsQuerySchema = paginationQuerySchema.extend({
  invoiceId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom must be YYYY-MM-DD').optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo must be YYYY-MM-DD').optional(),
  sort: z.enum(['paymentNo', 'amount', 'paymentDate', 'method']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

// ---------------------------------------------------------------------------
// Subscriptions (subscription billing) — Super Admin only.
// ---------------------------------------------------------------------------
export const createSubscriptionInvoiceSchema = z.object({
  amount: z.number().nonnegative(),
  planId: z.number().int().positive().nullable().optional(),
  description: z.string().trim().max(300).nullable().optional(),
  periodStart: isoDate,
  periodEnd: isoDate,
  dueDate: isoDate,
});

export const recordSubscriptionPaymentSchema = z.object({
  amount: z.number().positive(),
  paymentDate: dateString,
  method: z.enum(paymentMethods).optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Online billing (Phase 14) — company billing page + super admin controls.
// ---------------------------------------------------------------------------
export const billingCycleEnum = z.enum(['monthly', 'annual']);

export const checkoutSchema = z.object({
  planId: z.number().int().positive(),
  billingCycle: billingCycleEnum.default('monthly'),
});

export const changePlanSchema = z.object({
  planId: z.number().int().positive(),
  billingCycle: billingCycleEnum.default('monthly'),
  applyImmediately: z.boolean().optional(),
});

export const renewSubscriptionSchema = z.object({
  billingCycle: billingCycleEnum.optional(),
});

export const refundSubscriptionSchema = z.object({
  invoiceId: z.number().int().positive(),
  amount: z.number().positive(),
});

export const mockPaySchema = z.object({
  invoiceId: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Reports & MIS (Phase 10)
// ---------------------------------------------------------------------------
export const reportTypes = [
  'sales',
  'lead-conversion',
  'follow-ups',
  'pipeline',
  'target-achievement',
  'customers',
  'products',
  'territories',
  'collections',
  'aging',
  'won-lost',
  'productivity',
];

export const reportQuerySchema = paginationQuerySchema.extend({
  period: z.enum(['day', 'month', 'quarter', 'year']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD').optional(),
  salespersonId: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  product: z.string().trim().max(200).optional(),
  territory: z.string().trim().max(160).optional(),
  status: z.string().trim().max(60).optional(),
  search: z.string().trim().max(100).optional(),
  sortBy: z.string().trim().max(60).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  format: z.enum(['csv', 'xlsx', 'pdf']).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  companyId: z.coerce.number().int().positive().optional(),
});

export const misSummaryQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD').optional(),
  companyId: z.coerce.number().int().positive().optional(),
});

export const adminDashboardQuerySchema = z.object({
  companyId: z.coerce.number().int().positive().optional(),
});

// ---------------------------------------------------------------------------
// AI Assistant (Phase 11)
// ---------------------------------------------------------------------------
export const aiAskSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  conversationId: z.number().int().positive().nullable().optional(),
  companyId: z.number().int().positive().nullable().optional(),
});
