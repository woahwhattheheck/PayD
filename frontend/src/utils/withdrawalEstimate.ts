export interface WithdrawalEstimate {
  estimatedReceive: number;
  isCurrencySupported: boolean;
  error: string | null;
}

/** Estimate only currencies the selected anchor can actually pay out. */
export function getWithdrawalEstimate(
  amount: string,
  supportedCurrencies: readonly string[] | undefined,
  selectedCurrency: string,
  exchangeRate: number
): WithdrawalEstimate {
  const isCurrencySupported = supportedCurrencies?.includes(selectedCurrency) ?? false;
  const error = supportedCurrencies && !isCurrencySupported
    ? `Selected anchor does not support ${selectedCurrency}. Please choose another anchor or currency.`
    : null;
  const numericAmount = Number(amount);
  const convertedAmount = numericAmount * exchangeRate;
  const estimatedReceive = isCurrencySupported
    && Number.isFinite(numericAmount) && numericAmount > 0
    && Number.isFinite(exchangeRate) && exchangeRate > 0
    && Number.isFinite(convertedAmount)
    ? convertedAmount
    : 0;

  return { estimatedReceive, isCurrencySupported, error };
}
