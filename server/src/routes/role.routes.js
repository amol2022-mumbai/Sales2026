import { Router } from 'express';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { idParamSchema, updateRolePermissionsSchema } from '../schemas/index.js';
import { listRoles, getRole, listPermissions, updateRolePermissions } from '../controllers/roleController.js';

const router = Router();

router.use(authenticate);

router.get('/', authorize('roles:view'), listRoles);
router.get('/permissions', authorize('roles:view'), listPermissions);
router.get('/:id', authorize('roles:view'), validate(idParamSchema, 'params'), getRole);
router.put('/:id/permissions', authorize('roles:manage'), requireSuperAdmin, validate(idParamSchema, 'params'), validate(updateRolePermissionsSchema), updateRolePermissions);

export default router;
