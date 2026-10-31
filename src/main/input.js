// Global keyboard/mouse hook (Tab key for the build panel, clicks for augment picks).
const { EventEmitter } = require('events');

class GlobalInput extends EventEmitter {
  constructor(log = console) {
    super();
    this.log = log;
    this.tabDown = false;
    this.hook = null;
  }

  start() {
    try {
      const { uIOhook, UiohookKey } = require('uiohook-napi');
      this.hook = uIOhook;
      uIOhook.on('keydown', (e) => {
        if (e.keycode === UiohookKey.Tab && !this.tabDown) {
          this.tabDown = true;
          this.emit('tab', true);
        }
      });
      uIOhook.on('keyup', (e) => {
        if (e.keycode === UiohookKey.Tab && this.tabDown) {
          this.tabDown = false;
          this.emit('tab', false);
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
