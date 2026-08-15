import { apiFetch } from './client.js';

export const configApi = {
  get: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/config${q ? `?${q}` : ''}`);
  },
};

export const adminApi = {
  clients: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return apiFetch(`/admin/clients${q ? `?${q}` : ''}`, { raw: true });
    },
    get: (id) => apiFetch(`/admin/clients/${id}`),
    create: (payload) => apiFetch('/admin/clients', { method: 'POST', body: payload }),
    update: (id, payload) => apiFetch(`/admin/clients/${id}`, { method: 'PUT', body: payload }),
    inviteAdmin: (id, payload) => apiFetch(`/admin/clients/${id}/invite-admin`, { method: 'POST', body: payload }),
    onboard: (payload) => apiFetch('/admin/clients/onboard', { method: 'POST', body: payload }),
    activate: (id) => apiFetch(`/admin/clients/${id}/activate`, { method: 'POST' }),
    suspend: (id) => apiFetch(`/admin/clients/${id}/suspend`, { method: 'POST' }),
    deactivate: (id) => apiFetch(`/admin/clients/${id}/deactivate`, { method: 'POST' }),
  },
  plans: {
    list: () => apiFetch('/admin/plans'),
    get: (id) => apiFetch(`/admin/plans/${id}`),
    create: (payload) => apiFetch('/admin/plans', { method: 'POST', body: payload }),
    update: (id, payload) => apiFetch(`/admin/plans/${id}`, { method: 'PUT', body: payload }),
  },
  licenses: {
    list: () => apiFetch('/admin/licenses'),
    get: (companyId) => apiFetch(`/admin/licenses/${companyId}`),
    upsert: (companyId, payload) => apiFetch(`/admin/licenses/${companyId}`, { method: 'PUT', body: payload }),
  },
  subscriptions: {
    list: () => apiFetch('/admin/subscriptions'),
    get: (companyId) => apiFetch(`/admin/subscriptions/${companyId}`),
    createInvoice: (companyId, payload) => apiFetch(`/admin/subscriptions/${companyId}/invoices`, { method: 'POST', body: payload }),
    recordPayment: (invoiceId, payload) => apiFetch(`/admin/subscriptions/invoices/${invoiceId}/payments`, { method: 'POST', body: payload }),
    changePlan: (companyId, payload) => apiFetch(`/admin/subscriptions/${companyId}/change-plan`, { method: 'POST', body: payload }),
    renew: (companyId, payload = {}) => apiFetch(`/admin/subscriptions/${companyId}/renew`, { method: 'POST', body: payload }),
    cancel: (companyId) => apiFetch(`/admin/subscriptions/${companyId}/cancel`, { method: 'POST' }),
    reactivate: (companyId) => apiFetch(`/admin/subscriptions/${companyId}/reactivate`, { method: 'POST' }),
    refund: (companyId, payload) => apiFetch(`/admin/subscriptions/${companyId}/refund`, { method: 'POST', body: payload }),
    events: (companyId) => apiFetch(`/admin/subscriptions/${companyId}/events`),
    payments: (companyId) => apiFetch(`/admin/subscriptions/${companyId}/payments`),
  },
  modules: () => apiFetch('/admin/modules'),
  dashboard: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/admin/dashboard${q ? `?${q}` : ''}`);
  },
  operations: {
    overview: () => apiFetch('/admin/operations'),
    tenant: (id) => apiFetch(`/admin/operations/tenants/${id}`),
    alerts: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return apiFetch(`/admin/operations/alerts${q ? `?${q}` : ''}`, { raw: true });
    },
  },
};

export const authApi = {
  login: (email, password) => apiFetch('/auth/login', { method: 'POST', body: { email, password } }),
  acceptInvite: (token, password) => apiFetch('/auth/accept-invite', { method: 'POST', body: { token, password } }),
  me: () => apiFetch('/auth/me'),
  logout: () => apiFetch('/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword, newPassword) =>
    apiFetch('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
  updateProfile: (payload) => apiFetch('/auth/me', { method: 'PUT', body: payload }),
};

export const dashboardApi = {
  summary: () => apiFetch('/dashboard/summary'),
};

export const companyApi = {
  list: () => apiFetch('/companies'),
  get: (id) => apiFetch(`/companies/${id}`),
  update: (id, payload) => apiFetch(`/companies/${id}`, { method: 'PUT', body: payload }),
  completeSetup: (id, payload) => apiFetch(`/companies/${id}/complete-setup`, { method: 'POST', body: payload }),
};

export const usersApi = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/users${q ? `?${q}` : ''}`, { raw: true });
  },
  get: (id) => apiFetch(`/users/${id}`),
  create: (payload) => apiFetch('/users', { method: 'POST', body: payload }),
  update: (id, payload) => apiFetch(`/users/${id}`, { method: 'PUT', body: payload }),
  resetPassword: (id, password) => apiFetch(`/users/${id}/reset-password`, { method: 'POST', body: { password } }),
  setStatus: (id, status) => apiFetch(`/users/${id}/status`, { method: 'POST', body: { status } }),
};

export const rolesApi = {
  list: () => apiFetch('/roles'),
  get: (id) => apiFetch(`/roles/${id}`),
  permissions: () => apiFetch('/roles/permissions'),
  updatePermissions: (id, permissionKeys) =>
    apiFetch(`/roles/${id}/permissions`, { method: 'PUT', body: { permissionKeys } }),
};

export const teamsApi = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/teams${q ? `?${q}` : ''}`, { raw: true });
  },
  get: (id) => apiFetch(`/teams/${id}`),
  create: (payload) => apiFetch('/teams', { method: 'POST', body: payload }),
  update: (id, payload) => apiFetch(`/teams/${id}`, { method: 'PUT', body: payload }),
  addMembers: (id, userIds) => apiFetch(`/teams/${id}/members`, { method: 'POST', body: { userIds } }),
  removeMember: (id, userId) => apiFetch(`/teams/${id}/members/${userId}`, { method: 'DELETE' }),
};

