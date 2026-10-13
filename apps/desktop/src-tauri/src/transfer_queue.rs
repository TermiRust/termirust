use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use termirust_core::CoreError;
use termirust_core::sftp::{CancelFlag, TreeProgress};
use tokio::sync::Semaphore;

/// Enough parallelism to hide latency without starving the shell sharing the connection.
pub const MAX_PARALLEL_TRANSFERS: usize = 2;
/// About ten updates a second keeps the queue panel smooth without flooding IPC.
pub const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// What the queue panel shows for one transfer. Byte counts are typed as numbers for
/// TypeScript; JSON numbers are exact up to 2^53 bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum TransferEvent {
    Queued,
    #[serde(rename_all = "camelCase")]
    Running {
        #[specta(type = u32)]
        done: u64,
        #[specta(type = u32)]
        total: u64,
        files_done: u32,
        files_total: u32,
        current: String,
    },
    #[serde(rename_all = "camelCase")]
    Completed {
        #[specta(type = u32)]
        bytes: u64,
    },
    Failed {
        message: String,
    },
    Cancelled,
}

impl From<&TreeProgress> for TransferEvent {
    fn from(p: &TreeProgress) -> Self {
        TransferEvent::Running {
            done: p.done,
            total: p.total,
            files_done: p.files_done,
            files_total: p.files_total,
            current: p.current.clone(),
        }
    }
}

/// Lets through at most one progress update per interval.
#[derive(Debug)]
pub struct ProgressThrottle {
    interval: Duration,
    last: Option<Instant>,
}

impl ProgressThrottle {
    pub fn new(interval: Duration) -> Self {
        Self {
            interval,
            last: None,
        }
    }

    pub fn ready(&mut self, now: Instant) -> bool {
        match self.last {
            Some(last) if now.duration_since(last) < self.interval => false,
            _ => {
                self.last = Some(now);
                true
            }
        }
    }
}

pub type ProgressSink = Box<dyn FnMut(&TreeProgress) + Send>;

/// Runs transfers a few at a time, in the order they were queued, and lets any of them be
/// cancelled — queued ones never start.
pub struct TransferQueue {
    slots: Arc<Semaphore>,
    next_id: AtomicU32,
    active: Arc<Mutex<HashMap<u32, CancelFlag>>>,
}

impl Default for TransferQueue {
    fn default() -> Self {
        Self::new(MAX_PARALLEL_TRANSFERS)
    }
}

impl TransferQueue {
    pub fn new(max_parallel: usize) -> Self {
        Self {
            slots: Arc::new(Semaphore::new(max_parallel)),
            next_id: AtomicU32::new(1),
            active: Arc::default(),
        }
    }

    pub fn enqueue<J, F>(
        &self,
        job: J,
        on_event: impl Fn(TransferEvent) + Send + Sync + 'static,
    ) -> u32
    where
        J: FnOnce(CancelFlag, ProgressSink) -> F + Send + 'static,
        F: Future<Output = termirust_core::Result<u64>> + Send + 'static,
    {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let cancel = CancelFlag::default();
        if let Ok(mut active) = self.active.lock() {
            active.insert(id, cancel.clone());
        }
        let slots = self.slots.clone();
        let active = self.active.clone();
        let on_event = Arc::new(on_event);
        on_event(TransferEvent::Queued);
        tokio::spawn(async move {
            let outcome = match slots.acquire_owned().await {
                Ok(_permit) if !cancel.is_cancelled() => {
                    let sink = progress_sink(on_event.clone(), cancel.clone());
                    job(cancel.clone(), sink).await
                }
                Ok(_) => Err(CoreError::Cancelled),
                Err(_) => Err(CoreError::Sftp("transfer queue closed".into())),
            };
            if let Ok(mut active) = active.lock() {
                active.remove(&id);
            }
            on_event(match outcome {
                Ok(bytes) => TransferEvent::Completed { bytes },
                Err(CoreError::Cancelled) => TransferEvent::Cancelled,
                Err(e) => {
                    tracing::warn!(transfer_id = id, error = %e, "transfer failed");
                    TransferEvent::Failed {
                        message: e.to_string(),
                    }
                }
            });
        });
        id
    }

    /// Returns false when the transfer already finished or never existed.
    pub fn cancel(&self, id: u32) -> bool {
        let flag = self.active.lock().ok().and_then(|a| a.get(&id).cloned());
        flag.map(|f| f.cancel()).is_some()
    }
}

fn progress_sink(
    on_event: Arc<impl Fn(TransferEvent) + Send + Sync + 'static>,
    cancel: CancelFlag,
) -> ProgressSink {
    let mut throttle = ProgressThrottle::new(PROGRESS_INTERVAL);
    Box::new(move |p: &TreeProgress| {
        if !cancel.is_cancelled() && throttle.ready(Instant::now()) {
            on_event(p.into());
        }
    })
}

