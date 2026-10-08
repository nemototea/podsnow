import { Field } from './components';

export interface DateFieldProps {
  label: string;
  /** `YYYY-MM-DD`。未設定は空文字。 */
  value: string;
  onChange: (v: string) => void;
  help?: string;
  /** 読めない値のときの文言（文字入力だけで使う。ピッカーは読めない値を作らない）。 */
  error?: string | null;
}

/**
 * 日付の入力（Web は `YYYY-MM-DD` の文字入力。iOS は `DateField.ios.tsx`、
 * Android は `DateField.android.tsx` で OS の日付ピッカー。Issue #167）。
 */
export function DateField({ label, value, onChange, help, error }: DateFieldProps) {
  return (
    <Field
      label={label}
      value={value}
      onChangeText={onChange}
      placeholder="YYYY-MM-DD"
      {...(help ? { help } : {})}
      {...(error ? { error } : {})}
    />
  );
}
