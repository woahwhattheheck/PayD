#![cfg(test)]

use crate::{RevenueSplitContract, RevenueSplitContractClient, RecipientShare};
use soroban_sdk::{
    testutils::{Address as _, Events},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, FromVal, Symbol, Vec,
};

fn create_token_contract<'a>(e: &Env, admin: &Address) -> (Address, StellarAssetClient<'a>, TokenClient<'a>) {
    e.mock_all_auths();
    let contract_id = e.register_stellar_asset_contract_v2(admin.clone()).address();
    let stellar_asset_client = StellarAssetClient::new(e, &contract_id);
    let token_client = TokenClient::new(e, &contract_id);
    (contract_id, stellar_asset_client, token_client)
}

#[test]
fn test_distribution_invalid_amount_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let contract_id = env.register(RevenueSplitContract, ());
    let contract_client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let shares = Vec::from_array(&env, [RecipientShare { destination: recipient1.clone(), basis_points: 10000 }]);
    contract_client.init(&admin, &shares);

    let sender = Address::generate(&env);
    stellar_asset_client.mint(&sender, &1000);

    let assets = Vec::from_array(&env, [(token_id.clone(), 0i128)]);
    assert!(contract_client.try_distribute(&sender, &assets).is_err());
    assert_eq!(token_client.balance(&sender), 1000);
}

#[test]
fn test_initialization() {
    let env = Env::default();
    let contract_id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);

    let shares = Vec::from_array(&env, [
        RecipientShare { destination: recipient1.clone(), basis_points: 6000 },
        RecipientShare { destination: recipient2.clone(), basis_points: 4000 },
    ]);

    env.mock_all_auths();
    client.init(&admin, &shares);

    // Initialized correctly without panic
}

#[test]
fn test_init_invalid_shares() {
    let env = Env::default();
    let contract_id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);

    let shares = Vec::from_array(&env, [
        RecipientShare { destination: recipient1.clone(), basis_points: 5000 },
    ]);

    env.mock_all_auths();
    assert!(client.try_init(&admin, &shares).is_err());
}

#[test]
fn test_init_empty_recipients_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let shares = Vec::<RecipientShare>::new(&env);

    assert!(client.try_init(&admin, &shares).is_err());
}

#[test]
fn test_init_duplicate_recipient_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);

    let shares = Vec::from_array(&env, [
        RecipientShare { destination: recipient1.clone(), basis_points: 5000 },
        RecipientShare { destination: recipient1.clone(), basis_points: 5000 },
    ]);

    assert!(client.try_init(&admin, &shares).is_err());
}

#[test]
#[should_panic]
fn test_init_requires_admin_auth() {
    let env = Env::default();
    let contract_id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let shares = Vec::from_array(&env, [RecipientShare { destination: recipient1, basis_points: 10000 }]);

    // No mock auths => require_auth should panic
    client.init(&admin, &shares);
}

#[test]
fn test_distribution() {
    let env = Env::default();
    env.mock_all_auths();

    // Create token
    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    // Setup revenue split contract
    let contract_id = env.register(RevenueSplitContract, ());
    let contract_client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let recipient3 = Address::generate(&env);

    // 50%, 30%, 20%
    let shares = Vec::from_array(&env, [
        RecipientShare { destination: recipient1.clone(), basis_points: 5000 },
        RecipientShare { destination: recipient2.clone(), basis_points: 3000 },
        RecipientShare { destination: recipient3.clone(), basis_points: 2000 },
    ]);

    contract_client.init(&admin, &shares);

    // Fund a sender
    let sender = Address::generate(&env);
    stellar_asset_client.mint(&sender, &1000);

    // Distribute 1000 tokens
    let assets = Vec::from_array(&env, [(token_id.clone(), 1000i128)]);
    contract_client.distribute(&sender, &assets);

    // Verify balances
    assert_eq!(token_client.balance(&sender), 0);
    assert_eq!(token_client.balance(&recipient1), 500);
    assert_eq!(token_client.balance(&recipient2), 300);
    assert_eq!(token_client.balance(&recipient3), 200);
}

