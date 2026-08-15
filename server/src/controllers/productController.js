import { asyncHandler } from '../lib/asyncHandler.js';
import { ok, created, paginated } from '../lib/response.js';
import { getUserDataScope } from '../services/access.js';
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
} from '../services/productService.js';

function resolveProductCompany(req) {
  if (req.user.isSuperAdmin) return req.body.companyId ?? req.user.companyId ?? null;
  return req.user.companyId;
}

export const list = asyncHandler(async (req, res) => {
  const scope = getUserDataScope(req.user);
  const { data, total } = listProducts(scope, req.query);
  return paginated(res, data, {
    page: req.query.page,
    pageSize: req.query.pageSize,
    total,
  });
});

export const get = asyncHandler(async (req, res) => {
  const scope = getUserDataScope(req.user);
  return ok(res, getProduct(scope, req.params.id));
});

export const create = asyncHandler(async (req, res) => {
  const scope = getUserDataScope(req.user);
  const companyId = resolveProductCompany(req);
  const product = createProduct(scope, companyId, req.body, req.user.id);

  req.audit?.('product.create', {
    entityType: 'product',
    entityId: product.id,
    metadata: { name: product.name, companyId },
  });

  return created(res, product);
});

export const update = asyncHandler(async (req, res) => {
  const scope = getUserDataScope(req.user);
  const product = updateProduct(scope, req.params.id, req.body);

  req.audit?.('product.update', { entityType: 'product', entityId: product.id, metadata: { name: product.name } });

  return ok(res, product);
});

export const remove = asyncHandler(async (req, res) => {
  const scope = getUserDataScope(req.user);
  const result = deleteProduct(scope, req.params.id);

  req.audit?.('product.delete', { entityType: 'product', entityId: result.id });

  return ok(res, result);
});
