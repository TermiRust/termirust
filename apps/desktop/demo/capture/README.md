# README screenshots

The images in `assets/screenshots` come from the real UI on the demo backend (fictional data).

```sh
pnpm --filter @termirust/desktop exec vite --mode demo --port 1430   # terminal 1
mkdir -p /tmp/shots && cd /tmp/shots && npm i puppeteer-core@24       # once
node <repo>/apps/desktop/demo/capture/scenes.mjs /tmp/shots [scene]   # raw 2x PNGs
node <repo>/apps/desktop/demo/capture/frame.mjs /tmp/shots/monitor.png assets/screenshots/monitor.webp
```

Uses the installed Google Chrome. WebGL is disabled so xterm renders crisply at 2x.
