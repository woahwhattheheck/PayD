#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, symbol_short, token,
    Address, Env, String, Symbol,
};
use common::CommonError;

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized  = 1,
    NotInitialized      = 2,
    Unauthorized        = 3,
    PaymentNotFound     = 4,
    InvalidAmount       = 5,
    NotPending          = 6,
    InvalidFeeRate      = 7,
    SettlementExpired   = 8,
    RefundNotAvailable  = 9,
    InvalidStatus       = 10,
    NotReady            = 11,
    DeadlineOverflow    = 12,
    SettlementUnavailable = 13,
}

impl From<CommonError> for ContractError {
    fn from(e: CommonError) -> Self {
        match e {
            CommonError::AlreadyInitialized => ContractError::AlreadyInitialized,
            CommonError::NotInitialized => ContractError::NotInitialized,
            CommonError::Unauthorized => ContractError::Unauthorized,
        }
    }
}

// ── Events ────────────────────────────────────────────────────────────────────

#[contractevent]
pub struct PaymentInitiatedEvent {
    pub payment_id: u64,
    pub from: Address,
    pub amount: i128,
    pub target_asset: String,
    pub anchor_id: String,
}

#[contractevent]
pub struct PaymentStatusUpdatedEvent {
    pub payment_id: u64,
    pub new_status: Symbol,
}

#[contractevent]
pub struct PaymentCancelledEvent {
    pub payment_id: u64,
    pub refunded_amount: i128,
}

#[contractevent]
pub struct PaymentSettledEvent {
    pub payment_id: u64,
    pub recipient: Address,
    pub settled_amount: i128,
    pub settled_at: u64,
}

#[contractevent]
pub struct PaymentRefundedEvent {
    pub payment_id: u64,
    pub sender: Address,
    pub refunded_amount: i128,
    pub refunded_at: u64,
}

// ── Storage types ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct PaymentRecord {
    pub from: Address,
    pub amount: i128,
    pub net_amount: i128,
    pub asset: Address,
    pub receiver_id: String,
    pub target_asset: String,
    pub anchor_id: String,
    pub status: Symbol,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct SettlementTerms {
    pub recipient: Address,
    pub created_at: u64,
    pub refund_available_at: u64,
}

#[contracttype]
pub enum DataKey {
    Admin,
    PaymentCount,
    FeeRateBps,
    Payment(u64),
    Terms(u64),
}

// ~30 days at 5 s/ledger
const PAYMENT_TTL_LEDGERS: u32 = 518_400;
// Maximum protocol fee: 10%
const MAX_FEE_BPS: u32 = 1_000;
// Sender may recover an unsettled escrow exactly seven days after initiation.
pub const REFUND_DELAY_SECONDS: u64 = 7 * 24 * 60 * 60;

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct CrossAssetPaymentContract;

