export function getPasswordRequirements(password) {
  return [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'At least one uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'At least one number', met: /\d/.test(password) },
    { label: 'At least one special character', met: /[^A-Za-z0-9]/.test(password) },
  ]
}

export function isPasswordValid(password) {
  return getPasswordRequirements(password).every((requirement) => requirement.met)
}
