import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { paginationQuerySchema } from '../schemas/index.js';
import { listAuditLogs } from '../controllers/auditController.js';

const router = Router();

router.use(authenticate);

router.get('/', authorize('audit_logs:view'), validate(paginationQuerySchema, 'query'), listAuditLogs);

export default router;
