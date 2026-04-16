/**
 * Video Engine Installer
 *
 * Manages Python virtual environment creation and pip dependency
 * installation for the video engine. This ensures the engine's
 * Python dependencies are isolated from the system Python.
 */

import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';

const LOG_PREFIX = '[video-install]';

/** Minimum Python version required (3.10+) */
const MIN_PYTHON_MAJOR = 3;
const MIN_PYTHON_MINOR = 10;

/** Requirements file name inside the engine directory */
const REQUIREMENTS_FILE = 'requirements.txt';

// ── Types ──

/** Installation progress callback */
export type InstallProgressCallback = (stage: string, detail: string) => void;

/** Result of an installation attempt */
export interface InstallResult {
  success: boolean;
  /** Path to the Python binary in the venv */
  pythonPath?: string;
  /** Error message on failure */
  error?: string;
  /** Whether a new venv was created (vs. existing) */
  created: boolean;
}

// ── Helpers ──

/** Execute a command and return stdout/stderr */
function exec(
  command: string,
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, timeout: 300_000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(`Command failed: ${command} ${args.join(' ')}\n${stderr || err.message}`)
          );
          return;
        }
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      }
    );
  });
}

/**
 * Find a suitable Python 3 binary on the system.
 * Tries python3, python, py (Windows) in order.
 */
export async function findPython(): Promise<string | null> {
  const candidates =
    process.platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      const { stdout } = await exec(cmd, [
        '-c',
        'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")',
      ]);
      const [major, minor] = stdout.trim().split('.').map(Number);
      if (major >= MIN_PYTHON_MAJOR && (major > MIN_PYTHON_MAJOR || minor >= MIN_PYTHON_MINOR)) {
        console.log(`${LOG_PREFIX} Found Python ${major}.${minor} at: ${cmd}`);
        return cmd;
      }
    } catch {
      // This candidate not available — try next
    }
  }

  return null;
}

/**
 * Get the venv Python binary path for a given engine directory.
 */
export function getVenvPythonPath(enginePath: string): string {
  if (process.platform === 'win32') {
    return path.join(enginePath, 'venv', 'Scripts', 'python.exe');
  }
  return path.join(enginePath, 'venv', 'bin', 'python');
}

/**
 * Get the venv pip binary path for a given engine directory.
 */
function getVenvPipPath(enginePath: string): string {
  if (process.platform === 'win32') {
    return path.join(enginePath, 'venv', 'Scripts', 'pip.exe');
  }
  return path.join(enginePath, 'venv', 'bin', 'pip');
}

/**
 * Check if the venv already exists and is valid.
 */
export function isVenvInstalled(enginePath: string): boolean {
  const pythonBin = getVenvPythonPath(enginePath);
  return fs.existsSync(pythonBin);
}

/**
 * Create a Python virtual environment and install dependencies.
 *
 * Steps:
 * 1. Find a system Python >= 3.10
 * 2. Create a venv inside enginePath/venv
 * 3. Upgrade pip
 * 4. Install requirements.txt (if present)
 *
 * @param enginePath - Absolute path to the effect_engine directory
 * @param onProgress - Optional progress callback
 * @returns Installation result
 */
export async function installEngine(
  enginePath: string,
  onProgress?: InstallProgressCallback
): Promise<InstallResult> {
  const progress = onProgress ?? (() => {});

  // Check if already installed
  if (isVenvInstalled(enginePath)) {
    const pythonBin = getVenvPythonPath(enginePath);
    console.log(`${LOG_PREFIX} venv already exists at: ${pythonBin}`);
    progress('check', 'Virtual environment already exists');

    // Ensure requirements are up to date
    try {
      await installRequirements(enginePath, progress);
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} requirements update failed:`,
        err instanceof Error ? err.message : String(err)
      );
    }

    return { success: true, pythonPath: pythonBin, created: false };
  }

  // Find system Python
  progress('python', 'Searching for Python 3.10+...');
  const systemPython = await findPython();
  if (!systemPython) {
    return {
      success: false,
      error: `Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ not found. Please install Python.`,
      created: false,
    };
  }

  // Create venv
  const venvPath = path.join(enginePath, 'venv');
  progress('venv', `Creating virtual environment at ${venvPath}...`);
  console.log(`${LOG_PREFIX} Creating venv with: ${systemPython}`);

  try {
    await exec(systemPython, ['-m', 'venv', venvPath]);
  } catch (err) {
    return {
      success: false,
      error: `Failed to create venv: ${err instanceof Error ? err.message : String(err)}`,
      created: false,
    };
  }

  // Verify venv was created
  const pythonBin = getVenvPythonPath(enginePath);
  if (!fs.existsSync(pythonBin)) {
    return {
      success: false,
      error: `Venv creation succeeded but Python binary not found at: ${pythonBin}`,
      created: false,
    };
  }

  // Upgrade pip
  progress('pip', 'Upgrading pip...');
  try {
    await exec(pythonBin, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} pip upgrade failed (non-fatal):`,
      err instanceof Error ? err.message : String(err)
    );
  }

  // Install requirements
  try {
    await installRequirements(enginePath, progress);
  } catch (err) {
    return {
      success: false,
      error: `Failed to install requirements: ${err instanceof Error ? err.message : String(err)}`,
      created: true,
    };
  }

  console.log(`${LOG_PREFIX} Installation complete`);
  progress('done', 'Installation complete');

  return { success: true, pythonPath: pythonBin, created: true };
}

/**
 * Install Python requirements from the engine's requirements.txt.
 */
async function installRequirements(
  enginePath: string,
  progress: InstallProgressCallback
): Promise<void> {
  const reqFile = path.join(enginePath, REQUIREMENTS_FILE);
  if (!fs.existsSync(reqFile)) {
    console.log(`${LOG_PREFIX} No requirements.txt found — skipping`);
    progress('requirements', 'No requirements.txt found');
    return;
  }

  progress('requirements', 'Installing Python dependencies...');
  const pipBin = getVenvPipPath(enginePath);
  const pipCmd = fs.existsSync(pipBin) ? pipBin : getVenvPythonPath(enginePath);
  const pipArgs = fs.existsSync(pipBin)
    ? ['install', '-r', reqFile]
    : ['-m', 'pip', 'install', '-r', reqFile];

  console.log(`${LOG_PREFIX} Installing requirements from: ${reqFile}`);
  await exec(pipCmd, pipArgs, enginePath);
  progress('requirements', 'Dependencies installed');
}

/**
 * Uninstall the virtual environment by removing the venv directory.
 */
export async function uninstallEngine(enginePath: string): Promise<void> {
  const venvPath = path.join(enginePath, 'venv');
  if (fs.existsSync(venvPath)) {
    console.log(`${LOG_PREFIX} Removing venv at: ${venvPath}`);
    fs.rmSync(venvPath, { recursive: true, force: true });
  }
}
