import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  cancelAppointment as cancelAppointmentApi,
  createAppointment,
  getAppointments,
  getDoctors,
  searchHospitals,
} from '../api.js'
import { CalendarIcon, CloseIcon, HospitalIcon } from '../components/icons.jsx'
import './Appointments.css'

function getToday() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Mirrors the server's appointment duration (APPOINTMENT_DURATION_MINUTES).
const APPOINTMENT_DURATION_MINUTES = 30

/**
 * Compute when an appointment is over by interpreting its date/time in its own
 * timezone. Used so the badge and tabs are correct the moment a visit ends, even
 * if the stored status is still "Upcoming" (for example while the API is asleep).
 */
function getAppointmentEndTime(appointment) {
  const { date, time, timeZone = 'Asia/Kolkata' } = appointment || {}
  if (!date || !time) return null

  const [year, month, day] = String(date).split('-').map(Number)
  const [hour, minute] = String(time).split(':').map(Number)
  if ([year, month, day, hour, minute].some((value) => !Number.isFinite(value))) return null

  const desired = Date.UTC(year, month - 1, day, hour, minute)
  let candidate = desired

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date(candidate))
      const local = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]))
      const represented = Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
        local.second,
      )
      const difference = desired - represented
      if (difference === 0) break
      candidate += difference
    }
  } catch {
    return null
  }

  return new Date(candidate + APPOINTMENT_DURATION_MINUTES * 60_000)
}

/**
 * The status shown in the UI. Cancelled/Completed come from the server; an
 * "Upcoming" appointment that has already ended is displayed as "Completed".
 */
function resolveAppointmentStatus(appointment, now = new Date()) {
  const status = appointment?.status || 'Upcoming'
  if (status !== 'Upcoming') return status

  const endsAt = getAppointmentEndTime(appointment)
  if (endsAt && endsAt.getTime() <= now.getTime()) return 'Completed'
  return 'Upcoming'
}

function formatDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatTime(time) {
  const [hours, minutes] = time.split(':')
  const date = new Date()
  date.setHours(Number(hours), Number(minutes), 0, 0)
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

function getAppointmentId(appointment) {
  return appointment._id || appointment.id
}

function getDoctorId(doctor) {
  return String(
    doctor.id || doctor._id || `${doctor.name}|${doctor.specialty}|${doctor.location || ''}`,
  )
}

function requestError(error, fallback) {
  if (error.status === 401) return 'Your session has expired. Please log in again.'
  return error.message || fallback
}

function safeHospitalSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function hospitalMapUrl(hospital) {
  // Google Places supplies a direct link to the exact listing. Prefer it over
  // coordinates so selecting a hospital opens that place, not just a map pin.
  const sourceUrl = safeHospitalSourceUrl(hospital?.sourceUrl)
  if (sourceUrl) {
    const hostname = new URL(sourceUrl).hostname.toLocaleLowerCase()
    if (
      hostname === 'google.com' ||
      hostname.endsWith('.google.com') ||
      hostname === 'maps.app.goo.gl'
    ) {
      return sourceUrl
    }
  }

  // OpenStreetMap fallback results still open in Google Maps for a consistent
  // navigation experience; their original data-source attribution is retained.
  const coordinates = hospital?.location?.coordinates
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return ''
  const longitude = Number(coordinates[0])
  const latitude = Number(coordinates[1])
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    Math.abs(longitude) > 180 ||
    Math.abs(latitude) > 90
  ) {
    return ''
  }
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
}

const SPECIALTY_GUIDANCE = {
  Cardiologist: 'heart and circulation',
  Dermatologist: 'skin, hair and nails',
  Endocrinologist: 'diabetes, thyroid and hormones',
  'ENT Specialist': 'ear, nose and throat',
  Gastroenterologist: 'digestion, stomach and liver',
  'General Physician': 'fever, infections and general health',
  Gynecologist: "women's health and pregnancy",
  Neurologist: 'brain, nerves and headaches',
  Ophthalmologist: 'eyes and vision',
  'Orthopedic Surgeon': 'bones, joints and muscles',
  Pediatrician: 'child health and development',
  Psychiatrist: 'mental health and wellbeing',
}

