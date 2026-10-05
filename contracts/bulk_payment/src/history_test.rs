use super::*;
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, vec};

#[test]
fn sender_history_tracks_creation_modes_and_isolates_senders() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let other = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let asset = StellarAssetClient::new(&env, &token);
    asset.mint(&sender, &100);
    asset.mint(&other, &100);
    let address = env.register(BulkPaymentContract, ());
    let client = BulkPaymentContractClient::new(&env, &address);
    client.initialize(&admin);
    let payments = vec![&env, PaymentOp { recipient: Address::generate(&env), amount: 1 }];

    assert!(client.get_batches_by_sender(&sender, &0, &10).is_empty());
    let first = client.execute_batch(&sender, &token, &payments, &client.get_sequence());
    let other_id = client.execute_batch(&other, &token, &payments, &client.get_sequence());
    let partial = client.execute_batch_partial(&sender, &token, &payments, &client.get_sequence());
    let skipped_ops = vec![&env, PaymentOp { recipient: Address::generate(&env), amount: 0 }];
    let skipped = client.execute_batch_partial(&sender, &token, &skipped_ops, &client.get_sequence());
    assert_eq!(client.get_batches_by_sender(&sender, &0, &2), vec![&env, skipped, partial]);
    assert_eq!(client.get_batches_by_sender(&sender, &1, &2), vec![&env, first]);
    assert!(client.get_batches_by_sender(&sender, &2, &2).is_empty());
    assert_eq!(client.get_batches_by_sender(&other, &0, &10), vec![&env, other_id]);
    assert!(client.get_batches_by_sender(&Address::generate(&env), &0, &10).is_empty());
    assert!(client.get_batches_by_sender(&sender, &0, &0).is_empty());
    assert!(client.get_batches_by_sender(&sender, &u32::MAX, &u32::MAX).is_empty());

    let sequence = client.get_sequence();
    assert!(client.try_execute_batch(&sender, &token, &Vec::new(&env), &sequence).is_err());
    assert_eq!(client.get_sequence(), sequence);
    assert_eq!(client.get_batches_by_sender(&sender, &0, &10), vec![&env, skipped, partial, first]);
}

#[test]
fn sender_history_caps_pages_without_rewriting_prior_items() {
    let env = Env::default();
    let sender = Address::generate(&env);
    let address = env.register(BulkPaymentContract, ());
    let client = BulkPaymentContractClient::new(&env, &address);
    // Populate the real shared index directly to isolate the page-size boundary
    // from token transfers. These are index fixtures, not fake payment records.
    env.as_contract(&address, || {
        for id in 1..=101u64 {
            common::sender_history::append(&env, &sender, id);
        }
    });
    let first = client.get_batches_by_sender(&sender, &0, &u32::MAX);
    assert_eq!(first.len(), 100);
    assert_eq!(first.get(0), Some(101));
    assert_eq!(first.get(99), Some(2));
    assert_eq!(client.get_batches_by_sender(&sender, &1, &u32::MAX), vec![&env, 1u64]);
    assert!(client.get_batches_by_sender(&sender, &2, &100).is_empty());

    let separate_address = env.register(BulkPaymentContract, ());
    let separate = BulkPaymentContractClient::new(&env, &separate_address);
    assert!(separate.get_batches_by_sender(&sender, &0, &100).is_empty());
}
