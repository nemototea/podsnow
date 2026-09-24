import { Field } from './components';

export interface DateFieldProps {
  label: string;
  /** `YYYY-MM-DD`。未設定は空文字。 */
  value: string;
  onChange: (v: string) => void;
  help?: string;
}

/** 日付の入力（Android と Web は `YYYY-MM-DD` の文字入力。iOS は `DateField.ios.tsx`）。 */
export function DateField({ label, value, onChange, help }: DateFieldProps) {
  return (
    <Field
      label={label}
      value={value}
      onChangeText={onChange}
      placeholder="YYYY-MM-DD"
      {...(help ? { help } : {})}
    />
  );
}
