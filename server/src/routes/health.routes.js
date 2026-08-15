import { Router } from 'express';
import { health, healthDb, healthReady } from '../controllers/healthController.js';

const router = Router();

router.get('/health', health);
router.get('/health/db', healthDb);
router.get('/health/ready', healthReady);

export default router;
