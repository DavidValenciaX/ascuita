import { ReactNode } from 'react';

type FireSliderSectionProps = {
  title: string;
  children: ReactNode;
  contentClassName?: string | null;
};

export default function FireSliderSection({
  title,
  children,
  contentClassName = 'settingsPanel__fireGrid',
}: FireSliderSectionProps) {
  return (
    <div className="settingsPanel__fireSection">
      <div className="settingsPanel__fireSectionTitle">{title}</div>
      {contentClassName ? <div className={contentClassName}>{children}</div> : children}
    </div>
  );
}
