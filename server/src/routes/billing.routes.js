import { Router } from 'express';
import { authenticateAllowInactive } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { checkoutSchema, changePlanSchema, renewSubscriptionSchema, mockPaySchema } from '../schemas/index.js';
import {
  getBilling,
  getBillingPlans,
  getBillingInvoices,
  getBillingPayments,
  getBillingEvents,
  getBillingUsage,
  checkout,
  changePlanAction,
  renewAction,
  cancelAction,
  reactivateAction,
  mockPay,
} from '../controllers/billingController.js';

const router = Router();

router.use(authenticateAllowInactive);

router.get('/', authorize('billing:view'), getBilling);
router.get('/plans', authorize('billing:view'), getBillingPlans);
router.get('/invoices', authorize('billing:view'), getBillingInvoices);
router.get('/payments', authorize('billing:view'), getBillingPayments);
router.get('/events', authorize('billing:view'), getBillingEvents);
router.get('/usage', authorize('billing:view'), getBillingUsage);

router.post('/checkout', authorize('billing:edit'), validate(checkoutSchema), checkout);
router.post('/change-plan', authorize('billing:edit'), validate(changePlanSchema), changePlanAction);
router.post('/renew', authorize('billing:edit'), validate(renewSubscriptionSchema), renewAction);
router.post('/cancel', authorize('billing:edit'), cancelAction);
router.post('/reactivate', authorize('billing:edit'), reactivateAction);
router.post('/mock-pay', authorize('billing:edit'), validate(mockPaySchema), mockPay);

export default router;
