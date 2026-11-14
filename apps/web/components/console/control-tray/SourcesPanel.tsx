import type { GroundingResult } from '../../../../../shared/realtime-protocol';
import { useTranslation } from '@/lib/i18n';

export default function SourcesPanel({ result }: { result: GroundingResult | null }) {
  const { t } = useTranslation();
  if (!result || (!result.sources.length && !result.searchEntryPoint?.renderedContent)) return null;
  return (
    <details className="sources-panel">
      <summary>{t('sources')}</summary>
      <div className="sources-panel__content">
        {result.summary ? <p>{result.summary}</p> : null}
        <ul>
          {result.sources.filter(source => /^https?:\/\//i.test(source.url)).map((source, index) => (
            <li key={`${source.url}-${index}`}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
            </li>
          ))}
        </ul>
        {result.searchEntryPoint?.renderedContent ? (
          <iframe
            title={t('searchSuggestions')}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={result.searchEntryPoint.renderedContent}
          />
        ) : null}
      </div>
    </details>
  );
}
