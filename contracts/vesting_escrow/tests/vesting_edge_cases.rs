use soroban_sdk::{
    testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
    token, Address, Env, Vec,
};
use vesting_escrow::{VestingContract, VestingContractClient};

const START: u64 = 1_000;
const CLIFF: u64 = 100;
const DURATION: u64 = 1_000;
const AMOUNT: i128 = 10_000;
const FUNDS: i128 = 20_000;

struct Fixture {
    env: Env,
    contract: Address,
    funder: Address,
    beneficiary: Address,
    token: Address,
    clawback_admin: Address,
    upgrade_admin: Address,
}

impl Fixture {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(START);
        let funder = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let clawback_admin = Address::generate(&env);
        let upgrade_admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(token_admin).address();
        token::StellarAssetClient::new(&env, &token).mint(&funder, &FUNDS);
        let contract = env.register(VestingContract, ());
        Self {
            env,
            contract,
            funder,
            beneficiary,
            token,
            clawback_admin,
            upgrade_admin,
        }
    }

    fn client(&self) -> VestingContractClient<'_> {
        VestingContractClient::new(&self.env, &self.contract)
    }

    fn initialize(&self) {
        self.client().initialize(
            &self.funder,
            &self.beneficiary,
            &self.token,
            &START,
            &CLIFF,
            &DURATION,
            &AMOUNT,
            &self.clawback_admin,
            &self.upgrade_admin,
        );
    }

    fn balance(&self, address: &Address) -> i128 {
        token::Client::new(&self.env, &self.token).balance(address)
    }

    fn assert_balances(&self, beneficiary: i128, admin: i128, escrow: i128) {
        assert_eq!(self.balance(&self.funder), FUNDS - AMOUNT);
        assert_eq!(self.balance(&self.beneficiary), beneficiary);
        assert_eq!(self.balance(&self.clawback_admin), admin);
        assert_eq!(self.balance(&self.contract), escrow);
        assert_eq!(beneficiary + admin + escrow, AMOUNT);
    }
}

#[test]
fn uninitialized_vesting_operations_are_rejected() {
    let f = Fixture::new();
    let client = f.client();
    assert!(client.try_claim().is_err());
    assert!(client.try_clawback().is_err());
    assert!(client.try_get_config().is_err());
    assert!(client.try_get_vested_amount().is_err());
    assert!(client.try_get_claimable_amount().is_err());
    assert_eq!(f.balance(&f.funder), FUNDS);
    assert_eq!(f.balance(&f.contract), 0);
}

#[test]
fn double_initialization_preserves_the_original_grant_and_funds() {
    let f = Fixture::new();
    f.initialize();
    let replacement = Address::generate(&f.env);
    assert!(f
        .client()
        .try_initialize(
            &f.funder,
            &replacement,
            &f.token,
            &(START + 1),
            &0,
            &1,
            &1,
            &replacement,
            &replacement,
        )
        .is_err());
    let config = f.client().get_config();
    assert_eq!(config.beneficiary, f.beneficiary);
    assert_eq!(config.clawback_admin, f.clawback_admin);
    assert_eq!(config.start_time, START);
    assert_eq!(config.total_amount, AMOUNT);
    assert_eq!(config.claimed_amount, 0);
    assert!(config.is_active);
    assert_eq!(f.client().get_upgrade_admin(), f.upgrade_admin);
    f.assert_balances(0, 0, AMOUNT);
}

#[test]
fn invalid_initialization_does_not_store_config_or_move_funds() {
    let f = Fixture::new();
    // Zero/negative amounts and a cliff after the vesting end are invalid.
    for (amount, cliff, duration) in [(0, CLIFF, DURATION), (-1, CLIFF, DURATION), (AMOUNT, 101, 100)] {
        assert!(f
            .client()
            .try_initialize(
                &f.funder,
                &f.beneficiary,
                &f.token,
                &START,
                &cliff,
                &duration,
                &amount,
                &f.clawback_admin,
                &f.upgrade_admin,
            )
            .is_err());
        assert!(f.client().try_get_config().is_err());
        assert!(f.client().try_get_upgrade_admin().is_err());
        assert_eq!(f.balance(&f.funder), FUNDS);
        assert_eq!(f.balance(&f.contract), 0);
    }
    // Rejected attempts must not prevent a subsequent valid initialization.
    f.initialize();
    f.assert_balances(0, 0, AMOUNT);
}

