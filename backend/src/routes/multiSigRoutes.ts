import { Router } from 'express';
import { z } from 'zod';
import { MultiSigController } from '../controllers/multiSigController.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = Router();

const secretSchema = z.string().min(1);
const publicKeyParamsSchema = z.object({ publicKey: z.string().min(1) });
const thresholdsSchema = z.object({}).passthrough();
const configureBodySchema = z.object({
  issuerSecret: secretSchema,
  signers: z.array(z.unknown()).min(1),
  thresholds: thresholdsSchema,
});
const addSignerBodySchema = z.object({
  issuerSecret: secretSchema,
  signerPublicKey: z.string().min(1),
  weight: z.number(),
});
const secretBodySchema = z.object({ issuerSecret: secretSchema });
const thresholdsBodySchema = z.object({
  issuerSecret: secretSchema,
  thresholds: thresholdsSchema,
});

router.post('/configure', validateRequest({ body: configureBodySchema }), MultiSigController.configure);
router.get('/status/:publicKey', validateRequest({ params: publicKeyParamsSchema }), MultiSigController.getStatus);
router.post('/signers', validateRequest({ body: addSignerBodySchema }), MultiSigController.addSigner);
router.delete('/signers/:publicKey', validateRequest({ params: publicKeyParamsSchema, body: secretBodySchema }), MultiSigController.removeSigner);
router.put('/thresholds', validateRequest({ body: thresholdsBodySchema }), MultiSigController.updateThresholds);

export default router;
