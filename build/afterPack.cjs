const fs = require('fs');
const path = require('path');

/**
 * electron-builder afterPack hook to reduce app size
 * Removes unused platform binaries and locale files
 * Supports macOS and Windows builds
 */
exports.default = async function(context) {
  const appOutDir = context.appOutDir;
  const arch = context.arch === 1 ? 'x64' : 'arm64'; // 1 = x64, 3 = arm64
  const platform = context.electronPlatformName || process.platform;

  console.log(`[afterPack] Cleaning up for ${platform}-${arch}...`);

  // Determine resource paths based on platform
  let resourcesPath, appPath;

  if (platform === 'darwin') {
    resourcesPath = path.join(appOutDir, 'Neon Post.app', 'Contents', 'Resources');
    appPath = path.join(resourcesPath, 'app');
  } else {
    // Windows / Linux: flat structure
    resourcesPath = path.join(appOutDir, 'resources');
    appPath = path.join(resourcesPath, 'app');
  }

  // 1. Remove unused ripgrep platform binaries (~41MB savings)
  const ripgrepPath = path.join(appPath, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep');
  if (fs.existsSync(ripgrepPath)) {
    const platformMap = {
      darwin: `${arch}-darwin`,
      win32: `${arch}-win32`,
      linux: `${arch}-linux`,
    };
    const keepPlatform = platformMap[platform] || `${arch}-${platform}`;
    const entries = fs.readdirSync(ripgrepPath);

    for (const entry of entries) {
      const entryPath = path.join(ripgrepPath, entry);
      const stat = fs.statSync(entryPath);

      if (stat.isDirectory() && entry !== keepPlatform) {
        console.log(`[afterPack] Removing ripgrep/${entry}`);
        fs.rmSync(entryPath, { recursive: true, force: true });
      }
    }
  }

  // 2. Remove unused locale files (keep only en) - macOS only (.lproj)
  if (platform === 'darwin' && fs.existsSync(resourcesPath)) {
    const localeFiles = fs.readdirSync(resourcesPath).filter(f => f.endsWith('.lproj') && f !== 'en.lproj');
    for (const locale of localeFiles) {
      const localePath = path.join(resourcesPath, locale);
      console.log(`[afterPack] Removing locale ${locale}`);
      fs.rmSync(localePath, { recursive: true, force: true });
    }
  }

  // 3. Ensure correct platform-specific @napi-rs/canvas binding exists
  const napirsDir = path.join(appPath, 'node_modules', '@napi-rs');
  if (fs.existsSync(napirsDir)) {
    const bindingMap = {
      'win32-x64': 'canvas-win32-x64-msvc',
      'win32-arm64': 'canvas-win32-arm64-msvc',
      'darwin-x64': 'canvas-darwin-x64',
      'darwin-arm64': 'canvas-darwin-arm64',
      'linux-x64': 'canvas-linux-x64-gnu',
      'linux-arm64': 'canvas-linux-arm64-gnu',
    };
    const needed = bindingMap[`${platform}-${arch}`];
    if (needed) {
      const neededPath = path.join(napirsDir, needed);
      if (!fs.existsSync(neededPath)) {
        // Copy from source node_modules if available (e.g. force-installed cross-platform)
        const srcPath = path.join(context.packager.projectDir, 'node_modules', '@napi-rs', needed);
        if (fs.existsSync(srcPath)) {
          console.log(`[afterPack] Copying missing ${needed} binding`);
          copyDirSync(srcPath, neededPath);
        } else {
          console.warn(`[afterPack] WARNING: Missing @napi-rs/${needed} — install it with: npm install @napi-rs/${needed} --force`);
        }
      }
      // Remove other platform bindings
      const entries = fs.readdirSync(napirsDir);
      for (const entry of entries) {
        if (entry.startsWith('canvas-') && entry !== needed && entry !== 'canvas') {
          const entryPath = path.join(napirsDir, entry);
          console.log(`[afterPack] Removing @napi-rs/${entry}`);
          fs.rmSync(entryPath, { recursive: true, force: true });
        }
      }
    }
  }

  // 4. Remove unnecessary files from node_modules
  const nodeModulesPath = path.join(appPath, 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    cleanDirectory(nodeModulesPath, ['.md', '.markdown']);
  }

  console.log('[afterPack] Cleanup complete');
};

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function cleanDirectory(dir, extensions) {
  if (!fs.existsSync(dir)) return;

  let removed = 0;
  const walk = (currentPath) => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        // Remove test/docs directories
        if (['test', 'tests', '__tests__', 'docs', 'example', 'examples', '.github'].includes(entry.name)) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          removed++;
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        // Remove markdown files (except LICENSE)
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext) && !entry.name.toLowerCase().includes('license')) {
          fs.unlinkSync(fullPath);
          removed++;
        }
      }
    }
  };

  walk(dir);
  if (removed > 0) {
    console.log(`[afterPack] Removed ${removed} unnecessary files/directories`);
  }
}
