import { useEffect, useRef, useState } from 'react';
import c from 'classnames';
import { useConversations, type ConversationMessage } from '@/hooks/useConversations';
import { useConversationResume, useAgent, useUI, useAuthGate, useUser } from '@/lib/state';
import { useLiveAPIContext } from '@/contexts/LiveAPIContext';
import { useTranslation } from '@/lib/i18n';
import { confirmDestructive } from '@/lib/confirm-dialog';

function formatDate(ms: number) {
  if (!ms) return '';
  return new Date(ms).toLocaleString();
}

function isConversationActive(endedAt: number | null) {
  return endedAt == null;
}

function Sidebar() {
  const { conversations, deleteConversation, loadMessages } = useConversations();
  const { disconnect } = useLiveAPIContext();
  const { showSidebar, setShowSidebar } = useUI();
  const { isAuthenticated, authReady } = useAuthGate();
  const userId = useUser(state => state.uid);
  const setResumeConversation = useConversationResume(state => state.setPending);
  const { setCurrent, availablePresets, availablePersonal } = useAgent();
  const { t } = useTranslation();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const openRequestRef = useRef(0);
  const loadedMessagesScope = useRef<{ userId: string; conversationId: string } | null>(null);

  useEffect(() => {
    openRequestRef.current += 1;
    loadedMessagesScope.current = null;
    setSelectedId(null);
    setMessages([]);
    setLoadingMessages(false);
  }, [userId]);

  function resetSelection() {
    openRequestRef.current += 1;
    setSelectedId(null);
    setMessages([]);
    setLoadingMessages(false);
    loadedMessagesScope.current = null;
  }

  async function openConversation(id: string) {
    const ownerId = userId;
    const requestId = openRequestRef.current + 1;
    openRequestRef.current = requestId;
    setSelectedId(id);
    setLoadingMessages(true);
    setMessages([]);
    loadedMessagesScope.current = null;
    try {
      const msgs = await loadMessages(id);
      if (openRequestRef.current !== requestId || useUser.getState().uid !== ownerId) return;
      loadedMessagesScope.current = ownerId ? { userId: ownerId, conversationId: id } : null;
      setMessages(msgs);
    } catch (error) {
      if (openRequestRef.current !== requestId) return;
      console.error('Error loading messages:', error);
    } finally {
      if (openRequestRef.current !== requestId) return;
      setLoadingMessages(false);
    }
  }

  async function handleDelete(id: string) {
    const confirmed = await confirmDestructive({
      title: t('chatsDeleteConfirmTitle'),
      text: t('chatsDeleteConfirm'),
      confirmText: t('chatsDelete'),
      cancelText: t('confirmCancel'),
    });
    if (!confirmed) return;
    setDeletingId(id);
    try {
      await deleteConversation(id);
      if (selectedId === id) {
        resetSelection();
      }
    } catch (error) {
      console.error('Error deleting conversation:', error);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleResume(conversationId: string) {
    const scope = loadedMessagesScope.current;
    if (!userId || useUser.getState().uid !== userId || scope?.userId !== userId || scope.conversationId !== conversationId) return;
    const conversation = conversations.find(conv => conv.id === conversationId);
    if (!conversation) return;

    const resolvedAgent = [...availablePresets, ...availablePersonal].find(
      agent => agent.id === conversation.agentId
    );
    if (!resolvedAgent) {
      window.alert(t('conversationAgentMissing'));
      return;
    }
    disconnect();
    setCurrent(resolvedAgent);

    setResumeConversation({
      userId,
      conversationId: conversation.id,
      agentId: conversation.agentId,
      agentName:
        conversation.agentName ||
        resolvedAgent.name ||
        t('chatsAssistant'),
      messages: messages.map(message => ({
        role: message.role,
        text: message.text,
      })),
    });
    resetSelection();
    setShowSidebar(false);
  }

  function handleNewChat() {
    disconnect();
    resetSelection();
    setShowSidebar(false);
  }

  if (!showSidebar) return null;

  const canShowChats = authReady && isAuthenticated;

  return (
    <>
      <div className="sidebar__overlay" onClick={() => setShowSidebar(false)} />
    <aside className="sidebar">
      <div className="sidebar__header">
        <h2 className="sidebar__title">{t('chatsTitle')}</h2>
        <button
          type="button"
          className="sidebar__closeBtn"
          onClick={() => setShowSidebar(false)}
          aria-label="Close sidebar"
        >
          <span className="icon">close</span>
        </button>
      </div>

      <button
        type="button"
        className="sidebar__newChatBtn"
        onClick={handleNewChat}
      >
        <span className="icon">add_comment</span>
        {t('newChat')}
      </button>

      <div className="sidebar__content">
        {selectedId ? (
          <div className="sidebar__detail">
            <div className="sidebar__detailHeader">
              <button
                type="button"
                className="sidebar__backBtn"
                onClick={resetSelection}
              >
                <span className="icon">arrow_back</span>
              </button>
              <div className="sidebar__detailActions">
                <button
                  type="button"
                  className="button primary sidebar__resumeBtn"
                  onClick={() => void handleResume(selectedId)}
                  disabled={loadingMessages}
                >
                  <span className="icon">play_arrow</span>
                  {t('chatsResume')}
                </button>
                {conversations.find(conv => conv.id === selectedId) && (
                  <button
                    type="button"
                    className="sidebar__deleteBtn"
                    onClick={() => handleDelete(selectedId)}
                    disabled={
                      isConversationActive(
                        conversations.find(conv => conv.id === selectedId)?.endedAt ?? null
                      ) || deletingId === selectedId
                    }
                    title={t('chatsDelete')}
                  >
                    <span className="icon">delete</span>
                  </button>
                )}
              </div>
            </div>

            <div className="sidebar__detailInfo">
              <strong>
                {conversations.find(conv => conv.id === selectedId)?.agentName ||
                  t('chatsAssistant')}
              </strong>
              <small>
                {formatDate(
                  conversations.find(conv => conv.id === selectedId)?.startedAt || 0
                )}
              </small>
            </div>

            {loadingMessages ? (
              <p className="sidebar__emptyMsg">{t('chatsLoading')}</p>
            ) : messages.length === 0 ? (
              <p className="sidebar__emptyMsg">{t('chatsNoMessages')}</p>
            ) : (
              <div className="sidebar__messages">
                {messages.map(msg => (
                  <div
                    key={msg.id}
                    className={c('sidebar__message', {
                      'sidebar__message--user': msg.role === 'user',
                      'sidebar__message--assistant': msg.role === 'assistant',
                    })}
                  >
                    <span className="sidebar__messageRole">
                      {msg.role === 'user' ? t('chatsYou') : t('chatsAssistant')}
                    </span>
                    <p className="sidebar__messageText">{msg.text}</p>
                    <span className="sidebar__messageTime">
                      {formatDate(msg.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {!canShowChats ? (
              <p className="sidebar__emptyMsg">{t('chatsEmpty')}</p>
            ) : conversations.length === 0 ? (
              <p className="sidebar__emptyMsg">{t('chatsEmpty')}</p>
            ) : (
              <ul className="sidebar__list">
                {conversations.map(conv => (
                  <li key={conv.id} className="sidebar__item">
                    <button
                      type="button"
                      className="sidebar__itemMain"
                      onClick={() => openConversation(conv.id)}
                    >
                      <span className="sidebar__itemIcon">
                        <span className="icon">forum</span>
                      </span>
                      <span className="sidebar__itemInfo">
                        <strong>{conv.agentName || t('chatsAssistant')}</strong>
                        <small>{formatDate(conv.startedAt)}</small>
                        <small>
                          {conv.messageCount} {t('chatsMessages')}
                          {' · '}
                          {conv.endedAt ? t('chatsEnded') : t('chatsActive')}
                        </small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="sidebar__itemDelete"
                      onClick={() => handleDelete(conv.id)}
                      disabled={
                        isConversationActive(conv.endedAt) ||
                        deletingId === conv.id
                      }
                      title={
                        isConversationActive(conv.endedAt)
                          ? t('chatsDeleteDisabled')
                          : t('chatsDelete')
                      }
                    >
                      <span className="icon">delete</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </aside>
    </>
  );
}

export default Sidebar;
