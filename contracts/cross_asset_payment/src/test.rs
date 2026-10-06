#![cfg(test)]

use super::*;
use soroban_sdk::{
    events::Event,
    testutils::{Address as _, Events as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String,
};

// ── Error codes ───────────────────────────────────────────────────────────────
//   AlreadyInitialized = 1
//   NotInitialized     = 2
//   Unauthorized       = 3
//   PaymentNotFound    = 4
//   InvalidAmount      = 5
//   NotPending         = 6
//   InvalidFeeRate     = 7
//   SettlementExpired  = 8
//   RefundNotAvailable = 9
//   InvalidStatus      = 10
//   NotReady           = 11
//   DeadlineOverflow   = 12

struct Setup {
    env: Env,
    sender: Address,
    recipient: Address,
    token: Address,
    admin: Address,
    contract_id: Address,
    client: CrossAssetPaymentContractClient<'static>,
}

fn setup(fee_rate_bps: u32) -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&sender, &100_000);

    let admin = Address::generate(&env);
    let contract_id = env.register(CrossAssetPaymentContract, ());
    let client = CrossAssetPaymentContractClient::new(&env, &contract_id);
    client.init(&admin, &fee_rate_bps);

    Setup {
        env,
        sender,
        recipient,
        token,
        admin,
        contract_id,
        client,
    }
}

fn initiate(s: &Setup, amount: i128) -> u64 {
    s.client.initiate_payment(
        &s.sender,
        &amount,
        &s.token,
        &s.recipient,
        &String::from_str(&s.env, "worker-1"),
        &String::from_str(&s.env, "EUR"),
        &String::from_str(&s.env, "anchor-eu"),
    )
}

