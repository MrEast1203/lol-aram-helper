// Console logger that also appends to a file (userData/app.log), so problems seen in a
// real game can be looked at afterwards. The file starts over once it passes maxBytes.
const fs = require('fs');
const path = require('path');
const util = require('util');

function createLog(file, maxBytes = 1024 * 1024) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.statSync(file).size > maxBytes) fs.rmSync(file);
  } catch {}
  const write = (level, args) => {
    try {
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${util.format(...args)}\n`);
    } catch {}
  };
  return {
    info: (...args) => (console.log(...args), write('INFO', args)),
    warn: (...args) => (console.warn(...args), write('WARN', args)),
    error: (...args) => (console.error(...args), write('ERROR', args)),
  };
}

module.exports = { createLog };
