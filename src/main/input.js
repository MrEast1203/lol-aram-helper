// Global keyboard hook: Tab for the build panel and the scan / hide hotkeys.
// It only listens; nothing is ever sent to the game.
const { EventEmitter } = require('events');

class GlobalInput extends EventEmitter {
  // getHotkeys() -> { scan: 'F7', hide: 'F8' } (uiohook key names)
  constructor(log = console, getHotkeys = () => ({})) {
    super();
    this.log = log;
    this.getHotkeys = getHotkeys;
    this.down = new Set();
    this.hook = null;
  }

  start() {
    try {
      const { uIOhook, UiohookKey } = require('uiohook-napi');
      this.hook = uIOhook;
      uIOhook.on('keydown', (e) => {
        if (this.down.has(e.keycode)) return; // ignore key repeat
        this.down.add(e.keycode);
        if (e.keycode === UiohookKey.Tab) return this.emit('tab', true);
        for (const [action, key] of Object.entries(this.getHotkeys())) {
          if (e.keycode === UiohookKey[key]) this.emit('hotkey', action);
        }
      });
      uIOhook.on('keyup', (e) => {
        this.down.delete(e.keycode);
        if (e.keycode === UiohookKey.Tab) this.emit('tab', false);
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
