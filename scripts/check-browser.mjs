import { chromium } from 'playwright';
import { runBrowserRegressions } from '../tests/browser-regressions.mjs';
import { runCommandBrowserRegressions } from '../tests/command-browser-regressions.mjs';
import { runSpecBrowserRegressions } from '../tests/spec-browser-regressions.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(process.env.LAB_TEST_URL || 'http://127.0.0.1:4173');
  for (const result of await runBrowserRegressions(page)) console.log('PASS ' + result);
  for (const result of await runCommandBrowserRegressions(page)) console.log('PASS ' + result);
  for (const result of await runSpecBrowserRegressions(page)) console.log('PASS ' + result);
} finally {
  await browser.close();
}