// Keep only the location snapshot needed by an appointment. This also prevents
// photo metadata and other live-provider fields from being posted to booking.
function normalizeHospital(hospital, fallbackCity) {
  if (!hospital || typeof hospital !== 'object') return null

  const id = typeof (hospital.id || hospital.osmId) === 'string'
    ? (hospital.id || hospital.osmId).trim()
    : ''
  const name = typeof hospital.name === 'string' ? hospital.name.trim() : ''
  const address = typeof hospital.address === 'string' ? hospital.address.trim() : ''
  const city = typeof hospital.city === 'string'
    ? hospital.city.trim()
    : fallbackCity.trim()
  const state = typeof hospital.state === 'string' ? hospital.state.trim() : ''
  const sourceUrl = safeHospitalSourceUrl(hospital.sourceUrl)
  const coordinates = hospital.location?.coordinates

  if (
    !id || id.length > 200 ||
    name.length < 2 || name.length > 200 ||
    address.length > 1000 || city.length > 120 || state.length > 120 ||
    !['OpenStreetMap', 'Google Places'].includes(hospital.source) ||
    !sourceUrl ||
    !Array.isArray(coordinates) || coordinates.length !== 2
  ) {
    return null
  }

  const longitude = Number(coordinates[0])
  const latitude = Number(coordinates[1])
  if (
    !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
    !Number.isFinite(latitude) || Math.abs(latitude) > 90
  ) {
    return null
  }

  return {
    id,
    name,
    address,
    city: city || fallbackCity.trim(),
    state,
    source: hospital.source,
    sourceUrl,
    location: { type: 'Point', coordinates: [longitude, latitude] },
  }
}

