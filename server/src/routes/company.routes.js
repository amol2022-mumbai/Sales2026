import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { companySettingsSchema, completeCompanySetupSchema, idParamSchema, paginationQuerySchema } from '../schemas/index.js';
import { listCompanies, getCompany, updateCompany, completeCompanySetup } from '../controllers/companyController.js';

const router = Router();

router.use(authenticate);

router.get('/', authorize('settings:view'), validate(paginationQuerySchema, 'query'), listCompanies);
router.get('/:id', authorize('settings:view'), validate(idParamSchema, 'params'), getCompany);
router.put('/:id', authorize('settings:edit'), validate(idParamSchema, 'params'), validate(companySettingsSchema), updateCompany);
router.post('/:id/complete-setup', authorize('settings:edit'), validate(idParamSchema, 'params'), validate(completeCompanySetupSchema), completeCompanySetup);

export default router;
