import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioRecorder } from '@/lib/audio-recorder';
import { audioContext } from '@/lib/utils';

class FakeContext {
  state: AudioContextState = 'suspended';
  source = { connect: vi.fn(), disconnect: vi.fn() };
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  createMediaStreamSource = vi.fn(() => this.source);
  constructor() { contexts.push(this); }
}

const contexts: FakeContext[] = [];
const getUserMedia = vi.fn();
let recorder: AudioRecorder;

function microphone() {
  const stream = { active: true, getTracks: () => [track] };
  const track = { stop: vi.fn(() => { stream.active = false; }) };
  return { stream: stream as unknown as MediaStream, track };
}

beforeEach(() => {
  contexts.length = 0;
  getUserMedia.mockReset();
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('AudioWorkletNode', class {
    port = { onmessage: null };
    disconnect = vi.fn();
  });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:audio'), revokeObjectURL: vi.fn() });
  recorder = new AudioRecorder();
});

afterEach(() => {
  recorder.dispose();
  vi.unstubAllGlobals();
});

describe('audio activated by a user gesture', () => {
  it('resumes input and output before microphone permission resolves', async () => {
    const mic = microphone();
    let allow!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise(resolve => { allow = resolve; }));

    const output = audioContext();
    const input = recorder.prepare();
    expect(contexts).toHaveLength(2);
    expect(contexts.every(context => context.resume.mock.calls.length === 1)).toBe(true);
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true });
    expect(recorder.recording).toBe(false);

    allow(mic.stream);
    await Promise.all([output, input]);
    expect(contexts[1].source.connect).not.toHaveBeenCalled();
    await recorder.start();
    expect(contexts[1].source.connect).toHaveBeenCalledTimes(2);
    expect(recorder.recording).toBe(true);
    await contexts[0].close();
  });

  it('keeps the unlocked context across mute and reconnect without registering worklets twice', async () => {
    const first = microphone();
    const second = microphone();
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    await recorder.start();
    const context = contexts[0];
    recorder.stop();
    expect(first.track.stop).toHaveBeenCalledOnce();
    expect(context.close).not.toHaveBeenCalled();
    expect(recorder.recording).toBe(false);

    await recorder.start();
    expect(contexts).toHaveLength(1);
    expect(context.audioWorklet.addModule).toHaveBeenCalledTimes(2);
    expect(recorder.recording).toBe(true);
  });

  it('propagates permission denial and supports a later explicit retry', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
    await expect(recorder.prepare()).rejects.toMatchObject({ name: 'NotAllowedError' });
    recorder.stop();
    getUserMedia.mockResolvedValueOnce(microphone().stream);
    await recorder.start();
    expect(recorder.recording).toBe(true);
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it('stops a stream granted after preparation was cancelled', async () => {
    const mic = microphone();
    let allow!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise(resolve => { allow = resolve; }));
    const pending = recorder.prepare();
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    recorder.stop();
    allow(mic.stream);
    await rejection;
    expect(mic.track.stop).toHaveBeenCalled();
    expect(recorder.recording).toBe(false);
    expect(recorder.stream).toBeUndefined();
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it('discards a partially loaded worklet context so retry can succeed', async () => {
    getUserMedia.mockResolvedValueOnce(microphone().stream).mockResolvedValueOnce(microphone().stream);
    const prepare = recorder.prepare();
    await Promise.resolve();
    contexts[0].audioWorklet.addModule.mockRejectedValueOnce(new Error('Module failed'));
    await expect(prepare).rejects.toThrow('Module failed');
    await recorder.start();
    expect(contexts).toHaveLength(2);
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(recorder.recording).toBe(true);
  });
});
