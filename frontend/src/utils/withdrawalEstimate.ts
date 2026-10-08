export interface WithdrawalEstimate {
  estimatedReceive: number;
  isCurrencySupported: boolean;
  isEstimateAvailable: boolean;
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
  const numericAmount = Number(amount);
  const isAmountValid = Number.isFinite(numericAmount) && numericAmount > 0;
  const isRateValid = Number.isFinite(exchangeRate) && exchangeRate > 0;
  const convertedAmount = numericAmount * exchangeRate;
  const isEstimateAvailable = isCurrencySupported && isAmountValid && isRateValid
    && Number.isFinite(convertedAmount) && convertedAmount > 0;
  let error: string | null = null;
  if (supportedCurrencies && !isCurrencySupported) {
    error = `Selected anchor does not support ${selectedCurrency}. Please choose another anchor or currency.`;
  } else if (isCurrencySupported && !isRateValid) {
    error = 'Exchange rate is unavailable. Please refresh the rate before withdrawing.';
  } else if (isCurrencySupported && isAmountValid && !isEstimateAvailable) {
    error = 'Unable to estimate this amount. Please choose a different amount.';
  }

  return {
    estimatedReceive: isEstimateAvailable ? convertedAmount : 0,
    isCurrencySupported,
    isEstimateAvailable,
    error,
  };
}
