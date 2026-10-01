import { chromium } from 'playwright';
import { runBrowserRegressions } from '../tests/browser-regressions.mjs';
import { runCommandBrowserRegressions } from '../tests/command-browser-regressions.mjs';
import { runSpecBrowserRegressions } from '../tests/spec-browser-regressions.mjs';
import { runMechanismBrowserRegressions } from '../tests/mechanism-browser-regressions.mjs';
import { runAlgorithmBrowserRegressions } from '../tests/algorithm-browser-regressions.mjs';
import { runFoundationBrowserRegressions } from '../tests/foundation-browser-regressions.mjs';
import { runEditorBrowserRegressions } from '../tests/editor-browser-regressions.mjs';
import { runServiceBrowserRegressions } from '../tests/service-browser-regressions.mjs';
import { runDeviceBrowserRegressions } from '../tests/device-browser-regressions.mjs';
import { runAdvancedBrowserRegressions } from '../tests/advanced-browser-regressions.mjs';
import { runRoadmapCoreBrowserRegressions } from '../tests/roadmap-core-browser-regressions.mjs';
import { runRoadmapSpecBrowserRegressions } from '../tests/roadmap-spec-browser-regressions.mjs';
import { runRoadmapProtocolBrowserRegressions } from '../tests/roadmap-protocol-browser-regressions.mjs';
import { runRoadmapBranchBrowserRegressions } from '../tests/roadmap-branch-browser-regressions.mjs';
import { runRoadmapModelBrowserRegressions } from '../tests/roadmap-model-browser-regressions.mjs';
import { runObservationDepthBrowserRegressions } from '../tests/observation-depth-browser-regressions.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(process.env.LAB_TEST_URL || 'http://127.0.0.1:4173');
  for (const result of await runBrowserRegressions(page)) console.log('PASS ' + result);
  for (const result of await runCommandBrowserRegressions(page)) console.log('PASS ' + result);
  for (const result of await runSpecBrowserRegressions(page)) console.log('PASS ' + result);
  for (const result of await runMechanismBrowserRegressions(page)) console.log('PASS ' + result);
  for (const result of await runServiceBrowserRegressions(page)) console.log('PASS ' + result);
  for (const result of await runDeviceBrowserRegressions(page)) console.log('PASS ' + result);
  for (const result of await runAdvancedBrowserRegressions(page)) console.log('PASS ' + result);
  for (const result of await runRoadmapCoreBrowserRegressions(page)) console.log('PASS ' + result);
  for (const result of await runRoadmapSpecBrowserRegressions(page)) console.log('PASS ' + result);
  for (const result of await runRoadmapProtocolBrowserRegressions(page)) console.log('PASS ' + result);
  for (const result of await runRoadmapBranchBrowserRegressions(page)) console.log('PASS ' + result);
  for (const result of await runRoadmapModelBrowserRegressions(page)) console.log('PASS ' + result);
  for (const result of await runObservationDepthBrowserRegressions(page)) console.log('PASS ' + result);
  for (const result of await runAlgorithmBrowserRegressions(page)) console.log('PASS ' + result);
  for (const result of await runFoundationBrowserRegressions(page)) console.log('PASS ' + result);
  for (const result of await runEditorBrowserRegressions(page)) console.log('PASS ' + result);
} finally {
  await browser.close();
}
