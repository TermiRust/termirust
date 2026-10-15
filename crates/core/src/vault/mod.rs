mod ai_chats;
mod ai_settings;
pub mod crypto;
mod groups;
mod hosts;
mod identities;
mod items;
mod key_store;
mod known_hosts;
mod open;
mod port_forwards;
mod secret;
mod snippets;
mod ssh_config_import;

pub use ai_chats::{
    AiChat, AiChatRecord, AiChatRepository, ChatMessageRecord, ChatQuoteRecord, ChatRole,
    MAX_CHAT_MESSAGES,
};
pub use ai_settings::{AiSettings, AiSettingsRepository};
pub use groups::{Group, GroupRecord, GroupRepository};
pub use hosts::{Host, HostAuth, HostEnvironment, HostRecord, HostRepository, TAB_COLORS};
pub use identities::{Identity, IdentityRecord, IdentityRepository};
pub use items::{ItemKind, ItemMeta, StoredItem};
pub use key_store::{MemoryKeyStore, OsKeychain, VaultKeyStore};
pub use known_hosts::{HostKeyStatus, KnownHost, KnownHostRecord, KnownHostRepository};
pub use open::{VAULT_FORMAT_VERSION, Vault};
pub use port_forwards::{
    ForwardSpec, LOOPBACK, PortForwardRecord, PortForwardRepository, PortForwardRule,
};
pub use secret::Secret;
pub use snippets::{Snippet, SnippetRecord, SnippetRepository};
pub use ssh_config_import::{
    SshConfigImportSummary, import_ssh_config_hosts, is_already_saved, missing_settings,
    saved_match,
};

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
