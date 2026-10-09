import { readEnv } from '../../config/env.js';
import { ExternalComplianceApiProvider } from './externalComplianceApiProvider.js';
import { LocalRuleBasedProvider } from './localRuleBasedProvider.js';
import type { RuleBasedCalculator } from './localRuleBasedProvider.js';
import type { TaxComplianceProvider } from './types.js';

export function createTaxComplianceProvider(ruleBasedCalculator: RuleBasedCalculator): TaxComplianceProvider {
  const providerName = readEnv('TAX_COMPLIANCE_PROVIDER') || 'local_rule_based';

  if (providerName === 'external_compliance_api') {
    const baseUrl = readEnv('TAX_COMPLIANCE_API_BASE_URL');
    if (!baseUrl) {
      throw new Error('TAX_COMPLIANCE_API_BASE_URL must be set when TAX_COMPLIANCE_PROVIDER=external_compliance_api');
    }

    return new ExternalComplianceApiProvider({
      baseUrl,
      apiKey: readEnv('TAX_COMPLIANCE_API_KEY'),
      timeoutMs: readEnv('TAX_COMPLIANCE_API_TIMEOUT_MS')
        ? Number.parseInt(readEnv('TAX_COMPLIANCE_API_TIMEOUT_MS'), 10)
        : undefined,
    });
  }

  return new LocalRuleBasedProvider(ruleBasedCalculator);
}
