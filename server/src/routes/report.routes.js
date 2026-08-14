import { Router } from 'express';
import { authenticate, requireModule, requireExport } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { reportQuerySchema } from '../schemas/index.js';
import { listReportTypes, getReport, exportReport } from '../controllers/reportController.js';

const router = Router();

router.use(authenticate, requireModule('reports'));

router.get('/types', authorize('reports:view'), listReportTypes);
router.get('/:type/export', requireExport, authorize('reports:export'), validate(reportQuerySchema, 'query'), exportReport);
router.get('/:type', authorize('reports:view'), validate(reportQuerySchema, 'query'), getReport);

export default router;
