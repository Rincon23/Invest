import type { MissionKey, MissionsStatus } from '../gamification/missions';
import { apiRequest } from './apiClient';

/** Gives the XP of what was just done (and of the `visits` reported) and returns the missions. */
export function checkMissions(visits: MissionKey[] = []): Promise<MissionsStatus> {
  return apiRequest('POST', '/missions', { visits });
}
