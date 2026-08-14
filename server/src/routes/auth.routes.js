import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loginSchema, changePasswordSchema, updateProfileSchema, acceptInviteSchema } from '../schemas/index.js';
import {
  login,
  me,
  logout,
  changePassword,
  updateProfile,
  acceptInvite,
} from '../controllers/authController.js';

const router = Router();

router.post('/login', validate(loginSchema), login);
router.post('/accept-invite', validate(acceptInviteSchema), acceptInvite);

router.use(authenticate);

router.get('/me', me);
router.post('/logout', logout);
router.put('/me', validate(updateProfileSchema), updateProfile);
router.post('/change-password', validate(changePasswordSchema), changePassword);

export default router;
