import { Router } from 'express';
import { authenticate, requireModule } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import {
  createOpportunitySchema,
  updateOpportunitySchema,
  moveOpportunityStageSchema,
  addOpportunityNoteSchema,
  listOpportunitiesQuerySchema,
  opportunityBoardQuerySchema,
  idParamSchema,
} from '../schemas/index.js';
import {
  listOpportunities,
  getOpportunity,
  opportunityMeta,
  opportunityBoard,
  opportunityDashboard,
  createOpportunity,
  updateOpportunity,
  moveStage,
  addOpportunityNote,
  deleteOpportunity,
} from '../controllers/opportunityController.js';

const router = Router();

router.use(authenticate, requireModule('pipeline'));

router.get('/', authorize('pipeline:view'), validate(listOpportunitiesQuerySchema, 'query'), listOpportunities);
router.get('/dashboard', authorize('pipeline:view'), opportunityDashboard);
router.get('/meta', authorize('pipeline:view'), opportunityMeta);
router.get('/board', authorize('pipeline:view'), validate(opportunityBoardQuerySchema, 'query'), opportunityBoard);
router.post('/', authorize('pipeline:create'), validate(createOpportunitySchema), createOpportunity);
router.get('/:id', authorize('pipeline:view'), validate(idParamSchema, 'params'), getOpportunity);
router.put('/:id', authorize('pipeline:edit'), validate(idParamSchema, 'params'), validate(updateOpportunitySchema), updateOpportunity);
router.post('/:id/stage', authorize('pipeline:edit'), validate(idParamSchema, 'params'), validate(moveOpportunityStageSchema), moveStage);
router.post('/:id/notes', authorize('pipeline:edit'), validate(idParamSchema, 'params'), validate(addOpportunityNoteSchema), addOpportunityNote);
router.delete('/:id', authorize('pipeline:delete'), validate(idParamSchema, 'params'), deleteOpportunity);

export default router;
