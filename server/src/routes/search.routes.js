import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { searchQuerySchema } from '../schemas/index.js';
import { search } from '../controllers/searchController.js';

const router = Router();

router.use(authenticate);

router.get('/', validate(searchQuerySchema, 'query'), search);

export default router;
