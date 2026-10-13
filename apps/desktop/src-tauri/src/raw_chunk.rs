use tauri::ipc::{InvokeResponseBody, IpcResponse};

/// Bytes sent over a Tauri channel as a raw `ArrayBuffer` instead of a JSON number array.
pub struct RawChunk(pub Vec<u8>);

impl IpcResponse for RawChunk {
    fn body(self) -> tauri::Result<InvokeResponseBody> {
        Ok(InvokeResponseBody::Raw(self.0))
    }
}

// The generated TS type says number[]; at runtime the frontend receives an ArrayBuffer
// and normalises both shapes in `toBytes`.
impl specta::Type for RawChunk {
    fn definition(types: &mut specta::Types) -> specta::datatype::DataType {
        <Vec<u8> as specta::Type>::definition(types)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_sent_as_raw_bytes() {
        match RawChunk(vec![1, 2, 3]).body().unwrap() {
            InvokeResponseBody::Raw(bytes) => assert_eq!(bytes, vec![1, 2, 3]),
            InvokeResponseBody::Json(json) => panic!("expected raw bytes, got JSON {json}"),
        }
    }
}
