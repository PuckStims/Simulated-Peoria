import './ui/styles.css';
import { loadRequestedRegionAssets } from './core/RegionLoader';
import { MicrocosmWorld } from './core/World';
import { HudView } from './ui/HudView';

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('microcosm-canvas') as HTMLCanvasElement | null;
  const banner = document.getElementById('status-banner') as HTMLDivElement | null;
  if (!canvas || !banner) return;

  const params = new URLSearchParams(window.location.search);
  const requestedRegion = params.get('region') || 'peoria-il';

  try {
    const assetLoadStartedMs = performance.now();
    banner.textContent = `Loading region "${requestedRegion}" terrain & geography...`;
    // A fixture may only be selected explicitly with ?region=test-fixture. Falling
    // back from a real region would make synthetic geography look like Peoria.
    const assets = await loadRequestedRegionAssets(window.location.search);
    const assetLoadMs = performance.now() - assetLoadStartedMs;

    const sceneConstructionStartedMs = performance.now();
    const world = new MicrocosmWorld(canvas, assets);
    world.setStartupMetrics(assetLoadMs, performance.now() - sceneConstructionStartedMs);
    const hud = new HudView(world);
    document.body.appendChild(hud.root);

    banner.classList.add('hidden');
    world.start();

    // Expose read-only diagnostic handle for debugging without mutating internal physics
    (window as unknown as Record<string, unknown>).__MICROCOSM__ = world;
  } catch (err) {
    banner.classList.add('error');
    const msg = err instanceof Error ? err.message : String(err);
    banner.innerHTML = `
      <div><strong>Unable to load Project Microcosm region data</strong></div>
      <div style="max-width:520px;text-align:center;">${msg}</div>
      <div style="font-size:12px;color:#8e9baa;">Run <code>npm run geo:import</code> to prepare Peoria data. The synthetic fixture is only available explicitly via <code>?region=test-fixture</code>.</div>
    `;
  }
}

void bootstrap();
