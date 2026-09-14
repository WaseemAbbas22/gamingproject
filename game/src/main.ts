import './legacy.css';
import './hud.css';
import { bootGame } from './game';

function hideBoot(): void {
  document.getElementById('bootOverlay')?.remove();
}

function bootStatus(text: string): void {
  const boot = document.getElementById('bootOverlay');
  if (boot) boot.innerHTML = `<div>FORZA LEGENDS<small>${text}</small></div>`;
}
(window as Window & { __bootStatus?: (t: string) => void }).__bootStatus = bootStatus;

window.setTimeout(hideBoot, 8000);

bootGame().catch((err) => {
  const boot = document.getElementById('bootOverlay');
  if (boot) boot.innerHTML = `<div>GRAPHICS INIT FAILED<small>${err instanceof Error ? err.stack || err.message : String(err)}</small></div>`;
  console.error(err);
  window.setTimeout(hideBoot, 1200);
});
