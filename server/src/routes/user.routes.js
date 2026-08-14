import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import {
  createUserSchema,
  updateUserSchema,
  resetPasswordSchema,
  statusActionSchema,
  idParamSchema,
  listUsersQuerySchema,
} from '../schemas/index.js';
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  resetPassword,
  setUserStatus,
} from '../controllers/userController.js';

const router = Router();

router.use(authenticate);

router.get('/', authorize('users:view'), validate(listUsersQuerySchema, 'query'), listUsers);
router.post('/', authorize('users:create'), validate(createUserSchema), createUser);
router.get('/:id', authorize('users:view'), validate(idParamSchema, 'params'), getUser);
router.put('/:id', authorize('users:edit'), validate(idParamSchema, 'params'), validate(updateUserSchema), updateUser);
router.post('/:id/reset-password', authorize('users:manage'), validate(idParamSchema, 'params'), validate(resetPasswordSchema), resetPassword);
router.post('/:id/status', authorize(['users:edit', 'users:manage']), validate(idParamSchema, 'params'), validate(statusActionSchema), setUserStatus);

export default router;
