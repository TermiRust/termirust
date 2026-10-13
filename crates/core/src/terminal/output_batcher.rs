use std::time::Duration;

use tokio::sync::mpsc;
use tokio::time::Instant;

/// Limits that decide when buffered terminal output is handed to the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BatchPolicy {
    pub max_bytes: usize,
    pub max_delay: Duration,
}

impl Default for BatchPolicy {
    fn default() -> Self {
        Self {
            max_bytes: 64 * 1024,
            max_delay: Duration::from_millis(16),
        }
    }
}

/// Coalesces many small output chunks so the webview receives roughly one message per frame.
#[derive(Debug)]
pub struct OutputBatcher {
    policy: BatchPolicy,
    buffer: Vec<u8>,
    first_byte_at: Option<Instant>,
}

impl OutputBatcher {
    pub fn new(policy: BatchPolicy) -> Self {
        Self {
            policy,
            buffer: Vec::with_capacity(policy.max_bytes),
            first_byte_at: None,
        }
    }

    /// Buffers `data`; returns a batch once the size limit is reached.
    pub fn push(&mut self, data: &[u8], now: Instant) -> Option<Vec<u8>> {
        if data.is_empty() {
            return None;
        }
        if self.buffer.is_empty() {
            self.first_byte_at = Some(now);
        }
        self.buffer.extend_from_slice(data);
        (self.buffer.len() >= self.policy.max_bytes).then(|| self.take())
    }

    /// Returns a batch if the oldest buffered byte has waited at least `max_delay`.
    pub fn poll(&mut self, now: Instant) -> Option<Vec<u8>> {
        let deadline = self.deadline()?;
        (now >= deadline).then(|| self.take())
    }

    pub fn flush(&mut self) -> Option<Vec<u8>> {
        (!self.buffer.is_empty()).then(|| self.take())
    }

    pub fn deadline(&self) -> Option<Instant> {
        self.first_byte_at.map(|t| t + self.policy.max_delay)
    }

    fn take(&mut self) -> Vec<u8> {
        self.first_byte_at = None;
        std::mem::replace(&mut self.buffer, Vec::with_capacity(self.policy.max_bytes))
    }
}

