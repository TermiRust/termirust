Throwaway SSH keys used only by tests. They grant access to nothing except the
Docker test servers in docker/test-ssh.yml. ed25519_encrypted uses the passphrase
test-passphrase. Regenerate with ssh-keygen and update the expected fingerprints in the tests.
