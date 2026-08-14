import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { paginationQuerySchema, idParamSchema } from '../schemas/index.js';
import { listNotifications, markRead, markAllRead } from '../controllers/notificationController.js';

const router = Router();

router.use(authenticate);

router.get('/', authorize('notifications:view'), validate(paginationQuerySchema, 'query'), listNotifications);
router.put('/read-all', authorize('notifications:view'), markAllRead);
router.put('/:id/read', authorize('notifications:view'), validate(idParamSchema, 'params'), markRead);

export default router;