/// Drains `input` into `emit` in batches; stops when `input` closes or `emit` returns false.
pub async fn forward_in_batches(
    mut input: mpsc::Receiver<Vec<u8>>,
    policy: BatchPolicy,
    mut emit: impl FnMut(Vec<u8>) -> bool,
) {
    let mut batcher = OutputBatcher::new(policy);
    loop {
        let next = match batcher.deadline() {
            Some(deadline) => tokio::select! {
                chunk = input.recv() => chunk,
                _ = tokio::time::sleep_until(deadline) => {
                    if let Some(batch) = batcher.poll(Instant::now()) && !emit(batch) {
                        return;
                    }
                    continue;
                }
            },
            None => input.recv().await,
        };

        match next {
            Some(chunk) => {
                if let Some(batch) = batcher.push(&chunk, Instant::now())
                    && !emit(batch)
                {
                    return;
                }
            }
            None => {
                if let Some(batch) = batcher.flush() {
                    emit(batch);
                }
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(max_bytes: usize, delay_ms: u64) -> BatchPolicy {
        BatchPolicy {
            max_bytes,
            max_delay: Duration::from_millis(delay_ms),
        }
    }

    #[test]
    fn default_policy_is_one_frame_or_64_kib() {
        let p = BatchPolicy::default();
        assert_eq!(p.max_bytes, 65_536);
        assert_eq!(p.max_delay, Duration::from_millis(16));
    }

    #[test]
    fn push_holds_data_below_the_size_limit() {
        let mut b = OutputBatcher::new(policy(10, 16));
        assert_eq!(b.push(b"abc", Instant::now()), None);
        assert!(b.deadline().is_some());
    }

    #[test]
    fn push_returns_everything_once_the_size_limit_is_reached() {
        let mut b = OutputBatcher::new(policy(4, 16));
        let now = Instant::now();
        assert_eq!(b.push(b"ab", now), None);
        assert_eq!(b.push(b"cdef", now), Some(b"abcdef".to_vec()));
        assert_eq!(b.deadline(), None);
        assert_eq!(b.flush(), None);
    }

    #[test]
    fn push_ignores_empty_chunks() {
        let mut b = OutputBatcher::new(policy(4, 16));
        assert_eq!(b.push(b"", Instant::now()), None);
        assert_eq!(b.deadline(), None);
    }

    #[test]
    fn poll_waits_for_the_delay_measured_from_the_first_buffered_byte() {
        let mut b = OutputBatcher::new(policy(100, 16));
        let start = Instant::now();
        b.push(b"a", start);
        b.push(b"b", start + Duration::from_millis(10));
        assert_eq!(b.poll(start + Duration::from_millis(15)), None);
        assert_eq!(
            b.poll(start + Duration::from_millis(16)),
            Some(b"ab".to_vec())
        );
    }

    #[test]
    fn poll_on_an_empty_batcher_returns_nothing() {
        let mut b = OutputBatcher::new(policy(100, 16));
        assert_eq!(b.poll(Instant::now() + Duration::from_secs(1)), None);
    }

    #[test]
    fn flush_returns_partial_data_and_resets() {
        let mut b = OutputBatcher::new(policy(100, 16));
        b.push(b"xyz", Instant::now());
        assert_eq!(b.flush(), Some(b"xyz".to_vec()));
        assert_eq!(b.flush(), None);
    }

    #[tokio::test(start_paused = true)]
    async fn forwards_small_chunks_as_one_batch_after_the_delay() {
        let (tx, rx) = mpsc::channel(16);
        let (out_tx, mut out_rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(forward_in_batches(rx, policy(1024, 16), move |b| {
            out_tx.send(b).is_ok()
        }));

        tx.send(b"he".to_vec()).await.unwrap();
        tx.send(b"llo".to_vec()).await.unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(out_rx.recv().await, Some(b"hello".to_vec()));

        drop(tx);
        task.await.unwrap();
        assert_eq!(out_rx.recv().await, None);
    }

    #[tokio::test(start_paused = true)]
    async fn forwards_immediately_when_the_size_limit_is_hit() {
        let (tx, rx) = mpsc::channel(16);
        let (out_tx, mut out_rx) = mpsc::unbounded_channel();
        tokio::spawn(forward_in_batches(rx, policy(4, 1000), move |b| {
            out_tx.send(b).is_ok()
        }));

        tx.send(b"abcd".to_vec()).await.unwrap();
        assert_eq!(out_rx.recv().await, Some(b"abcd".to_vec()));
    }

    #[tokio::test(start_paused = true)]
    async fn flushes_the_remainder_when_input_closes() {
        let (tx, rx) = mpsc::channel(16);
        let mut out = Vec::new();
        tx.send(b"tail".to_vec()).await.unwrap();
        drop(tx);
        forward_in_batches(rx, policy(1024, 1000), |b| {
            out.push(b);
            true
        })
        .await;
        assert_eq!(out, vec![b"tail".to_vec()]);
    }

    #[tokio::test(start_paused = true)]
    async fn stops_when_the_receiver_side_goes_away() {
        let (tx, rx) = mpsc::channel(16);
        let mut calls = 0;
        tx.send(b"abcd".to_vec()).await.unwrap();
        tx.send(b"efgh".to_vec()).await.unwrap();
        forward_in_batches(rx, policy(4, 1000), |_| {
            calls += 1;
            false
        })
        .await;
        assert_eq!(calls, 1);
    }

    #[tokio::test(start_paused = true)]
    async fn stops_when_the_receiver_goes_away_on_a_timed_flush() {
        let (tx, rx) = mpsc::channel(16);
        let mut calls = 0;
        tx.send(b"a".to_vec()).await.unwrap();
        let _keep_open = tx;
        forward_in_batches(rx, policy(1024, 16), |_| {
            calls += 1;
            false
        })
        .await;
        assert_eq!(calls, 1);
    }
}
