import { Router } from 'express';
import { authenticate, requireModule } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import {
  createTargetSchema,
  updateTargetSchema,
  listTargetsQuerySchema,
  exportTargetsQuerySchema,
  targetsDashboardQuerySchema,
  targetScorecardQuerySchema,
  targetCompareQuerySchema,
  idParamSchema,
} from '../schemas/index.js';
import {
  listTargets,
  getTarget,
  targetsMeta,
  targetsDashboard,
  targetsScorecard,
  targetsCompare,
  createTarget,
  updateTarget,
  deleteTarget,
  exportTargets,
} from '../controllers/targetController.js';

const router = Router();

router.use(authenticate, requireModule('targets'));

router.get('/', authorize('targets:view'), validate(listTargetsQuerySchema, 'query'), listTargets);
router.get('/dashboard', authorize('targets:view'), validate(targetsDashboardQuerySchema, 'query'), targetsDashboard);
router.get('/meta', authorize('targets:view'), targetsMeta);
router.get('/scorecard', authorize('targets:view'), validate(targetScorecardQuerySchema, 'query'), targetsScorecard);
router.get('/compare', authorize('targets:view'), validate(targetCompareQuerySchema, 'query'), targetsCompare);
router.get('/export', authorize('targets:export'), validate(exportTargetsQuerySchema, 'query'), exportTargets);
router.post('/', authorize('targets:create'), validate(createTargetSchema), createTarget);
router.get('/:id', authorize('targets:view'), validate(idParamSchema, 'params'), getTarget);
router.put('/:id', authorize('targets:edit'), validate(idParamSchema, 'params'), validate(updateTargetSchema), updateTarget);
router.delete('/:id', authorize('targets:delete'), validate(idParamSchema, 'params'), deleteTarget);

export default router;
