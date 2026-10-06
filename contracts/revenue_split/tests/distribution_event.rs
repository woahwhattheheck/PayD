use revenue_split::{RevenueSplitContract, RevenueSplitContractClient, RecipientShare};
use soroban_sdk::{
    testutils::{Address as _, Events},
    token::StellarAssetClient,
    Address, Env, FromVal, IntoVal, Map, Symbol, Val, Vec,
};

#[test]
fn distribution_event_matches_indexer_payload_schema() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token = StellarAssetClient::new(&env, &token_id);

    let contract_id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let shares = Vec::from_array(
        &env,
        [
            RecipientShare {
                destination: recipient_a,
                basis_points: 6000,
            },
            RecipientShare {
                destination: recipient_b,
                basis_points: 4000,
            },
        ],
    );
    client.init(&admin, &shares);

    let sender = Address::generate(&env);
    token.mint(&sender, &1000);
    client.distribute(
        &sender,
        &Vec::from_array(&env, [(token_id.clone(), 1000i128)]),
    );

    let event_name = Symbol::new(&env, "distribution_executed_event");
    let mut matching_event = None;
    for (address, topics, data) in env.events().all().iter() {
        if address != client.address {
            continue;
        }
        let is_target_event = topics
            .get(0)
            .map(|topic| Symbol::from_val(&env, &topic) == event_name)
            .unwrap_or(false);
        if is_target_event {
            assert!(
                matching_event.is_none(),
                "expected exactly one DistributionExecutedEvent"
            );
            matching_event = Some((topics, data));
        }
    }

    let (topics, data) = matching_event.expect("expected one DistributionExecutedEvent");
    assert_eq!(
        topics,
        Vec::from_array(
            &env,
            [event_name.into_val(&env), token_id.clone().into_val(&env)],
        ),
        "indexer topics must preserve the event type and distributed asset"
    );

    let expected_data = Map::<Symbol, Val>::from_array(
        &env,
        [
            (
                Symbol::new(&env, "recipient_count"),
                2u32.into_val(&env),
            ),
            (
                Symbol::new(&env, "split_percentages"),
                Vec::from_array(&env, [6000u32, 4000u32]).into_val(&env),
            ),
            (
                Symbol::new(&env, "total_amount"),
                1000i128.into_val(&env),
            ),
        ],
    );
    assert_eq!(
        data,
        expected_data.into_val(&env),
        "event data must match the map schema decoded by the contract-event indexer"
    );
}
