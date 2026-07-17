import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

async function shareOnNative(filename: string, content: string) {
  const result = await Filesystem.writeFile({
    path: filename,
    data: content,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true,
  });

  await Share.share({
    title: filename,
    text: filename,
    url: result.uri,
    dialogTitle: 'Share Ascuita export',
  });
}

export function exportJsonFile(filename: string, content: string) {
  if (Capacitor.isNativePlatform()) {
    void shareOnNative(filename, content).catch(error => {
      console.error('Could not share the exported file.', error);
    });
    return;
  }

  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
