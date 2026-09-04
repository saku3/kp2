// Minimal client for the ttyd (>= 1.7) WebSocket protocol.
//
//   client -> server : '0' + input bytes | '1' + JSON({columns, rows}) | '2' pause | '3' resume
//   server -> client : '0' + output bytes | '1' + window title | '2' + JSON preferences
//
// The first message after connect is a JSON text frame {AuthToken, columns, rows}.
import type { Terminal } from '@xterm/xterm';

const enum ClientCmd { Input = '0', Resize = '1', Pause = '2', Resume = '3' }
const enum ServerCmd { Output = '0', Title = '1', Prefs = '2' }

export type TtydStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface TtydClientOptions {
  wsUrl: string;
  tokenUrl: string;
  onStatus?: (status: TtydStatus) => void;
  onTitle?: (title: string) => void;
}

export class TtydClient {
  private socket: WebSocket | null = null;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private disposables: { dispose(): void }[] = [];
  private closedByUser = false;

  // Flow control (same thresholds as ttyd's own web client).
  private written = 0;
  private pending = 0;
  private paused = false;

  constructor(private readonly term: Terminal, private readonly opts: TtydClientOptions) {}

  async connect(): Promise<void> {
    this.closedByUser = false;
    this.opts.onStatus?.('connecting');

    let token = '';
    try {
      const res = await fetch(this.opts.tokenUrl);
      token = (await res.json()).token ?? '';
    } catch {
      // ttyd without credentials returns {"token":""}; keep going with an empty token.
    }

    const socket = new WebSocket(this.opts.wsUrl, ['tty']);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ AuthToken: token, columns: this.term.cols, rows: this.term.rows }));
      this.opts.onStatus?.('open');
      this.disposables.push(
        this.term.onData((data) => this.sendInput(data)),
        this.term.onBinary((data) => this.sendInput(Uint8Array.from(data, (c) => c.charCodeAt(0)))),
        this.term.onResize(({ cols, rows }) => this.sendResize(cols, rows)),
      );
      this.term.focus();
    };

    socket.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
      const bytes = new Uint8Array(ev.data);
      const cmd = String.fromCharCode(bytes[0]);
      const payload = bytes.subarray(1);
      switch (cmd) {
        case ServerCmd.Output:
          this.writeOutput(payload);
          break;
        case ServerCmd.Title:
          this.opts.onTitle?.(this.decoder.decode(payload));
          break;
        case ServerCmd.Prefs:
          // Preferences from ttyd's -t options; we manage xterm options ourselves.
          break;
      }
    };

    socket.onerror = () => this.opts.onStatus?.('error');
    socket.onclose = () => {
      this.disposeListeners();
      this.opts.onStatus?.('closed');
      if (!this.closedByUser) {
        this.term.write('\r\n\x1b[90m[connection closed]\x1b[0m\r\n');
      }
    };
  }

  /** Send raw input to the PTY (what the user would have typed). */
  sendInput(data: string | Uint8Array): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const body = typeof data === 'string' ? this.encoder.encode(data) : data;
    const frame = new Uint8Array(body.length + 1);
    frame[0] = ClientCmd.Input.charCodeAt(0);
    frame.set(body, 1);
    this.socket.send(frame);
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.closedByUser = true;
    this.socket?.close();
    this.socket = null;
  }

  private sendResize(cols: number, rows: number): void {
    this.sendText(ClientCmd.Resize + JSON.stringify({ columns: cols, rows }));
  }

  private sendText(text: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(this.encoder.encode(text));
  }

  private writeOutput(data: Uint8Array): void {
    const limit = 100_000, highWater = 10, lowWater = 4;
    this.written += data.length;
    if (this.written > limit) {
      this.pending += 1;
      this.written = 0;
      this.term.write(data, () => {
        this.pending = Math.max(this.pending - 1, 0);
        if (this.paused && this.pending < lowWater) {
          this.paused = false;
          this.sendText(ClientCmd.Resume);
        }
      });
      if (!this.paused && this.pending > highWater) {
        this.paused = true;
        this.sendText(ClientCmd.Pause);
      }
    } else {
      this.term.write(data);
    }
  }

  private disposeListeners(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
