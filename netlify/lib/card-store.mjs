import { getStore } from '@netlify/blobs';

export function cardStore(mode) {
  return getStore({ name: 'gift-cards-' + mode, consistency: 'strong' });
}
