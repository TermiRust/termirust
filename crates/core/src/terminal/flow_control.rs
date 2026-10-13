use std::sync::Mutex;

use tokio::sync::Notify;

/// Backpressure between the Rust producer and the terminal renderer.
///
/// xterm.js drops data once ~50 MB is queued, so the producer must pause until the
/// frontend acknowledges what it has rendered.
#[derive(Debug)]
pub struct OutputFlowControl {
    in_flight: Mutex<usize>,
    capacity_freed: Notify,
    high_watermark: usize,
}

impl OutputFlowControl {
    pub fn new(high_watermark: usize) -> Self {
        Self {
            in_flight: Mutex::new(0),
            capacity_freed: Notify::new(),
            high_watermark: high_watermark.max(1),
        }
    }

    pub fn in_flight(&self) -> usize {
        *self.lock()
    }

    pub fn record_sent(&self, bytes: usize) {
        *self.lock() += bytes;
    }

    pub fn acknowledge(&self, bytes: usize) {
        let mut in_flight = self.lock();
        *in_flight = in_flight.saturating_sub(bytes);
        drop(in_flight);
        self.capacity_freed.notify_waiters();
    }

    /// Resolves once fewer than `high_watermark` bytes are unacknowledged.
    pub async fn wait_for_capacity(&self) {
        loop {
            let freed = self.capacity_freed.notified();
            if *self.lock() < self.high_watermark {
                return;
            }
            freed.await;
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, usize> {
        self.in_flight
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Default for OutputFlowControl {
    fn default() -> Self {
        Self::new(2 * 1024 * 1024)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use super::*;

    #[test]
    fn tracks_sent_and_acknowledged_bytes() {
        let flow = OutputFlowControl::new(100);
        flow.record_sent(60);
        flow.record_sent(30);
        flow.acknowledge(50);
        assert_eq!(flow.in_flight(), 40);
    }

    #[test]
    fn over_acknowledging_never_underflows() {
        let flow = OutputFlowControl::new(100);
        flow.record_sent(10);
        flow.acknowledge(25);
        assert_eq!(flow.in_flight(), 0);
    }

    #[test]
    fn default_allows_two_mebibytes_in_flight() {
        let flow = OutputFlowControl::default();
        flow.record_sent(2 * 1024 * 1024 - 1);
        assert!(flow.in_flight() < flow.high_watermark);
    }

    #[tokio::test]
    async fn does_not_wait_below_the_watermark() {
        let flow = OutputFlowControl::new(100);
        flow.record_sent(99);
        tokio::time::timeout(Duration::from_millis(50), flow.wait_for_capacity())
            .await
            .expect("capacity is available");
    }

    #[tokio::test]
    async fn waits_at_the_watermark_until_the_renderer_acknowledges() {
        let flow = Arc::new(OutputFlowControl::new(100));
        flow.record_sent(100);

        let waiter = tokio::spawn({
            let flow = flow.clone();
            async move { flow.wait_for_capacity().await }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(
            !waiter.is_finished(),
            "producer must pause at the watermark"
        );

        flow.acknowledge(1);
        tokio::time::timeout(Duration::from_millis(200), waiter)
            .await
            .expect("acknowledgement wakes the producer")
            .unwrap();
    }

    #[tokio::test]
    async fn a_partial_acknowledgement_that_stays_above_the_watermark_keeps_waiting() {
        let flow = Arc::new(OutputFlowControl::new(100));
        flow.record_sent(150);
        let waiter = tokio::spawn({
            let flow = flow.clone();
            async move { flow.wait_for_capacity().await }
        });

        flow.acknowledge(10);
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!waiter.is_finished());

        flow.acknowledge(41);
        tokio::time::timeout(Duration::from_millis(200), waiter)
            .await
            .unwrap()
            .unwrap();
    }

    #[test]
    fn a_zero_watermark_is_raised_to_one_byte() {
        let flow = OutputFlowControl::new(0);
        assert_eq!(flow.high_watermark, 1);
    }
}
