/** Where the project lives; change REPO when the GitHub organisation is created. */
const REPO = "https://github.com/termirust/termirust";

export const PROJECT = {
  name: "Termirust",
  copyright: "Copyright © 2026 Termirust contributors",
  license: "GNU Affero General Public License v3.0",
  repoUrl: REPO,
  issuesUrl: `${REPO}/issues/new/choose`,
  releasesUrl: `${REPO}/releases`,
  licenseUrl: `${REPO}/blob/main/LICENSE`,
  privacyUrl: `${REPO}/blob/main/PRIVACY.md`,
  trademarksUrl: `${REPO}/blob/main/TRADEMARKS.md`,
  securityUrl: `${REPO}/security/policy`,
  releaseUrl: (version: string) => `${REPO}/releases/tag/v${version}`,
} as const;
