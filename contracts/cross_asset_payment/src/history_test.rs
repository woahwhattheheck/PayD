use super::*;
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, vec};

#[test]
fn sender_history_preserves_creation_order_across_status_changes() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let other = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let asset = StellarAssetClient::new(&env, &token);
    asset.mint(&sender, &100);
    asset.mint(&other, &100);
    let address = env.register(CrossAssetPaymentContract, ());
    let client = CrossAssetPaymentContractClient::new(&env, &address);
    client.init(&admin, &0);
    let receiver = String::from_str(&env, "worker-1");
    let target = String::from_str(&env, "EUR");
    let anchor = String::from_str(&env, "anchor-eu");
    let create = |from: &Address| client.initiate_payment(from, &10, &token, &receiver, &target, &anchor);

    assert!(client.get_payments_by_sender(&sender, &0, &2).is_empty());
    let first = create(&sender);
    let other_id = create(&other);
    let second = create(&sender);
    let third = create(&sender);
    client.update_status(&first, &symbol_short!("complete"));
    client.cancel_payment(&sender, &second);
    assert_eq!(client.get_payments_by_sender(&sender, &0, &2), vec![&env, third, second]);
    assert_eq!(client.get_payments_by_sender(&sender, &1, &2), vec![&env, first]);
    assert!(client.get_payments_by_sender(&sender, &2, &2).is_empty());
    assert_eq!(client.get_payments_by_sender(&other, &0, &10), vec![&env, other_id]);
    assert_eq!(client.get_batches_by_sender(&sender, &0, &10), vec![&env, third, second, first]);

    assert!(client.try_initiate_payment(&sender, &0, &token, &receiver, &target, &anchor).is_err());
    assert_eq!(client.get_payment_count(), 4);
    assert_eq!(client.get_payments_by_sender(&sender, &0, &10), vec![&env, third, second, first]);
    assert!(client.get_payments_by_sender(&Address::generate(&env), &0, &10).is_empty());
    assert!(client.get_payments_by_sender(&sender, &0, &0).is_empty());
    assert!(client.get_payments_by_sender(&sender, &u32::MAX, &u32::MAX).is_empty());
}
