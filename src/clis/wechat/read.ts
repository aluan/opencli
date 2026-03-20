import { execSync, spawnSync } from 'node:child_process';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const readCommand = cli({
  site: 'wechat',
  name: 'read',
  description: 'Read the current chat content by selecting all and copying',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['Content'],
  func: async (page: IPage | null) => {
    try {
      // Backup clipboard
      let clipBackup = '';
      try {
        clipBackup = execSync('pbpaste', { encoding: 'utf-8' });
      } catch { /* clipboard may be empty */ }

      let running = execSync("osascript -e 'application \"WeChat\" is running'", { encoding: 'utf-8' }).trim();
      if (running !== 'true') {
        try {
          execSync('open -a "WeChat"');
        } catch {}
        execSync("osascript -e 'delay 0.5'");
        running = execSync("osascript -e 'application \"WeChat\" is running'", { encoding: 'utf-8' }).trim();
        if (running !== 'true') {
          return [{ Content: 'WeChat is not running' }];
        }
      }

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
          if (frontmost === 'WeChat') break;
          execSync("osascript -e 'delay 0.2'");
        }
        if (frontmost !== 'WeChat') {
          return [{ Content: `WeChat not frontmost (frontmost=${frontmost || 'unknown'})` }];
        }
      }

      // Click on the chat area to focus (best-effort)
      try {
        execSync(
          "osascript " +
          "-e 'tell application \"System Events\"' " +
          "-e 'tell application process \"WeChat\"' " +
          "-e 'set frontWin to front window' " +
          "-e 'set winPos to position of frontWin' " +
          "-e 'set winSize to size of frontWin' " +
          "-e 'set clickX to (item 1 of winPos) + (item 1 of winSize) * 0.66' " +
          "-e 'set clickY to (item 2 of winPos) + (item 2 of winSize) * 0.45' " +
          "-e 'click at {clickX, clickY}' " +
          "-e 'end tell' " +
          "-e 'end tell'",
          { stdio: 'ignore' }
        );
      } catch {}

      execSync("osascript -e 'delay 0.2'");

      const a11yEnabled = execSync("osascript -e 'tell application \"System Events\" to UI elements enabled'", { encoding: 'utf-8' }).trim();
      if (a11yEnabled !== 'true') {
        return [{ Content: 'Accessibility permission required (System Settings > Privacy & Security > Accessibility)' }];
      }

      // Read visible texts via Accessibility (Cmd+A/C not supported in WeChat chat view)
      const appleScript = [
        'using terms from application "System Events"',
        'global results, maxDepth, maxItems',
        'set results to {}',
        'set maxDepth to 8',
        'set maxItems to 2000',
        'on addText(v)',
        'global results',
        'if v is missing value then return',
        'try',
        'set s to v as text',
        'on error',
        'return',
        'end try',
        'if s is "" then return',
        'if s is "组" then return',
        'set end of results to s',
        'end addText',
        'on walk(el, depth)',
        'global results, maxDepth, maxItems',
        'if depth > maxDepth then return',
        'if (count of results) > maxItems then return',
        'try',
        'set r to role of el',
        'if r is "AXStaticText" or r is "AXTextArea" or r is "AXTextField" or r contains "Text" then',
        'try',
        'my addText(value of el)',
        'end try',
        'try',
        'my addText(title of el)',
        'end try',
        'try',
        'my addText(description of el)',
        'end try',
        'try',
        'my addText(name of el)',
        'end try',
        'else if r is "AXGroup" then',
        'try',
        'my addText(value of el)',
        'end try',
        'try',
        'my addText(title of el)',
        'end try',
        'try',
        'my addText(description of el)',
        'end try',
        'try',
        'my addText(name of el)',
        'end try',
        'end if',
        'end try',
        'try',
        'repeat with c in (UI elements of el)',
        'my walk(c, depth + 1)',
        'if (count of results) > maxItems then exit repeat',
        'end repeat',
        'end try',
        'end walk',
        'with timeout of 8 seconds',
        'tell application "System Events"',
        'tell application process "WeChat"',
        'set frontWin to front window',
        'set roots to {}',
        'try',
        'set roots to every scroll area of frontWin',
        'end try',
        'if (count of roots) is 0 then set roots to {frontWin}',
        'repeat with rootEl in roots',
        'my walk(rootEl, 0)',
        'if (count of results) > maxItems then exit repeat',
        'end repeat',
        'end tell',
        'end tell',
        'set text item delimiters to linefeed',
        'return results as text',
        'end timeout',
        'end using terms from',
      ].join('\n');
      let content = execSync(
        "osascript <<'APPLESCRIPT'\n" + appleScript + '\nAPPLESCRIPT',
        { encoding: 'utf-8' }
      ).trim();

      const a11yUseful = Boolean(content) && !/^(组\\s*)+$/u.test(content);

      if (!a11yUseful) {
        // Fallback: try menu "Select All" + "Copy"
        try {
          execSync(
            "osascript " +
            "-e 'tell application \"System Events\"' " +
            "-e 'tell application process \"WeChat\"' " +
            "-e 'click menu item \"全选\" of menu 1 of menu bar item \"文件\" of menu bar 1' " +
            "-e 'delay 0.2' " +
            "-e 'click menu item \"拷贝\" of menu 1 of menu bar item \"编辑\" of menu bar 1' " +
            "-e 'end tell' " +
            "-e 'end tell'",
            { stdio: 'ignore' }
          );
          execSync("osascript -e 'delay 0.2'");
          const pasted = execSync('pbpaste', { encoding: 'utf-8' }).trim();
          if (pasted && pasted !== clipBackup) {
            content = pasted;
          }
        } catch {}
      }

      // Restore clipboard
      if (clipBackup) {
        spawnSync('pbcopy', { input: clipBackup });
      }

      return [{ Content: content || '(no content captured)' }];
    } catch (err: any) {
      const stderr = err?.stderr ? String(err.stderr).trim() : '';
      const stdout = err?.stdout ? String(err.stdout).trim() : '';
      const detail = [err?.message, stderr, stdout].filter(Boolean).join(' | ');
      return [{ Content: 'Error: ' + detail }];
    }
  },
});
