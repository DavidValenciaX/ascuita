import { DeepPartial, InnerFireConfig } from '@/lib/fire/config';
import FireSliderControl from './FireSliderControl';
import { FireNumericSectionKey, NumericSliderDef } from './fire-settings-schema';

export function createFireSectionUpdater(
  config: InnerFireConfig,
  updateConfig: (patch: DeepPartial<InnerFireConfig>) => void
) {
  return function <TSectionKey extends FireNumericSectionKey>(sectionKey: TSectionKey) {
    return <K extends keyof InnerFireConfig[TSectionKey]>(
      key: K,
      value: InnerFireConfig[TSectionKey][K]
    ) => {
      const nextSection: InnerFireConfig[TSectionKey] = {
        ...config[sectionKey],
      };
      nextSection[key] = value;

      const nextPatch: DeepPartial<InnerFireConfig> = {};
      nextPatch[sectionKey] = nextSection;

      updateConfig(nextPatch);
    };
  };
}

export function renderFireSliderControls<TSection extends Record<string, number>>(
  values: TSection,
  controls: NumericSliderDef<TSection>[],
  onChange: <K extends keyof TSection>(key: K, value: TSection[K]) => void
) {
  return controls.map(control => (
    <FireSliderControl
      key={control.key}
      label={control.label}
      value={values[control.key]}
      min={control.min}
      max={control.max}
      step={control.step}
      unit={control.unit}
      onChange={value => onChange(control.key, value as TSection[typeof control.key])}
    />
  ));
}
