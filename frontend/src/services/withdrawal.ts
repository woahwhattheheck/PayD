/**
 * Withdrawal service for SEP-24 interactive flow.
 * Handles anchor discovery, withdrawal initiation, and transaction polling.
 */

import axios from 'axios';

const API_BASE_URL = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000/api';

export interface AnchorInfo {
  domain: string;
  name: string;
  supportedCurrencies: string[];
  withdrawFee?: string;
  withdrawMinAmount?: number;
  withdrawMaxAmount?: number;
}

export interface WithdrawalTransaction {
  id: string;
  anchorDomain: string;
  status:
    | 'incomplete'
    | 'pending_user_transfer'
    | 'pending_anchor'
    | 'pending_stellar'
    | 'pending_external'
    | 'completed'
    | 'failed'
    | 'refunded'
    | 'expired'
    | 'error';
  amountIn: number;
  assetCode: string;
  amountOut?: number;
  withdrawAnchorAccountId?: string;
  interactiveUrl?: string;
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface WithdrawalRequest {
  anchorDomain: string;
  assetCode: string;
  amount: number;
  destinationType: 'bank_account' | 'mobile_money';
  destinationDetails: Record<string, string>;
}

export interface WithdrawalResponse {
  transactionId: string;
  interactiveUrl: string;
  status: string;
}

const withdrawalService = {
  /** Fetch available anchors for withdrawal. */
  getAvailableAnchors: async (assetCode: string = 'ORGUSD'): Promise<AnchorInfo[]> => {
    const response = await axios.get<{ anchors: AnchorInfo[] }>(
      `${API_BASE_URL}/withdrawal/anchors`,
      { params: { assetCode } }
    );
    return response.data.anchors;
  },

  /** Initiate a withdrawal via backend SEP-24 endpoint. */
  initiateWithdrawal: async (request: WithdrawalRequest): Promise<WithdrawalResponse> => {
    const response = await axios.post<WithdrawalResponse>(
      `${API_BASE_URL}/withdrawal/initiate`,
      request
    );
    return response.data;
  },

  /** Get withdrawal transaction status. */
  getTransactionStatus: async (
    transactionId: string,
    anchorDomain: string
  ): Promise<WithdrawalTransaction> => {
    const response = await axios.get<WithdrawalTransaction>(
      `${API_BASE_URL}/withdrawal/status/${transactionId}`,
      { params: { anchorDomain } }
    );
    return response.data;
  },

  /** Cancel a pending withdrawal. */
  cancelWithdrawal: async (transactionId: string): Promise<void> => {
    await axios.post(`${API_BASE_URL}/withdrawal/cancel`, { transactionId });
  },
};

export default withdrawalService;
