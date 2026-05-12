import { execSync } from 'child_process';

// Test the exact same command used in runKeyCheck
try {
  const cmd = 'powershell -NoProfile -NonInteractive -Command "[Reflection.Assembly]::LoadWithPartialName(\'System.Windows.Forms\') | Out-Null; [System.Windows.Forms.Control]::ModifierKeys"';
  const output = execSync(cmd, { timeout: 2000, encoding: 'utf8' }).trim();
  console.log('Raw output:', JSON.stringify(output));
  console.log('Would trigger recovery:', output && output !== 'None' && output.includes('Shift'));
} catch (e) {
  console.error('FAILED:', e.message);
}

// Also test that require would fail in ESM
try {
  const { execSync: es2 } = require('child_process');
  console.log('require() worked (unexpected)');
} catch (e) {
  console.log('require() failed as expected in ESM:', e.message);
}
