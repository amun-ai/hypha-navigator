/**
 * Scoped CSS for the debug overlay, injected into Shadow DOM.
 */
export const overlayStyles = `
  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  .debugger-icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: #4a90d9;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    transition: transform 0.15s, background 0.15s;
    user-select: none;
    font-size: 18px;
    line-height: 1;
  }

  .debugger-icon:hover {
    transform: scale(1.1);
    background: #357abd;
  }

  .debugger-icon.connected {
    background: #27ae60;
  }

  .debugger-icon.error {
    background: #e74c3c;
  }

  .debugger-panel {
    display: none;
    width: 380px;
    max-height: 520px;
    background: #1e1e2e;
    color: #cdd6f4;
    border-radius: 8px;
    border: 1px solid #45475a;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    flex-direction: column;
    position: absolute;
    bottom: 50px;
    right: 0;
    font-size: 13px;
  }

  .debugger-panel.open {
    display: flex;
  }

  .panel-header {
    background: #313244;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: default;
    border-bottom: 1px solid #45475a;
    font-weight: 600;
    font-size: 12px;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: #a6adc8;
  }

  .panel-header .title {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .panel-header .close-btn {
    cursor: pointer;
    color: #6c7086;
    font-size: 16px;
    line-height: 1;
    padding: 2px 4px;
    border-radius: 3px;
  }

  .panel-header .close-btn:hover {
    color: #cdd6f4;
    background: #45475a;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    background: #6c7086;
  }

  .status-dot.connected {
    background: #a6e3a1;
  }

  .status-dot.error {
    background: #f38ba8;
  }

  .panel-body {
    padding: 10px 12px;
    overflow-y: auto;
    flex: 1;
    max-height: 440px;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    border-bottom: 1px solid #313244;
    font-size: 12px;
  }

  .info-row .label {
    color: #6c7086;
  }

  .info-row .value {
    color: #cdd6f4;
    text-align: right;
    word-break: break-all;
    max-width: 180px;
    font-family: 'SF Mono', Monaco, Consolas, monospace;
    font-size: 11px;
  }

  .instructions-section {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid #313244;
  }

  .instructions-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .url-label {
    font-size: 11px;
    color: #6c7086;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 3px;
  }

  .instructions-block {
    font-family: 'SF Mono', Monaco, Consolas, monospace;
    font-size: 10px;
    color: #a6e3a1;
    background: #11111b;
    border: 1px solid #313244;
    border-radius: 4px;
    padding: 8px;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
    line-height: 1.5;
  }

  .copy-btn {
    background: #45475a;
    color: #cdd6f4;
    border: none;
    border-radius: 3px;
    padding: 2px 8px;
    font-size: 10px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .copy-btn:hover {
    background: #585b70;
  }

  .log-section {
    margin-top: 8px;
  }

  .log-title {
    font-size: 11px;
    color: #6c7086;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }

  .log-entry {
    font-family: 'SF Mono', Monaco, Consolas, monospace;
    font-size: 11px;
    padding: 3px 6px;
    border-radius: 3px;
    background: #313244;
    margin-bottom: 2px;
    color: #a6adc8;
    word-break: break-all;
  }

  .log-entry.call {
    border-left: 2px solid #89b4fa;
  }

  .log-entry.result {
    border-left: 2px solid #a6e3a1;
  }

  .log-entry.error {
    border-left: 2px solid #f38ba8;
    color: #f38ba8;
  }
`;