export const productsApi = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/products${q ? `?${q}` : ''}`, { raw: true });
  },
  get: (id) => apiFetch(`/products/${id}`),
  create: (payload) => apiFetch('/products', { method: 'POST', body: payload }),
  update: (id, payload) => apiFetch(`/products/${id}`, { method: 'PUT', body: payload }),
  remove: (id) => apiFetch(`/products/${id}`, { method: 'DELETE' }),
};

export const notificationsApi = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/notifications${q ? `?${q}` : ''}`);
  },
  markRead: (id) => apiFetch(`/notifications/${id}/read`, { method: 'PUT' }),
  markAllRead: () => apiFetch('/notifications/read-all', { method: 'PUT' }),
};

export const searchApi = {
  global: (q) => apiFetch(`/search?q=${encodeURIComponent(q)}`),
};

export const leadsApi = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/leads${q ? `?${q}` : ''}`, { raw: true });
  },
  get: (id) => apiFetch(`/leads/${id}`),
  meta: () => apiFetch('/leads/meta'),
  dashboard: () => apiFetch('/leads/dashboard'),
  create: (payload) => apiFetch('/leads', { method: 'POST', body: payload }),
  update: (id, payload) => apiFetch(`/leads/${id}`, { method: 'PUT', body: payload }),
  remove: (id) => apiFetch(`/leads/${id}`, { method: 'DELETE' }),
  addNote: (id, note) => apiFetch(`/leads/${id}/notes`, { method: 'POST', body: { note } }),
  bulkAssign: (leadIds, assignedTo) => apiFetch('/leads/bulk-assign', { method: 'POST', body: { leadIds, assignedTo } }),
  bulkStatus: (leadIds, status) => apiFetch('/leads/bulk-status', { method: 'POST', body: { leadIds, status } }),
  import: (format, data, companyId) =>
    apiFetch('/leads/import', { method: 'POST', body: { format, data, companyId: companyId ?? null } }),
  exportUrl: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return `/api/leads/export${q ? `?${q}` : ''}`;
  },
};

export const customersApi = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/customers${q ? `?${q}` : ''}`, { raw: true });
  },
  get: (id) => apiFetch(`/customers/${id}`),
  meta: () => apiFetch('/customers/meta'),
  dashboard: () => apiFetch('/customers/dashboard'),
  create: (payload) => apiFetch('/customers', { method: 'POST', body: payload }),
  update: (id, payload) => apiFetch(`/customers/${id}`, { method: 'PUT', body: payload }),
  remove: (id) => apiFetch(`/customers/${id}`, { method: 'DELETE' }),
  addNote: (id, note) => apiFetch(`/customers/${id}/notes`, { method: 'POST', body: { note } }),
  addActivity: (id, type, description, scheduledAt) =>
    apiFetch(`/customers/${id}/activities`, { method: 'POST', body: { type, description, scheduledAt: scheduledAt ?? null } }),
  bulkAssign: (customerIds, assignedTo) => apiFetch('/customers/bulk-assign', { method: 'POST', body: { customerIds, assignedTo } }),
  bulkStatus: (customerIds, status) => apiFetch('/customers/bulk-status', { method: 'POST', body: { customerIds, status } }),
  convert: (payload) => apiFetch('/customers/convert', { method: 'POST', body: payload }),
  import: (format, data, companyId) =>
    apiFetch('/customers/import', { method: 'POST', body: { format, data, companyId: companyId ?? null } }),
  exportUrl: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return `/api/customers/export${q ? `?${q}` : ''}`;
  },
};

