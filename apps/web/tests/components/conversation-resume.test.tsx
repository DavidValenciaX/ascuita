import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ load: vi.fn(), disconnect: vi.fn() }));
vi.mock('@/hooks/useConversations', () => ({ useConversations: () => ({
  conversations: [{ id: 'chat-a', agentId: 'default-agent', agentName: 'Ascuita', startedAt: 1, endedAt: 2, messageCount: 1 }],
  loadMessages: mocks.load, deleteConversation: vi.fn(),
}) }));
vi.mock('@/contexts/LiveAPIContext', () => ({ useLiveAPIContext: () => ({ disconnect: mocks.disconnect }) }));

import Sidebar from '@/components/Sidebar';
import { useAgent, useAuthGate, useConversationResume, useUI, useUser } from '@/lib/state';
import { Ascuita } from '@/lib/presets/agents';

let root: Root;
let container: HTMLDivElement;
const messages = [{ id: 'one', role: 'user', text: 'Private text from A', timestamp: 1 }];

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(messages);
  mocks.disconnect.mockImplementation(() => useConversationResume.getState().clearPending());
  useUser.setState({ uid: 'account-a' });
  useAuthGate.setState({ authReady: true, isAuthenticated: true });
  useAgent.setState({ current: Ascuita, availablePresets: [Ascuita], availablePersonal: [] });
  useConversationResume.setState({ pending: null });
  useUI.setState({ showSidebar: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Sidebar />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('queues the loaded conversation for its account after resetting the previous session', async () => {
  await act(async () => container.querySelector<HTMLButtonElement>('.sidebar__itemMain')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('.sidebar__resumeBtn')!.click());
  expect(mocks.disconnect).toHaveBeenCalledOnce();
  expect(useConversationResume.getState().pending).toEqual({
    userId: 'account-a', agentId: Ascuita.id, agentName: Ascuita.name, conversationId: 'chat-a',
    messages: [{ role: 'user', text: 'Private text from A' }],
  });
});

it('discards message loading that completes after switching accounts', async () => {
  let finish!: (value: typeof messages) => void;
  mocks.load.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await act(async () => container.querySelector<HTMLButtonElement>('.sidebar__itemMain')!.click());
  await act(async () => { useUser.setState({ uid: 'account-b' }); });
  await act(async () => { finish(messages); });
  expect(container.textContent).not.toContain('Private text from A');
  expect(container.querySelector('.sidebar__resumeBtn')).toBeNull();
  expect(useConversationResume.getState().pending).toBeNull();
});

it('new chat clears a queued history request', async () => {
  useConversationResume.getState().setPending({
    userId: 'account-a', agentId: Ascuita.id, agentName: Ascuita.name, conversationId: 'chat-a', messages: [],
  });
  await act(async () => container.querySelector<HTMLButtonElement>('.sidebar__newChatBtn')!.click());
  expect(useConversationResume.getState().pending).toBeNull();
});
