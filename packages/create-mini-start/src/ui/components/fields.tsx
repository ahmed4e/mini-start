/** The form's building blocks: numbered sections, text fields, choice cards and switches. */
import type { ReactNode, Ref } from 'react'

export function Section({ number, title, children }: { number?: number; title?: string; children: ReactNode }) {
  return (
    <section>
      {title && (
        <h2 className="section-title">
          <span className="num">{number}</span>
          {title}
        </h2>
      )}
      {children}
    </section>
  )
}

interface TextFieldProps {
  id: string
  label: string
  value: string
  error?: string
  onChange: (value: string) => void
  inputRef?: Ref<HTMLInputElement>
}

export function TextField({ id, label, value, error, onChange, inputRef }: TextFieldProps) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        ref={inputRef}
        id={id}
        className={error ? 'text-input invalid' : 'text-input'}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </label>
  )
}

interface ChoiceCardProps {
  /** radio: one of a group (round box); checkbox: any number. */
  type: 'radio' | 'checkbox'
  name?: string
  checked: boolean
  onChange: (checked: boolean) => void
  title: string
  description: string
  meta?: string
}

export function ChoiceCard({ type, name, checked, onChange, title, description, meta }: ChoiceCardProps) {
  return (
    <label className="addon">
      <input type={type} name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={type === 'radio' ? 'box round' : 'box'} />
      <span className="addon-name">{title}</span>
      <span className="addon-desc">{description}</span>
      {meta && <span className="addon-meta">{meta}</span>}
    </label>
  )
}

interface SwitchProps {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  title: string
  description: ReactNode
}

export function Switch({ checked, disabled, onChange, title, description }: SwitchProps) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" />
      <span>
        <span className="toggle-title">{title}</span>
        <br />
        <span className="toggle-desc">{description}</span>
      </span>
    </label>
  )
}
