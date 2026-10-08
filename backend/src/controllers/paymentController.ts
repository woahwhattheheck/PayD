import { Request, Response } from 'express';
import { AnchorService } from '../services/anchorService.js';
import { Keypair, Asset } from '@stellar/stellar-sdk';
import { StellarService } from '../services/stellarService.js';
import { sendInternalError } from '../utils/internalError.js';

/**
 * Resolve the caller's Stellar secret for status lookups.
 *
 * Status endpoints previously accepted `?secretKey=S...` in the URL query
 * string, which drops the full account seed into access logs, browser
 * history, proxies, and Referer headers (#605). The secret must now arrive
 * in the `Authorization: Bearer <seed>` header (or `X-Stellar-Secret-Key`
 * for non-Authorization clients). Query-string secrets are rejected
 * outright so callers stop leaking them.
 */
export function resolveClientSecret(req: Request): string | undefined {
  const auth = req.get('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    const value = auth.slice(7).trim();
    if (value) return value;
  }
  const headerSecret = req.get('x-stellar-secret-key');
  if (headerSecret && headerSecret.trim()) {
    return headerSecret.trim();
  }
  return undefined;
}

export class PaymentController {
  /**
   * GET /api/payments/anchor-info
   */
  static async getAnchorInfo(req: Request, res: Response) {
    const { domain } = req.query;
    if (!domain) return res.status(400).json({ error: 'Domain required' });

    try {
      const info = await AnchorService.getSEP31Info(domain as string);
      res.json(info);
    } catch (error) {
      sendInternalError(res, req, error);
    }
  }

  /**
   * POST /api/payments/sep31/initiate
   */
  static async initiateSEP31(req: Request, res: Response) {
    const { domain, paymentData, secretKey } = req.body;

    if (!domain || !paymentData || !secretKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      const clientKeypair = Keypair.fromSecret(secretKey);

      // 1. Authenticate
      const token = await AnchorService.authenticate(domain as string, clientKeypair);

      // 2. Initiate Payment
      const result = await AnchorService.initiatePayment(domain as string, token, paymentData);

      res.json(result);
    } catch (error) {
      sendInternalError(res, req, error, 'Failed to initiate SEP-31 payment');
    }
  }

  /**
   * GET /api/payments/sep31/status/:domain/:id
   */
  static async getStatus(req: Request, res: Response) {
    const { domain, id } = req.params;

    if ('secretKey' in req.query) {
      return res.status(400).json({
        error: 'secretKey must not be sent in the URL query string; use the Authorization: Bearer header instead'
      });
    }
    const secretKey = resolveClientSecret(req);

    if (!domain || !id || !secretKey) {
      return res.status(400).json({ error: 'Missing required params' });
    }

    try {
      const clientKeypair = Keypair.fromSecret(secretKey);
      // Re-auth to get a fresh token or use a session-based approach
      // For simplicity in this implementation, we re-auth
      const token = await AnchorService.authenticate(domain as string, clientKeypair);

      const status = await AnchorService.getTransaction(domain as string, token, id as string);
      res.json(status);
    } catch (error) {
      sendInternalError(res, req, error);
    }
  }

  /**
   * GET /api/payments/sep24/info?domain=...
   */
  static async getSEP24Info(req: Request, res: Response) {
    const { domain } = req.query;
    if (!domain) return res.status(400).json({ error: 'Domain required' });

    try {
      const info = await AnchorService.getSEP24Info(domain as string);
      res.json(info);
    } catch (error) {
      sendInternalError(res, req, error);
    }
  }

  /**
   * POST /api/payments/sep24/withdraw
   */
  static async initiateSEP24Withdrawal(req: Request, res: Response) {
    const { domain, secretKey, withdrawalData } = req.body;

    if (!domain || !secretKey || !withdrawalData) {
      return res.status(400).json({ error: 'Missing required fields: domain, secretKey, withdrawalData' });
    }

    try {
      const clientKeypair = Keypair.fromSecret(secretKey);

      // 1. Authenticate with the anchor
      const token = await AnchorService.authenticate(domain as string, clientKeypair);

      // 2. Initiate interactive withdrawal
      const result = await AnchorService.initiateSEP24Withdrawal(domain as string, token, withdrawalData);

      res.json(result);
    } catch (error) {
      sendInternalError(res, req, error, 'Failed to initiate SEP-24 withdrawal');
    }
  }

  /**
   * GET /api/payments/sep24/status/:domain/:id
   */
  static async getSEP24Status(req: Request, res: Response) {
    const { domain, id } = req.params;

    if ('secretKey' in req.query) {
      return res.status(400).json({
        error: 'secretKey must not be sent in the URL query string; use the Authorization: Bearer header instead'
      });
    }
    const secretKey = resolveClientSecret(req);

    if (!domain || !id || !secretKey) {
      return res.status(400).json({ error: 'Missing required params' });
    }

    try {
      const clientKeypair = Keypair.fromSecret(secretKey);
      const token = await AnchorService.authenticate(domain as string, clientKeypair);

      const status = await AnchorService.getSEP24Transaction(domain as string, token, id as string);
      res.json(status);
    } catch (error) {
      sendInternalError(res, req, error);
    }
  }

  /**
   * GET /api/payments/paths
   * Proxy to Stellar Horizon strictSendPaths
   */
  static async getCrossAssetPaths(req: Request, res: Response) {
    const { sourceAsset, sourceAmount, destAssets } = req.query;

    if (
      typeof sourceAsset !== 'string' ||
      typeof sourceAmount !== 'string' ||
      typeof destAssets !== 'string'
    ) {
      return res.status(400).json({
        error: 'Missing or invalid query params: sourceAsset, sourceAmount, destAssets must be strings'
      });
    }

    try {
      const server = StellarService.getServer();

      // Parse Source Asset
      let sourceAssetObj: Asset;
      if (sourceAsset === 'XLM') {
        sourceAssetObj = Asset.native();
      } else {
        // Format parsing: CODE:ISSUER
        const parts = sourceAsset.split(':');
        if (parts.length !== 2) throw new Error('Invalid sourceAsset format. Use CODE:ISSUER or XLM');
        sourceAssetObj = new Asset(parts[0] as string, parts[1] as string);
      }

      // Parse Destination Assets
      const destAssetList: Asset[] = destAssets.split(',').map((assetStr) => {
        if (assetStr === 'XLM') return Asset.native();
        const parts = assetStr.split(':');
        if (parts.length !== 2) throw new Error(`Invalid destAsset format: ${assetStr}`);
        return new Asset(parts[0] as string, parts[1] as string);
      });

      // Call Horizon
      const pathsResponse = await server
        .strictSendPaths(sourceAssetObj, sourceAmount, destAssetList)
        .call();

      res.json({
        paths: pathsResponse.records
      });

    } catch (error) {
      sendInternalError(res, req, error, 'Error fetching conversion paths');
    }
  }
}
