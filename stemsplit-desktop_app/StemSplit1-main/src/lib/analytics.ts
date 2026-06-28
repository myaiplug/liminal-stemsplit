let pinged = false;

export async function sendPing(event: string) {
  try {
    const { isTauriRuntime } = await import('./tauri-runtime');
    if (!isTauriRuntime()) return;
    const serverUrl = 'https://liminal-stemsplit.onrender.com';
    await fetch(`${serverUrl}/api/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, version: '0.5.0' }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Silent fail — never block the user
  }
}

export function pingAppOpen() {
  if (pinged) return;
  pinged = true;
  sendPing('app_open');
}

export function pingSplitComplete() {
  sendPing('split_complete');
}
