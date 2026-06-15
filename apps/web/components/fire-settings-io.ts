import { ChangeEvent } from 'react';
import { InnerFireConfig, normalizeInnerFireConfig } from '@/lib/fire/config';

export function exportFireConfig(config: InnerFireConfig) {
  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'ascuita-fire-config.json';
  anchor.click();
  URL.revokeObjectURL(url);
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
