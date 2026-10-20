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

type GetAudioContextOptions = AudioContextOptions & {
  id?: string;
};

const map: Map<string, AudioContext> = new Map();

// Call directly from the start button: creating/resuming must happen before
// awaiting permissions, network requests, or worklet loading (especially on iOS).
export async function audioContext(options: GetAudioContextOptions = {}) {
  if (typeof AudioContext === 'undefined') {
    throw new DOMException('Web Audio is unavailable', 'NotSupportedError');
  }
  const { id, ...contextOptions } = options;
  let context = id ? map.get(id) : undefined;
  if (!context || context.state === 'closed') {
    context = new AudioContext(contextOptions);
    if (id) map.set(id, context);
  }
  if (context.state !== 'running') await context.resume();
  if (context.state !== 'running') {
    throw new DOMException('Audio needs a user gesture', 'NotAllowedError');
  }
  return context;
}

export function base64ToArrayBuffer(base64: string) {
  var binaryString = atob(base64);
  var bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
