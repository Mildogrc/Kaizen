// When Kaizen runs in the cloud, the server can't reach AnkiConnect on your
// machine, so this tab relays its requests: server → WebSocket → this tab →
// http://127.0.0.1:8765 → back. AnkiConnect must allow this site's origin
// (AnkiConnect config: "webCorsOriginList").
import { createRoot, createSignal } from 'solid-js';

function createRelay() {
  const [status, setStatus] = createSignal('off'); // off | connecting | ready | blocked
  let socket = null;
  let stopped = true;
  let delay = 1000;

  async function forward(connectUrl, message) {
    const { id, ...payload } = message;
    try {
      const res = await fetch(connectUrl, { method: 'POST', body: JSON.stringify(payload) });
      const envelope = await res.json();
      setStatus('ready');
      return { id, response: envelope };
    } catch {
      setStatus('blocked');
      return { id, transportError: 'This browser cannot reach AnkiConnect. Start Anki and add this site to AnkiConnect’s webCorsOriginList.' };
    }
  }

  function start(connectUrl) {
    if (!stopped) return;
    stopped = false;
    const open = () => {
      setStatus('connecting');
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${proto}://${location.host}/api/anki/relay`);
      socket.onopen = () => { delay = 1000; setStatus('ready'); };
      socket.onmessage = async (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        const reply = await forward(connectUrl, message);
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(reply));
      };
      socket.onclose = () => {
        socket = null;
        if (stopped) return setStatus('off');
        setStatus('connecting');
        setTimeout(open, delay);
        delay = Math.min(delay * 2, 30000);
      };
    };
    open();
  }

  function stop() {
    stopped = true;
    socket?.close();
  }

  return { status, start, stop };
}

export const ankiRelay = createRoot(createRelay);
