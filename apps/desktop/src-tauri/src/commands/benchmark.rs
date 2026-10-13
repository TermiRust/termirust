use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;
use termirust_core::terminal::{
    BatchPolicy, OutputFlowControl, forward_in_batches, sample_output_chunks,
};
use tokio::sync::mpsc;

use crate::raw_chunk::RawChunk;

const CHUNK_SIZE: usize = 4096;
const MAX_TOTAL_BYTES: u32 = 512 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OutputBenchmark {
    pub total_bytes: u32,
    pub messages: u32,
    pub rust_elapsed_ms: f64,
}

/// Flow control of the benchmark currently streaming, if any.
#[derive(Default)]
pub struct ActiveBenchmark(Mutex<Option<Arc<OutputFlowControl>>>);

impl ActiveBenchmark {
    fn start(&self) -> Arc<OutputFlowControl> {
        let flow = Arc::new(OutputFlowControl::default());
        *self.0.lock().unwrap_or_else(|p| p.into_inner()) = Some(flow.clone());
        flow
    }

    fn acknowledge(&self, bytes: usize) {
        if let Some(flow) = self.0.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
            flow.acknowledge(bytes);
        }
    }
}

/// Streams synthetic terminal output through the same batching and backpressure path
/// real sessions use.
async fn stream_sample_output(
    total_bytes: u32,
    flow: Arc<OutputFlowControl>,
    mut emit: impl FnMut(Vec<u8>) -> bool + Send + 'static,
) -> OutputBenchmark {
    let total_bytes = total_bytes.min(MAX_TOTAL_BYTES);
    let started = Instant::now();
    let (tx, rx) = mpsc::channel(64);
    let messages = Arc::new(AtomicU32::new(0));

    let counter = messages.clone();
    let sent = flow.clone();
    let forwarder = tokio::spawn(forward_in_batches(
        rx,
        BatchPolicy::default(),
        move |batch| {
            counter.fetch_add(1, Ordering::Relaxed);
            sent.record_sent(batch.len());
            emit(batch)
        },
    ));
    for chunk in sample_output_chunks(total_bytes as usize, CHUNK_SIZE) {
        flow.wait_for_capacity().await;
        if tx.send(chunk).await.is_err() {
            break;
        }
    }
    drop(tx);
    let _ = forwarder.await;

    OutputBenchmark {
        total_bytes,
        messages: messages.load(Ordering::Relaxed),
        rust_elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
    }
}

#[tauri::command]
#[specta::specta]
pub async fn benchmark_output_raw(
    active: State<'_, ActiveBenchmark>,
    total_bytes: u32,
    on_output: Channel<RawChunk>,
) -> Result<OutputBenchmark, ()> {
    let flow = active.start();
    Ok(stream_sample_output(total_bytes, flow, move |b| {
        on_output.send(RawChunk(b)).is_ok()
    })
    .await)
}

#[tauri::command]
#[specta::specta]
pub async fn benchmark_output_json(
    active: State<'_, ActiveBenchmark>,
    total_bytes: u32,
    on_output: Channel<Vec<u8>>,
) -> Result<OutputBenchmark, ()> {
    let flow = active.start();
    Ok(stream_sample_output(total_bytes, flow, move |b| on_output.send(b).is_ok()).await)
}

#[tauri::command]
#[specta::specta]
pub fn benchmark_acknowledge_output(active: State<'_, ActiveBenchmark>, bytes: u32) {
    active.acknowledge(bytes as usize);
}

/// Lets the frontend print benchmark results to the dev console (used by the autorun mode).
#[tauri::command]
#[specta::specta]
pub fn benchmark_report(summary: String) {
    eprintln!("[benchmark] {summary}");
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[tokio::test]
    async fn delivers_every_byte_in_batches_of_at_most_64_kib() {
        let flow = Arc::new(OutputFlowControl::default());
        let renderer = flow.clone();
        let received = Arc::new(Mutex::new(Vec::<usize>::new()));
        let sink = received.clone();
        let report = stream_sample_output(1_000_000, flow, move |b| {
            sink.lock().unwrap().push(b.len());
            renderer.acknowledge(b.len());
            true
        })
        .await;

        let sizes = received.lock().unwrap().clone();
        assert_eq!(sizes.iter().sum::<usize>(), 1_000_000);
        assert!(sizes.iter().all(|&n| n <= 64 * 1024 + CHUNK_SIZE));
        assert_eq!(report.total_bytes, 1_000_000);
        assert_eq!(report.messages as usize, sizes.len());
        assert!(
            report.messages < 1_000_000 / CHUNK_SIZE as u32,
            "chunks must be coalesced"
        );
    }

    #[tokio::test]
    async fn pauses_when_the_renderer_stops_acknowledging() {
        let flow = Arc::new(OutputFlowControl::new(256 * 1024));
        let observed = flow.clone();
        let streaming = tokio::spawn(stream_sample_output(10_000_000, flow, |_| true));

        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(
            !streaming.is_finished(),
            "producer must stall without acknowledgements"
        );
        let in_flight = observed.in_flight();
        assert!(
            (256 * 1024..1024 * 1024).contains(&in_flight),
            "in flight: {in_flight}"
        );

        observed.acknowledge(usize::MAX);
        streaming.abort();
    }

    #[tokio::test]
    async fn caps_the_requested_size() {
        let flow = Arc::new(OutputFlowControl::new(usize::MAX));
        let report = stream_sample_output(u32::MAX, flow, |_| false).await;
        assert_eq!(report.total_bytes, MAX_TOTAL_BYTES);
        assert_eq!(report.messages, 1);
    }

    #[test]
    fn acknowledging_without_an_active_benchmark_is_a_no_op() {
        ActiveBenchmark::default().acknowledge(10);
    }

    #[test]
    fn acknowledgements_reach_the_latest_benchmark() {
        let active = ActiveBenchmark::default();
        let first = active.start();
        let second = active.start();
        second.record_sent(100);
        first.record_sent(100);
        active.acknowledge(60);
        assert_eq!(second.in_flight(), 40);
        assert_eq!(first.in_flight(), 100);
    }
}