#[test]
fn test_distribution_multiple_assets() {
    let env = Env::default();
    env.mock_all_auths();

    // Create tokens
    let token_admin = Address::generate(&env);
    let (token_id1, stellar_asset_client1, token_client1) = create_token_contract(&env, &token_admin);
    let (token_id2, stellar_asset_client2, token_client2) = create_token_contract(&env, &token_admin);

    // Setup revenue split contract
    let contract_id = env.register(RevenueSplitContract, ());
    let contract_client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);

    // 60%, 40%
    let shares = Vec::from_array(&env, [
        RecipientShare { destination: recipient1.clone(), basis_points: 6000 },
        RecipientShare { destination: recipient2.clone(), basis_points: 4000 },
    ]);

    contract_client.init(&admin, &shares);

    // Fund a sender
    let sender = Address::generate(&env);
    stellar_asset_client1.mint(&sender, &1000);
    stellar_asset_client2.mint(&sender, &2000);

    // Distribute multiple assets
    let assets = Vec::from_array(&env, [
        (token_id1.clone(), 1000i128),
        (token_id2.clone(), 2000i128)
    ]);
    contract_client.distribute(&sender, &assets);

    // Verify balances token 1
    assert_eq!(token_client1.balance(&sender), 0);
    assert_eq!(token_client1.balance(&recipient1), 600);
    assert_eq!(token_client1.balance(&recipient2), 400);

    // Verify balances token 2
    assert_eq!(token_client2.balance(&sender), 0);
    assert_eq!(token_client2.balance(&recipient1), 1200);
    assert_eq!(token_client2.balance(&recipient2), 800);
}

#[test]
fn test_update_recipients() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    
    // Initial 100% to recipient1
    let shares = Vec::from_array(&env, [
        RecipientShare { destination: recipient1.clone(), basis_points: 10000 },
    ]);
    client.init(&admin, &shares);

    // Update to 2 recipients perfectly
    let recipient2 = Address::generate(&env);
    let new_shares = Vec::from_array(&env, [
        RecipientShare { destination: recipient1.clone(), basis_points: 5000 },
        RecipientShare { destination: recipient2.clone(), basis_points: 5000 },
    ]);

    client.update_recipients(&new_shares);
}

// ── Event emission ────────────────────────────────────────────────────────────

fn count_named_events(env: &Env, contract_addr: &Address, event_name: &str) -> u32 {
    let target_sym = Symbol::new(env, event_name);
    let mut n = 0u32;
    for (addr, topics, _data) in env.events().all().iter() {
        if addr != *contract_addr {
            continue;
        }
        if topics.iter().any(|t| Symbol::from_val(env, &t) == target_sym) {
            n += 1;
        }
    }
    n
}

#[test]
fn test_distribute_emits_distribution_executed_event() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let contract_id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);

    let shares = Vec::from_array(
        &env,
        [
            RecipientShare {
                destination: recipient1.clone(),
                basis_points: 6000,
            },
            RecipientShare {
                destination: recipient2.clone(),
                basis_points: 4000,
            },
        ],
    );
    client.init(&admin, &shares);

    let sender = Address::generate(&env);
    stellar_asset_client.mint(&sender, &1000);

    let assets = Vec::from_array(&env, [(token_id.clone(), 1000i128)]);
    client.distribute(&sender, &assets);

    // Check events before any further host reads (balance calls can clear the log).
    let n = count_named_events(&env, &client.address, "distribution_executed_event");
    assert_eq!(n, 1, "expected one DistributionExecutedEvent");

    assert_eq!(token_client.balance(&recipient1), 600);
    assert_eq!(token_client.balance(&recipient2), 400);
}

#[test]
fn test_distribute_emits_one_event_per_asset() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id1, stellar_asset_client1, _) = create_token_contract(&env, &token_admin);
    let (token_id2, stellar_asset_client2, _) = create_token_contract(&env, &token_admin);

    let contract_id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let shares = Vec::from_array(
        &env,
        [RecipientShare {
            destination: recipient1.clone(),
            basis_points: 10000,
        }],
    );
    client.init(&admin, &shares);

    let sender = Address::generate(&env);
    stellar_asset_client1.mint(&sender, &100);
    stellar_asset_client2.mint(&sender, &200);

    let assets = Vec::from_array(
        &env,
        [(token_id1.clone(), 100i128), (token_id2.clone(), 200i128)],
    );
    client.distribute(&sender, &assets);

    let n = count_named_events(&env, &client.address, "distribution_executed_event");
    assert_eq!(n, 2, "expected one DistributionExecutedEvent per asset");
}

#[test]
fn test_distribution_emits_truthful_total_when_last_share_rounds_to_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);
    let contract_id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let first = Address::generate(&env);
    let last = Address::generate(&env);
    let shares = Vec::from_array(
        &env,
        [
            RecipientShare { destination: first.clone(), basis_points: 5000 },
            RecipientShare { destination: last.clone(), basis_points: 5000 },
        ],
    );
    client.init(&admin, &shares);

    let sender = Address::generate(&env);
    stellar_asset_client.mint(&sender, &1);
    client.distribute(&sender, &Vec::from_array(&env, [(token_id, 1i128)]));

    assert_eq!(count_named_events(&env, &client.address, "distribution_executed_event"), 1);
    assert_eq!(token_client.balance(&sender), 0);
    assert_eq!(token_client.balance(&first), 0);
    assert_eq!(token_client.balance(&last), 1);
}
