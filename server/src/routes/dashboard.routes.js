import { Router } from 'express';
import { authenticate, requireModule } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { summary } from '../controllers/dashboardController.js';

const router = Router();

router.use(authenticate, requireModule('dashboard'));

router.get('/summary', authorize('dashboard:view'), summary);

export default router;
