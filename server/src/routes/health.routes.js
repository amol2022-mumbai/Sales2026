import { Router } from 'express';
import { health, healthDb } from '../controllers/healthController.js';

const router = Router();

router.get('/health', health);
router.get('/health/db', healthDb);

export default router;
