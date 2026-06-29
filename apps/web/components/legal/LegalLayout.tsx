import { ReactNode } from 'react';
import { useLanguage } from '../../lib/i18n';

type LegalLayoutProps = {
  title: string;
  lang: string;
  children: ReactNode;
};

export default function LegalLayout({ title, lang, children }: LegalLayoutProps) {
  const { language } = useLanguage();

  return (
    <div className="legal-page" lang={lang}>
      <div className="legal-page__container">
        <a href="/" className="legal-page__back">
          <span className="icon">arrow_back</span>
          Ascuita
        </a>
        <h1 className="legal-page__title">{title}</h1>
        <div className="legal-page__content">{children}</div>
        <footer className="legal-page__footer">
          {language === 'en' ? (
            <>
              <a href="/privacy">Privacy Policy</a>
              <span>·</span>
              <a href="/terms">Terms of Service</a>
            </>
          ) : (
            <>
              <a href="/privacidad">Política de Privacidad</a>
              <span>·</span>
              <a href="/terminos">Términos y Condiciones</a>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
