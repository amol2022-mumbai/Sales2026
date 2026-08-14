import { Router } from 'express';
import { authenticate, requireModule } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import {
  createFollowUpSchema,
  updateFollowUpSchema,
  completeFollowUpSchema,
  rescheduleFollowUpSchema,
  assignFollowUpSchema,
  cancelFollowUpSchema,
  listFollowUpsQuerySchema,
  calendarQuerySchema,
  idParamSchema,
} from '../schemas/index.js';
import {
  listFollowUps,
  getFollowUp,
  followUpMeta,
  followUpDashboard,
  followUpCalendar,
  createFollowUp,
  updateFollowUp,
  completeFollowUp,
  rescheduleFollowUp,
  assignFollowUp,
  cancelFollowUp,
  deleteFollowUp,
  runReminders,
} from '../controllers/followUpController.js';

const router = Router();

router.use(authenticate, requireModule('followups'));

router.get('/', authorize('followups:view'), validate(listFollowUpsQuerySchema, 'query'), listFollowUps);
router.get('/dashboard', authorize('followups:view'), followUpDashboard);
router.get('/meta', authorize('followups:view'), followUpMeta);
router.get('/calendar', authorize('followups:view'), validate(calendarQuerySchema, 'query'), followUpCalendar);
router.post('/reminders', authorize('followups:edit'), runReminders);
router.post('/', authorize('followups:create'), validate(createFollowUpSchema), createFollowUp);
router.get('/:id', authorize('followups:view'), validate(idParamSchema, 'params'), getFollowUp);
router.put('/:id', authorize('followups:edit'), validate(idParamSchema, 'params'), validate(updateFollowUpSchema), updateFollowUp);
router.post('/:id/complete', authorize('followups:edit'), validate(idParamSchema, 'params'), validate(completeFollowUpSchema), completeFollowUp);
router.post('/:id/reschedule', authorize('followups:edit'), validate(idParamSchema, 'params'), validate(rescheduleFollowUpSchema), rescheduleFollowUp);
router.post('/:id/assign', authorize('followups:assign'), validate(idParamSchema, 'params'), validate(assignFollowUpSchema), assignFollowUp);
router.post('/:id/cancel', authorize('followups:edit'), validate(idParamSchema, 'params'), validate(cancelFollowUpSchema), cancelFollowUp);
router.delete('/:id', authorize('followups:delete'), validate(idParamSchema, 'params'), deleteFollowUp);

export default router;
