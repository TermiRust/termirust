//! Optional AI help (ADR-012): providers the user configures, plus the guards every request
//! passes through before anything leaves the machine.

pub mod danger;
pub mod prompts;
pub mod provider;
pub mod redact;
