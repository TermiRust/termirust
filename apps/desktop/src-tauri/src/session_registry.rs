use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use tokio::sync::RwLock;

/// Live sessions keyed by the id handed to the frontend.
pub struct SessionRegistry<S> {
    next_id: AtomicU32,
    sessions: RwLock<HashMap<u32, Arc<S>>>,
}

impl<S> Default for SessionRegistry<S> {
    fn default() -> Self {
        Self {
            next_id: AtomicU32::new(1),
            sessions: RwLock::default(),
        }
    }
}

impl<S> SessionRegistry<S> {
    pub async fn insert(&self, session: S) -> u32 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.sessions.write().await.insert(id, Arc::new(session));
        id
    }

    pub async fn get(&self, id: u32) -> Option<Arc<S>> {
        self.sessions.read().await.get(&id).cloned()
    }

    pub async fn remove(&self, id: u32) -> Option<Arc<S>> {
        self.sessions.write().await.remove(&id)
    }

    #[cfg(test)]
    pub async fn len(&self) -> usize {
        self.sessions.read().await.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn hands_out_unique_increasing_ids() {
        let registry = SessionRegistry::default();
        let a = registry.insert("a").await;
        let b = registry.insert("b").await;
        assert_eq!((a, b), (1, 2));
        assert_eq!(*registry.get(a).await.unwrap(), "a");
        assert_eq!(*registry.get(b).await.unwrap(), "b");
    }

    #[tokio::test]
    async fn unknown_ids_return_none() {
        let registry: SessionRegistry<&str> = SessionRegistry::default();
        assert!(registry.get(42).await.is_none());
        assert!(registry.remove(42).await.is_none());
    }

    #[tokio::test]
    async fn removed_sessions_are_gone_and_ids_are_not_reused() {
        let registry = SessionRegistry::default();
        let a = registry.insert("a").await;
        assert_eq!(*registry.remove(a).await.unwrap(), "a");
        assert!(registry.get(a).await.is_none());
        assert_eq!(registry.len().await, 0);
        assert_eq!(registry.insert("b").await, 2);
    }
}
