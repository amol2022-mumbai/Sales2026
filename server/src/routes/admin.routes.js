import { Router } from 'express';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createClientSchema,
  updateClientSchema,
  createPlanSchema,
  updatePlanSchema,
  upsertLicenseSchema,
  listClientsQuerySchema,
  idParamSchema,
  companyIdParamSchema,
  inviteAdminSchema,
  createSubscriptionInvoiceSchema,
  recordSubscriptionPaymentSchema,
  changePlanSchema,
  renewSubscriptionSchema,
  refundSubscriptionSchema,
} from '../schemas/index.js';
import {
  listClients,
  getClient,
  createClient,
  updateClient,
  inviteCompanyAdmin,
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  listLicenses,
  getLicense,
  upsertLicense,
  listModules,
  platformDashboard,
  aiConfigStatus,
  aiConfigTest,
} from '../controllers/adminController.js';
import {
  listSubscriptions,
  getSubscription,
  createSubscriptionInvoice,
  recordSubscriptionPayment,
  changePlanAction,
  renewSubscriptionAction,
  cancelSubscriptionAction,
  reactivateSubscriptionAction,
  refundSubscriptionAction,
  listSubscriptionEvents,
  listSubscriptionPayments,
} from '../controllers/subscriptionController.js';
import {
  adminDashboardQuerySchema,
} from '../schemas/index.js';

const router = Router();

router.use(authenticate, requireSuperAdmin);

// Clients
router.get('/clients', validate(listClientsQuerySchema, 'query'), listClients);
router.post('/clients', validate(createClientSchema), createClient);
router.get('/clients/:id', validate(idParamSchema, 'params'), getClient);
router.put('/clients/:id', validate(idParamSchema, 'params'), validate(updateClientSchema), updateClient);
router.post('/clients/:id/invite-admin', validate(idParamSchema, 'params'), validate(inviteAdminSchema), inviteCompanyAdmin);

// Plans
router.get('/plans', listPlans);
router.post('/plans', validate(createPlanSchema), createPlan);
router.get('/plans/:id', validate(idParamSchema, 'params'), getPlan);
router.put('/plans/:id', validate(idParamSchema, 'params'), validate(updatePlanSchema), updatePlan);

// Licenses (keyed by company id)
router.get('/licenses', listLicenses);
router.get('/licenses/:id', validate(idParamSchema, 'params'), getLicense);
router.put('/licenses/:id', validate(idParamSchema, 'params'), validate(upsertLicenseSchema), upsertLicense);

// Module catalog
router.get('/modules', listModules);

// Subscriptions (subscription billing records across tenants)
router.get('/subscriptions', listSubscriptions);
router.get('/subscriptions/:companyId', validate(companyIdParamSchema, 'params'), getSubscription);
router.post('/subscriptions/:companyId/invoices', validate(companyIdParamSchema, 'params'), validate(createSubscriptionInvoiceSchema), createSubscriptionInvoice);
router.post('/subscriptions/invoices/:id/payments', validate(idParamSchema, 'params'), validate(recordSubscriptionPaymentSchema), recordSubscriptionPayment);
router.post('/subscriptions/:companyId/change-plan', validate(companyIdParamSchema, 'params'), validate(changePlanSchema), changePlanAction);
router.post('/subscriptions/:companyId/renew', validate(companyIdParamSchema, 'params'), validate(renewSubscriptionSchema), renewSubscriptionAction);
router.post('/subscriptions/:companyId/cancel', validate(companyIdParamSchema, 'params'), cancelSubscriptionAction);
router.post('/subscriptions/:companyId/reactivate', validate(companyIdParamSchema, 'params'), reactivateSubscriptionAction);
router.post('/subscriptions/:companyId/refund', validate(companyIdParamSchema, 'params'), validate(refundSubscriptionSchema), refundSubscriptionAction);
router.get('/subscriptions/:companyId/events', validate(companyIdParamSchema, 'params'), listSubscriptionEvents);
router.get('/subscriptions/:companyId/payments', validate(companyIdParamSchema, 'params'), listSubscriptionPayments);

// AI Assistant configuration (status + connectivity test; never returns keys)
router.get('/ai/status', aiConfigStatus);
router.post('/ai/test', aiConfigTest);

// Platform dashboard (cross-tenant analytics)
router.get('/dashboard', validate(adminDashboardQuerySchema, 'query'), platformDashboard);

export default router;
