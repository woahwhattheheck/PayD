export interface WalletModalCallbacks {
  onWalletSelected: (walletId: string) => void;
  onClosed: () => void;
}

export interface WalletSelection {
  address: string;
  walletId: string;
}

/**
 * Wait for the wallet modal lifecycle to finish. A wallet choice is not
 * complete until the asynchronous address lookup has settled, even if the
 * modal closes immediately after selection.
 */
export function waitForWalletSelection(
  openModal: (callbacks: WalletModalCallbacks) => Promise<void>,
  getAddress: () => Promise<{ address: string }>
): Promise<WalletSelection | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let selectionPending = false;

    const resolveOnce = (selection: WalletSelection | null) => {
      if (settled) return;
      settled = true;
      resolve(selection);
    };

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const callbacks: WalletModalCallbacks = {
      onWalletSelected: (walletId) => {
        if (settled || selectionPending) return;
        selectionPending = true;

        void getAddress().then(
          ({ address }) => resolveOnce({ address, walletId }),
          rejectOnce
        );
      },
      onClosed: () => {
        if (!selectionPending) resolveOnce(null);
      },
    };

    try {
      void openModal(callbacks).catch(rejectOnce);
    } catch (error) {
      rejectOnce(error);
    }
  });
}

export async function requireConnectedWallet<T>(
  getCurrentAddress: () => string | null,
  connect: () => Promise<void>,
  callback: () => Promise<T>
): Promise<T> {
  if (!getCurrentAddress()) {
    await connect();
  }

  if (!getCurrentAddress()) {
    throw new Error('Wallet connection required to perform this action');
  }

  return callback();
}
