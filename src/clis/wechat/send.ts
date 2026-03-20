import { execSync, spawnSync } from 'node:child_process';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const sendCommand = cli({
  site: 'wechat',
  name: 'send',
  description: 'Send a message in the active WeChat conversation via clipboard paste',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'text', required: true, positional: true, help: 'Message to send' },
    { name: 'send-key', required: false, positional: false, help: 'Send hotkey: enter | cmd-enter | ctrl-enter | auto', default: 'enter' },
  ],
  columns: ['Status'],
  func: async (page: IPage | null, kwargs: any) => {
    const text = kwargs.text as string;
    try {
      const running = execSync("osascript -e 'application \"WeChat\" is running'", { encoding: 'utf-8' }).trim();
      if (running !== 'true') {
        return [{ Status: 'WeChat is not running' }];
      }
      const sendKeyRaw = String(kwargs['send-key'] ?? kwargs.sendKey ?? process.env.OPENCLI_WECHAT_SEND_KEY ?? 'enter');
      const sendKey = sendKeyRaw.toLowerCase();
      const sendKeySteps: string[] = [];
      if (sendKey === 'cmd-enter' || sendKey === 'cmd+enter') {
        sendKeySteps.push("-e 'keystroke return using command down' ");
      } else if (sendKey === 'ctrl-enter' || sendKey === 'ctrl+enter') {
        sendKeySteps.push("-e 'keystroke return using control down' ");
      } else if (sendKey === 'auto') {
        sendKeySteps.push("-e 'keystroke return' ");
        sendKeySteps.push("-e 'delay 0.15' ");
        sendKeySteps.push("-e 'keystroke return using command down' ");
      } else {
        sendKeySteps.push("-e 'keystroke return' ");
      }

      // Backup clipboard
      let clipBackup = '';
      try {
        clipBackup = execSync('pbpaste', { encoding: 'utf-8' });
      } catch { /* clipboard may be empty */ }

      // Copy text to clipboard
      spawnSync('pbcopy', { input: text });

      // Activate WeChat and wait until it is frontmost
      let frontmost = '';
      for (let i = 0; i < 12; i++) {
        execSync("osascript -e 'tell application \"WeChat\" to activate'");
        execSync("osascript -e 'delay 0.2'");
        frontmost = execSync(
          "osascript -e 'tell application \"System Events\" to get name of first application process whose frontmost is true'",
          { encoding: 'utf-8' }
        ).trim();
        if (frontmost === 'WeChat') break;
        execSync("osascript -e 'delay 0.2'");
      }
      if (frontmost !== 'WeChat') {
        return [{ Status: `WeChat not frontmost (frontmost=${frontmost || 'unknown'})` }];
      }

      // Try to focus the message input via accessibility first (best-effort)
      try {
        execSync(
          "osascript " +
          "-e 'tell application \"System Events\"' " +
          "-e 'tell application process \"WeChat\"' " +
          "-e 'set frontmost to true' " +
          "-e 'set focused of (first text area of front window) to true' " +
          "-e 'end tell' " +
          "-e 'end tell'",
          { stdio: 'ignore' }
        );
        execSync("osascript -e 'delay 0.1'");
      } catch {}
      try {
        execSync(
          "osascript " +
          "-e 'tell application \"System Events\"' " +
          "-e 'tell application process \"WeChat\"' " +
          "-e 'set frontmost to true' " +
          "-e 'set focused of (first text field of front window) to true' " +
          "-e 'end tell' " +
          "-e 'end tell'",
          { stdio: 'ignore' }
        );
        execSync("osascript -e 'delay 0.1'");
      } catch {}

      let canClick = true;
      try {
        const winCount = parseInt(
          execSync(
            "osascript -e 'tell application \"System Events\" to count windows of application process \"WeChat\"'",
            { encoding: 'utf-8' }
          ).trim(),
          10
        );
        if (!Number.isFinite(winCount) || winCount <= 0) canClick = false;
      } catch { canClick = false; }

      if (canClick) {
        try {
          // Click inside the input area to ensure focus (best-effort)
          execSync(
            "osascript " +
            "-e 'tell application \"System Events\"' " +
            "-e 'tell application process \"WeChat\"' " +
            "-e 'set frontWin to front window' " +
            "-e 'set winPos to position of frontWin' " +
            "-e 'set winSize to size of frontWin' " +
            "-e 'set clickX to (item 1 of winPos) + (item 1 of winSize) * 0.66' " +
            "-e 'set clickY to (item 2 of winPos) + (item 2 of winSize) * 0.88' " +
            "-e 'click at {clickX, clickY}' " +
            "-e 'end tell' " +
            "-e 'end tell'",
            { stdio: 'ignore' }
          );
          execSync("osascript -e 'delay 0.2'");
        } catch { /* window access may be blocked */ }
      }

      execSync(
        "osascript " +
        "-e 'tell application \"System Events\"' " +
        "-e 'keystroke \"v\" using command down' " +
        "-e 'delay 0.2' " +
        sendKeySteps.join('') +
        "-e 'end tell'"
      );

      // Restore clipboard
      if (clipBackup) {
        spawnSync('pbcopy', { input: clipBackup });
      }

      const note = canClick ? '' : ' (no window access)';
      return [{ Status: `Sent (Cmd+V + Enter)${note}` }];
    } catch (err: any) {
      const stderr = err?.stderr ? String(err.stderr).trim() : '';
      const stdout = err?.stdout ? String(err.stdout).trim() : '';
      const detail = [err?.message, stderr, stdout].filter(Boolean).join(' | ');
      return [{ Status: 'Error: ' + detail }];
    }
  },
});
