import type { HomeTemplate } from '../modules/home';
import { apiRequest } from './apiClient';

/** The Início of the template account, which "Voltar ao padrão" brings back (null: none yet). */
export function fetchHomeTemplate(): Promise<HomeTemplate | null> {
  return apiRequest('GET', '/settings/home');
}
