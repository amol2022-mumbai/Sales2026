import { Router } from 'express';
import { authenticate, requireModule } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { misSummaryQuerySchema } from '../schemas/index.js';
import { summary } from '../controllers/misController.js';

const router = Router();

router.use(authenticate, requireModule('mis'));

router.get('/summary', authorize('mis:view'), validate(misSummaryQuerySchema, 'query'), summary);

export default router;