fn assert_contract_event<E: Event>(env: &Env, contract_id: &Address, expected: &E) {
    let expected_topics = expected.topics(env);
    let expected_data = expected.data(env);

    assert!(
        env.events().all().iter().any(|(address, topics, data)| {
            address == *contract_id && topics == expected_topics && data == expected_data
        }),
        "expected contract event was not emitted"
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_double_init_panics() {
    let s = setup(0);
    s.client.init(&s.admin, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_init_fee_above_cap_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(CrossAssetPaymentContract, ());
    let client = CrossAssetPaymentContractClient::new(&env, &contract_id);
    client.init(&admin, &1001);
}

#[test]
fn test_initiate_payment_binds_recipient_and_deadline() {
    let s = setup(0);
    let tc = TokenClient::new(&s.env, &s.token);

    let id = initiate(&s, 500);
    assert_eq!(id, 1);
    assert_eq!(tc.balance(&s.contract_id), 500);
    assert_eq!(tc.balance(&s.sender), 99_500);

    let record = s.client.get_payment(&id).unwrap();
    assert_eq!(record.amount, 500);
    assert_eq!(record.net_amount, 500);
    assert_eq!(record.recipient, s.recipient);
    assert_eq!(record.status, symbol_short!("pending"));
    assert_eq!(record.created_at, 1_000_000);
    assert_eq!(
        record.refund_available_at,
        1_000_000 + REFUND_DELAY_SECONDS
    );
}

#[test]
fn test_initiate_payment_with_fee() {
    let s = setup(100);
    let tc = TokenClient::new(&s.env, &s.token);

    let id = initiate(&s, 10_000);
    let record = s.client.get_payment(&id).unwrap();

    assert_eq!(record.amount, 10_000);
    assert_eq!(record.net_amount, 9_900);
    assert_eq!(tc.balance(&s.contract_id), 9_900);
    assert_eq!(tc.balance(&s.admin), 100);
    assert_eq!(tc.balance(&s.sender), 90_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_initiate_zero_amount_panics() {
    let s = setup(0);
    s.client.initiate_payment(
        &s.sender,
        &0,
        &s.token,
        &s.recipient,
        &String::from_str(&s.env, "r"),
        &String::from_str(&s.env, "EUR"),
        &String::from_str(&s.env, "anc"),
    );
}

#[test]
fn test_payment_count_increments() {
    let s = setup(0);
    assert_eq!(s.client.get_payment_count(), 0);
    for i in 1..=3u64 {
        initiate(&s, 100);
        assert_eq!(s.client.get_payment_count(), i);
    }
}

#[test]
fn test_update_status_only_marks_ready() {
    let s = setup(0);
    let id = initiate(&s, 500);

    s.client.update_status(&id, &symbol_short!("ready"));

    let record = s.client.get_payment(&id).unwrap();
    assert_eq!(record.status, symbol_short!("ready"));
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn test_update_status_rejects_terminal_bypass() {
    let s = setup(0);
    let id = initiate(&s, 500);
    s.client.update_status(&id, &symbol_short!("settled"));
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_update_status_not_found_panics() {
    let s = setup(0);
    s.client.update_status(&999, &symbol_short!("ready"));
}

#[test]
fn test_settle_transfers_fee_adjusted_net_once_and_emits_event() {
    let s = setup(200);
    let tc = TokenClient::new(&s.env, &s.token);
    let id = initiate(&s, 10_000);

    s.client.update_status(&id, &symbol_short!("ready"));
    s.client.settle(&id);

    assert_eq!(tc.balance(&s.recipient), 9_800);
    assert_eq!(tc.balance(&s.admin), 200);
    assert_eq!(tc.balance(&s.contract_id), 0);
    assert_eq!(
        s.client.get_payment(&id).unwrap().status,
        symbol_short!("settled")
    );

    assert_contract_event(
        &s.env,
        &s.contract_id,
        &PaymentSettledEvent {
            payment_id: id,
            recipient: s.recipient.clone(),
            settled_amount: 9_800,
            settled_at: 1_000_000,
        },
    );
}

#[test]
fn test_settling_one_payment_preserves_the_other_escrow() {
    let s = setup(0);
    let tc = TokenClient::new(&s.env, &s.token);
    let first = initiate(&s, 500);
    let second = initiate(&s, 700);

    s.client.update_status(&first, &symbol_short!("ready"));
    s.client.update_status(&second, &symbol_short!("ready"));
    s.client.settle(&first);

    assert_eq!(tc.balance(&s.recipient), 500);
    assert_eq!(tc.balance(&s.contract_id), 700);
    assert_eq!(
        s.client.get_payment(&second).unwrap().status,
        symbol_short!("ready")
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn test_settle_requires_ready_state() {
    let s = setup(0);
    let id = initiate(&s, 500);
    s.client.settle(&id);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_settle_rejects_exact_refund_boundary() {
    let s = setup(0);
    let id = initiate(&s, 500);
    s.client.update_status(&id, &symbol_short!("ready"));
    s.env
        .ledger()
        .set_timestamp(1_000_000 + REFUND_DELAY_SECONDS);
    s.client.settle(&id);
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_refund_rejects_one_second_before_deadline() {
    let s = setup(0);
    let id = initiate(&s, 500);
    s.env
        .ledger()
        .set_timestamp(1_000_000 + REFUND_DELAY_SECONDS - 1);
    s.client.refund_expired(&s.sender, &id);
}

#[test]
fn test_refund_succeeds_at_exact_deadline_and_emits_event() {
    let s = setup(100);
    let tc = TokenClient::new(&s.env, &s.token);
    let id = initiate(&s, 10_000);
    let sender_after_initiation = tc.balance(&s.sender);
    let deadline = 1_000_000 + REFUND_DELAY_SECONDS;

    s.client.update_status(&id, &symbol_short!("ready"));
    s.env.ledger().set_timestamp(deadline);
    s.client.refund_expired(&s.sender, &id);

    assert_eq!(tc.balance(&s.sender), sender_after_initiation + 9_900);
    assert_eq!(tc.balance(&s.contract_id), 0);
    assert_eq!(
        s.client.get_payment(&id).unwrap().status,
        symbol_short!("refunded")
    );

    assert_contract_event(
        &s.env,
        &s.contract_id,
        &PaymentRefundedEvent {
            payment_id: id,
            sender: s.sender.clone(),
            refunded_amount: 9_900,
            refunded_at: deadline,
        },
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_refund_rejects_non_sender() {
    let s = setup(0);
    let id = initiate(&s, 500);
    let stranger = Address::generate(&s.env);
    s.env
        .ledger()
        .set_timestamp(1_000_000 + REFUND_DELAY_SECONDS);
    s.client.refund_expired(&stranger, &id);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_refund_cannot_replay_after_settlement() {
    let s = setup(0);
    let id = initiate(&s, 500);
    s.client.update_status(&id, &symbol_short!("ready"));
    s.client.settle(&id);
    s.env
        .ledger()
        .set_timestamp(1_000_000 + REFUND_DELAY_SECONDS);
    s.client.refund_expired(&s.sender, &id);
}

#[test]
fn test_cancel_refunds_net_amount() {
    let s = setup(200);
    let tc = TokenClient::new(&s.env, &s.token);
    let id = initiate(&s, 10_000);
    let before = tc.balance(&s.sender);

    s.client.cancel_payment(&s.sender, &id);

    assert_eq!(tc.balance(&s.sender), before + 9_800);
    assert_eq!(tc.balance(&s.contract_id), 0);
    assert_eq!(
        s.client.get_payment(&id).unwrap().status,
        symbol_short!("cancelled")
    );
}

#[test]
fn test_admin_can_cancel_pending_payment() {
    let s = setup(0);
    let id = initiate(&s, 500);
    s.client.cancel_payment(&s.admin, &id);
    assert_eq!(
        s.client.get_payment(&id).unwrap().status,
        symbol_short!("cancelled")
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_cancel_ready_payment_panics() {
    let s = setup(0);
    let id = initiate(&s, 500);
    s.client.update_status(&id, &symbol_short!("ready"));
    s.client.cancel_payment(&s.sender, &id);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_cancel_not_found_panics() {
    let s = setup(0);
    s.client.cancel_payment(&s.sender, &999);
}
