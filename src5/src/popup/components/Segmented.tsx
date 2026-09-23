// A small segmented control (radio-group semantics) for two-or-three exclusive
// choices — batch mode, appearance, tab-close mode. Generic over the value type
// so callers keep their own string unions.
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  ariaLabel?: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o, index) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={value === o.value || (!options.some((option) => option.value === value) && index === 0) ? 0 : -1}
          className={`seg${value === o.value ? ' on' : ''}`}
          onClick={() => onChange(o.value)}
          onKeyDown={(event) => {
            let next = index
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length
            else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length
            else if (event.key === 'Home') next = 0
            else if (event.key === 'End') next = options.length - 1
            else return
            event.preventDefault()
            onChange(options[next].value)
            const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
            buttons?.[next]?.focus()
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
