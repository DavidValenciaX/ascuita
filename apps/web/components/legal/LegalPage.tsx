import ReactMarkdown from 'react-markdown';
import LegalLayout from './LegalLayout';

type LegalPageProps = {
  title: string;
  lang: string;
  content: string;
};

export default function LegalPage({ title, lang, content }: LegalPageProps) {
  return (
    <LegalLayout title={title} lang={lang}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </LegalLayout>
  );
}
