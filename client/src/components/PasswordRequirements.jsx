import { getPasswordRequirements } from '../utils/passwordRules.js'

export default function PasswordRequirements({ password }) {
  return (
    <ul
      aria-live="polite"
      aria-label="Password requirements"
      className="mt-2 grid gap-1 text-xs sm:grid-cols-2"
    >
      {getPasswordRequirements(password).map(({ label, met }) => (
        <li key={label} className={met ? 'text-emerald-700' : 'text-slate-500'}>
          <span aria-hidden="true" className="mr-1.5 inline-block w-3 font-bold">
            {met ? '✓' : '○'}
          </span>
          {label}
        </li>
      ))}
    </ul>
  )
}
