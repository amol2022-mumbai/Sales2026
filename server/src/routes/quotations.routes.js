import { Router } from 'express';
import { authenticate, requireModule } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import {
  createQuotationSchema,
  updateQuotationSchema,
  listQuotationsQuerySchema,
  idParamSchema,
} from '../schemas/index.js';
import { list, get, create, update, remove } from '../controllers/quotationController.js';

const router = Router();

router.use(authenticate, requireModule('quotations'));

router.get('/', authorize('quotations:view'), validate(listQuotationsQuerySchema, 'query'), list);
router.post('/', authorize('quotations:create'), validate(createQuotationSchema), create);
router.get('/:id', authorize('quotations:view'), validate(idParamSchema, 'params'), get);
router.put('/:id', authorize('quotations:edit'), validate(idParamSchema, 'params'), validate(updateQuotationSchema), update);
router.delete('/:id', authorize('quotations:delete'), validate(idParamSchema, 'params'), remove);

export default router;
