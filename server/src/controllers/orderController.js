import { asyncHandler } from '../lib/asyncHandler.js';
import { ok, created, paginated } from '../lib/response.js';
import { badRequest } from '../lib/httpError.js';
import { getUserDataScope } from '../services/access.js';
import {
  listOrders,
  getOrder,
  createOrder,
  convertQuotationToOrder,
  updateOrder,
  deleteOrder,
} from '../services/orderService.js';

function resolveCompany(req) {
  const companyId = req.user.isSuperAdmin ? (req.body.companyId ?? null) : req.user.companyId;
  if (!companyId) throw badRequest('A target company is required');
  return companyId;
}

export const list = asyncHandler(async (req, res) => {
  const scope = getUserDataScope(req.user);
  const { data, total } = listOrders(scope, req.query);
  return paginated(res, data, { page: req.query.page, pageSize: req.query.pageSize, total });
});

export const get = asyncHandler(async (req, res) => {
  const scope = getUserDataScope(req.user);
  return ok(res, getOrder(scope, req.params.id));
});

export const create = asyncHandler(async (req, res) => {
  const scope = getUserDataScope(req.user);
  const companyId = resolveCompany(req);
  const order = createOrder(scope, companyId, req.body, req.user.id);

  req.audit?.('order.create', {
    entityType: 'order',
    entityId: order.id,
    metadata: { companyId, customerId: order.customerId, quotationId: order.quotationId, total: order.total },
  });

  return created(res, order);
});

export const convert = asyncHandler(async (req, res) => {
  const scope = getUserDataScope(req.user);
  const companyId = resolveCompany(req);
  const order = convertQuotationToOrder(scope, companyId, req.body, req.user.id);

  req.audit?.('order.convert', {
    entityType: 'order',
    entityId: order.id,
    metadata: { companyId, quotationId: order.quotationId, customerId: order.customerId, total: order.total },
  });

  return created(res, order);
});

export const update = asyncHandler(async (req, res) => {
  const scope = getUserDataScope(req.user);
  const order = updateOrder(scope, req.params.id, req.body);

  req.audit?.('order.update', { entityType: 'order', entityId: order.id, metadata: { status: order.status } });

  return ok(res, order);
});

export const remove = asyncHandler(async (req, res) => {
  const scope = getUserDataScope(req.user);
  const result = deleteOrder(scope, req.params.id);

  req.audit?.('order.delete', { entityType: 'order', entityId: result.id });

  return ok(res, result);
});
