import { Router } from 'express';
import { authenticate, requireModule } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import {
  createProductSchema,
  updateProductSchema,
  listProductsQuerySchema,
  idParamSchema,
} from '../schemas/index.js';
import { list, get, create, update, remove } from '../controllers/productController.js';

const router = Router();

router.use(authenticate, requireModule('products'));

router.get('/', authorize('products:view'), validate(listProductsQuerySchema, 'query'), list);
router.post('/', authorize('products:create'), validate(createProductSchema), create);
router.get('/:id', authorize('products:view'), validate(idParamSchema, 'params'), get);
router.put('/:id', authorize('products:edit'), validate(idParamSchema, 'params'), validate(updateProductSchema), update);
router.delete('/:id', authorize('products:delete'), validate(idParamSchema, 'params'), remove);

export default router;
