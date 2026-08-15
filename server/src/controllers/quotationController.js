import { asyncHandler } from '../lib/asyncHandler.js';
import { ok, created, paginated } from '../lib/response.js';
import { badRequest } from '../lib/httpError.js';
import { getUserDataScope } from '../services/access.js';
import {
  listQuotations,
  getQuotation,
  createQuotation,
  updateQuotation,
  deleteQuotation,
} from '../services/quotationService.js';

function resolveCompany(req) {
  const companyId = req.user.isSuperAdmin ? (req.body.companyId ?? null) : req.user.companyId;
  if (!companyId) throw badRequest('A target company is required');
  return companyId;
}

export const list = asyncHandler(async (req, res) => {
  const scope = getUserDataScope(req.user);
  const { data, total } = listQuotations(scope, req.query);
  return paginated(res, data, { page: req.query.page, pageSize: req.query.pageSize, total });
});

export const get = asyncHandler(async (req, res) => {
  const scope = getUserDataScope(req.user);
  return ok(res, getQuotation(scope, req.params.id));
});

export const create = asyncHandler(async (req, res) => {
  const scope = getUserDataScope(req.user);
  const companyId = resolveCompany(req);
  const quotation = createQuotation(scope, companyId, req.body, req.user.id);

  req.audit?.('quotation.create', {
    entityType: 'quotation',
    entityId: quotation.id,
    metadata: { companyId, customerId: quotation.customerId, total: quotation.total },
  });

  return created(res, quotation);
});

export const update = asyncHandler(async (req, res) => {
  const scope = getUserDataScope(req.user);
  const quotation = updateQuotation(scope, req.params.id, req.body);

  req.audit?.('quotation.update', { entityType: 'quotation', entityId: quotation.id, metadata: { status: quotation.status } });

  return ok(res, quotation);
});

export const remove = asyncHandler(async (req, res) => {
  const scope = getUserDataScope(req.user);
  const result = deleteQuotation(scope, req.params.id);

  req.audit?.('quotation.delete', { entityType: 'quotation', entityId: result.id });

  return ok(res, result);
});
