// ============================================================
// DiaLux — Chatbot widget
// Talks to /api/chat (Groq). Conversation persists in localStorage.
// Features: open/close, send, clear history, typing dots, FAQ chips.
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  console.log('[chatbot] script loaded');

  const chatWidget = document.getElementById('chatbot-widget');
  if (!chatWidget) {
    console.warn('[chatbot] widget not found in DOM');
    return;
  }

  const toggleBtn     = document.getElementById('chat-toggle-btn');
  const closeBtn      = document.getElementById('chat-close-btn');
  const clearBtn      = document.getElementById('chat-clear-btn');
  const chatWindow    = document.getElementById('chat-window');
  const chatMessages  = document.getElementById('chat-messages');
  const chatForm      = document.getElementById('chat-form');
  const chatInput     = document.getElementById('chat-input');
  const suggestions   = document.getElementById('chat-suggestions');

  const GREETING = "Hi! I'm DiaLux Assistant 👋 Ask me about our devices, rental plans, prices, delivery, or how returns work. Tap a suggestion below or type your own question.";

  let conversation = [];
  try {
    conversation = JSON.parse(localStorage.getItem('dialux-chat-history')) || [];
  } catch {
    conversation = [];
  }

  /* ---------------- rendering ---------------- */

  const renderMessage = (role, content) => {
    const el = document.createElement('div');
    el.className = `chat-msg ${role === 'assistant' ? 'bot' : role}`;
    el.textContent = content;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return el;
  };

  const showTyping = () => {
    const el = document.createElement('div');
    el.className = 'chat-msg bot chat-typing';
    el.id = 'chat-typing-indicator';
    el.innerHTML = '<span></span><span></span><span></span>';
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  };

  const hideTyping = () => {
    document.getElementById('chat-typing-indicator')?.remove();
  };

  const clearMessages = () => {
    chatMessages.innerHTML = '';
  };

  /* ---------------- suggestions visibility ---------------- */

  // Show chips only when the user hasn't sent anything yet.
  const updateSuggestions = () => {
    if (!suggestions) return;
    const userHasSpoken = conversation.some(m => m.role === 'user');
    suggestions.classList.toggle('hidden', userHasSpoken);
  };

  /* ---------------- initial paint ---------------- */

  if (conversation.length === 0) {
    renderMessage('assistant', GREETING);
  } else {
    conversation.forEach(msg => renderMessage(msg.role, msg.content));
  }
  updateSuggestions();

  /* ---------------- open / close ---------------- */

  toggleBtn.addEventListener('click', () => {
    chatWindow.classList.toggle('hidden');
    if (!chatWindow.classList.contains('hidden')) chatInput.focus();
  });

  closeBtn.addEventListener('click', () => {
    chatWindow.classList.add('hidden');
  });

  /* ---------------- clear history ---------------- */

  clearBtn?.addEventListener('click', () => {
    if (!confirm('Clear this conversation? This cannot be undone.')) return;
    conversation = [];
    localStorage.removeItem('dialux-chat-history');
    clearMessages();
    renderMessage('assistant', GREETING);
    updateSuggestions();
    chatInput.focus();
  });

  /* ---------------- send ---------------- */

  const sendMessage = async (text) => {
    const userMessage = String(text || '').trim();
    if (!userMessage) return;

    renderMessage('user', userMessage);
    conversation.push({ role: 'user', content: userMessage });
    chatInput.value = '';
    updateSuggestions();

    showTyping();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversation }),
      });

      hideTyping();

      if (!res.ok) throw new Error('Failed to get response');
      const data = await res.json();

      renderMessage('assistant', data.result);
      conversation.push({ role: 'assistant', content: data.result });
      localStorage.setItem('dialux-chat-history', JSON.stringify(conversation));
    } catch (err) {
      hideTyping();
      renderMessage('assistant', "Sorry, I'm having trouble connecting right now. Please try again later.");
      console.error('[chatbot] error:', err);
    }
  };

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage(chatInput.value);
  });

  /* ---------------- suggestion chips ---------------- */

  suggestions?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-q]');
    if (!btn) return;
    sendMessage(btn.dataset.q);
  });

  /* ---------------- keyboard ---------------- */

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') chatWindow.classList.add('hidden');
  });
});