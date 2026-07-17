import { ChangeEvent } from 'react';
import { InnerFireConfig, normalizeInnerFireConfig } from '@/lib/fire/config';
import { exportJsonFile } from '@/lib/file-sharing';

export function exportFireConfig(config: InnerFireConfig) {
  const json = JSON.stringify(config, null, 2);
  exportJsonFile('ascuita-fire-config.json', json);
}

export function importFireConfigFromInput(
  event: ChangeEvent<HTMLInputElement>,
  onConfigLoaded: (config: InnerFireConfig) => void
) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = loadEvent => {
    try {
      const parsed = JSON.parse(String(loadEvent.target?.result ?? '')) as InnerFireConfig;
      onConfigLoaded(normalizeInnerFireConfig(parsed));
    } catch (error) {
      console.error('No se pudo importar la configuracion del fuego.', error);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}
