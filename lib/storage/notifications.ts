import type { PushDevice, PushSendReport, PushSubscriptionInput } from '../notifications/types';
import { apiRequest, seg } from './apiClient';

export interface PushStatus {
  /** Null while the server has no VAPID keys: notifications cannot be turned on yet. */
  publicKey: string | null;
  devices: PushDevice[];
}

/** The devices that receive the signed-in user's notifications. */
export interface NotificationsRepository {
  getPushStatus(): Promise<PushStatus>;
  registerDevice(subscription: PushSubscriptionInput): Promise<PushDevice>;
  removeDevice(id: string): Promise<void>;
  /** Sends the test notification to one device, or to all of them. */
  sendTest(deviceId?: string): Promise<PushSendReport>;
}

export class HttpNotificationsRepository implements NotificationsRepository {
  getPushStatus(): Promise<PushStatus> {
    return apiRequest('GET', '/push');
  }

  registerDevice(subscription: PushSubscriptionInput): Promise<PushDevice> {
    return apiRequest('POST', '/push/devices', subscription);
  }

  removeDevice(id: string): Promise<void> {
    return apiRequest('DELETE', `/push/devices/${seg(id)}`);
  }

  sendTest(deviceId?: string): Promise<PushSendReport> {
    return apiRequest('POST', '/push/test', deviceId ? { deviceId } : {});
  }
}
