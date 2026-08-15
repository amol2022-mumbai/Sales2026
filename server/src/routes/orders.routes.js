import { Router } from 'express';
import { authenticate, requireModule } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import {
  createOrderSchema,
  updateOrderSchema,
  convertQuotationSchema,
  listOrdersQuerySchema,
  idParamSchema,
} from '../schemas/index.js';
import { list, get, create, convert, update, remove } from '../controllers/orderController.js';

const router = Router();

router.use(authenticate, requireModule('orders'));

router.get('/', authorize('orders:view'), validate(listOrdersQuerySchema, 'query'), list);
router.post('/', authorize('orders:create'), validate(createOrderSchema), create);
router.post('/convert', authorize('orders:create'), validate(convertQuotationSchema), convert);
router.get('/:id', authorize('orders:view'), validate(idParamSchema, 'params'), get);
router.put('/:id', authorize('orders:edit'), validate(idParamSchema, 'params'), validate(updateOrderSchema), update);
router.delete('/:id', authorize('orders:delete'), validate(idParamSchema, 'params'), remove);

export default router;
