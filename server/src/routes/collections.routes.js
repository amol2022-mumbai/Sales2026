import { Router } from 'express';
import { authenticate, requireModule } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  recordPaymentSchema,
  listInvoicesQuerySchema,
  listPaymentsQuerySchema,
  idParamSchema,
} from '../schemas/index.js';
import {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  listPayments,
  recordPayment,
  deletePayment,
  collectionsDashboard,
} from '../controllers/collectionsController.js';

const router = Router();

router.use(authenticate, requireModule('collections'));

router.get('/', authorize('collections:view'), validate(listInvoicesQuerySchema, 'query'), listInvoices);
router.get('/dashboard', authorize('collections:view'), collectionsDashboard);
router.get('/payments', authorize('collections:view'), validate(listPaymentsQuerySchema, 'query'), listPayments);
router.post('/', authorize('collections:create'), validate(createInvoiceSchema), createInvoice);
router.post('/payments', authorize('collections:create'), validate(recordPaymentSchema), recordPayment);
router.delete('/payments/:id', authorize('collections:delete'), validate(idParamSchema, 'params'), deletePayment);
router.get('/:id', authorize('collections:view'), validate(idParamSchema, 'params'), getInvoice);
router.put('/:id', authorize('collections:edit'), validate(idParamSchema, 'params'), validate(updateInvoiceSchema), updateInvoice);
router.delete('/:id', authorize('collections:delete'), validate(idParamSchema, 'params'), deleteInvoice);

export default router;
