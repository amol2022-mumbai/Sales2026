import { Router } from 'express';
import { authenticate, requireModule } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import {
  createTeamSchema,
  updateTeamSchema,
  addTeamMembersSchema,
  idParamSchema,
  teamMemberParamsSchema,
  listTeamsQuerySchema,
} from '../schemas/index.js';
import {
  listTeams,
  getTeam,
  createTeam,
  updateTeam,
  addTeamMembers,
  removeTeamMember,
} from '../controllers/teamController.js';

const router = Router();

router.use(authenticate, requireModule('sales_team'));

router.get('/', authorize('sales_team:view'), validate(listTeamsQuerySchema, 'query'), listTeams);
router.post('/', authorize('sales_team:create'), validate(createTeamSchema), createTeam);
router.get('/:id', authorize('sales_team:view'), validate(idParamSchema, 'params'), getTeam);
router.put('/:id', authorize('sales_team:edit'), validate(idParamSchema, 'params'), validate(updateTeamSchema), updateTeam);
router.post('/:id/members', authorize('sales_team:edit'), validate(idParamSchema, 'params'), validate(addTeamMembersSchema), addTeamMembers);
router.delete('/:id/members/:userId', authorize('sales_team:edit'), validate(teamMemberParamsSchema, 'params'), removeTeamMember);

export default router;