#[cfg(test)]
mod tests {
    use tokio::sync::{mpsc, oneshot};

    use super::*;

    fn progress(done: u64) -> TreeProgress {
        TreeProgress {
            done,
            total: 10,
            files_done: 0,
            files_total: 1,
            current: "/a".into(),
        }
    }

    fn recorder() -> (
        impl Fn(TransferEvent) + Send + Sync + 'static,
        mpsc::UnboundedReceiver<TransferEvent>,
    ) {
        let (tx, rx) = mpsc::unbounded_channel();
        (move |e| drop(tx.send(e)), rx)
    }

    async fn until_finished(rx: &mut mpsc::UnboundedReceiver<TransferEvent>) -> Vec<TransferEvent> {
        let mut seen = Vec::new();
        while let Some(event) = rx.recv().await {
            let done = matches!(
                event,
                TransferEvent::Completed { .. }
                    | TransferEvent::Failed { .. }
                    | TransferEvent::Cancelled
            );
            seen.push(event);
            if done {
                break;
            }
        }
        seen
    }

    #[test]
    fn throttle_lets_one_update_through_per_interval() {
        let mut throttle = ProgressThrottle::new(Duration::from_millis(100));
        let start = Instant::now();
        assert!(throttle.ready(start));
        assert!(!throttle.ready(start + Duration::from_millis(50)));
        assert!(throttle.ready(start + Duration::from_millis(100)));
        assert!(!throttle.ready(start + Duration::from_millis(199)));
    }

    #[test]
    fn byte_counts_serialise_as_plain_json_numbers() {
        let json = serde_json::to_value(TransferEvent::from(&progress(4))).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"state": "running", "done": 4, "total": 10, "filesDone": 0, "filesTotal": 1, "current": "/a"})
        );
    }

    #[tokio::test]
    async fn reports_queued_progress_and_completion() {
        let queue = TransferQueue::new(1);
        let (on_event, mut rx) = recorder();
        queue.enqueue(
            |_, mut sink| async move {
                sink(&progress(4));
                sink(&progress(8)); // throttled away
                Ok(10)
            },
            on_event,
        );
        assert_eq!(
            until_finished(&mut rx).await,
            vec![
                TransferEvent::Queued,
                TransferEvent::from(&progress(4)),
                TransferEvent::Completed { bytes: 10 }
            ]
        );
    }

    #[tokio::test]
    async fn failures_carry_the_reason() {
        let queue = TransferQueue::default();
        let (on_event, mut rx) = recorder();
        queue.enqueue(
            |_, _| async { Err(CoreError::Sftp("permission denied".into())) },
            on_event,
        );
        let events = until_finished(&mut rx).await;
        assert!(
            matches!(events.last(), Some(TransferEvent::Failed { message }) if message.contains("permission denied"))
        );
    }

    #[tokio::test]
    async fn runs_no_more_than_the_limit_at_once_and_never_starts_a_cancelled_one() {
        let queue = TransferQueue::new(1);
        let (release, wait) = oneshot::channel::<()>();
        let (first_events, mut first_rx) = recorder();
        let first = queue.enqueue(
            |cancel, _| async move {
                let _ = wait.await;
                if cancel.is_cancelled() {
                    Err(CoreError::Cancelled)
                } else {
                    Ok(1)
                }
            },
            first_events,
        );

        let started = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (second_events, mut second_rx) = recorder();
        let second = queue.enqueue(
            {
                let started = started.clone();
                |_, _| async move {
                    started.store(true, Ordering::SeqCst);
                    Ok(2)
                }
            },
            second_events,
        );
        assert_ne!(first, second);

        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(queue.cancel(second), "a queued transfer can be cancelled");
        release.send(()).unwrap();

        assert_eq!(
            until_finished(&mut first_rx).await.last(),
            Some(&TransferEvent::Completed { bytes: 1 })
        );
        assert_eq!(
            until_finished(&mut second_rx).await.last(),
            Some(&TransferEvent::Cancelled)
        );
        assert!(!started.load(Ordering::SeqCst));
        assert!(!queue.cancel(first), "finished transfers are forgotten");
    }

    #[tokio::test]
    async fn cancelling_a_running_transfer_reports_cancelled() {
        let queue = TransferQueue::default();
        let (on_event, mut rx) = recorder();
        let (started_tx, started_rx) = oneshot::channel();
        let id = queue.enqueue(
            |cancel, _| async move {
                let _ = started_tx.send(());
                while !cancel.is_cancelled() {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
                Err(CoreError::Cancelled)
            },
            on_event,
        );
        started_rx.await.unwrap();
        assert!(queue.cancel(id));
        assert_eq!(
            until_finished(&mut rx).await.last(),
            Some(&TransferEvent::Cancelled)
        );
    }
}
