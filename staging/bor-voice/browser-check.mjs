// Run with a local Playwright installation and Chromium. No remote requests are allowed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startHarness } from '../../tests/e2e/harness.js';

const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.BOR_VOICE_PLAYWRIGHT || 'playwright');
const app = await startHarness();
const mockPeer = process.env.BOR_VOICE_MOCK_PEER === '1';
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.BOR_VOICE_CHROMIUM || undefined,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });

  for (const [label, device] of [['desktop', {}], ['mobile viewport', devices['Pixel 7']]]) {
    const initialCalls = app.aiCalls.length;
    const context = await browser.newContext({ ...device, permissions: ['microphone', 'camera'] });
    try {
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== app.url) return route.abort();
        if (route.request().resourceType() !== 'document') return route.continue();
        const response = await route.fetch();
        await route.fulfill({
          response,
          headers: { ...response.headers(), 'permissions-policy': 'microphone=(self), camera=(self), display-capture=(self), geolocation=()' },
        });
      });
      await context.addInitScript(mockPeer => {
        const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        window.voiceTracks = [];
        navigator.mediaDevices.getUserMedia = async options => {
          if (window.denyVoice && options.audio) throw new DOMException('Test denial', 'NotAllowedError');
          const stream = await native(options);
          window.voiceTracks.push(...stream.getTracks());
          return stream;
        };
        // Simulate choosing a display source with synthetic frames. No system picker is opened.
        Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
          configurable: true, value: () => navigator.mediaDevices.getUserMedia({ video: true }),
        });
        function sendTranscript(send) {
          send({ type: 'session.started' });
          send({ type: 'session.input_transcript.delta', event_id: 'u2', delta: ' cuaca?', start_ms: 10, end_ms: 20 });
          send({ type: 'session.input_transcript.delta', event_id: 'u1', delta: 'Bagaimana', start_ms: 0, end_ms: 10 });
          send({ type: 'session.input_transcript.delta', event_id: 'u2', delta: ' duplikat', start_ms: 10, end_ms: 20 });
          send({ type: 'session.output_transcript.delta', event_id: 'a1', delta: '<img src=x onerror=alert(1)>', start_ms: 20, end_ms: 30 });
        }
        if (mockPeer) {
          class MockChannel extends EventTarget {
            readyState = 'open';
            receive(event) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) })); }
            send(data) {
              if (JSON.parse(data).type === 'session.close') {
                queueMicrotask(() => this.receive({ type: 'session.closed' }));
              }
            }
          }
          window.RTCPeerConnection = class extends EventTarget {
            iceGatheringState = 'complete';
            addTrack(track) { this.track = track; }
            createDataChannel() { this.channel = new MockChannel(); return this.channel; }
            createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
            setLocalDescription(offer) { this.localDescription = offer; }
            setRemoteDescription() {
              this.dispatchEvent(Object.assign(new Event('track'), { track: this.track }));
              sendTranscript(event => this.channel.receive(event));
            }
            close() {}
          };
          window.BORVoicePreview = { exchange: async () => ({ answerSdp: 'v=0\r\n' }) };
          return;
        }
        window.BORVoicePreview = {
          async exchange(offer, signal) {
            const peer = new RTCPeerConnection();
            signal.addEventListener('abort', () => peer.close(), { once: true });
            // An actual second WebRTC peer, standing in for the provider.
            const output = new AudioContext();
            const oscillator = output.createOscillator();
            const destination = output.createMediaStreamDestination();
            oscillator.connect(destination);
            oscillator.start();
            signal.addEventListener('abort', () => { oscillator.stop(); void output.close(); }, { once: true });
            for (const track of destination.stream.getAudioTracks()) peer.addTrack(track, destination.stream);
            peer.ondatachannel = ({ channel }) => {
              const send = event => channel.send(JSON.stringify(event));
              channel.onopen = () => sendTranscript(send);
              channel.onmessage = ({ data }) => {
                if (JSON.parse(data).type === 'session.close') send({ type: 'session.closed' });
              };
            };
            await peer.setRemoteDescription({ type: 'offer', sdp: offer });
            await peer.setLocalDescription(await peer.createAnswer());
            if (peer.iceGatheringState !== 'complete') {
              await new Promise(resolve => peer.addEventListener('icegatheringstatechange', () => {
                if (peer.iceGatheringState === 'complete') resolve();
              }));
            }
            return { answerSdp: peer.localDescription.sdp };
          },
        };
      }, mockPeer);

      const page = await context.newPage();
      page.on("pageerror", error => console.error(error));
      await page.goto(app.url, { waitUntil: 'domcontentloaded' });
      const guest = page.locator('#continueGuest');
      if (await guest.isVisible()) await guest.click();
      const panel = page.locator('#voicePreview');
      await panel.locator('summary').click();
      await panel.getByRole('button', { name: 'Mulai suara' }).click();
      await page.waitForFunction(() => document.querySelector('[data-voice-user]').textContent === 'Bagaimana cuaca?');
      await page.waitForFunction(() => document.querySelector('#voicePreview audio').srcObject?.getAudioTracks().length === 1);
      assert.equal(await panel.locator('[data-voice-assistant]').textContent(), '<img src=x onerror=alert(1)>');
      assert.equal(await panel.locator('[data-voice-assistant] img').count(), 0);
      await panel.getByRole('button', { name: 'Salin dikte ke chat' }).click();
      assert.equal(await page.locator('#prompt').inputValue(), 'Bagaimana cuaca?');
      assert.equal(app.aiCalls.length, initialCalls);
      await panel.getByRole('button', { name: 'Bisukan balasan' }).click();
      assert.equal(await panel.locator('audio').evaluate(audio => audio.muted), true);
      await panel.getByRole('button', { name: 'Akhiri suara' }).click();
      await page.waitForFunction(() => document.querySelector('#voicePreview [role=status]').textContent === 'Sesi suara berakhir.');
      assert.equal(await page.evaluate(() => window.voiceTracks.every(track => track.readyState === 'ended')), true);

      await page.evaluate(() => { window.denyVoice = true; });
      await panel.getByRole('button', { name: 'Mulai suara' }).click();
      await page.waitForFunction(() => document.querySelector('#voicePreview [role=status]').textContent === 'Izin mikrofon ditolak.');

      for (const [button, filename] of [['Kamera', 'camera.jpg'], ['Bagikan layar', 'screen.jpg']]) {
        await panel.getByRole('button', { name: button }).click();
        await page.waitForFunction(() => document.querySelector('#voicePreview video').videoWidth > 0);
        await panel.getByRole('button', { name: 'Lampirkan gambar' }).click();
        await page.waitForFunction(name => document.querySelector('#csvName').textContent === name, filename);
        assert.equal(await page.evaluate(() => window.voiceTracks.every(track => track.readyState === 'ended')), true);
        assert.equal(app.aiCalls.length, initialCalls, 'Capturing must never send the draft automatically');
      }

      await page.locator('#clearCsv').click();
      await page.locator('#send').click();
      await page.waitForFunction(() => document.querySelector('.voice-read-action'));
      assert.match(await page.locator('.voice-read-action').first().textContent(), /Bacakan/);
      console.log(label + ' (' + (mockPeer ? 'simulated transport' : 'local WebRTC peer') + '): captions, media controls, attachments, dictation, permission denial and read-aloud control passed.');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await app.close();
}
