import { ipcMain } from 'electron';
import type { IPCDependencies } from './types';

export function registerCronIPC(deps: IPCDependencies): void {
  const { getScheduler, getIosChannel, updateTrayMenu } = deps;

  ipcMain.handle('cron:list', async () => {
    return getScheduler()?.getAllJobs() || [];
  });

  ipcMain.handle(
    'cron:create',
    async (
      _,
      name: string,
      schedule: string,
      prompt: string,
      channel: string,
      sessionId: string
    ) => {
      const scheduler = getScheduler();
      const result = await scheduler?.createJob(
        name,
        schedule,
        prompt,
        channel,
        sessionId || 'default'
      );
      updateTrayMenu();
      // Notify iOS of updated routines
      const iosChannel = getIosChannel();
      if (iosChannel) {
        iosChannel.broadcast({ type: 'routines', jobs: scheduler?.getAllJobs() || [] });
      }
      return { success: result?.success ?? false };
    }
  );

  ipcMain.handle('cron:delete', async (_, name: string) => {
    const scheduler = getScheduler();
    const success = scheduler?.deleteJob(name);
    updateTrayMenu();
    // Notify iOS of updated routines
    const iosChannel = getIosChannel();
    if (success && iosChannel) {
      iosChannel.broadcast({ type: 'routines', jobs: scheduler?.getAllJobs() || [] });
    }
    return { success };
  });

  ipcMain.handle('cron:toggle', async (_, name: string, enabled: boolean) => {
    const scheduler = getScheduler();
    const success = scheduler?.setJobEnabled(name, enabled);
    updateTrayMenu();
    // Notify iOS of updated routines
    const iosChannel = getIosChannel();
    if (success && iosChannel) {
      iosChannel.broadcast({ type: 'routines', jobs: scheduler?.getAllJobs() || [] });
    }
    return { success };
  });

  ipcMain.handle('cron:run', async (_, name: string) => {
    const result = await getScheduler()?.runJobNow(name);
    return result;
  });

  ipcMain.handle('cron:history', async (_, limit: number = 20) => {
    return getScheduler()?.getHistory(limit) || [];
  });
}
