use crate::{ContractError, RecipientShare, RevenueSplitContract, RevenueSplitContractClient};
use soroban_sdk::{
    testutils::{Address as _, Events},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, FromVal, Map, Symbol, Val, Vec,
};

#[test]
fn overflowing_share_total_is_rejected_at_init() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let first = Address::generate(&env);
    let last = Address::generate(&env);
    let invalid = Vec::from_array(&env, [
        RecipientShare { destination: first.clone(), basis_points: u32::MAX },
        RecipientShare { destination: last.clone(), basis_points: 10001 },
    ]);
    assert_eq!(client.try_init(&admin, &invalid), Err(Ok(ContractError::SharesMustSumToTotal)));
    // A failed validation must not leave the contract initialized.
    let valid = Vec::from_array(&env, [
        RecipientShare { destination: first, basis_points: 6000 },
        RecipientShare { destination: last, basis_points: 4000 },
    ]);
    client.init(&admin, &valid);
}

#[test]
fn overflowing_share_update_preserves_active_split() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let first = Address::generate(&env);
    let last = Address::generate(&env);
    client.init(&admin, &Vec::from_array(&env, [
        RecipientShare { destination: first.clone(), basis_points: 5000 },
        RecipientShare { destination: last.clone(), basis_points: 5000 },
    ]));
    let invalid = Vec::from_array(&env, [
        RecipientShare { destination: first.clone(), basis_points: u32::MAX },
        RecipientShare { destination: last.clone(), basis_points: 10001 },
    ]);
    assert_eq!(client.try_update_recipients(&invalid), Err(Ok(ContractError::SharesMustSumToTotal)));
    let token_id = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token = TokenClient::new(&env, &token_id);
    let sender = Address::generate(&env);
    StellarAssetClient::new(&env, &token_id).mint(&sender, &100);
    client.distribute(&sender, &Vec::from_array(&env, [(token_id.clone(), 100)]));
    assert_eq!(token.balance(&first), 50);
    assert_eq!(token.balance(&last), 50);
    assert_eq!(token.balance(&sender), 0);
}

#[test]
fn large_distribution_preserves_balances_and_event_payload() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let first = Address::generate(&env);
    let last = Address::generate(&env);
    client.init(&admin, &Vec::from_array(&env, [
        RecipientShare { destination: first.clone(), basis_points: 6000 },
        RecipientShare { destination: last.clone(), basis_points: 4000 },
    ]));
    let token_id = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token = TokenClient::new(&env, &token_id);
    let sender = Address::generate(&env);
    let amount = i128::MAX / 2;
    StellarAssetClient::new(&env, &token_id).mint(&sender, &amount);
    assert_eq!(client.try_distribute(&sender, &Vec::from_array(&env, [(token_id.clone(), amount)])), Ok(Ok(())));

    // Read the event before later token calls replace the invocation's log.
    let topic = Symbol::new(&env, "distribution_executed_event");
    let mut count = 0;
    for (contract, topics, data) in env.events().all().iter() {
        if contract != id || topics.first().map(|value| Symbol::from_val(&env, &value)) != Some(topic.clone()) {
            continue;
        }
        count += 1;
        let fields = Map::<Symbol, Val>::from_val(&env, &data);
        assert_eq!(i128::from_val(&env, &fields.get(Symbol::new(&env, "total_amount")).unwrap()), amount);
        assert_eq!(u32::from_val(&env, &fields.get(Symbol::new(&env, "recipient_count")).unwrap()), 2);
        assert_eq!(Address::from_val(&env, &fields.get(Symbol::new(&env, "asset")).unwrap()), token_id);
        assert_eq!(Vec::<u32>::from_val(&env, &fields.get(Symbol::new(&env, "split_percentages")).unwrap()), Vec::from_array(&env, [6000, 4000]));
    }
    assert_eq!(count, 1);
    // Independent reduced-ratio oracle, avoiding the original multiply overflow.
    let first_amount = (amount / 5) * 3 + ((amount % 5) * 3) / 5;
    assert_eq!(token.balance(&sender), 0);
    assert_eq!(token.balance(&first), first_amount);
    assert_eq!(token.balance(&last), amount - first_amount);
}
