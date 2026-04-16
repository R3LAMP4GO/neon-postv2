/**
 * iOS channel - WebSocket-based mobile companion
 *
 * Supports two modes:
 * - Relay mode (default): connects to cloud relay for remote access
 * - Local mode: runs local WebSocket server for LAN connections
 */

import crypto from 'crypto';
import fs from 'fs';
import { BaseChannel } from '../index';
import { iOSWebSocketServer } from './server';
import { iOSRelayClient } from './relay-client';
import {
  iOSMessageCallback,
  ConnectedDevice,
  iOSMessageHandler,
  iOSSessionsHandler,
  iOSHistoryHandler,
  iOSStatusForwarder,
  iOSModelsHandler,
  iOSModelSwitchHandler,
  iOSStopHandler,
  iOSClearHandler,
  iOSFactsHandler,
  iOSFactsDeleteHandler,
  iOSDailyLogsHandler,
  iOSSoulHandler,
  iOSSoulDeleteHandler,
  iOSCustomizeGetHandler,
  iOSCustomizeSaveHandler,
  iOSRoutinesListHandler,
  iOSRoutinesCreateHandler,
  iOSRoutinesDeleteHandler,
  iOSRoutinesToggleHandler,
  iOSRoutinesRunHandler,
  iOSAppInfoHandler,
  iOSModeGetHandler,
  iOSModeSwitchHandler,
  iOSWorkflowsHandler,
  iOSChatInfoHandler,
} from './types';
import { SettingsManager } from '../../settings';

export type { iOSMessageCallback, ConnectedDevice };

const DEFAULT_RELAY_URL = 'wss://neon-post-relay.buzzbeamaustralia.workers.dev';

type Backend = iOSWebSocketServer | iOSRelayClient;

export class iOSChannel extends BaseChannel {
  name = 'ios';
  private backend: Backend;
  private mode: 'relay' | 'local';

  constructor(port?: number) {
    super();

    const relayUrl = SettingsManager.get('ios.relayUrl') || DEFAULT_RELAY_URL;
    let instanceId = SettingsManager.get('ios.instanceId') || '';

    // Auto-generate instance ID if not set
    if (!instanceId) {
      instanceId = crypto.randomBytes(4).toString('hex');
      SettingsManager.set('ios.instanceId', instanceId);
    }

    // Use relay mode by default, fall back to local if relay URL is empty/disabled
    if (relayUrl && relayUrl !== 'local') {
      this.mode = 'relay';
      this.backend = new iOSRelayClient(relayUrl, instanceId);
      console.log(`[iOS] Using relay mode (instance: ${instanceId})`);
    } else {
      this.mode = 'local';
      const configuredPort = port || Number(SettingsManager.get('ios.port')) || 7888;
      this.backend = new iOSWebSocketServer(configuredPort);
      console.log(`[iOS] Using local mode (port: ${configuredPort})`);
    }
  }

  setMessageHandler(handler: iOSMessageHandler): void {
    this.backend.setMessageHandler(handler);
  }

  setSessionsHandler(handler: iOSSessionsHandler): void {
    this.backend.setSessionsHandler(handler);
  }

  setHistoryHandler(handler: iOSHistoryHandler): void {
    this.backend.setHistoryHandler(handler);
  }

  setStatusForwarder(forwarder: iOSStatusForwarder): void {
    this.backend.setStatusForwarder(forwarder);
  }

  setModelsHandler(handler: iOSModelsHandler): void {
    this.backend.setModelsHandler(handler);
  }

  setModelSwitchHandler(handler: iOSModelSwitchHandler): void {
    this.backend.setModelSwitchHandler(handler);
  }

  setStopHandler(handler: iOSStopHandler): void {
    this.backend.setStopHandler(handler);
  }

  setClearHandler(handler: iOSClearHandler): void {
    this.backend.setClearHandler(handler);
  }