#[contractimpl]
impl CrossAssetPaymentContract {
    pub fn init(env: Env, admin: Address, fee_rate_bps: u32) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        if fee_rate_bps > MAX_FEE_BPS {
            return Err(ContractError::InvalidFeeRate);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::PaymentCount, &0u64);
        env.storage().instance().set(&DataKey::FeeRateBps, &fee_rate_bps);
        Ok(())
    }

    pub fn set_fee_rate(env: Env, fee_rate_bps: u32) -> Result<(), ContractError> {
        if fee_rate_bps > MAX_FEE_BPS {
            return Err(ContractError::InvalidFeeRate);
        }
        common::require_admin(&env, &DataKey::Admin).map_err(ContractError::from)?;
        env.storage().instance().set(&DataKey::FeeRateBps, &fee_rate_bps);
        Ok(())
    }

    /// Initiate a cross-asset payment. The on-chain settlement recipient is
    /// bound here so a later settlement cannot redirect the escrow. The fee is
    /// routed to the admin immediately; only `net_amount` remains in custody.
    pub fn initiate_payment(
        env: Env,
        from: Address,
        amount: i128,
        asset: Address,
        recipient: Address,
        receiver_id: String,
        target_asset: String,
        anchor_id: String,
    ) -> Result<u64, ContractError> {
        from.require_auth();

        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;

        let fee_rate_bps: u32 = env.storage().instance()
            .get(&DataKey::FeeRateBps)
            .unwrap_or(0);

        let fee = amount
            .checked_mul(fee_rate_bps as i128)
            .ok_or(ContractError::InvalidAmount)?
            / 10_000;
        let net_amount = amount
            .checked_sub(fee)
            .ok_or(ContractError::InvalidAmount)?;

        let created_at = env.ledger().timestamp();
        let refund_available_at = created_at
            .checked_add(REFUND_DELAY_SECONDS)
            .ok_or(ContractError::DeadlineOverflow)?;

        let token_client = token::Client::new(&env, &asset);

        token_client.transfer(&from, &env.current_contract_address(), &amount);
        if fee > 0 {
            token_client.transfer(&env.current_contract_address(), &admin, &fee);
        }

        let count: u64 = env.storage().instance()
            .get(&DataKey::PaymentCount)
            .unwrap_or(0)
            .checked_add(1)
            .ok_or(ContractError::InvalidAmount)?;
        env.storage().instance().set(&DataKey::PaymentCount, &count);

        let record = PaymentRecord {
            from: from.clone(),
            amount,
            net_amount,
            asset,
            receiver_id,
            target_asset: target_asset.clone(),
            anchor_id: anchor_id.clone(),
            status: symbol_short!("pending"),
        };
        let terms = SettlementTerms {
            recipient,
            created_at,
            refund_available_at,
        };

        persist_payment(&env, count, &record);
        persist_terms(&env, count, &terms);

        PaymentInitiatedEvent {
            payment_id: count,
            from,
            amount,
            target_asset,
            anchor_id,
        };

        Ok(count)
    }

    /// Mark a pending payment ready for settlement. Terminal status changes are
    /// intentionally impossible through this generic status surface.
    pub fn update_status(
        env: Env,
        payment_id: u64,
        new_status: Symbol,
    ) -> Result<(), ContractError> {
        common::require_admin(&env, &DataKey::Admin).map_err(ContractError::from)?;

        let mut record = load_payment(&env, payment_id)?;
        // A legacy record has no sidecar terms. Keep it pending so the
        // existing sender/admin cancellation path remains available.
        load_terms(&env, payment_id)?;
        if record.status != symbol_short!("pending") {
            return Err(ContractError::NotPending);
        }
        if new_status != symbol_short!("ready") {
            return Err(ContractError::InvalidStatus);
        }

        record.status = new_status.clone();
        persist_payment(&env, payment_id, &record);

        PaymentStatusUpdatedEvent { payment_id, new_status };

        Ok(())
    }

    /// Settle a ready payment before its refund deadline. The admin invocation
    /// represents anchor confirmation; the recipient was fixed at initiation.
    pub fn settle(env: Env, payment_id: u64) -> Result<(), ContractError> {
        common::require_admin(&env, &DataKey::Admin).map_err(ContractError::from)?;

        let now = env.ledger().timestamp();
        let mut record = load_payment(&env, payment_id)?;

        if record.status != symbol_short!("ready") {
            return Err(ContractError::NotReady);
        }
        let terms = load_terms(&env, payment_id)?;
        if now >= terms.refund_available_at {
            return Err(ContractError::SettlementExpired);
        }

        let amount = record.net_amount;
        let recipient = terms.recipient.clone();

        // Commit the terminal state before the outward token call. Soroban
        // transaction rollback restores it if the token transfer fails.
        record.status = symbol_short!("settled");
        persist_payment(&env, payment_id, &record);

        if amount > 0 {
            token::Client::new(&env, &record.asset).transfer(
                &env.current_contract_address(),
                &recipient,
                &amount,
            );
        }

        PaymentSettledEvent {
            payment_id,
            recipient,
            settled_amount: amount,
            settled_at: now,
        }
        .publish(&env);

        Ok(())
    }

    /// Refund an unsettled payment to its original sender at or after the exact
    /// seven-day boundary. Pending and ready payments are both recoverable.
    pub fn refund_expired(
        env: Env,
        caller: Address,
        payment_id: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();

        let now = env.ledger().timestamp();
        let mut record = load_payment(&env, payment_id)?;

        if caller != record.from {
            return Err(ContractError::Unauthorized);
        }
        if record.status != symbol_short!("pending") && record.status != symbol_short!("ready") {
            return Err(ContractError::NotPending);
        }
        let terms = load_terms(&env, payment_id)?;
        if now < terms.refund_available_at {
            return Err(ContractError::RefundNotAvailable);
        }

        let amount = record.net_amount;
        let sender = record.from.clone();

        record.status = symbol_short!("refunded");
        persist_payment(&env, payment_id, &record);

        if amount > 0 {
            token::Client::new(&env, &record.asset).transfer(
                &env.current_contract_address(),
                &sender,
                &amount,
            );
        }

        PaymentRefundedEvent {
            payment_id,
            sender,
            refunded_amount: amount,
            refunded_at: now,
        }
        .publish(&env);

        Ok(())
    }

    /// Cancel a payment before it is marked ready. Only the original sender or
    /// admin may cancel. Fees already routed to the admin are non-refundable.
    pub fn cancel_payment(
        env: Env,
        caller: Address,
        payment_id: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();

        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;

        let mut record = load_payment(&env, payment_id)?;

        if record.status != symbol_short!("pending") {
            return Err(ContractError::NotPending);
        }

        if caller != record.from && caller != admin {
            return Err(ContractError::Unauthorized);
        }

        let refund = record.net_amount;
        record.status = symbol_short!("cancelled");
        persist_payment(&env, payment_id, &record);

        if refund > 0 {
            let token_client = token::Client::new(&env, &record.asset);
            token_client.transfer(&env.current_contract_address(), &record.from, &refund);
        }

        PaymentCancelledEvent { payment_id, refunded_amount: refund };

        Ok(())
    }

    pub fn get_payment(env: Env, payment_id: u64) -> Option<PaymentRecord> {
        env.storage().persistent().get(&DataKey::Payment(payment_id))
    }

    pub fn get_settlement_terms(env: Env, payment_id: u64) -> Option<SettlementTerms> {
        env.storage().persistent().get(&DataKey::Terms(payment_id))
    }

    pub fn get_payment_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::PaymentCount).unwrap_or(0)
    }
}

fn load_payment(env: &Env, payment_id: u64) -> Result<PaymentRecord, ContractError> {
    env.storage().persistent()
        .get(&DataKey::Payment(payment_id))
        .ok_or(ContractError::PaymentNotFound)
}

fn persist_payment(env: &Env, payment_id: u64, record: &PaymentRecord) {
    let key = DataKey::Payment(payment_id);
    env.storage().persistent().set(&key, record);
    env.storage().persistent().extend_ttl(
        &key,
        PAYMENT_TTL_LEDGERS,
        PAYMENT_TTL_LEDGERS,
    );
}

fn load_terms(env: &Env, payment_id: u64) -> Result<SettlementTerms, ContractError> {
    env.storage().persistent()
        .get(&DataKey::Terms(payment_id))
        .ok_or(ContractError::SettlementUnavailable)
}

fn persist_terms(env: &Env, payment_id: u64, terms: &SettlementTerms) {
    let key = DataKey::Terms(payment_id);
    env.storage().persistent().set(&key, terms);
    env.storage().persistent().extend_ttl(
        &key,
        PAYMENT_TTL_LEDGERS,
        PAYMENT_TTL_LEDGERS,
    );
}

mod test;
