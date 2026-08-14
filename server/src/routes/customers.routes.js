import { Router } from 'express';
import { authenticate, requireModule } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import {
  createCustomerSchema,
  updateCustomerSchema,
  addCustomerNoteSchema,
  addCustomerActivitySchema,
  bulkAssignCustomersSchema,
  bulkStatusCustomersSchema,
  convertLeadToCustomerSchema,
  importCustomersSchema,
  listCustomersQuerySchema,
  exportCustomersQuerySchema,
  idParamSchema,
} from '../schemas/index.js';
import {
  listCustomers,
  getCustomer,
  customerMeta,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  addCustomerNote,
  addCustomerActivity,
  bulkAssignCustomers,
  bulkStatusCustomers,
  customerDashboard,
  convertLeadToCustomer,
  importCustomers,
  exportCustomers,
} from '../controllers/customerController.js';

const router = Router();

router.use(authenticate, requireModule('customers'));

router.get('/', authorize('customers:view'), validate(listCustomersQuerySchema, 'query'), listCustomers);
router.get('/dashboard', authorize('customers:view'), customerDashboard);
router.get('/meta', authorize('customers:view'), customerMeta);
router.get('/export', authorize('customers:export'), validate(exportCustomersQuerySchema, 'query'), exportCustomers);
router.post('/import', authorize('customers:create'), validate(importCustomersSchema), importCustomers);
router.post('/convert', authorize('customers:create'), validate(convertLeadToCustomerSchema), convertLeadToCustomer);
router.post('/bulk-assign', authorize('customers:assign'), validate(bulkAssignCustomersSchema), bulkAssignCustomers);
router.post('/bulk-status', authorize('customers:edit'), validate(bulkStatusCustomersSchema), bulkStatusCustomers);
router.post('/', authorize('customers:create'), validate(createCustomerSchema), createCustomer);
router.get('/:id', authorize('customers:view'), validate(idParamSchema, 'params'), getCustomer);
router.put('/:id', authorize('customers:edit'), validate(idParamSchema, 'params'), validate(updateCustomerSchema), updateCustomer);
router.delete('/:id', authorize('customers:delete'), validate(idParamSchema, 'params'), deleteCustomer);
router.post('/:id/notes', authorize('customers:edit'), validate(idParamSchema, 'params'), validate(addCustomerNoteSchema), addCustomerNote);
router.post('/:id/activities', authorize('customers:edit'), validate(idParamSchema, 'params'), validate(addCustomerActivitySchema), addCustomerActivity);

export default router;
