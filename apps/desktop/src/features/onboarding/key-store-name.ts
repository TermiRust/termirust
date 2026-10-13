/** What the OS calls the place the vault key is kept, so the onboarding can name it. */
export function keyStoreName(userAgent: string = navigator.userAgent): { store: string; prompt: string } {
  if (/Mac/i.test(userAgent)) return { store: "macOS Keychain", prompt: "macOS will ask for your Mac login password to let Termirust use the Keychain." };
  if (/Windows/i.test(userAgent)) return { store: "Windows Credential Manager", prompt: "Windows keeps the key in Credential Manager; you may not see a prompt at all." };
  return { store: "your desktop keyring (GNOME Keyring or KWallet)", prompt: "Your desktop may ask you to unlock its keyring." };
}
