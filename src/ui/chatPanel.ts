import * as vscode from 'vscode';
import { AiReporter } from '../ai/reporter';
import { WorkUnit } from '../types';
import * as path from 'path';

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
  ): void {
    if (ChatPanel.currentPanel) {
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

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ACM Chat</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
      height: 100vh;
      padding: 12px;
    }
    h2 {
      margin-bottom: 12px;
      color: var(--vscode-textLink-foreground);
      font-size: 1.1em;
    }
    #messages {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 12px;
    }
    .message {
      padding: 10px 14px;
      border-radius: 8px;
      max-width: 90%;
      line-height: 1.5;
      white-space: pre-wrap;
    }
    .message.user {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      align-self: flex-end;
    }
    .message.assistant {
      background: var(--vscode-editor-inactiveSelectionBackground);
      align-self: flex-start;
    }
    .input-row {
      display: flex;
      gap: 8px;
    }
    input {
      flex: 1;
      padding: 8px 12px;
      border-radius: 4px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-size: inherit;
      outline: none;
    }
    input:focus { border-color: var(--vscode-focusBorder); }
    button {
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: inherit;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .placeholder {
      text-align: center;
      color: var(--vscode-descriptionForeground);
      margin: auto;
      padding: 20px;
    }
    .placeholder p { margin-bottom: 8px; }
  </style>
</head>
<body>
  <h2>$(comment) Ask About My Work</h2>
  <div id="messages">
    <div class="placeholder">
      <p>💬 Ask anything about your recent work.</p>
      <p>Examples:<br>"What did I work on this week?"<br>"How many bugs did I fix last month?"</p>
    </div>
  </div>
  <div class="input-row">
    <input id="input" type="text" placeholder="Ask a question..." />
    <button onclick="sendQuestion()">Ask</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const input = document.getElementById('input');
    const messages = document.getElementById('messages');

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendQuestion();
    });

    function sendQuestion() {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      vscode.postMessage({ type: 'question', text });
    }

    window.addEventListener('message', (event) => {
      const { type, history } = event.data;
      if (type === 'history') {
        messages.innerHTML = '';
        history.forEach((entry) => {
          const div = document.createElement('div');
          div.className = 'message ' + entry.role;
          div.textContent = entry.content;
          messages.appendChild(div);
        });
        messages.scrollTop = messages.scrollHeight;
      }
    });
  </script>
</body>
</html>`;
  }
}
