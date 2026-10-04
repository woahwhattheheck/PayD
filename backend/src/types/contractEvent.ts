// Contract event domain types

export interface ContractEvent {
  id: number;
  organizationId: number;
  contractId: string;
  eventType: string;
  payload: Record<string, any>;
  ledgerSequence: number;
  transactionHash: string;
  eventIndex: number;
  ledgerClosedAt: Date;
  indexedAt: Date;
}

export interface IndexerState {
  id: number;
  indexerName: string;
  lastIndexedLedger: number;
  lastIndexedAt: Date;
  status: 'active' | 'paused' | 'error';
  errorMessage?: string;
  updatedAt: Date;
}

export interface ContractEventFilters {
  eventType?: string;
  fromLedger?: number;
  toLedger?: number;
  page?: number;
  limit?: number;
}

export interface PaginatedContractEvents {
  events: ContractEvent[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Soroban RPC event structure
export interface SorobanEvent {
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  id: string;
  pagingToken: string;
  topic: string[];
  value: {
    xdr: string;
  };
  inSuccessfulContractCall: boolean;
  txHash: string;
}

export interface GetEventsResponse {
  events: SorobanEvent[];
  latestLedger: number;
}