  setFactsHandler(handler: iOSFactsHandler): void {
    this.backend.setFactsHandler(handler);
  }
  setFactsDeleteHandler(handler: iOSFactsDeleteHandler): void {
    this.backend.setFactsDeleteHandler(handler);
  }
  setDailyLogsHandler(handler: iOSDailyLogsHandler): void {
    this.backend.setDailyLogsHandler(handler);
  }
  setSoulHandler(handler: iOSSoulHandler): void {
    this.backend.setSoulHandler(handler);
  }
  setSoulDeleteHandler(handler: iOSSoulDeleteHandler): void {
    this.backend.setSoulDeleteHandler(handler);
  }
  setCustomizeGetHandler(handler: iOSCustomizeGetHandler): void {
    this.backend.setCustomizeGetHandler(handler);
  }
  setCustomizeSaveHandler(handler: iOSCustomizeSaveHandler): void {
    this.backend.setCustomizeSaveHandler(handler);
  }
  setRoutinesListHandler(handler: iOSRoutinesListHandler): void {
    this.backend.setRoutinesListHandler(handler);
  }
  setRoutinesCreateHandler(handler: iOSRoutinesCreateHandler): void {
    this.backend.setRoutinesCreateHandler(handler);
  }
  setRoutinesDeleteHandler(handler: iOSRoutinesDeleteHandler): void {
    this.backend.setRoutinesDeleteHandler(handler);
  }
  setRoutinesToggleHandler(handler: iOSRoutinesToggleHandler): void {
    this.backend.setRoutinesToggleHandler(handler);
  }
  setRoutinesRunHandler(handler: iOSRoutinesRunHandler): void {
    this.backend.setRoutinesRunHandler(handler);
  }
  setAppInfoHandler(handler: iOSAppInfoHandler): void {
    this.backend.setAppInfoHandler(handler);
  }
  setSkinHandler(handler: (skinId: string) => void): void {
    this.backend.setSkinHandler(handler);
  }
  setModeGetHandler(handler: iOSModeGetHandler): void {
    this.backend.setModeGetHandler(handler);
  }
  setModeSwitchHandler(handler: iOSModeSwitchHandler): void {
    this.backend.setModeSwitchHandler(handler);
  }
  setWorkflowsHandler(handler: iOSWorkflowsHandler): void {
    this.backend.setWorkflowsHandler(handler);
  }
  setChatInfoHandler(handler: iOSChatInfoHandler): void {
    this.backend.setChatInfoHandler(handler);
  }

  getPairingCode(): string {
    return this.backend.getActivePairingCode();
  }

  regeneratePairingCode(): string {
    return this.backend.generatePairingCode();
  }

  getConnectedDevices(): ConnectedDevice[] {
    return this.backend.getConnectedDevices();
  }

  getInstanceId(): string {
    if (this.mode === 'relay') {
      return (this.backend as iOSRelayClient).getInstanceId();
    }
    return '';
  }

  getRelayUrl(): string {
    if (this.mode === 'relay') {
      return SettingsManager.get('ios.relayUrl') || DEFAULT_RELAY_URL;
    }
    return '';
  }

  getMode(): 'relay' | 'local' {
    return this.mode;
  }

  /** Force reconnect relay WebSocket — used after system sleep/wake */
  async forceReconnect(): Promise<void> {
    if (this.mode === 'relay') {
      await (this.backend as iOSRelayClient).forceReconnect();
    }
  }

  sendToDevice(deviceId: string, message: object): boolean {
    return this.backend.sendToDevice(deviceId, message);
  }

  broadcast(message: object): void {
    this.backend.broadcast(message);
  }

  async sendPushNotifications(
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<void> {
    await this.backend.sendPushNotifications(title, body, data);
  }

  syncFromDesktop(
    userMessage: string,
    response: string,
    sessionId: string,
    media?: Array<{ type: string; filePath: string; mimeType: string }>
  ): void {
    // Convert file paths to data URIs so iOS can display images
    const convertedMedia = media?.map((m) => {
      try {
        if (!fs.existsSync(m.filePath)) return m;
        const data = fs.readFileSync(m.filePath);
        const b64 = data.toString('base64');
        return { ...m, filePath: `data:${m.mimeType};base64,${b64}` };
      } catch {
        return m;
      }
    });
    this.backend.broadcast({
      type: 'sync',
      userMessage,
      response,
      sessionId,
      media: convertedMedia,
      timestamp: new Date().toISOString(),
    });
  }

  getPort(): number {
    if (this.mode === 'local') {
      return (this.backend as unknown as { port: number }).port;
    }
    return 0;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      await this.backend.start();
      this.isRunning = true;
    } catch (error) {
      console.error('[iOS] Failed to start:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    await this.backend.stop();
    this.isRunning = false;
  }
}

// Singleton
let iosChannelInstance: iOSChannel | null = null;

export function createiOSChannel(port?: number): iOSChannel | null {
  if (!iosChannelInstance) {
    try {
      iosChannelInstance = new iOSChannel(port);
    } catch (error) {
      console.error('[iOS] Failed to create iOS channel:', error);
      return null;
    }
  }
  return iosChannelInstance;
}

export function destroyiOSChannel(): void {
  iosChannelInstance = null;
}
