import { Router } from 'express';
import { authenticate, requireModule } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import {
  createLeadSchema,
  updateLeadSchema,
  addLeadNoteSchema,
  bulkAssignLeadsSchema,
  bulkStatusLeadsSchema,
  importLeadsSchema,
  listLeadsQuerySchema,
  exportLeadsQuerySchema,
  idParamSchema,
} from '../schemas/index.js';
import {
  listLeads,
  getLead,
  leadMeta,
  createLead,
  updateLead,
  deleteLead,
  addNote,
  bulkAssign,
  bulkStatus,
  leadDashboard,
  importLeads,
  exportLeads,
} from '../controllers/leadController.js';

const router = Router();

router.use(authenticate, requireModule('leads'));

router.get('/', authorize('leads:view'), validate(listLeadsQuerySchema, 'query'), listLeads);
router.get('/dashboard', authorize('leads:view'), leadDashboard);
router.get('/meta', authorize('leads:view'), leadMeta);
router.get('/export', authorize('leads:export'), validate(exportLeadsQuerySchema, 'query'), exportLeads);
router.post('/import', authorize('leads:create'), validate(importLeadsSchema), importLeads);
router.post('/bulk-assign', authorize('leads:assign'), validate(bulkAssignLeadsSchema), bulkAssign);
router.post('/bulk-status', authorize('leads:edit'), validate(bulkStatusLeadsSchema), bulkStatus);
router.post('/', authorize('leads:create'), validate(createLeadSchema), createLead);
router.get('/:id', authorize('leads:view'), validate(idParamSchema, 'params'), getLead);
router.put('/:id', authorize('leads:edit'), validate(idParamSchema, 'params'), validate(updateLeadSchema), updateLead);
router.delete('/:id', authorize('leads:delete'), validate(idParamSchema, 'params'), deleteLead);
router.post('/:id/notes', authorize('leads:edit'), validate(idParamSchema, 'params'), validate(addLeadNoteSchema), addNote);

export default router;