export default function Appointments() {
  const [appointments, setAppointments] = useState([])
  const [doctors, setDoctors] = useState([])
  const [doctorsLoading, setDoctorsLoading] = useState(true)
  const [doctorError, setDoctorError] = useState('')
  const [doctorSpecialty, setDoctorSpecialty] = useState('')
  const [activeTab, setActiveTab] = useState('Upcoming')
  const [showForm, setShowForm] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [cancellingId, setCancellingId] = useState(null)
  const [form, setForm] = useState({ doctorId: '', date: '', time: '', reason: '' })
  const [hospitalCity, setHospitalCity] = useState('')
  const [hospitalName, setHospitalName] = useState('')
  const [hospitalResults, setHospitalResults] = useState([])
  const [selectedHospital, setSelectedHospital] = useState(null)
  const [hospitalLoading, setHospitalLoading] = useState(false)
  const [hospitalError, setHospitalError] = useState('')
  const [hospitalNotice, setHospitalNotice] = useState('')
  const [hospitalSearched, setHospitalSearched] = useState(false)
  const [hospitalSource, setHospitalSource] = useState('')
  const [hospitalCached, setHospitalCached] = useState(false)
  const [hospitalResultsVisible, setHospitalResultsVisible] = useState(true)
  const appointmentRequest = useRef(0)
  const doctorRequest = useRef(0)
  const hospitalRequest = useRef(0)

  const today = getToday()

  const loadAppointments = useCallback(async () => {
    const currentRequest = ++appointmentRequest.current
    setLoading(true)
    setError('')
    try {
      const result = await getAppointments()
      if (currentRequest !== appointmentRequest.current) return
      const records = Array.isArray(result) ? result : result.appointments || []
      setAppointments(Array.isArray(records) ? records : [])
      setError('')
    } catch (err) {
      if (currentRequest === appointmentRequest.current) {
        setError(requestError(err, 'Unable to load appointments. Please try again.'))
      }
    } finally {
      if (currentRequest === appointmentRequest.current) setLoading(false)
    }
  }, [])

  const loadDoctors = useCallback(async () => {
    const currentRequest = ++doctorRequest.current
    setDoctorsLoading(true)
    setDoctorError('')
    try {
      const result = await getDoctors()
      if (currentRequest !== doctorRequest.current) return
      const records = Array.isArray(result) ? result : result.doctors || []
      setDoctors(Array.isArray(records) ? records : [])
      setDoctorError('')
    } catch (err) {
      if (currentRequest === doctorRequest.current) {
        setDoctorError(requestError(err, 'Unable to load the demo provider directory.'))
      }
    } finally {
      if (currentRequest === doctorRequest.current) setDoctorsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAppointments()
    loadDoctors()
    return () => {
      appointmentRequest.current += 1
      doctorRequest.current += 1
      hospitalRequest.current += 1
    }
  }, [loadAppointments, loadDoctors])

  const visibleAppointments = useMemo(
    () =>
      appointments
        .filter((appointment) => {
          const status = resolveAppointmentStatus(appointment)
          return activeTab === 'Upcoming'
            ? status === 'Upcoming'
            : status === 'Completed' || status === 'Cancelled'
        })
        .sort((a, b) => {
          const first = `${a.date} ${a.time}`
          const second = `${b.date} ${b.time}`
          return activeTab === 'Upcoming'
            ? first.localeCompare(second)
            : second.localeCompare(first)
        }),
    [appointments, activeTab],
  )

  const upcomingCount = appointments.filter(
    (appointment) => resolveAppointmentStatus(appointment) === 'Upcoming',
  ).length
  const pastCount = appointments.filter(
    (appointment) => resolveAppointmentStatus(appointment) !== 'Upcoming',
  ).length

  const availableCities = useMemo(
    () => [...new Set(doctors.map((doctor) => doctor.location?.trim()).filter(Boolean))]
      .sort((first, second) => first.localeCompare(second, 'en-IN')),
    [doctors],
  )

  const availableSpecialties = useMemo(() => {
    const cityQuery = hospitalCity.trim().toLocaleLowerCase()
    const cityDoctors = cityQuery
      ? doctors.filter(
          (doctor) => (doctor.location || '').trim().toLocaleLowerCase() === cityQuery,
        )
      : doctors
    return [...new Set(cityDoctors.map((doctor) => doctor.specialty).filter(Boolean))]
      .sort((first, second) => first.localeCompare(second, 'en-IN'))
  }, [doctors, hospitalCity])

  const filteredDoctors = useMemo(() => {
    const cityQuery = hospitalCity.trim().toLocaleLowerCase()
    return doctors.filter((doctor) => {
      const matchesCity = !cityQuery ||
        (doctor.location || '').trim().toLocaleLowerCase() === cityQuery
      const matchesSpecialty = !doctorSpecialty || doctor.specialty === doctorSpecialty
      return matchesCity && matchesSpecialty
    })
  }, [doctors, doctorSpecialty, hospitalCity])

  function resetBookingForm() {
    hospitalRequest.current += 1
    setForm({ doctorId: '', date: '', time: '', reason: '' })
    setDoctorSpecialty('')
    setHospitalCity('')
    setHospitalName('')
    setHospitalResults([])
    setSelectedHospital(null)
    setHospitalLoading(false)
    setHospitalError('')
    setHospitalNotice('')
    setHospitalSearched(false)
    setHospitalSource('')
    setHospitalCached(false)
    setHospitalResultsVisible(true)
  }

  function toggleBookingForm() {
    if (showForm) resetBookingForm()
    setShowForm((visible) => !visible)
    setMessage('')
    setError('')
  }

  function updateHospitalCriteria(field, value) {
    // Results for previous criteria must never remain selectable under a new
    // city/name, including while an older request is still resolving.
    hospitalRequest.current += 1
    if (field === 'city') setHospitalCity(value)
    else setHospitalName(value)
    setHospitalLoading(false)
    setHospitalResults([])
    setSelectedHospital(null)
    setHospitalError('')
    setHospitalNotice('')
    setHospitalSearched(false)
    setHospitalSource('')
    setHospitalCached(false)
    setHospitalResultsVisible(true)
  }

  function handleLocationChange(value) {
    updateHospitalCriteria('city', value)
    const cityQuery = value.trim().toLocaleLowerCase()
    const specialtyAvailable = !doctorSpecialty || !cityQuery || doctors.some(
      (doctor) =>
        (doctor.location || '').trim().toLocaleLowerCase() === cityQuery &&
        doctor.specialty === doctorSpecialty,
    )

    if (!specialtyAvailable) setDoctorSpecialty('')

    setForm((current) => {
      if (!current.doctorId) return current
      const selectedDoctor = doctors.find(
        (doctor) => getDoctorId(doctor) === current.doctorId,
      )
      const matchesCity = selectedDoctor && (!cityQuery ||
        (selectedDoctor.location || '').trim().toLocaleLowerCase() === cityQuery)
      const matchesSpecialty = !doctorSpecialty || !specialtyAvailable ||
        selectedDoctor?.specialty === doctorSpecialty
      return matchesCity && matchesSpecialty ? current : { ...current, doctorId: '' }
    })
  }

  function handleSpecialtyChange(value) {
    setDoctorSpecialty(value)
    setForm((current) => {
      if (!current.doctorId) return current
      const selectedDoctor = doctors.find(
        (doctor) => getDoctorId(doctor) === current.doctorId,
      )
      const matchesSpecialty = selectedDoctor &&
        (!value || selectedDoctor.specialty === value)
      return matchesSpecialty ? current : { ...current, doctorId: '' }
    })
  }

  async function runHospitalSearch() {
    const cityValue = hospitalCity.trim()
    const nameValue = hospitalName.trim()
    if (!cityValue) {
      setHospitalError('Choose the shared provider and hospital city above first.')
      return
    }

    const currentRequest = ++hospitalRequest.current
    setHospitalLoading(true)
    setHospitalError('')
    setHospitalNotice('')
    setHospitalSearched(true)
    setHospitalResults([])
    setSelectedHospital(null)
    setHospitalSource('')
    setHospitalCached(false)
    setHospitalResultsVisible(true)

    try {
      const result = await searchHospitals({ city: cityValue, name: nameValue })
      if (currentRequest !== hospitalRequest.current) return
      const records = Array.isArray(result.results)
        ? result.results
        : result.hospitals || []
      const normalized = Array.isArray(records)
        ? records.map((hospital) => normalizeHospital(hospital, cityValue)).filter(Boolean)
        : []
      setHospitalResults(normalized)
      setHospitalSource(result.source || 'OpenStreetMap')
      setHospitalCached(Boolean(result.cached))
      setHospitalNotice(result.notice || '')
    } catch (err) {
      if (currentRequest === hospitalRequest.current) {
        setHospitalResults([])
        setHospitalError(requestError(err, 'Unable to search hospitals. Please try again.'))
      }
    } finally {
      if (currentRequest === hospitalRequest.current) setHospitalLoading(false)
    }
  }

  function handleHospitalSearchKey(event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (!hospitalLoading && !submitting) runHospitalSearch()
    }
  }

  async function handleBook(event) {
    event.preventDefault()
    setMessage('')
    setError('')

    if (form.date < today) {
      setError('Please select today or a future date.')
      return
    }

    const selectedDoctor = doctors.find(
      (doctor) => getDoctorId(doctor) === form.doctorId,
    )
    if (!selectedDoctor) {
      setError('Please select a doctor from the current directory.')
      return
    }

    if (!selectedHospital) {
      setError('Search for and select a hospital location before booking.')
      return
    }

    const conflict = appointments.some(
      (appointment) =>
        appointment.status === 'Upcoming' &&
        appointment.doctor === selectedDoctor.name &&
        appointment.date === form.date &&
        appointment.time === form.time,
    )
    if (conflict) {
      setError('You already booked this doctor at that time.')
      return
    }

    setSubmitting(true)
    try {
      const result = await createAppointment({
        doctor: selectedDoctor.name,
        specialty: selectedDoctor.specialty,
        hospital: selectedHospital,
        date: form.date,
        time: form.time,
        reason: form.reason.trim(),
      })
      if (!result.appointment) {
        throw new Error('The server did not return the new appointment.')
      }

      setAppointments((current) => [...current, result.appointment])
      setActiveTab('Upcoming')
      setShowForm(false)
      resetBookingForm()
      setMessage('Appointment and hospital location saved successfully.')
    } catch (err) {
      setError(requestError(err, 'Unable to book appointment. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel(appointment) {
    const id = getAppointmentId(appointment)
    if (!id || !window.confirm('Cancel this appointment?')) return

    setMessage('')
    setError('')
    setCancellingId(id)
    try {
      const result = await cancelAppointmentApi(id)
      setAppointments((current) =>
        current.map((item) =>
          getAppointmentId(item) === id
            ? result.appointment || { ...item, status: 'Cancelled' }
            : item,
        ),
      )
      const emailQueued = result?.notification?.email === 'queued'
      setMessage(
        emailQueued
          ? 'Appointment cancelled successfully. A cancellation email is on its way to your account address.'
          : 'Appointment cancelled successfully. Reminders for this appointment have been stopped.',
      )
    } catch (err) {
      setError(requestError(err, 'Unable to cancel appointment. Please try again.'))
    } finally {
      setCancellingId(null)
    }
  }

  return (
    <div className="appointments-page">
      <header className="appointments-header">
        <div className="appointments-heading">
          <span className="appointments-eyebrow">Your care schedule</span>
          <h1>Appointments</h1>
          <p>Book a visit and keep track of your upcoming care.</p>
        </div>
        <button
          className="book-appointment-btn"
          onClick={toggleBookingForm}
          disabled={doctorsLoading || doctors.length === 0 || submitting}
          type="button"
        >
          {showForm ? <CloseIcon /> : <CalendarIcon />}
          {showForm ? 'Close form' : 'Book new appointment'}
        </button>
      </header>

      {message && <p className="appointment-message" role="status">{message}</p>}
      {error && (
        <div className="appointment-error" role="alert">
          <span>{error}</span>
          {!loading && !showForm && appointments.length === 0 && (
            <button type="button" onClick={loadAppointments}>
              Try again
            </button>
          )}
        </div>
      )}

      {doctorError && (
        <div className="appointment-error" role="alert">
          <span>{doctorError}</span>
          {!doctorsLoading && (
            <button type="button" onClick={loadDoctors}>Try again</button>
          )}
        </div>
      )}

      {showForm && (
        <section className="booking-form-card" aria-labelledby="booking-form-title">
          <div className="booking-form-heading">
            <div>
              <span className="booking-eyebrow">Appointment details</span>
              <h2 id="booking-form-title">Book a new appointment</h2>
              <p>Choose a provider, a time, and a mapped hospital location.</p>
            </div>
            <span className="booking-required-note">* Required fields</span>
          </div>
          <form onSubmit={handleBook}>
            <div className="booking-form-grid">
              <div className="booking-field">
                <label htmlFor="appointment-location">City for provider and hospital</label>
                <select
                  id="appointment-location"
                  value={hospitalCity}
                  onChange={(event) => handleLocationChange(event.target.value)}
                  required
                  disabled={doctorsLoading || submitting}
                >
                  <option value="">Select a city</option>
                  {availableCities.map((city) => (
                    <option key={city} value={city}>{city}</option>
                  ))}
                </select>
                <small>Used for both provider and hospital results.</small>
              </div>

              <div className="booking-field">
                <label htmlFor="doctor-specialty">Specialty</label>
                <select
                  id="doctor-specialty"
                  value={doctorSpecialty}
                  onChange={(event) => handleSpecialtyChange(event.target.value)}
                  disabled={doctorsLoading || submitting}
                >
                  <option value="">All specialties</option>
                  {availableSpecialties.map((specialty) => (
                    <option key={specialty} value={specialty}>
                      {specialty}
                      {SPECIALTY_GUIDANCE[specialty]
                        ? ` — ${SPECIALTY_GUIDANCE[specialty]}`
                        : ''}
                    </option>
                  ))}
                </select>
                <small>Optional filter for the demo provider directory.</small>
              </div>

              <div className="booking-field booking-field-wide">
                <label htmlFor="doctor">Select doctor</label>
                <select
                  id="doctor"
                  value={form.doctorId}
                  onChange={(event) => setForm({ ...form, doctorId: event.target.value })}
                  required
                  disabled={doctorsLoading || doctors.length === 0 || submitting}
                >
                  <option value="">
                    {filteredDoctors.length ? 'Select a doctor' : 'No doctors match these filters'}
                  </option>
                  {filteredDoctors.map((doctor) => (
                    <option key={getDoctorId(doctor)} value={getDoctorId(doctor)}>
                      {doctor.name} — {doctor.specialty}
                      {doctor.location ? ` (${doctor.location})` : ''}
                    </option>
                  ))}
                </select>
                <small>{filteredDoctors.length} matching provider{filteredDoctors.length === 1 ? '' : 's'} in the demo directory.</small>
              </div>

              <div className="booking-field">
                <label htmlFor="date">Appointment date</label>
                <input
                  id="date"
                  type="date"
                  min={today}
                  value={form.date}
                  onChange={(event) => setForm({ ...form, date: event.target.value })}
                  required
                  disabled={submitting}
                />
                <small>Choose today or a future date.</small>
              </div>

              <div className="booking-field">
                <label htmlFor="time">Appointment time</label>
                <input
                  id="time"
                  type="time"
                  step="900"
                  value={form.time}
                  onChange={(event) => setForm({ ...form, time: event.target.value })}
                  required
                  disabled={submitting}
                />
                <small>Choose a time in 15-minute increments. A slot can only be booked once per doctor.</small>
              </div>
            </div>

            <section className="hospital-booking-section" aria-labelledby="hospital-booking-title">
              <div className="hospital-section-heading">
                <span className="hospital-heading-icon"><HospitalIcon /></span>
                <div>
                  <h3 id="hospital-booking-title">Hospital location</h3>
                  <p>Use the shared appointment city to search the live directory, then select a hospital.</p>
                </div>
                {selectedHospital && <span className="hospital-selected-badge">Selected</span>}
              </div>

              <p className="hospital-shared-location">
                {hospitalCity.trim()
                  ? <>Provider and hospital city: <strong>{hospitalCity.trim()}</strong>. Edit the shared city above to change both.</>
                  : 'Choose the shared city above to filter providers and search hospitals.'}
              </p>

              <div className="hospital-search-controls">
                <div className="hospital-search-field">
                  <label htmlFor="appointment-hospital-name">Hospital name (optional)</label>
                  <input
                    id="appointment-hospital-name"
                    type="text"
                    value={hospitalName}
                    onChange={(event) => updateHospitalCriteria('name', event.target.value)}
                    onKeyDown={handleHospitalSearchKey}
                    placeholder="e.g. Apollo"
                    maxLength={100}
                    disabled={submitting}
                  />
                </div>
                <button
                  type="button"
                  className="book-appointment-btn hospital-search-btn"
                  onClick={runHospitalSearch}
                  disabled={hospitalLoading || submitting}
                >
                  {hospitalLoading ? 'Searching…' : 'Search hospitals'}
                </button>
              </div>

              {hospitalLoading && (
                <p className="hospital-search-status" role="status">
                  Finding mapped hospitals near {hospitalCity.trim()}…
                </p>
              )}
              {hospitalError && (
                <div className="hospital-search-error" role="alert">
                  <span>{hospitalError}</span>
                  {!hospitalLoading && (
                    <button type="button" onClick={runHospitalSearch}>Try again</button>
                  )}
                </div>
              )}

              {selectedHospital && (
                <div className="selected-hospital-card">
                  <div>
                    <span className="selected-hospital-label">Selected hospital</span>
                    <h4>{selectedHospital.name}</h4>
                    <p>{selectedHospital.address || 'Address not available in map data'}</p>
                    {(selectedHospital.city || selectedHospital.state) && (
                      <p>{[selectedHospital.city, selectedHospital.state].filter(Boolean).join(', ')}</p>
                    )}
                    <small>Hospital data: {selectedHospital.source}</small>
                  </div>
                  <div className="selected-hospital-actions">
                    <a href={hospitalMapUrl(selectedHospital)} target="_blank" rel="noreferrer">
                      View on Google Maps ↗
                    </a>
                    {hospitalResults.length > 1 && !hospitalResultsVisible && (
                      <button type="button" onClick={() => setHospitalResultsVisible(true)}>
                        Change hospital
                      </button>
                    )}
                  </div>
                </div>
              )}

              {hospitalResultsVisible && hospitalResults.length > 0 && (
                <>
                  <div className="hospital-results-meta">
                    <span>{hospitalResults.length} selectable hospitals</span>
                    <small>
                      {hospitalSource}{hospitalCached ? ' · Cached' : ' · Live'}
                    </small>
                  </div>
                  <ul className="hospital-results" aria-label="Hospital search results">
                    {hospitalResults.map((hospital) => {
                      const selected = selectedHospital?.id === hospital.id
                      return (
                        <li className={`hospital-result${selected ? ' selected' : ''}`} key={hospital.id}>
                          <h4>{hospital.name}</h4>
                          <p>{hospital.address || 'Address not available in map data'}</p>
                          {(hospital.city || hospital.state) && (
                            <p>{[hospital.city, hospital.state].filter(Boolean).join(', ')}</p>
                          )}
                          <div className="hospital-result-footer">
                            <a
                              href={hospitalMapUrl(hospital)}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`View ${hospital.name} on Google Maps`}
                            >
                              Google Maps ↗
                            </a>
                            <button
                              type="button"
                              className="hospital-select-btn"
                              disabled={selected || submitting}
                              onClick={() => {
                                setSelectedHospital(hospital)
                                setHospitalResultsVisible(false)
                                setHospitalError('')
                                setError('')
                              }}
                            >
                              {selected ? 'Selected' : 'Select hospital'}
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}

              {!hospitalLoading && !hospitalError && hospitalSearched && hospitalResults.length === 0 && (
                <p className="hospital-search-status">
                  No selectable mapped hospitals found. Try another city or remove the name filter.
                </p>
              )}
              {hospitalNotice && <p className="hospital-search-notice">{hospitalNotice}</p>}
              <p className="hospital-search-notice">
                Selecting a hospital saves its displayed location; it does not confirm doctor
                affiliation, availability, or a real-world booking.
              </p>
            </section>

            <div className="booking-field booking-reason">
              <label htmlFor="reason">Reason for visit <span>(optional)</span></label>
              <input
                id="reason"
                type="text"
                maxLength={500}
                value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.target.value })}
                placeholder="Brief reason for the appointment"
                disabled={submitting}
              />
              <small>Share only synthetic, non-clinical information for this demo.</small>
            </div>

            <div className="booking-form-footer">
              <p>Confirming saves the selected provider and hospital to your appointment.</p>
              <button
                type="submit"
                className="book-appointment-btn"
                disabled={submitting || doctorsLoading || doctors.length === 0}
              >
                {submitting ? 'Saving…' : 'Confirm booking'}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="appointment-list-heading">
        <div>
          <h2>Your appointments</h2>
          <p>Review upcoming visits or look back at your history.</p>
        </div>
        <div className="appointment-tabs" role="group" aria-label="Appointment filter">
          <button
            className={activeTab === 'Upcoming' ? 'active' : ''}
            aria-pressed={activeTab === 'Upcoming'}
            onClick={() => setActiveTab('Upcoming')}
            type="button"
          >
            Upcoming <span>{upcomingCount}</span>
          </button>
          <button
            className={activeTab === 'Past' ? 'active' : ''}
            aria-pressed={activeTab === 'Past'}
            onClick={() => setActiveTab('Past')}
            type="button"
          >
            Past <span>{pastCount}</span>
          </button>
        </div>
      </div>

      <section className="appointment-list" aria-live="polite" aria-busy={loading}>
        {loading ? (
          <div className="appointments-empty" role="status">
            <p>Loading your appointments…</p>
          </div>
        ) : visibleAppointments.length > 0 ? (
          visibleAppointments.map((appointment) => {
            const id = getAppointmentId(appointment)
            const doctorName = appointment.doctor || 'Doctor'
            const initials = doctorName
              .replace(/^Dr\.\s*/i, '')
              .split(' ')
              .filter(Boolean)
              .map((word) => word[0])
              .join('')
              .slice(0, 2)
              .toUpperCase() || 'D'
            const status = resolveAppointmentStatus(appointment)
            const startsAt = getAppointmentEndTime(appointment)
            const cancellationAllowed = startsAt &&
              startsAt.getTime() - APPOINTMENT_DURATION_MINUTES * 60_000 - Date.now() >= 60 * 60_000
            const canCancel = status === 'Upcoming'
            const hospital = appointment.hospital
            const mapUrl = hospitalMapUrl(hospital)

            return (
              <article className={`appointment-row ${status.toLowerCase()}`} key={id || `${doctorName}-${appointment.date}-${appointment.time}`}>
                <div className="doctor-avatar" aria-hidden="true">{initials}</div>
                <div className="doctor-details">
                  <h3>{doctorName}</h3>
                  <p>{appointment.specialty}</p>
                  <div className="appointment-datetime">
                    <span>▦ {formatDate(appointment.date)}</span>
                    <span className="datetime-divider">|</span>
                    <span>◷ {formatTime(appointment.time)}</span>
                  </div>
                  {hospital?.name && (
                    <div className="appointment-hospital">
                      <p className="appointment-hospital-name"><HospitalIcon /> {hospital.name}</p>
                      <p>{hospital.address || 'Address not available in map data'}</p>
                      {(hospital.city || hospital.state) && (
                        <p>{[hospital.city, hospital.state].filter(Boolean).join(', ')}</p>
                      )}
                      {mapUrl && (
                        <a href={mapUrl} target="_blank" rel="noreferrer">
                          View hospital on Google Maps ↗
                        </a>
                      )}
                      <small>Hospital data: {hospital.source}</small>
                    </div>
                  )}
                  {appointment.reason && (
                    <p className="appointment-reason">Reason: {appointment.reason}</p>
                  )}
                </div>

                <div className="appointment-row-actions">
                  <span className={`appointment-status ${status.toLowerCase()}`}>
                    <span className="status-dot">●</span>
                    {status}
                  </span>
                  {canCancel && (
                    <button
                      className="cancel-appointment-btn"
                      onClick={() => handleCancel(appointment)}
                      disabled={cancellingId === id || !cancellationAllowed}
                      title={!cancellationAllowed
                        ? 'Appointments cannot be cancelled within 1 hour of their start time.'
                        : undefined}
                      type="button"
                    >
                      {cancellingId === id ? 'Cancelling…' : 'Cancel'}
                    </button>
                  )}
                  {canCancel && !cancellationAllowed && (
                    <small className="cancellation-window-notice">
                      Cancellation closes 1 hour before the appointment.
                    </small>
                  )}
                </div>
              </article>
            )
          })
        ) : (
          <div className="appointments-empty">
            <CalendarIcon />
            <h3>No {activeTab.toLowerCase()} appointments</h3>
            <p>
              {activeTab === 'Upcoming'
                ? 'Book a new appointment to see it here.'
                : 'Your past or cancelled appointments will appear here.'}
            </p>
          </div>
        )}
      </section>

      <p className="appointments-disclaimer">
        Demo providers are synthetic and are not verified as affiliated with selected hospitals.
        Hospital listings come from map providers; availability and appointments are not confirmed
        with the hospital.
      </p>
    </div>
  )
}
