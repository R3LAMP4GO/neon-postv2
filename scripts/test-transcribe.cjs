/**
 * Quick test: runs the transcription chain outside Electron to see what fails.
 * Usage: node scripts/test-transcribe.cjs [file_path]
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const testFile = process.argv[2] || 'C:\\Users\\SPARTAN PC\\Downloads\\test.mp4';
const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
const scriptPath = path.join(__dirname, 'transcribe.py');

console.log('=== Transcription Test ===');
console.log('Platform:', process.platform);
console.log('Python cmd:', pythonCmd);
console.log('Script path:', scriptPath);
console.log('Script exists:', fs.existsSync(scriptPath));
console.log('Test file:', testFile);
console.log('File exists:', fs.existsSync(testFile));
console.log('');

// Read the API key from settings DB
const dbPath = path.join(require('os').homedir(), 'AppData', 'Roaming', 'neon-post', 'neon-post.db');
console.log('DB path:', dbPath);
console.log('DB exists:', fs.existsSync(dbPath));

let apiKey = '';
try {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare("SELECT value FROM settings WHERE key = 'assembly.apiKey'").get();
  apiKey = row ? row.value : '';
  db.close();
  console.log('API key from DB:', apiKey ? apiKey.slice(0, 8) + '...' : 'MISSING');
} catch (e) {
  console.log('DB read error:', e.message);
}

if (!apiKey) {
  // Try SettingsManager JSON
  const settingsPath = path.join(require('os').homedir(), 'AppData', 'Roaming', 'neon-post', 'settings.json');
  console.log('Trying settings.json:', settingsPath);
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      apiKey = settings['assembly.apiKey'] || settings.assembly?.apiKey || '';
      console.log('API key from JSON:', apiKey ? apiKey.slice(0, 8) + '...' : 'MISSING');
    } catch (e) {
      console.log('JSON read error:', e.message);
    }
  }
}

console.log('');

// Test 1: Python CLI
console.log('--- Test 1: Python CLI ---');
if (!apiKey) {
  console.log('SKIP: No API key found');
} else if (!fs.existsSync(testFile)) {
  console.log('SKIP: Test file does not exist');
  console.log('Pass a real file: node scripts/test-transcribe.cjs "C:\\path\\to\\video.mp4"');
} else {
  const args = [scriptPath, testFile, '--key', apiKey];
  console.log('Running:', pythonCmd, args.join(' '));

  execFile(pythonCmd, args, { timeout: 60000 }, (error, stdout, stderr) => {
    if (error) {
      console.log('CLI ERROR:', error.message);
      console.log('STDERR:', stderr?.slice(0, 500));
      console.log('STDOUT:', stdout?.slice(0, 500));
    } else {
      console.log('CLI SUCCESS');
      try {
        const result = JSON.parse(stdout);
        if (result.error) {
          console.log('Script error:', result.error);
        } else {
          console.log('Text length:', result.text?.length);
          console.log('Segments:', result.segments?.length);
          console.log('Duration:', result.duration);
        }
      } catch (e) {
        console.log('Parse error, raw output:', stdout.slice(0, 200));
      }
    }

    // Test 2: HTTP upload
    console.log('');
    console.log('--- Test 2: HTTP upload ---');
    const fileBuffer = fs.readFileSync(testFile);
    console.log('File buffer size:', fileBuffer.length);

    fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'content-type': 'application/octet-stream',
      },
      body: fileBuffer,
    })
    .then(res => {
      console.log('Upload status:', res.status);
      return res.json();
    })
    .then(data => {
      if (data.upload_url) {
        console.log('Upload URL:', data.upload_url.slice(0, 60) + '...');
        console.log('HTTP UPLOAD SUCCESS');
      } else {
        console.log('Upload response:', JSON.stringify(data));
      }
    })
    .catch(err => {
      console.log('HTTP ERROR:', err.message);
    });
  });
}
