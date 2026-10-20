/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { audioContext } from './utils';
import AudioRecordingWorklet from './worklets/audio-processing';
import VolMeterWorket from './worklets/vol-meter';

import { createWorketFromSrc } from './audioworklet-registry';
import EventEmitter from 'eventemitter3';

function arrayBufferToBase64(buffer: ArrayBuffer) {
  var binary = '';
  var bytes = new Uint8Array(buffer);
  var len = bytes.byteLength;
  for (var i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export class AudioRecorder extends EventEmitter {
  stream: MediaStream | undefined;
  audioContext: AudioContext | undefined;
  source: MediaStreamAudioSourceNode | undefined;
  recording: boolean = false;
  recordingWorklet: AudioWorkletNode | undefined;
  vuWorklet: AudioWorkletNode | undefined;

  private preparing: Promise<void> | null = null;
  private generation = 0;

  constructor(public sampleRate = 16000) {
    super();
  }

  prepare(): Promise<void> {
    if (this.preparing) return this.preparing;
    if (this.stream?.active && this.source) return Promise.resolve();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new DOMException('Microphone is unavailable', 'NotSupportedError'));
    }
    const generation = this.generation;
    const operation = this.initialize(generation).finally(() => {
      if (this.preparing === operation) this.preparing = null;
    });
    this.preparing = operation;
    return operation;
  }

  private async initialize(generation: number) {
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    const existingContext = this.audioContext;
    // Both calls run in the button's click stack, before the first await.
    const contextReady = existingContext && existingContext.state !== 'closed'
      ? existingContext.resume().then(() => existingContext)
      : audioContext({ sampleRate: this.sampleRate });
    const streamReady = navigator.mediaDevices.getUserMedia({ audio: true }).then(value => {
      stream = value;
      if (generation !== this.generation) {
        value.getTracks().forEach(track => track.stop());
        throw new DOMException('Audio startup cancelled', 'AbortError');
      }
      return value;
    });
    try {
      [context, stream] = await Promise.all([contextReady, streamReady]);
      if (generation !== this.generation) throw new DOMException('Audio startup cancelled', 'AbortError');
      if (context.state !== 'running') throw new DOMException('Audio is suspended', 'NotAllowedError');
      if (!context.audioWorklet || typeof AudioWorkletNode === 'undefined') {
        throw new DOMException('AudioWorklet is unavailable', 'NotSupportedError');
      }
      this.audioContext = context;
      source = context.createMediaStreamSource(stream);
      if (!this.recordingWorklet || !this.vuWorklet) {
        const addModule = async (name: string, code: string) => {
          const url = createWorketFromSrc(name, code);
          try { await context!.audioWorklet.addModule(url); }
          finally { URL.revokeObjectURL(url); }
        };
        await addModule('audio-recorder-worklet', AudioRecordingWorklet);
        await addModule('vu-meter', VolMeterWorket);
        if (generation !== this.generation) throw new DOMException('Audio startup cancelled', 'AbortError');
        this.recordingWorklet = new AudioWorkletNode(context, 'audio-recorder-worklet');
        this.vuWorklet = new AudioWorkletNode(context, 'vu-meter');
        this.recordingWorklet.port.onmessage = (ev: MessageEvent) => {
          const buffer = ev.data.data.int16arrayBuffer;
          if (this.recording && buffer) this.emit('data', arrayBufferToBase64(buffer));
        };
        this.vuWorklet.port.onmessage = (ev: MessageEvent) => {
          if (this.recording) this.emit('volume', ev.data.volume);
        };
      }
      if (generation !== this.generation) throw new DOMException('Audio startup cancelled', 'AbortError');
      // Preparation obtains permission; start() connects the microphone graph.
      this.stream = stream;
      this.source = source;
    } catch (error) {
      source?.disconnect();
      if (generation === this.generation && context === this.audioContext) {
        this.audioContext = undefined;
        this.recordingWorklet = undefined;
        this.vuWorklet = undefined;
      }
      void streamReady.then(value => value.getTracks().forEach(track => track.stop())).catch(() => {});
      // A context can resolve after a permission failure or cancellation.
      void contextReady.then(value => {
        if (value !== this.audioContext && value.state !== 'closed') return value.close();
      }).catch(() => {});
      throw error;
    }
  }

  async start() {
    const generation = this.generation;
    await this.prepare();
    if (generation !== this.generation || this.recording) return;
    this.source!.connect(this.recordingWorklet!);
    this.source!.connect(this.vuWorklet!);
    this.recording = true;
  }

  stop() {
    if (this.preparing) {
      const context = this.audioContext;
      this.audioContext = undefined;
      this.recordingWorklet = undefined;
      this.vuWorklet = undefined;
      if (context && context.state !== 'closed') void context.close().catch(() => {});
    }
    this.generation += 1;
    this.preparing = null;
    this.recording = false;
    this.source?.disconnect();
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    this.source = undefined;
    // Keep the context unlocked across greetings, muting, and reconnections.
  }

  dispose() {
    this.stop();
    const context = this.audioContext;
    this.audioContext = undefined;
    this.recordingWorklet?.disconnect();
    this.vuWorklet?.disconnect();
    this.recordingWorklet = undefined;
    this.vuWorklet = undefined;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
}
