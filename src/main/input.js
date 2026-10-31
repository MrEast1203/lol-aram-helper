// Global keyboard/mouse hook: Tab for the build panel, a scan hotkey, clicks for
// augment picks. It only listens; nothing is ever sent to the game.
const { EventEmitter } = require('events');

class GlobalInput extends EventEmitter {
  constructor(log = console, getScanHotkey = () => null) {
    super();
    this.log = log;
    this.getScanHotkey = getScanHotkey;
    this.tabDown = false;
    this.hotkeyDown = false;
    this.hook = null;
  }

  start() {
    try {
      const { uIOhook, UiohookKey } = require('uiohook-napi');
      this.hook = uIOhook;
      const hotkeyCode = () => UiohookKey[this.getScanHotkey()] ?? null;
      uIOhook.on('keydown', (e) => {
        if (e.keycode === UiohookKey.Tab && !this.tabDown) {
          this.tabDown = true;
          this.emit('tab', true);
        } else if (e.keycode === hotkeyCode() && !this.hotkeyDown) {
          this.hotkeyDown = true;
          this.emit('scanHotkey');
        }
      });
      uIOhook.on('keyup', (e) => {
        if (e.keycode === UiohookKey.Tab && this.tabDown) {
          this.tabDown = false;
          this.emit('tab', false);
        } else if (e.keycode === hotkeyCode()) {
          this.hotkeyDown = false;
        }
      });
      uIOhook.on('mousedown', (e) => {
        if (e.button === 1) this.emit('click', e.x, e.y);
      });
      uIOhook.start();
      return true;
    } catch (e) {
      this.log.error('[input] global hook unavailable', e);
      return false;
    }
  }

  stop() {
    try {
      this.hook?.stop();
    } catch {}
  }
}

module.exports = { GlobalInput };
