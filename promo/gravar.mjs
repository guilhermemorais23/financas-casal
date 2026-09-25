// Grava promo/par-promo.html como MP4 (1920x1080, 30 fps), quadro a quadro.
// Precisa de: `npm i playwright` e um ffmpeg com libx264 no PATH (ou em FFMPEG).
// Uso: node promo/gravar.mjs [saida.mp4]
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const FPS = 30;
const out = process.argv[2] ?? "par-promo.mp4";
const html = pathToFileURL(fileURLToPath(new URL("./par-promo.html", import.meta.url))).href;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
await page.goto(html + "?gravar");
await page.waitForFunction(() => window.pronto === true, null, { timeout: 60000 });
const total = await page.evaluate(() => window.TOTAL);

const ffmpeg = spawn(process.env.FFMPEG ?? "ffmpeg", [
  "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out,
], { stdio: ["pipe", "inherit", "inherit"] });

const frames = Math.ceil((total / 1000) * FPS);
for (let i = 0; i < frames; i++) {
  await page.evaluate((t) => window.seek(t), (i * 1000) / FPS);
  const jpg = await page.locator("#stage").screenshot({ type: "jpeg", quality: 95 });
  if (!ffmpeg.stdin.write(jpg)) await new Promise((r) => ffmpeg.stdin.once("drain", r));
  if (i % 150 === 0) console.log(`quadro ${i}/${frames}`);
}
ffmpeg.stdin.end();
await new Promise((r) => ffmpeg.on("close", r));
await browser.close();
console.log("pronto:", out);
