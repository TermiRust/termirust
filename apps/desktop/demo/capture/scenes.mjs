import puppeteer from "puppeteer-core";

const OUT = process.argv[2];
const ONLY = process.argv[3];
const URL_ = "http://localhost:1430/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  // No WebGL: xterm then uses its DOM renderer, which scales correctly at 2x.
  args: ["--hide-scrollbars", "--font-render-hinting=none", "--disable-3d-apis"],
});

async function scene(name, { query = "", storage = {}, steps }) {
  if (ONLY && ONLY !== name) return;
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument((entries) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
  }, storage);
  await page.goto(URL_ + query, { waitUntil: "networkidle0" });
  await wait(600);
  const click = async (selector) => {
    await page.waitForSelector(selector, { visible: true, timeout: 5000 });
    await page.click(selector);
    await wait(350);
  };
  const clickText = async (text, tag = "button") => {
    const el = await page.waitForSelector(`::-p-xpath(//${tag}[normalize-space(.)="${text}"])`, { visible: true, timeout: 5000 });
    await el.click();
    await wait(350);
  };
  await steps({ page, click, clickText });
  await wait(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${name}: ${errors.length ? errors.join(" | ") : "ok"}`);
  await page.close();
}

const openHost = async (click, label) => {
  await click(`[aria-label="Connect to ${label}"]`);
  await wait(500);
};
const splitWith = async (click, label, direction = "Side by side") => {
  await click('[aria-label="Split pane"]');
  await click(`::-p-xpath(//div[@role="dialog" and @aria-label="Split pane"]//button[contains(., "${direction}")])`);
  await click(`[role="option"][aria-label="${label}"]`);
  await wait(500);
};

await scene("terminals", {
  query: "?scene=clean",
  steps: async ({ click, clickText }) => {
    await clickText("Hosts");
    await openHost(click, "web-01");
    await splitWith(click, "db-01");
    await splitWith(click, "api-staging", "Stacked");
  },
});

await scene("hosts", { steps: async ({ clickText }) => clickText("Hosts") });

await scene("monitor", {
  storage: { "termirust.monitor.hosts": JSON.stringify(["h-web1", "h-db1", "h-cache", "h-api"]) },
  steps: async ({ clickText }) => {
    await clickText("Monitor");
    await new Promise((r) => setTimeout(r, 900));
  },
});

await scene("sftp", {
  steps: async ({ click, clickText }) => {
    await clickText("SFTP");
    await click('[aria-label="Browse files on web-01"]');
    await new Promise((r) => setTimeout(r, 900));
  },
});

await scene("ai", {
  query: "?scene=clean",
  steps: async ({ click, clickText, page }) => {
    await clickText("Hosts");
    await openHost(click, "api-staging");
    await click("::-p-xpath(//button[normalize-space(.)='AI'])");
    await page.waitForSelector('::-p-xpath(//*[contains(., "mark-applied")])', { timeout: 5000 });
  },
});

await scene("connect", {
  query: "?scene=connect",
  steps: async ({ click, clickText }) => {
    await clickText("Hosts");
    await openHost(click, "edge-tunnel");
  },
});

await scene("onboarding", { query: "?scene=onboarding", steps: async () => {} });

await scene("keychain", { steps: async ({ clickText }) => clickText("Keychain") });

await browser.close();
