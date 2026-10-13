const PALETTE: [&str; 6] = ["31", "32", "33", "34", "35", "36"];

/// Synthetic, ANSI-coloured log output used to benchmark the terminal pipeline.
pub fn sample_output_chunks(
    total_bytes: usize,
    chunk_size: usize,
) -> impl Iterator<Item = Vec<u8>> {
    let chunk_size = chunk_size.max(1);
    let mut produced = 0usize;
    let mut line_no = 0u64;
    let mut pending: Vec<u8> = Vec::new();

    std::iter::from_fn(move || {
        if produced >= total_bytes {
            return None;
        }
        let want = chunk_size.min(total_bytes - produced);
        while pending.len() < want {
            let color = PALETTE[(line_no % PALETTE.len() as u64) as usize];
            pending.extend_from_slice(
                format!(
                    "\x1b[{color}m{line_no:>8}\x1b[0m  2026-10-13T12:00:00Z  INFO  request handled in {}ms path=/api/v1/hosts/{line_no}\r\n",
                    line_no % 997
                )
                .as_bytes(),
            );
            line_no += 1;
        }
        let rest = pending.split_off(want);
        let chunk = std::mem::replace(&mut pending, rest);
        produced += chunk.len();
        Some(chunk)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_exactly_the_requested_number_of_bytes() {
        let total: usize = sample_output_chunks(100_003, 4096).map(|c| c.len()).sum();
        assert_eq!(total, 100_003);
    }

    #[test]
    fn chunks_never_exceed_the_chunk_size() {
        assert!(sample_output_chunks(50_000, 1000).all(|c| !c.is_empty() && c.len() <= 1000));
    }

    #[test]
    fn zero_bytes_yields_no_chunks() {
        assert_eq!(sample_output_chunks(0, 4096).count(), 0);
    }

    #[test]
    fn zero_chunk_size_is_treated_as_one_byte() {
        assert_eq!(sample_output_chunks(3, 0).count(), 3);
    }

    #[test]
    fn output_contains_ansi_colours_and_crlf_line_endings() {
        let all: Vec<u8> = sample_output_chunks(1000, 64).flatten().collect();
        let text = String::from_utf8_lossy(&all);
        assert!(text.contains("\x1b[31m"));
        assert!(text.contains("\r\n"));
    }
}
