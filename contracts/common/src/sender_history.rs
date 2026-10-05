//! Append-only sender history shared by payment contracts. Storage is scoped to
//! the invoking contract; entries are independent of payment status.

use soroban_sdk::{contracttype, Address, Env, Vec};

#[contracttype]
enum HistoryKey {
    SenderHistoryCount(Address),
    SenderHistoryItem(Address, u64),
}

pub const MAX_PAGE_SIZE: u32 = 100;
const HISTORY_TTL_LEDGERS: u32 = 518_400;

/// Record one successful creation. Both writes roll back with the surrounding
/// contract invocation. Each append writes two bounded persistent entries rather
/// than loading and rewriting an ever-growing vector or instance storage map.
pub fn append(env: &Env, sender: &Address, record_id: u64) {
    let count_key = HistoryKey::SenderHistoryCount(sender.clone());
    let count: u64 = env.storage().persistent().get(&count_key).unwrap_or(0);
    let next = count.checked_add(1).expect("sender history index exhausted");
    let item_key = HistoryKey::SenderHistoryItem(sender.clone(), count);
    env.storage().persistent().set(&item_key, &record_id);
    env.storage().persistent().extend_ttl(
        &item_key, HISTORY_TTL_LEDGERS / 2, HISTORY_TTL_LEDGERS,
    );
    env.storage().persistent().set(&count_key, &next);
    env.storage().persistent().extend_ttl(
        &count_key, HISTORY_TTL_LEDGERS / 2, HISTORY_TTL_LEDGERS,
    );
}

/// Zero-based pages, newest creation first. The effective limit is capped at
/// MAX_PAGE_SIZE and determines the page offset. Zero limits, unknown senders
/// and pages beyond the end return an empty vector. Reads do not change TTLs.
pub fn page(env: &Env, sender: &Address, page: u32, limit: u32) -> Vec<u64> {
    let mut ids = Vec::new(env);
    let limit = core::cmp::min(limit, MAX_PAGE_SIZE);
    if limit == 0 {
        return ids;
    }
    let count_key = HistoryKey::SenderHistoryCount(sender.clone());
    let count: u64 = env.storage().persistent().get(&count_key).unwrap_or(0);
    // Widen before multiplying. Even the largest u32 page cannot overflow u64.
    let offset = u64::from(page) * u64::from(limit);
    let end = count.saturating_sub(offset);
    let start = end.saturating_sub(u64::from(limit));
    for position in (start..end).rev() {
        let key = HistoryKey::SenderHistoryItem(sender.clone(), position);
        let id: u64 = env.storage().persistent().get(&key)
            .expect("sender history entry missing");
        ids.push_back(id);
    }
    ids
}
