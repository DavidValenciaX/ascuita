import { ReactNode } from 'react';

type FireSliderSectionProps = {
  title: string;
  children: ReactNode;
  gridClassName?: string;
};

export default function FireSliderSection({
  title,
  children,
  gridClassName = 'settingsPanel__fireGrid',
}: FireSliderSectionProps) {
  return (
    <div className="settingsPanel__fireSection">
      <div className="settingsPanel__fireSectionTitle">{title}</div>
      <div className={gridClassName}>{children}</div>
    </div>
  );
}
