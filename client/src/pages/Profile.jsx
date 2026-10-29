import { useEffect, useRef, useState } from 'react'

import UserAvatar from '../components/UserAvatar.jsx'
import { PillIcon, ShieldCheckIcon, UserIcon } from '../components/icons.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { PROFILE_PHOTO_ACCEPT, validateProfilePhoto } from '../utils/profilePhoto.js'
import './Profile.css'

const BLOOD_TYPES = ['Unknown', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

function cleanList(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item).trim())
    .filter(Boolean)
}

function profileFromUser(user) {
  return {
    fullName: user?.fullName || '',
    dob: user?.dob || '',
    phone: user?.phone || '',
    city: user?.city || '',
    state: user?.state || '',
    email: user?.email || '',
    address: user?.address || '',
    bloodType: user?.bloodType || '',
    allergies: Array.isArray(user?.allergies) ? user.allergies : [],
    medications: Array.isArray(user?.medications) ? user.medications : [],
    emergencyName: user?.emergencyName || '',
    relationship: user?.relationship || '',
    emergencyPhone: user?.emergencyPhone || '',
    emergencyAddress: user?.emergencyAddress || '',
  }
}

function formatDate(value) {
  if (!value) return 'Not provided'
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function Profile() {
  const {
    user,
    saveProfile,
    saveProfilePhoto,
    removeProfilePhoto,
    profilePhotoVersion,
  } = useAuth()
  const [formData, setFormData] = useState(() => profileFromUser(user))
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [photoMessage, setPhotoMessage] = useState('')
  const [photoSaving, setPhotoSaving] = useState(false)
  const photoInput = useRef(null)

  const patient = profileFromUser(user)

  useEffect(() => {
    if (!editing) setFormData(profileFromUser(user))
  }, [user, editing])

  function handleChange(event) {
    const { name, value } = event.target
    setFormData((previous) => ({ ...previous, [name]: value }))
    setSaved(false)
    setError('')
  }

  function handleListChange(event) {
    const { name, value } = event.target
    setFormData((previous) => ({ ...previous, [name]: value.split('\n') }))
    setSaved(false)
    setError('')
  }

  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setSaved(false)
    setError('')

    try {
      const editableProfile = { ...formData }
      delete editableProfile.fullName
      delete editableProfile.email
      await saveProfile({
        ...editableProfile,
        allergies: cleanList(formData.allergies),
        medications: cleanList(formData.medications),
      })
      setEditing(false)
      setSaved(true)
    } catch (err) {
      setError(err.message || 'Unable to save your profile right now.')
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    setFormData(profileFromUser(user))
    setEditing(false)
    setError('')
  }

  async function handlePhotoChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const validationError = validateProfilePhoto(file)
    setPhotoError(validationError)
    setPhotoMessage('')
    if (validationError) return

    setPhotoSaving(true)
    try {
      await saveProfilePhoto(file)
      setPhotoMessage('Profile photo updated.')
    } catch (err) {
      setPhotoError(err.message || 'Unable to save the profile photo.')
    } finally {
      setPhotoSaving(false)
    }
  }

  async function handlePhotoRemove() {
    setPhotoSaving(true)
    setPhotoError('')
    setPhotoMessage('')
    try {
      await removeProfilePhoto()
      setPhotoMessage('Profile photo removed.')
    } catch (err) {
      setPhotoError(err.message || 'Unable to remove the profile photo.')
    } finally {
      setPhotoSaving(false)
    }
  }

  function renderField(label, name, value, type = 'text') {
    const constraints = {
      fullName: { minLength: 2, maxLength: 80 },
      email: { maxLength: 254 },
      phone: {
        maxLength: 20,
        pattern: '[+()0-9\\s.-]{7,20}',
        title: 'Use 7–20 characters: digits, spaces, and + ( ) . - only',
      },
      city: { maxLength: 80 },
      state: { maxLength: 80 },
      address: { maxLength: 240 },
      emergencyName: { maxLength: 80 },
      relationship: { maxLength: 60 },
      emergencyPhone: { maxLength: 40 },
      emergencyAddress: { maxLength: 240 },
    }
    const multiline = name === 'address' || name === 'emergencyAddress'
    const locked = name === 'fullName' || name === 'email'

    return (
      <div className={`profile-field${multiline ? ' profile-field-wide' : ''}`} key={name}>
        <label htmlFor={name}>{label}</label>
        {editing ? (
          multiline ? (
            <textarea
              id={name}
              name={name}
              rows="3"
              value={formData[name] ?? ''}
              onChange={handleChange}
              disabled={saving}
              {...constraints[name]}
            />
          ) : (
            <input
              id={name}
              name={name}
              type={type}
              value={formData[name] ?? ''}
              onChange={handleChange}
              required={name === 'fullName' || name === 'email'}
              disabled={saving || locked}
              {...constraints[name]}
            />
          )
        ) : (
          <span className="profile-field-value">
            {name === 'dob' ? formatDate(value) : value || 'Not provided'}
          </span>
        )}
        {editing && locked && (
          <small className="profile-field-hint">This account identifier cannot be changed.</small>
        )}
      </div>
    )
  }

  function renderListField(label, name, items, placeholder) {
    return (
      <div className="profile-field profile-field-wide profile-list-field">
        <label htmlFor={name}>{label}</label>
        {editing ? (
          <>
            <textarea
              id={name}
              name={name}
              rows="4"
              value={(formData[name] || []).join('\n')}
              onChange={handleListChange}
              placeholder={placeholder}
              disabled={saving}
              maxLength={name === 'allergies' ? 1600 : 4800}
              aria-describedby={`${name}-hint`}
            />
            <small className="profile-field-hint" id={`${name}-hint`}>
              Enter one item per line. Leave blank if none.
            </small>
          </>
        ) : items.length > 0 ? (
          name === 'allergies' ? (
            <div className="allergy-list">
              {items.map((allergy) => (
                <span className="allergy-tag" key={allergy}>{allergy}</span>
              ))}
            </div>
          ) : (
            <ul className="medication-list">
              {items.map((medicine) => <li key={medicine}>{medicine}</li>)}
            </ul>
          )
        ) : (
          <span className="profile-field-value">Not provided</span>
        )}
      </div>
    )
  }

  return (
    <div className="profile-page">
      <header className="profile-header">
        <div className="profile-identity">
          <div className="profile-avatar-control">
            <UserAvatar
              user={user}
              photoVersion={profilePhotoVersion}
              className="profile-avatar"
            />
            <div className="profile-photo-actions">
              <button
                type="button"
                className="profile-photo-btn"
                onClick={() => photoInput.current?.click()}
                disabled={photoSaving}
              >
                {photoSaving ? 'Saving…' : user?.profilePhotoUpdatedAt ? 'Change photo' : 'Add photo'}
              </button>
              {user?.profilePhotoUpdatedAt && (
                <button
                  type="button"
                  className="profile-photo-remove"
                  onClick={handlePhotoRemove}
                  disabled={photoSaving}
                >
                  Remove
                </button>
              )}
              <input
                ref={photoInput}
                className="profile-photo-input"
                type="file"
                accept={PROFILE_PHOTO_ACCEPT}
                aria-label="Choose a profile photo"
                onChange={handlePhotoChange}
                disabled={photoSaving}
              />
            </div>
          </div>
          <div className="profile-heading-copy">
            <span className="profile-eyebrow">Account settings</span>
            <h1>{patient.fullName || 'My Profile'}</h1>
            <p className="profile-subtitle">Manage your personal and healthcare information.</p>
            <span className="patient-role">{user?.role || 'patient'}</span>
          </div>
        </div>

        {!editing && (
          <button
            type="button"
            className="edit-profile-btn"
            onClick={() => {
              setFormData(profileFromUser(user))
              setEditing(true)
              setSaved(false)
              setError('')
            }}
          >
            Edit profile
          </button>
        )}
      </header>

      <div className="profile-alerts">
        {photoError && <div className="profile-error" role="alert">{photoError}</div>}
        {photoMessage && <div className="profile-success" role="status">{photoMessage}</div>}
        {saved && <div className="profile-success" role="status">Profile updated successfully.</div>}
        {error && <div className="profile-error" role="alert">{error}</div>}
      </div>

      <form onSubmit={handleSave}>
        <div className="profile-cards">
          <section className="profile-card">
            <div className="profile-card-heading">
              <span className="section-icon"><UserIcon /></span>
              <div>
                <h2>Personal details</h2>
                <p>Your identity and contact information</p>
              </div>
            </div>
            <div className="profile-fields">
              {renderField('Full Name', 'fullName', patient.fullName)}
              {renderField('Date of Birth', 'dob', patient.dob, 'date')}
              {renderField('Phone', 'phone', patient.phone, 'tel')}
              {renderField('City', 'city', patient.city)}
              {renderField('State', 'state', patient.state)}
              {renderField('Email', 'email', patient.email, 'email')}
              {renderField('Address', 'address', patient.address)}
            </div>
          </section>

          <section className="profile-card">
            <div className="profile-card-heading">
              <span className="section-icon"><PillIcon /></span>
              <div>
                <h2>Medical information</h2>
                <p>Health details you choose to keep here</p>
              </div>
            </div>
            <div className="profile-fields">
              <div className="profile-field">
                <label htmlFor="bloodType">Blood Type</label>
                {editing ? (
                  <select
                    id="bloodType"
                    name="bloodType"
                    value={formData.bloodType}
                    onChange={handleChange}
                    disabled={saving}
                  >
                    <option value="">Not provided</option>
                    {BLOOD_TYPES.map((bloodType) => (
                      <option value={bloodType} key={bloodType}>{bloodType}</option>
                    ))}
                  </select>
                ) : (
                  <span className="profile-field-value">{patient.bloodType || 'Not provided'}</span>
                )}
              </div>
              {renderListField('Allergies', 'allergies', patient.allergies, 'e.g. Penicillin')}
              {renderListField('Current Medications', 'medications', patient.medications, 'e.g. Vitamin D')}
            </div>
          </section>
        </div>

        <section className="profile-card emergency-card">
          <div className="profile-card-heading">
            <span className="section-icon"><ShieldCheckIcon /></span>
            <div>
              <h2>Emergency contact</h2>
              <p>Someone to contact if you need support</p>
            </div>
          </div>
          <div className="emergency-grid">
            {renderField('Full Name', 'emergencyName', patient.emergencyName)}
            {renderField('Relationship', 'relationship', patient.relationship)}
            {renderField('Phone', 'emergencyPhone', patient.emergencyPhone, 'tel')}
            {renderField('Address', 'emergencyAddress', patient.emergencyAddress)}
          </div>
        </section>

        {editing && (
          <div className="profile-actions">
            <button type="button" className="cancel-btn" onClick={handleCancel} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="save-btn" disabled={saving}>
              {saving ? 'Saving changes…' : 'Save changes'}
            </button>
          </div>
        )}
      </form>

      <p className="profile-disclaimer">
        MediGuide is an educational demo. Use synthetic information only.
      </p>
    </div>
  )
}