export const auditApi = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/audit-logs${q ? `?${q}` : ''}`);
  },
};

export const pipelineApi = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/pipeline${q ? `?${q}` : ''}`, { raw: true });
  },
  get: (id) => apiFetch(`/pipeline/${id}`),
  meta: () => apiFetch('/pipeline/meta'),
  dashboard: () => apiFetch('/pipeline/dashboard'),
  board: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/pipeline/board${q ? `?${q}` : ''}`);
  },
  create: (payload) => apiFetch('/pipeline', { method: 'POST', body: payload }),
  update: (id, payload) => apiFetch(`/pipeline/${id}`, { method: 'PUT', body: payload }),
  moveStage: (id, stage) => apiFetch(`/pipeline/${id}/stage`, { method: 'POST', body: { stage } }),
  addNote: (id, note) => apiFetch(`/pipeline/${id}/notes`, { method: 'POST', body: { note } }),
  remove: (id) => apiFetch(`/pipeline/${id}`, { method: 'DELETE' }),
};

export const targetsApi = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/targets${q ? `?${q}` : ''}`, { raw: true });
  },
  get: (id) => apiFetch(`/targets/${id}`),
  meta: () => apiFetch('/targets/meta'),
  dashboard: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/targets/dashboard${q ? `?${q}` : ''}`);
  },
  scorecard: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/targets/scorecard${q ? `?${q}` : ''}`);
  },
  compare: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/targets/compare${q ? `?${q}` : ''}`);
  },
  create: (payload) => apiFetch('/targets', { method: 'POST', body: payload }),
  update: (id, payload) => apiFetch(`/targets/${id}`, { method: 'PUT', body: payload }),
  remove: (id) => apiFetch(`/targets/${id}`, { method: 'DELETE' }),
  exportUrl: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return `/api/targets/export${q ? `?${q}` : ''}`;
  },
};

export const followUpsApi = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/follow-ups${q ? `?${q}` : ''}`, { raw: true });
  },
  get: (id) => apiFetch(`/follow-ups/${id}`),
  meta: () => apiFetch('/follow-ups/meta'),
  dashboard: () => apiFetch('/follow-ups/dashboard'),
  calendar: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/follow-ups/calendar${q ? `?${q}` : ''}`);
  },
  create: (payload) => apiFetch('/follow-ups', { method: 'POST', body: payload }),
  update: (id, payload) => apiFetch(`/follow-ups/${id}`, { method: 'PUT', body: payload }),
  complete: (id, notes) => apiFetch(`/follow-ups/${id}/complete`, { method: 'POST', body: { notes: notes || null } }),
  reschedule: (id, payload) => apiFetch(`/follow-ups/${id}/reschedule`, { method: 'POST', body: payload }),
  assign: (id, assignedTo) => apiFetch(`/follow-ups/${id}/assign`, { method: 'POST', body: { assignedTo: assignedTo ? Number(assignedTo) : null } }),
  cancel: (id, notes) => apiFetch(`/follow-ups/${id}/cancel`, { method: 'POST', body: { notes: notes || null } }),
  remove: (id) => apiFetch(`/follow-ups/${id}`, { method: 'DELETE' }),
};

export const collectionsApi = {
  invoices: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return apiFetch(`/collections${q ? `?${q}` : ''}`, { raw: true });
    },
    get: (id) => apiFetch(`/collections/${id}`),
    create: (payload) => apiFetch('/collections', { method: 'POST', body: payload }),
    update: (id, payload) => apiFetch(`/collections/${id}`, { method: 'PUT', body: payload }),
    remove: (id) => apiFetch(`/collections/${id}`, { method: 'DELETE' }),
  },
  payments: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return apiFetch(`/collections/payments${q ? `?${q}` : ''}`, { raw: true });
    },
    record: (payload) => apiFetch('/collections/payments', { method: 'POST', body: payload }),
    remove: (id) => apiFetch(`/collections/payments/${id}`, { method: 'DELETE' }),
  },
  dashboard: () => apiFetch('/collections/dashboard'),
};

export const reportsApi = {
  types: () => apiFetch('/reports/types'),
  get: (type, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/reports/${type}${q ? `?${q}` : ''}`);
  },
  exportUrl: (type, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return `/api/reports/${type}/export${q ? `?${q}` : ''}`;
  },
};

export const misApi = {
  summary: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/mis/summary${q ? `?${q}` : ''}`);
  },
};

export const aiApi = {
  ask: (question, { conversationId = null, companyId = null } = {}) =>
    apiFetch('/ai/ask', {
      method: 'POST',
      body: { question, conversationId: conversationId ?? null, companyId: companyId ?? null },
    }),
  conversations: () => apiFetch('/ai/conversations'),
  conversation: (id) => apiFetch(`/ai/conversations/${id}`),
};

export const aiAdminApi = {
  status: () => apiFetch('/admin/ai/status'),
  test: () => apiFetch('/admin/ai/test', { method: 'POST' }),
};

export const billingApi = {
  get: () => apiFetch('/billing'),
  plans: () => apiFetch('/billing/plans'),
  invoices: () => apiFetch('/billing/invoices'),
  payments: () => apiFetch('/billing/payments'),
  events: () => apiFetch('/billing/events'),
  usage: () => apiFetch('/billing/usage'),
  checkout: (payload) => apiFetch('/billing/checkout', { method: 'POST', body: payload }),
  changePlan: (payload) => apiFetch('/billing/change-plan', { method: 'POST', body: payload }),
  renew: (payload = {}) => apiFetch('/billing/renew', { method: 'POST', body: payload }),
  cancel: () => apiFetch('/billing/cancel', { method: 'POST' }),
  reactivate: () => apiFetch('/billing/reactivate', { method: 'POST' }),
  mockPay: (invoiceId) => apiFetch('/billing/mock-pay', { method: 'POST', body: { invoiceId } }),
};
