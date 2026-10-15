// Frames raw 2x screenshots as macOS-like windows (rounded corners, soft shadow) and writes WebP.
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
const [, , input, output] = process.argv;
const img = readFileSync(input).toString("base64");
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: 1440 + 96, height: 900 + 96, deviceScaleFactor: 2 });
await page.setContent(`<html><body style="margin:0;background:transparent">
  <div style="padding:40px 48px 56px;">
    <img src="data:image/png;base64,${img}" style="display:block;width:1440px;height:900px;border-radius:12px;
      box-shadow:0 0 0 1px rgba(255,255,255,.08),0 24px 48px rgba(0,0,0,.35),0 8px 16px rgba(0,0,0,.2)">
  </div></body></html>`);
await page.screenshot({ path: output, type: "webp", quality: 88, omitBackground: true, clip: { x: 0, y: 0, width: 1536, height: 996 } });
await browser.close();
