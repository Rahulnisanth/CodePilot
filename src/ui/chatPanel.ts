import * as vscode from 'vscode';
import { AiReporter } from '../ai/reporter';
import { WorkUnit } from '../types';

/**
 * Natural Language Q&A Panel — allows devs to ask questions about their work.
 * E.g. "What did I work on this week?"
 */
export class ChatPanel {
  static currentPanel: ChatPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private conversationHistory: Array<{
    role: 'user' | 'assistant';
    content: string;
  }> = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly aiReporter: AiReporter,
    private readonly workUnits: WorkUnit[],
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'acmChat',
      'ACM: Ask About My Work',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'question') {
        await this.handleQuestion(message.text);
      } else if (message.type === 'clear') {
        this.conversationHistory = [];
      }
    });

    this.panel.onDidDispose(() => {
      ChatPanel.currentPanel = undefined;
    });
  }

  static show(
    context: vscode.ExtensionContext,
    aiReporter: AiReporter,
    workUnits: WorkUnit[],
    startFresh = false,
  ): void {
    if (ChatPanel.currentPanel) {
      if (startFresh) {
        ChatPanel.currentPanel.conversationHistory = [];
        ChatPanel.currentPanel.panel.webview.postMessage({ type: 'reset' });
      }
      ChatPanel.currentPanel.panel.reveal(vscode.ViewColumn.Two);
      return;
    }
    ChatPanel.currentPanel = new ChatPanel(context, aiReporter, workUnits);
  }

  private async handleQuestion(question: string): Promise<void> {
    this.conversationHistory.push({ role: 'user', content: question });

    // Build context from work units
    const context = this.buildContext();

    try {
      const answer = await this.aiReporter.answerQuestion(question, context);
      this.conversationHistory.push({ role: 'assistant', content: answer });
    } catch {
      const error = 'Unable to process your question. Please try again.';
      this.conversationHistory.push({ role: 'assistant', content: error });
    }

    this.panel.webview.postMessage({
      type: 'history',
      history: this.conversationHistory,
    });
  }

  private buildContext(): string {
    if (this.workUnits.length === 0) {
      return 'No work units found. The developer has not committed any changes recently.';
    }

    return this.workUnits
      .slice(0, 20) // limit context size
      .map(
        (u) =>
          `- Task: "${u.name}" [${u.type}] — ${u.commits.length} commit(s) across ${u.repos.join(', ')}`,
      )
      .join('\n');
  }

  private getEmptyStateHtml(): string {
    return `
    <svg class="empty-icon" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
    </svg>
    <h3>Ask about your work</h3>
    <p>Explore your commits, bugs,<br>and activity across any time range.</p>
    <div class="chip-grid">
      <button class="chip" onclick="useChip(this)">What did I work on this week?</button>
      <button class="chip" onclick="useChip(this)">How many bugs did I fix last month?</button>
      <button class="chip" onclick="useChip(this)">Summarize my recent commits</button>
      <button class="chip" onclick="useChip(this)">Which files did I change most?</button>
    </div>
  `;
  }

  private getHtml(): string {
    const emptyStateHtml = this.getEmptyStateHtml();
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>ACM Chat</title>
      <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --radius-sm: 6px;
          --radius-md: 10px;
          --radius-lg: 16px;
          --transition: 150ms ease;
        }

        body {
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size, 13px);
          color: var(--vscode-foreground);
          background: var(--vscode-editor-background);
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px 8px;
          border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
          flex-shrink: 0;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 7px;
        }

        .header-icon {
          width: 18px;
          height: 18px;
          opacity: 0.85;
          flex-shrink: 0;
        }

        .header-title {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--vscode-foreground);
          opacity: 0.7;
        }

        .header-actions {
          display: flex;
          gap: 2px;
        }

        .icon-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border: none;
          background: transparent;
          color: var(--vscode-foreground);
          border-radius: var(--radius-sm);
          cursor: pointer;
          opacity: 0.5;
          transition: opacity var(--transition), background var(--transition);
        }

        .icon-btn:hover {
          opacity: 1;
          background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15));
        }

        .icon-btn svg { width: 15px; height: 15px; }

        #messages {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 12px 10px;
          scroll-behavior: smooth;
        }

        #messages::-webkit-scrollbar { width: 4px; }
        #messages::-webkit-scrollbar-track { background: transparent; }
        #messages::-webkit-scrollbar-thumb {
          background: var(--vscode-scrollbarSlider-background, rgba(128,128,128,0.3));
          border-radius: 2px;
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          flex: 1;
          padding: 24px 16px;
          text-align: center;
          gap: 16px;
          animation: fadeIn 0.3s ease;
        }

        .empty-icon {
          width: 36px;
          height: 36px;
          opacity: 0.3;
        }

        .empty-state h3 {
          font-size: 13px;
          font-weight: 600;
          color: var(--vscode-foreground);
          opacity: 0.6;
          margin: 0;
        }

        .empty-state p {
          font-size: 11.5px;
          color: var(--vscode-descriptionForeground);
          line-height: 1.5;
          margin: 0;
        }

        .chip-grid {
          display: flex;
          flex-direction: column;
          gap: 6px;
          width: 100%;
          max-width: 260px;
        }

        .chip {
          padding: 7px 12px;
          border-radius: var(--radius-md);
          border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
          background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.08));
          color: var(--vscode-foreground);
          font-size: 11.5px;
          text-align: left;
          cursor: pointer;
          transition: background var(--transition), border-color var(--transition);
          line-height: 1.4;
          opacity: 0.75;
        }

        .chip:hover {
          background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.15));
          border-color: var(--vscode-focusBorder, rgba(128,128,128,0.5));
          opacity: 1;
        }

        .msg-group {
          display: flex;
          flex-direction: column;
          animation: slideUp 0.2s ease;
        }

        .msg-group.user { align-items: flex-end; margin-top: 10px; }
        .msg-group.assistant { align-items: flex-start; margin-top: 4px; }
        .msg-group.user + .msg-group.user { margin-top: 2px; }

        .msg-role-label {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--vscode-descriptionForeground);
          margin-bottom: 4px;
          padding: 0 4px;
        }

        .message {
          padding: 9px 13px;
          border-radius: var(--radius-md);
          max-width: 92%;
          line-height: 1.55;
          font-size: 13px;
          position: relative;
        }

        .message.user {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border-bottom-right-radius: var(--radius-sm);
        }

        .message.assistant {
          background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.1));
          border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
          border-bottom-left-radius: var(--radius-sm);
        }

        .message code {
          font-family: var(--vscode-editor-font-family, monospace);
          font-size: 11.5px;
          background: rgba(128,128,128,0.18);
          padding: 1px 5px;
          border-radius: 3px;
        }

        .message.user code { background: rgba(255,255,255,0.2); }

        .message pre {
          background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
          border-radius: var(--radius-sm);
          padding: 10px 12px;
          margin-top: 8px;
          overflow-x: auto;
          font-family: var(--vscode-editor-font-family, monospace);
          font-size: 11.5px;
          line-height: 1.6;
          border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
        }

        .message pre code { background: transparent; padding: 0; }

        .msg-actions {
          display: flex;
          justify-content: flex-end;
          margin-top: 3px;
          gap: 4px;
          opacity: 0;
          transition: opacity var(--transition);
        }

        .msg-group:hover .msg-actions { opacity: 1; }

        .msg-action-btn {
          font-size: 10px;
          padding: 2px 7px;
          border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
          background: var(--vscode-editor-background);
          color: var(--vscode-descriptionForeground);
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: background var(--transition);
        }

        .msg-action-btn:hover {
          background: var(--vscode-list-hoverBackground);
          color: var(--vscode-foreground);
        }

        .typing-indicator {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 10px 14px;
          background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.1));
          border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
          border-radius: var(--radius-md);
          border-bottom-left-radius: var(--radius-sm);
          width: fit-content;
          animation: slideUp 0.2s ease;
        }

        .typing-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--vscode-descriptionForeground);
          opacity: 0.4;
          animation: bounce 1.2s infinite ease-in-out;
        }

        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }

        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-5px); opacity: 0.9; }
        }

        .input-area {
          padding: 8px 10px 10px;
          border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
          flex-shrink: 0;
        }

        .input-shell {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
          border-radius: var(--radius-md);
          background: var(--vscode-input-background);
          overflow: hidden;
          transition: border-color var(--transition);
        }

        .input-shell:focus-within {
          border-color: var(--vscode-focusBorder);
        }

        textarea {
          width: 100%;
          min-height: 52px;
          max-height: 160px;
          padding: 9px 12px 4px;
          background: transparent;
          color: var(--vscode-input-foreground);
          border: none;
          outline: none;
          resize: none;
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size, 13px);
          line-height: 1.55;
          overflow-y: auto;
        }

        textarea::placeholder { color: var(--vscode-input-placeholderForeground); }

        textarea::-webkit-scrollbar { width: 4px; }
        textarea::-webkit-scrollbar-thumb {
          background: var(--vscode-scrollbarSlider-background);
          border-radius: 2px;
        }

        .input-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 8px 6px;
        }

        .input-hint {
          font-size: 10.5px;
          color: var(--vscode-descriptionForeground);
          opacity: 0.6;
        }

        .send-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 11px;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: var(--radius-sm);
          cursor: pointer;
          font-size: 12px;
          font-family: var(--vscode-font-family);
          font-weight: 500;
          transition: background var(--transition), opacity var(--transition);
        }

        .send-btn:hover { background: var(--vscode-button-hoverBackground); }
        .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .send-btn svg { width: 13px; height: 13px; }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      </style>
    </head>
    <body>

      <div class="header">
        <div class="header-left">
          <svg class="header-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" fill="currentColor" opacity="0.85"/>
          </svg>
          <span class="header-title">ACM Chat</span>
        </div>
        <div class="header-actions">
          <button class="icon-btn" onclick="clearChat()" title="New chat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
        </div>
      </div>

      <div id="messages">
        <div class="empty-state" id="emptyState">
          ${emptyStateHtml}
        </div>
      </div>

      <div class="input-area">
        <div class="input-shell">
          <textarea id="input" placeholder="Ask a question about your work…" rows="1"></textarea>
          <div class="input-footer">
            <span class="input-hint">⏎ send &nbsp;·&nbsp; ⇧⏎ newline</span>
            <button class="send-btn" id="sendBtn" onclick="sendQuestion()" disabled>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
              Send
            </button>
          </div>
        </div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        const input = document.getElementById('input');
        const messagesEl = document.getElementById('messages');
        const sendBtn = document.getElementById('sendBtn');

        let isWaiting = false;
        let typingEl = null;

        input.addEventListener('input', () => {
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 160) + 'px';
          sendBtn.disabled = !input.value.trim() || isWaiting;
        });

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendQuestion();
          }
        });

        function useChip(btn) {
          input.value = btn.textContent;
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 160) + 'px';
          sendBtn.disabled = false;
          sendQuestion();
        }

        function sendQuestion() {
          const text = input.value.trim();
          if (!text || isWaiting) return;

          hideEmpty();
          appendMessage('user', text);
          input.value = '';
          input.style.height = 'auto';
          sendBtn.disabled = true;
          isWaiting = true;
          showTyping();

          vscode.postMessage({ type: 'question', text });
        }

        function hideEmpty() {
          const emptyState = document.getElementById('emptyState');
          if (emptyState) emptyState.remove();
        }

        function appendMessage(role, content) {
          const group = document.createElement('div');
          group.className = 'msg-group ' + role;

          const label = document.createElement('div');
          label.className = 'msg-role-label';
          label.textContent = role === 'user' ? 'You' : 'ACM';
          group.appendChild(label);

          const bubble = document.createElement('div');
          bubble.className = 'message ' + role;
          bubble.innerHTML = renderContent(content);
          group.appendChild(bubble);

          if (role === 'assistant') {
            const actions = document.createElement('div');
            actions.className = 'msg-actions';
            const copyBtn = document.createElement('button');
            copyBtn.className = 'msg-action-btn';
            copyBtn.textContent = 'Copy';
            copyBtn.onclick = () => {
              navigator.clipboard.writeText(content).then(() => {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
              });
            };
            actions.appendChild(copyBtn);
            group.appendChild(actions);
          }

          messagesEl.appendChild(group);
          scrollToBottom();
          return group;
        }

        function renderContent(text) {
          let escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

          escaped = escaped.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, (_, lang, code) =>
            '<pre><code>' + code.trimEnd() + '</code></pre>'
          );
          escaped = escaped.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
          escaped = escaped.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
          escaped = escaped.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
          escaped = escaped.replace(/\\n/g, '<br>');

          return escaped;
        }

        function showTyping() {
          removeTyping();
          typingEl = document.createElement('div');
          typingEl.className = 'msg-group assistant';
          const ind = document.createElement('div');
          ind.className = 'typing-indicator';
          ind.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
          typingEl.appendChild(ind);
          messagesEl.appendChild(typingEl);
          scrollToBottom();
        }

        function removeTyping() {
          if (typingEl) { typingEl.remove(); typingEl = null; }
        }

        function scrollToBottom() {
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        function clearChat() {
          messagesEl.innerHTML = '';
          isWaiting = false;
          removeTyping();
          sendBtn.disabled = true;

          const es = document.createElement('div');
          es.id = 'emptyState';
          es.className = 'empty-state';
          es.innerHTML = ${JSON.stringify(emptyStateHtml)};
          messagesEl.appendChild(es);
          vscode.postMessage({ type: 'clear' });
        }

        window.addEventListener('message', (event) => {
          const { type, history, answer, error } = event.data;

          if (type === 'history') {
            messagesEl.innerHTML = '';
            if (!history || history.length === 0) return;
            history.forEach((entry) => appendMessage(entry.role, entry.content));
          }

          // Backend-initiated reset (e.g. when show() is called with startFresh=true)
          if (type === 'reset') {
            clearChat();
          }

          if (type === 'answer') {
            removeTyping();
            isWaiting = false;
            sendBtn.disabled = !input.value.trim();
            appendMessage('assistant', answer || '(no response)');
          }

          if (type === 'error') {
            removeTyping();
            isWaiting = false;
            sendBtn.disabled = !input.value.trim();
            appendMessage('assistant', '⚠ ' + (error || 'Something went wrong.'));
          }
        });
      <\/script>
    </body>
    </html>
  `;
  }
}
