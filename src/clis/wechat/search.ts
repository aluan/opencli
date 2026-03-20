import { execSync, spawnSync } from 'node:child_process';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const searchCommand = cli({
  site: 'wechat',
  name: 'search',
  description: 'Open WeChat search and type a query (find contacts or messages)',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [{ name: 'query', required: true, positional: true, help: 'Search query (contact name or keyword)' }],
  columns: ['Status'],
  func: async (page: IPage | null, kwargs: any) => {
    const query = kwargs.query as string;
    try {
      let running = execSync("osascript -e 'application \"WeChat\" is running'", { encoding: 'utf-8' }).trim();
      if (running !== 'true') {
        // Launch WeChat if not running
        try {
          execSync('open -a "WeChat"');
        } catch {}
        execSync("osascript -e 'delay 0.5'");
        running = execSync("osascript -e 'application \"WeChat\" is running'", { encoding: 'utf-8' }).trim();
        if (running !== 'true') {
          return [{ Status: 'WeChat is not running' }];
        }
      }

      // Backup clipboard
      let clipBackup = '';
      try {
        clipBackup = execSync('pbpaste', { encoding: 'utf-8' });
      } catch { /* clipboard may be empty */ }

      // Copy query to clipboard for reliable input (IME/emoji safe)
      spawnSync('pbcopy', { input: query });

      const isWeChatFrontmost = (name: string) => {
        const n = (name || '').trim();
        if (!n) return false;
        return n === 'WeChat' || n === '微信' || n.includes('WeChat') || n.includes('微信');
      };

      // Activate WeChat and wait until it is frontmost
      let frontmost = '';
      for (let i = 0; i < 12; i++) {
        execSync("osascript -e 'tell application \"WeChat\" to activate'");
        execSync("osascript -e 'delay 0.2'");
        frontmost = execSync(
          "osascript -e 'tell application \"System Events\" to get name of first application process whose frontmost is true'",
          { encoding: 'utf-8' }
        ).trim();
        if (isWeChatFrontmost(frontmost)) break;
        execSync("osascript -e 'delay 0.2'");
      }
      if (!isWeChatFrontmost(frontmost)) {
        // Try launching to front as a fallback
        try {
          execSync('open -a "WeChat"');
        } catch {}
        execSync("osascript -e 'delay 0.5'");
        for (let i = 0; i < 10; i++) {
          execSync("osascript -e 'tell application \"WeChat\" to activate'");
          execSync("osascript -e 'delay 0.2'");
          frontmost = execSync(
            "osascript -e 'tell application \"System Events\" to get name of first application process whose frontmost is true'",
            { encoding: 'utf-8' }
          ).trim();
          if (isWeChatFrontmost(frontmost)) break;
          execSync("osascript -e 'delay 0.2'");
        }
        if (!isWeChatFrontmost(frontmost)) {
          if (clipBackup) {
            spawnSync('pbcopy', { input: clipBackup });
          }
          return [{ Status: `WeChat not frontmost (frontmost=${frontmost || 'unknown'})` }];
        }
      }

      // Cmd+F to open search (WeChat Mac uses Cmd+F for search)
      execSync(
        "osascript " +
        "-e 'tell application \"System Events\"' " +
        "-e 'keystroke \"f\" using command down' " +
        "-e 'delay 0.5' " +
        "-e 'keystroke \"v\" using command down' " +
        "-e 'delay 0.2' " +
        "-e 'keystroke return' " +
        "-e 'end tell'"
      );

      // Restore clipboard
      if (clipBackup) {
        spawnSync('pbcopy', { input: clipBackup });
      }

      return [{ Status: `Searching for: ${query}` }];
    } catch (err: any) {
      const stderr = err?.stderr ? String(err.stderr).trim() : '';
      const stdout = err?.stdout ? String(err.stdout).trim() : '';
      const detail = [err?.message, stderr, stdout].filter(Boolean).join(' | ');
      return [{ Status: 'Error: ' + detail }];
    }
  },
});
