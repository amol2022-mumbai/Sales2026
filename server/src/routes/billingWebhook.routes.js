import { Router, raw } from 'express';
import { webhook } from '../controllers/billingController.js';

// Raw-body webhook route. Mounted in app.js BEFORE the JSON body parser so the
// exact request body is available for signature verification. `raw` applies
// only to this route.
const router = Router();

router.post('/billing/webhook', raw({ type: '*/*', limit: '1mb' }), webhook);

export default router;
