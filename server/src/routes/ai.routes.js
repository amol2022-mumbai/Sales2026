import { Router } from 'express';
import { authenticate, requireModule } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { aiAskSchema, idParamSchema } from '../schemas/index.js';
import { ask, listConversations, getConversation } from '../controllers/aiController.js';

const router = Router();

router.use(authenticate, requireModule('ai_assistant'));

router.post('/ask', authorize('ai_assistant:view'), validate(aiAskSchema), ask);
router.get('/conversations', authorize('ai_assistant:view'), listConversations);
router.get('/conversations/:id', authorize('ai_assistant:view'), validate(idParamSchema, 'params'), getConversation);

export default router;