#[test]
fn claims_before_the_cliff_are_no_ops_and_the_cliff_is_inclusive() {
    let f = Fixture::new();
    f.initialize();
    // claim() intentionally returns successfully when nothing is claimable.
    // Verify the financial/state outcome rather than expecting a new API error.
    for now in [START - 1, START, START + CLIFF - 1] {
        f.env.ledger().set_timestamp(now);
        assert_eq!(f.client().get_vested_amount(), 0);
        assert_eq!(f.client().get_claimable_amount(), 0);
        f.client().claim();
        assert_eq!(f.client().get_config().claimed_amount, 0);
        f.assert_balances(0, 0, AMOUNT);
    }
    f.env.ledger().set_timestamp(START + CLIFF);
    assert_eq!(f.client().get_claimable_amount(), 1_000);
    f.client().claim();
    assert_eq!(f.client().get_config().claimed_amount, 1_000);
    f.assert_balances(1_000, 0, 9_000);
}

#[test]
fn multiple_partial_claims_only_transfer_the_newly_vested_amount() {
    let f = Fixture::new();
    f.initialize();
    let mut previous = 0;
    for (elapsed, vested) in [(100, 1_000), (201, 2_010), (750, 7_500), (1_000, 10_000)] {
        f.env.ledger().set_timestamp(START + elapsed);
        assert_eq!(f.client().get_claimable_amount(), vested - previous);
        f.client().claim();
        assert_eq!(f.client().get_config().claimed_amount, vested);
        assert_eq!(f.client().get_claimable_amount(), 0);
        f.assert_balances(vested, 0, AMOUNT - vested);
        previous = vested;
    }
    // Fully claimed grants remain no-ops at the end and after the end.
    for elapsed in [DURATION, DURATION + 1] {
        f.env.ledger().set_timestamp(START + elapsed);
        f.client().claim();
        assert_eq!(f.client().get_config().claimed_amount, AMOUNT);
        assert_eq!(f.client().get_claimable_amount(), 0);
        f.assert_balances(AMOUNT, 0, 0);
    }
}

#[test]
fn another_address_cannot_authorize_claim_or_clawback() {
    let f = Fixture::new();
    f.initialize();
    f.env.ledger().set_timestamp(START + 200);
    let outsider = Address::generate(&f.env);
    for function in ["claim", "clawback"] {
        f.env.mock_auths(&[MockAuth {
            address: &outsider,
            invoke: &MockAuthInvoke {
                contract: &f.contract,
                fn_name: function,
                args: Vec::new(&f.env),
                sub_invokes: &[],
            },
        }]);
        let rejected = match function {
            "claim" => f.client().try_claim().is_err(),
            _ => f.client().try_clawback().is_err(),
        };
        assert!(rejected);
        let config = f.client().get_config();
        assert!(config.is_active);
        assert_eq!(config.total_amount, AMOUNT);
        assert_eq!(config.claimed_amount, 0);
        f.assert_balances(0, 0, AMOUNT);
    }
    // Positive control: the actual administrator can authorize the same call.
    f.env.mock_auths(&[MockAuth {
        address: &f.clawback_admin,
        invoke: &MockAuthInvoke {
            contract: &f.contract,
            fn_name: "clawback",
            args: Vec::new(&f.env),
            sub_invokes: &[],
        },
    }]);
    f.client().clawback();
    assert!(!f.client().get_config().is_active);
    f.assert_balances(0, 8_000, 2_000);
}

#[test]
fn a_second_clawback_is_rejected_without_changing_the_capped_grant() {
    let f = Fixture::new();
    f.initialize();
    f.env.ledger().set_timestamp(START + 200);
    f.client().clawback();
    assert!(f.client().try_clawback().is_err());
    let config = f.client().get_config();
    assert!(!config.is_active);
    assert_eq!(config.total_amount, 2_000);
    assert_eq!(config.claimed_amount, 0);
    f.assert_balances(0, 8_000, 2_000);
    f.env.ledger().set_timestamp(START + DURATION);
    f.client().claim();
    assert_eq!(f.client().get_config().claimed_amount, 2_000);
    f.assert_balances(2_000, 8_000, 0);
}

#[test]
fn cliff_equal_to_duration_vests_all_tokens_at_the_boundary() {
    let f = Fixture::new();
    f.client().initialize(
        &f.funder,
        &f.beneficiary,
        &f.token,
        &START,
        &DURATION,
        &DURATION,
        &AMOUNT,
        &f.clawback_admin,
        &f.upgrade_admin,
    );
    f.env.ledger().set_timestamp(START + DURATION - 1);
    assert_eq!(f.client().get_claimable_amount(), 0);
    f.client().claim();
    f.assert_balances(0, 0, AMOUNT);
    f.env.ledger().set_timestamp(START + DURATION);
    assert_eq!(f.client().get_claimable_amount(), AMOUNT);
    f.client().claim();
    f.assert_balances(AMOUNT, 0, 0);
}
