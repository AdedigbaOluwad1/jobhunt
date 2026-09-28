const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'win32') {
  fs.chmodSync(path.join(__dirname, '..', 'dist', 'main.js'), 0o755);
}
